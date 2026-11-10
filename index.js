/**
 * Host half of dsh-instance-manager.
 *
 * Serves a small JSON API for the "DSH 多开器" panel:
 *   GET  /dsh-instance-manager/api  -> { root, instances }
 *   POST /dsh-instance-manager/api  -> { action: list|create|start|stop|open|delete, ... }
 *
 * The panel itself lives in client.js. This half runs inside the current DSH
 * host process, so it may enumerate sibling DSH homes and spawn / stop them.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, readlinkSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import net from 'node:net';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_NAME = 'dsh-instance-manager';

// When this module runs from a per-instance copy, PLUGIN_DIR points inside
// that instance's profile. The profile dependency must never point back at
// itself (pnpm then fails with "symlink path is the same as target path"),
// so resolve the canonical source when we can find it.
function resolvePluginSource() {
  const envSource = process.env.DSH_INSTANCE_MANAGER_PLUGIN;
  if (envSource && existsSync(join(envSource, 'package.json'))) return resolve(envSource);
  const marker = `${sep}node_modules${sep}${PLUGIN_NAME}`;
  if (PLUGIN_DIR.toLowerCase().endsWith(marker.toLowerCase())) {
    const instanceHome = resolve(PLUGIN_DIR, '..', '..', '..', '..');
    const candidate = resolve(instanceHome, '..', '..', 'plugin', PLUGIN_NAME);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return PLUGIN_DIR;
}

const PLUGIN_SOURCE = resolvePluginSource();
const PLUGIN_SPEC = 'link:' + PLUGIN_SOURCE.replace(/\\/g, '/');
const MULTI_ROOT = resolve(PLUGIN_DIR, '..', '..');
// Dev layout: <multi>/plugin/dsh-instance-manager -> instances live in <multi>/instances.
// Installed layout: keep friends' instances under their own DSH home instead of
// writing next to the extracted plugin folder (or a drive root).
const DEV_LAYOUT = existsSync(join(MULTI_ROOT, 'instances')) && existsSync(join(MULTI_ROOT, 'plugin'));
const FALLBACK_ROOT = join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'dsh-multi', 'instances');
const INSTANCES_ROOT = resolve(process.env.DSH_INSTANCE_MANAGER_ROOT || (DEV_LAYOUT ? join(MULTI_ROOT, 'instances') : FALLBACK_ROOT));
const API_PATH = '/dsh-instance-manager/api-v2';
const LOG_FILE = join(PLUGIN_DIR, 'host.log');
const APP_EXE = process.execPath;
const CLI_JS = join(dirname(APP_EXE), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
const PNPM_JS = join(dirname(APP_EXE), 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'dist', 'pnpm.mjs');
const PORT_MIN = 61200;
const PORT_MAX = 61299;
const SCRUB_ENV = ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_SHELL', 'DSH_WEB_URL', 'ELECTRON_RUN_AS_NODE'];
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
const PROFILE_PATCH_TEMPLATE = [
  '# Local DSH profile patch. Add rows here to configure this instance.',
  '[]',
  '',
].join('\n');
const PNPM_WORKSPACE = [
  'packages:',
  "  - '.'",
  'nodeLinker: hoisted',
  'autoInstallPeers: false',
  '',
].join('\n');
const REGISTRY_DIR = join(INSTANCES_ROOT, '_registry');
const REGISTRY_TTL = 60_000;
const REGISTRY_INTERVAL = 10_000;

let logBytes = 0;
try {
  logBytes = statSync(LOG_FILE).size;
} catch {
  logBytes = 0;
}

function log(...parts) {
  try {
    // Keep the diagnostic log bounded: a long-lived host would otherwise grow it
    // forever. One rotated file is enough for troubleshooting.
    if (logBytes > 1_000_000) {
      try {
        renameSync(LOG_FILE, LOG_FILE + '.1');
      } catch {
        /* keep appending if rotation fails */
      }
      logBytes = 0;
    }
    const line = `${new Date().toISOString()} ${parts.map((part) => String(part)).join(' ')}\n`;
    appendFileSync(LOG_FILE, line);
    logBytes += Buffer.byteLength(line);
  } catch {
    /* logging is best effort */
  }
}

function apiError(message) {
  return new Error(message);
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function readMeta(home) {
  return readJson(join(home, 'instance.json')) || {};
}

function writeMeta(home, meta) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'instance.json'), JSON.stringify(meta, null, 2), 'utf8');
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function currentHome() {
  return resolve(process.env.DSH_HOME || join(os.homedir(), '.dsh'));
}

function underRoot(home) {
  const target = resolve(home).toLowerCase();
  const root = INSTANCES_ROOT.toLowerCase();
  return target === root || target.startsWith(root + sep.toLowerCase());
}

function portOpen(port, timeout = 400) {
  return new Promise((resolveProbe) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.destroy();
      resolveProbe(value);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryBind(port) {
  return new Promise((resolveBind) => {
    const server = net.createServer();
    server.once('error', () => resolveBind(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolveBind(true));
    });
  });
}

async function allocatePort() {
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    if (await tryBind(port)) return port;
  }
  throw apiError(`端口 ${PORT_MIN}-${PORT_MAX} 已全部占用`);
}

function findPidByPort(port) {
  try {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    for (const line of String(out.stdout || '').split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      if (parts[1].endsWith(`:${port}`)) {
        const pid = Number(parts[parts.length - 1]);
        if (pid) return pid;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

let cachedApiKey;
function userApiKey() {
  if (cachedApiKey !== undefined) return cachedApiKey;
  cachedApiKey = null;
  try {
    const out = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')",
    ], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    const value = String(out.stdout || '').trim();
    if (value) cachedApiKey = value;
  } catch {
    /* ignore */
  }
  return cachedApiKey;
}

function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of SCRUB_ENV) delete env[key];
  Object.assign(env, extra);
  // Give every instance its own user-profile surface. Plugins that resolve
  // home through os.homedir()/USERPROFILE (~/.dsh) then stay inside the
  // instance instead of writing into the main DSH home.
  if (env.DSH_HOME) {
    const home = resolve(env.DSH_HOME);
    const profile = join(home, 'profile');
    const localAppData = join(home, 'localappdata');
    const temp = join(home, 'temp');
    mkdirSync(profile, { recursive: true });
    mkdirSync(localAppData, { recursive: true });
    mkdirSync(temp, { recursive: true });
    env.USERPROFILE = profile;
    env.HOME = profile;
    env.HOMEDRIVE = profile.slice(0, 2);
    env.HOMEPATH = profile.slice(2);
    if (!env.APPDATA) env.APPDATA = join(home, 'appdata');
    env.LOCALAPPDATA = localAppData;
    if (!env.TEMP) env.TEMP = temp;
    if (!env.TMP) env.TMP = env.TEMP;
    env.DSH_INSTANCE_MANAGER_PLUGIN = PLUGIN_SOURCE;
  }
  if (!env.DEEPSEEK_API_KEY) {
    const key = userApiKey();
    if (key) env.DEEPSEEK_API_KEY = key;
  }
  return env;
}

function describe(home, meta, fallbackName) {
  const kind = meta.kind === 'desktop' ? 'desktop' : 'web';
  return {
    id: home,
    name: meta.name || fallbackName || basename(home),
    kind,
    home,
    workspace: meta.workspace || join(home, 'workspace'),
    port: Number.isFinite(Number(meta.port)) && meta.port ? Number(meta.port) : null,
    pid: Number.isFinite(Number(meta.pid)) && meta.pid ? Number(meta.pid) : null,
    createdAt: meta.createdAt || meta.startedAt || null,
    manager: Boolean(meta.manager),
  };
}

function originPort(web) {
  try {
    const origin = typeof web.getOrigin === 'function' ? web.getOrigin() : '';
    if (origin && typeof origin.then === 'function') return null;
    const url = new URL(String(origin));
    return Number(url.port) || null;
  } catch {
    return null;
  }
}

async function probe(entry) {
  if (entry.kind === 'web') {
    if (!entry.port) return 'stopped';
    return (await portOpen(entry.port)) ? 'running' : 'stopped';
  }
  return pidAlive(entry.pid) ? 'running' : 'stopped';
}

let selfFile = null;

function selfEntry(web) {
  const home = currentHome();
  const meta = readJson(join(home, 'instance.json')) || {};
  const insideRoot = underRoot(home);
  const name = meta.name || (insideRoot ? basename(home) : '主 DSH');
  const kind = meta.kind === 'desktop' || meta.kind === 'web' ? meta.kind : (insideRoot ? 'web' : 'desktop');
  return {
    id: home,
    name,
    kind,
    home,
    workspace: meta.workspace || join(home, 'workspace'),
    port: originPort(web),
    pid: process.pid,
    status: 'running',
    current: true,
    createdAt: meta.createdAt || meta.startedAt || null,
    manager: Boolean(meta.manager),
    updatedAt: Date.now(),
  };
}

function registryFile(home) {
  const hash = createHash('sha1').update(resolve(home).toLowerCase()).digest('hex').slice(0, 16);
  return join(REGISTRY_DIR, hash + '.json');
}

function publishSelf(web) {
  try {
    mkdirSync(REGISTRY_DIR, { recursive: true });
    const entry = selfEntry(web);
    const file = registryFile(entry.home);
    writeFileSync(file, JSON.stringify(entry), 'utf8');
    selfFile = file;
  } catch (error) {
    log('registry publish failed:', error && error.message ? error.message : error);
  }
}

function readRegistry() {
  const entries = [];
  if (!isDir(REGISTRY_DIR)) return entries;
  try {
    for (const name of readdirSync(REGISTRY_DIR)) {
      if (!name.endsWith('.json')) continue;
      const entry = readJson(join(REGISTRY_DIR, name));
      if (entry && entry.home) entries.push(entry);
    }
  } catch {
    /* ignore a half-written registry */
  }
  return entries;
}

function clearSelf() {
  try {
    if (selfFile) unlinkSync(selfFile);
  } catch {
    /* already gone */
  }
  selfFile = null;
}

function clearRegistryEntry(home) {
  try {
    unlinkSync(registryFile(home));
  } catch {
    /* no entry for this home */
  }
}

async function collect(web) {
  const current = selfEntry(web);
  const byHome = new Map();
  byHome.set(resolve(current.home).toLowerCase(), current);
  if (isDir(INSTANCES_ROOT)) {
    for (const name of readdirSync(INSTANCES_ROOT).sort()) {
      if (name === '_registry') continue;
      const home = join(INSTANCES_ROOT, name);
      if (!isDir(home)) continue;
      const key = resolve(home).toLowerCase();
      if (byHome.has(key)) continue;
      const meta = readJson(join(home, 'instance.json'));
      if (!meta && !isDir(join(home, 'profiles'))) continue;
      const entry = describe(home, meta || {}, name);
      entry.current = false;
      entry.status = await probe(entry);
      byHome.set(key, entry);
    }
  }
  const now = Date.now();
  for (const entry of readRegistry()) {
    if (!entry.home) continue;
    const key = resolve(entry.home).toLowerCase();
    if (key === resolve(current.home).toLowerCase()) continue;
    if (entry.pid && !pidAlive(Number(entry.pid))) {
      try {
        unlinkSync(registryFile(entry.home));
      } catch {
        /* already gone */
      }
      continue;
    }
    if (now - Number(entry.updatedAt || 0) > REGISTRY_TTL) continue;
    const existing = byHome.get(key);
    if (existing) {
      existing.status = 'running';
      existing.pid = Number(entry.pid) || existing.pid;
      existing.port = Number(entry.port) || existing.port;
      existing.kind = entry.kind === 'desktop' || entry.kind === 'web' ? entry.kind : existing.kind;
    } else {
      byHome.set(key, { ...entry, current: false, status: 'running' });
    }
  }
  const instances = [current, ...Array.from(byHome.values()).filter((entry) => entry !== current)];
  return { root: INSTANCES_ROOT, instances };
}

function requireManaged(id) {
  if (!id || id === 'current') throw apiError('当前窗口不能这样操作');
  const home = resolve(String(id));
  if (!underRoot(home)) throw apiError('实例路径不在多开器目录内');
  if (!isDir(home)) throw apiError('实例目录不存在');
  return describe(home, readMeta(home), basename(home));
}

function createInstance(body) {
  const raw = String(body.name || '').trim().slice(0, 32);
  const name = raw.replace(/[\\/:*?"<>|]/g, '-').trim() || 'dsh';
  const kind = body.platform === 'desktop' ? 'desktop' : 'web';
  let home = join(INSTANCES_ROOT, name);
  let index = 2;
  while (existsSync(home)) {
    home = join(INSTANCES_ROOT, `${name}-${index}`);
    index += 1;
  }
  mkdirSync(join(home, 'workspace'), { recursive: true });
  const meta = {
    name,
    kind,
    home,
    workspace: join(home, 'workspace'),
    createdAt: new Date().toISOString(),
    manager: true,
  };
  writeMeta(home, meta);
  return describe(home, meta, name);
}

/**
 * Copy an instance's configuration and plugin list into a brand-new home.
 * Sessions, credentials, workspaces contents and user data are intentionally
 * NOT copied: a clone should behave like a fresh install with the same setup.
 */
function cloneInstance(body) {
  const source = requireManaged(body.id);
  const raw = String(body.name || '').trim().slice(0, 32);
  const wanted = (raw || `${source.name}-副本`).replace(/[\\/:*?"<>|]/g, '-').trim() || `${source.name}-副本`;
  let home = join(INSTANCES_ROOT, wanted);
  let index = 2;
  while (existsSync(home)) {
    home = join(INSTANCES_ROOT, `${wanted}-${index}`);
    index += 1;
  }
  const name = basename(home);
  const workspace = join(home, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const meta = {
    name,
    kind: source.kind,
    home,
    workspace,
    createdAt: new Date().toISOString(),
    manager: true,
    clonedFrom: source.home,
  };
  writeMeta(home, meta);

  const fromProfile = join(source.home, 'profiles', source.kind);
  const toProfile = join(home, 'profiles', source.kind);
  mkdirSync(toProfile, { recursive: true });
  for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
    const from = join(fromProfile, file);
    if (existsSync(from)) copyFileSync(from, join(toProfile, file));
  }
  ensureProfilePlugin(home, source.kind);

  let note = '';
  try {
    const deps = readJson(join(toProfile, 'package.json'))?.dependencies || {};
    if (Object.keys(deps).length > 0) {
      if (!existsSync(PNPM_JS)) {
        note = '，未找到 pnpm，插件需要进入实例后安装';
      } else {
        const install = spawnSync(
          process.execPath,
          [PNPM_JS, 'install', '--ignore-scripts', '--reporter=append-only'],
          {
            cwd: toProfile,
            env: childEnv({
              DSH_HOME: home,
              DSH_INSTANCE_MANAGER_ROOT: INSTANCES_ROOT,
              // process.execPath is the Electron binary; without this flag it
              // would open a GUI window instead of running pnpm as Node.
              ELECTRON_RUN_AS_NODE: '1',
            }),
            windowsHide: true,
            timeout: 180_000,
            encoding: 'utf8',
          },
        );
        if (install.status === 0) {
          note = '，插件已装好';
        } else {
          note = '，插件安装未完成（可进入实例后重试）';
          log('clone install failed:', String(install.stdout || '').slice(-400), String(install.stderr || '').slice(-400));
        }
      }
    }
  } catch (error) {
    note = '，插件安装出错（可进入实例后重试）';
    log('clone install error:', error && error.message ? error.message : error);
  }
  return { ...describe(home, meta, name), message: `已复制「${source.name}」为「${name}」${note}` };
}

async function waitForUrl(logPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = safeRead(logPath);
    const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/);
    if (match) return `http://127.0.0.1:${match[1]}/?token=${match[2]}`;
    await new Promise((done) => setTimeout(done, 350));
  }
  return null;
}

function findBrowser() {
  const candidates = [
    process.env.DSH_INSTANCE_MANAGER_BROWSER,
    join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { if (existsSync(candidate)) return candidate; } catch {}
  }
  return '';
}

function openInBrowser(url) {
  if (!url) return { opened: false, browser: '' };
  const browser = findBrowser();
  if (browser) {
    try {
      spawn(browser, [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      const raw = browser.split(/[\\/]/).pop() || browser;
      const label = /msedge/i.test(raw) ? 'Edge' : /chrome/i.test(raw) ? 'Chrome' : raw;
      log('opened url via', browser);
      return { opened: true, browser: label };
    } catch (err) {
      log('browser launch failed:', String(err));
    }
  }
  try {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    log('opened url via default handler');
    return { opened: true, browser: 'default' };
  } catch (err) {
    log('default open failed:', String(err));
    return { opened: false, browser: '' };
  }
}

function ensureFile(file, text) {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

function syncPluginPackage(profileDir) {
  const dest = join(profileDir, 'node_modules', PLUGIN_NAME);
  if (resolve(dest).toLowerCase() === PLUGIN_SOURCE.toLowerCase()) return;
  if (!existsSync(join(PLUGIN_SOURCE, 'package.json'))) {
    log('plugin source missing:', PLUGIN_SOURCE);
    return;
  }
  try {
    const stat = lstatSync(dest);
    if (stat.isSymbolicLink()) {
      try {
        if (resolve(readlinkSync(dest)).toLowerCase() === PLUGIN_SOURCE.toLowerCase()) return;
      } catch {
        /* fall through and replace the stale link */
      }
      // Only unlink the link. A recursive remove of a Windows reparse point
      // follows it and deletes the linked source directory.
      unlinkSync(dest);
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return;
  }
  mkdirSync(dest, { recursive: true });
  cpSync(PLUGIN_SOURCE, dest, {
    recursive: true,
    force: true,
    filter: (source) => !source.endsWith('host.log'),
  });
}

function removeExternalLinks(home) {
  for (const kind of ['web', 'desktop']) {
    const modules = join(home, 'profiles', kind, 'node_modules');
    if (!isDir(modules)) continue;
    for (const name of readdirSync(modules)) {
      const entry = join(modules, name);
      try {
        if (lstatSync(entry).isSymbolicLink()) unlinkSync(entry);
      } catch {
        /* skip unreadable entries */
      }
    }
  }
}

function ensureProfilePlugin(home, kind) {
  try {
    const profileKind = kind === 'desktop' ? 'desktop' : 'web';
    const profileDir = join(home, 'profiles', profileKind);
    mkdirSync(join(profileDir, 'node_modules'), { recursive: true });
    const pkgPath = join(profileDir, 'package.json');
    const pkg = readJson(pkgPath) || {
      name: `dsh-profile-${profileKind}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    };
    if (!pkg.dsh || typeof pkg.dsh !== 'object') pkg.dsh = {};
    if (!pkg.dsh.profile || typeof pkg.dsh.profile !== 'object') pkg.dsh.profile = {};
    const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles.slice() : [];
    for (const bundle of BASE_BUNDLES) {
      if (!bundles.includes(bundle)) bundles.push(bundle);
    }
    if (!bundles.includes(PLUGIN_NAME)) bundles.push(PLUGIN_NAME);
    pkg.dsh.profile.bundles = bundles;
    if (!pkg.dependencies || typeof pkg.dependencies !== 'object') pkg.dependencies = {};
    const dest = join(profileDir, 'node_modules', PLUGIN_NAME);
    if (resolve(dest).toLowerCase() === PLUGIN_SOURCE.toLowerCase()) {
      delete pkg.dependencies[PLUGIN_NAME];
      log('skipping self-referential dependency for', profileDir);
    } else {
      pkg.dependencies[PLUGIN_NAME] = PLUGIN_SPEC;
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    syncPluginPackage(profileDir);
    ensureFile(join(profileDir, 'cordis.yml'), '[]\n');
    ensureFile(join(profileDir, 'cordis.patch.yml'), PROFILE_PATCH_TEMPLATE);
    ensureFile(join(profileDir, 'pnpm-workspace.yaml'), PNPM_WORKSPACE);
  } catch (error) {
    log('ensureProfilePlugin failed:', home, error && error.message ? error.message : error);
  }
}

function refreshExistingProfiles() {
  if (!isDir(INSTANCES_ROOT)) return;
  for (const name of readdirSync(INSTANCES_ROOT)) {
    const home = join(INSTANCES_ROOT, name);
    if (!isDir(home)) continue;
    const meta = readJson(join(home, 'instance.json'));
    if (!meta) continue;
    ensureProfilePlugin(home, meta.kind === 'desktop' ? 'desktop' : 'web');
  }
}

async function clearStalePort(port, home) {
  if (!isDir(INSTANCES_ROOT)) return;
  for (const name of readdirSync(INSTANCES_ROOT)) {
    const other = join(INSTANCES_ROOT, name);
    if (!isDir(other) || resolve(other).toLowerCase() === resolve(home).toLowerCase()) continue;
    const meta = readJson(join(other, 'instance.json'));
    if (!meta || Number(meta.port) !== Number(port)) continue;
    if (pidAlive(meta.pid)) continue;
    if (await portOpen(port)) continue;
    delete meta.port;
    delete meta.url;
    delete meta.pid;
    writeMeta(other, meta);
    log('cleared stale port', port, 'from', other);
  }
}

async function startWeb(entry) {
  const home = entry.home;
  const workspace = join(home, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const port = await allocatePort();
  await clearStalePort(port, home);
  ensureProfilePlugin(home, 'web');
  const logPath = join(home, 'web.log');
  const env = childEnv({ DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_INSTANCE_MANAGER_ROOT: INSTANCES_ROOT });
  const fd = openSync(logPath, 'w');
  let child;
  try {
    child = spawn(APP_EXE, [
      '--expose-internals', CLI_JS,
      'web', '--no-open', '--host', '127.0.0.1', '--port', String(port),
    ], {
      cwd: workspace,
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
  const url = await waitForUrl(logPath, 20000);
  if (!url && !(await portOpen(port))) {
    throw apiError(`网页版启动失败，可查看 ${logPath}`);
  }
  const pid = findPidByPort(port) || child.pid || null;
  const meta = {
    ...readMeta(home),
    name: entry.name,
    kind: 'web',
    home,
    workspace,
    port,
    pid,
    url: url || `http://127.0.0.1:${port}/`,
    startedAt: new Date().toISOString(),
  };
  writeMeta(home, meta);
  const openResult = openInBrowser(meta.url);
  const opened = openResult.opened;
  return {
    ...entry,
    port,
    pid,
    status: 'running',
    url: meta.url,
    opened,
    message: opened ? `已启动「${entry.name}」并打开浏览器` : `已启动「${entry.name}」`,
  };
}

async function startDesktop(entry) {
  const home = entry.home;
  const workspace = join(home, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const appdata = join(home, 'appdata');
  const userdata = join(home, 'userdata');
  mkdirSync(appdata, { recursive: true });
  mkdirSync(userdata, { recursive: true });
  ensureProfilePlugin(home, 'desktop');
  const env = childEnv({ DSH_HOME: home, APPDATA: appdata, DSH_INSTANCE_MANAGER_ROOT: INSTANCES_ROOT });
  const logPath = join(home, 'desktop.log');
  let logFd = 'ignore';
  try {
    logFd = openSync(logPath, 'a');
  } catch {
    logFd = 'ignore';
  }
  const child = spawn(APP_EXE, [`--user-data-dir=${userdata}`], {
    cwd: workspace,
    env,
    detached: true,
    windowsHide: false,
    stdio: ['ignore', logFd, logFd],
  });
  if (typeof logFd === 'number') closeSync(logFd);
  child.unref();
  const meta = {
    ...readMeta(home),
    name: entry.name,
    kind: 'desktop',
    home,
    workspace,
    pid: child.pid || null,
    userData: userdata,
    appdata,
    startedAt: new Date().toISOString(),
  };
  writeMeta(home, meta);
  return { ...entry, pid: child.pid || null, status: 'running', message: '已启动桌面窗口，稍等几秒会出现' };
}

async function startInstance(id) {
  const entry = requireManaged(id);
  if ((await probe(entry)) === 'running') {
    let opened = false;
    if (entry.kind !== 'desktop') {
      const meta = readMeta(entry.home);
      opened = openInBrowser(meta.url || (entry.port ? `http://127.0.0.1:${entry.port}/` : '')).opened;
    }
    return {
      ...entry,
      status: 'running',
      opened,
      message: opened
        ? `实例「${entry.name}」已经在运行，已在浏览器打开`
        : `实例「${entry.name}」已经在运行`,
    };
  }
  if (entry.kind === 'desktop') return startDesktop(entry);
  return startWeb(entry);
}

async function restartInstance(id) {
  const entry = requireManaged(id);
  if ((await probe(entry)) !== 'running') throw apiError('实例没有在运行，直接启动即可');
  stopInstance(id);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((done) => setTimeout(done, 300));
    const fresh = requireManaged(id);
    if ((await probe(fresh)) === 'stopped') break;
  }
  const started = await startInstance(id);
  return { ...started, message: `已重启「${entry.name}」` };
}

function stopInstance(id) {
  const entry = requireManaged(id);
  const meta = readMeta(entry.home);
  let pid = Number.isFinite(meta.pid) && pidAlive(meta.pid) ? meta.pid : null;
  if (!pid && entry.port) pid = findPidByPort(entry.port);
  if (!pid) throw apiError('实例没有在运行');
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8000 });
  writeMeta(entry.home, { ...meta, pid: null, port: null, url: null, stoppedAt: new Date().toISOString() });
  clearRegistryEntry(entry.home);
  return { ...entry, pid: null, status: 'stopped', message: `已停止「${entry.name}」` };
}

function openInstance(id) {
  const entry = requireManaged(id);
  if (entry.kind === 'desktop') {
    return { opened: false, message: '桌面版请从任务栏或系统托盘打开' };
  }
  const meta = readMeta(entry.home);
  const url = meta.url || (meta.port ? `http://127.0.0.1:${meta.port}/` : '');
  if (!url) throw apiError('实例还没有启动，先点启动');
  const openResult = openInBrowser(url);
  return {
    opened: openResult.opened,
    url,
    browser: openResult.browser,
    message: openResult.opened
      ? `已在 ${openResult.browser || '浏览器'} 打开「${entry.name}」`
      : `没能唤起浏览器，请手动打开：${url}`,
  };
}

function deleteInstance(id) {
  const entry = requireManaged(id);
  const meta = readMeta(entry.home);
  if (Number.isFinite(meta.pid) && pidAlive(meta.pid)) throw apiError('实例还在运行，先停止再删除');
  if (entry.port && findPidByPort(entry.port)) throw apiError('实例还在运行，先停止再删除');
  removeExternalLinks(entry.home);
  rmSync(entry.home, { recursive: true, force: true });
  clearRegistryEntry(entry.home);
  return { removed: entry.home };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export const inject = ['webServer'];

export function apply(ctx) {
  try {
    const web = ctx.get('webServer');
    if (!web || typeof web.register !== 'function') {
      log('webServer service missing');
      return;
    }
    const route = {
      kind: 'exact',
      path: API_PATH,
      handler: async (req, res) => {
        try {
          const remote = (req.socket && req.socket.remoteAddress) || '';
          if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(remote)) {
            send(res, 403, { error: 'local access only' });
            return;
          }
          if (req.method === 'GET') {
            send(res, 200, await collect(web));
            return;
          }
          if (req.method !== 'POST') {
            send(res, 405, { error: 'method not allowed' });
            return;
          }
          const body = await readBody(req);
          const action = body.action || 'list';
          let result;
          if (action === 'list') result = await collect(web);
          else if (action === 'create') result = createInstance(body);
          else if (action === 'start') result = await startInstance(body.id);
          else if (action === 'stop') result = stopInstance(body.id);
          else if (action === 'restart') result = await restartInstance(body.id);
          else if (action === 'clone') result = cloneInstance(body);
          else if (action === 'open') result = openInstance(body.id);
          else if (action === 'delete') result = deleteInstance(body.id);
          else throw apiError(`未知动作: ${action}`);
          send(res, 200, { ok: true, result });
        } catch (error) {
          log('api error:', error && error.stack ? error.stack : error);
          send(res, 400, { error: error && error.message ? error.message : String(error) });
        }
      },
    };
    try {
      if (typeof globalThis.__dshInstanceManagerDispose === 'function') globalThis.__dshInstanceManagerDispose();
    } catch {
      /* the previous host instance may already be gone */
    }
    const dispose = web.register(route);
    globalThis.__dshInstanceManagerDispose = typeof dispose === 'function' ? dispose : null;
    ctx.effect(() => () => {
      try {
        if (typeof dispose === 'function') dispose();
      } catch {
        /* route already removed */
      }
    });
    log('api registered at', API_PATH, 'dispose=', typeof dispose);
    publishSelf(web);
    const heartbeat = setInterval(() => publishSelf(web), REGISTRY_INTERVAL);
    heartbeat.unref?.();
    ctx.effect(() => () => {
      clearInterval(heartbeat);
      clearSelf();
    });
    refreshExistingProfiles();
    log('existing profiles refreshed');
  } catch (error) {
    log('apply failed:', error && error.stack ? error.stack : error);
  }
}
