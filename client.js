window.__ModuleLoader__.load({
  id: 'dsh-instance-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;

    const API = '/dsh-instance-manager/api-v2';
    const IS_DESKTOP = /Electron/i.test(navigator.userAgent);
    const ZH = (navigator.language || 'en').toLowerCase().startsWith('zh');

    const T = ZH
      ? {
          nav: '多开器',
          title: 'DSH 多开器',
          subtitle: '本机所有 DSH 的总控台：像安装新软件一样多开，当前窗口也在其中',
          refresh: '刷新',
          newInstance: '新建多开',
          search: '搜索实例',
          sortCreated: '按创建时间',
          sortName: '按名称',
          sortStatus: '按状态',
          createTitle: '新建多开',
          nameLabel: '名称',
          namePlaceholder: '例如：练手 / 测试 / 项目 A',
          platform: '平台',
          platformWeb: '网页版',
          platformWebDesc: '在浏览器中打开，独立端口',
          platformDesktop: 'Windows 桌面版',
          platformDesktopDesc: '独立窗口，可收进系统托盘',
          permHint: '权限在每个 DSH 的会话里选择，和原生 DSH 完全一样（默认工作区内修改，可随时切完全权限或仅可查看）。',
          cancel: '取消',
          create: '创建',
          running: '运行中',
          stopped: '已停止',
          port: '端口',
          created: '创建时间',
          none: '—',
          start: '启动',
          stop: '停止',
          open: '打开',
          deleteConfirm: '删除这个多开实例？整个实例目录都会被删除。',
          currentBadge: '当前窗口',
          currentHint: '这个窗口本身（只读）',
          currentPill: '当前窗口',
          emptyTitle: '还没有多开实例',
          emptyDesc: '新建一个独立的 DSH：独立的插件、账户、会话和权限，像装了一个全新的 DSH。',
          emptyAction: '新建多开',
          loadFailed: '读取实例列表失败',
          actionFailed: '操作失败',
          createdToast: '已创建「{name}」',
          deletedToast: '已删除',
          tip: '关掉窗口不会结束运行中的任务；网页版可随时从「打开」重新唤出。权限在会话里选，和原生 DSH 一样。',
          unnamed: '未命名',
          loading: '正在读取实例…',
          retry: '重试',
          noMatch: '没有匹配的实例',
          restart: '重启',
          clone: '复制',
          selected: '已选 {n} 个',
          batchStart: '启动选中',
          batchStop: '停止选中',
          batchDelete: '删除选中',
          batchClear: '取消选择',
          batchConfirm: '删除选中的 {n} 个实例？实例目录会被删除。',
          batchDone: '已处理 {n} 个',
          batchSkipped: '跳过 {n} 个',
        }
      : {
          nav: 'Multi-opener',
          title: 'DSH Multi-opener',
          subtitle: 'Control panel for every local DSH, including this window',
          refresh: 'Refresh',
          newInstance: 'New instance',
          search: 'Search instances',
          sortCreated: 'By created',
          sortName: 'By name',
          sortStatus: 'By status',
          createTitle: 'New instance',
          nameLabel: 'Name',
          namePlaceholder: 'e.g. Sandbox / Test / Project A',
          platform: 'Platform',
          platformWeb: 'Web',
          platformWebDesc: 'Opens in a browser on its own port',
          platformDesktop: 'Windows desktop',
          platformDesktopDesc: 'Its own window, can live in the tray',
          permHint: 'Permissions are chosen per session inside each DSH, exactly like a native install (workspace-write by default, switchable to full access or read-only).',
          cancel: 'Cancel',
          create: 'Create',
          running: 'Running',
          stopped: 'Stopped',
          port: 'Port',
          created: 'Created',
          none: '—',
          start: 'Start',
          stop: 'Stop',
          open: 'Open',
          deleteConfirm: 'Delete this instance? Its whole home directory will be removed.',
          currentBadge: 'Current window',
          currentHint: 'This window (read only)',
          currentPill: 'Current window',
          emptyTitle: 'No instances yet',
          emptyDesc: 'Create an independent DSH: its own plugins, account, sessions and permissions, like a fresh install.',
          emptyAction: 'New instance',
          loadFailed: 'Could not read the instance list',
          actionFailed: 'Action failed',
          createdToast: 'Created "{name}"',
          deletedToast: 'Deleted',
          tip: 'Closing a window does not stop running tasks; web instances reopen from "Open". Permissions are chosen per session, just like native DSH.',
          unnamed: 'Untitled',
          loading: 'Loading instances…',
          retry: 'Retry',
          noMatch: 'No matching instances',
          restart: 'Restart',
          clone: 'Duplicate',
          selected: '{n} selected',
          batchStart: 'Start selected',
          batchStop: 'Stop selected',
          batchDelete: 'Delete selected',
          batchClear: 'Clear',
          batchConfirm: 'Delete {n} selected instances? Their home directories will be removed.',
          batchDone: 'Handled {n}',
          batchSkipped: 'Skipped {n}',
        };

    const PLATFORMS = [
      { id: 'web', label: T.platformWeb, desc: T.platformWebDesc },
      { id: 'desktop', label: T.platformDesktop, desc: T.platformDesktopDesc },
    ];

    async function api(body) {
      const options = body
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET' };
      const response = await fetch(API, { ...options, cache: 'no-store' });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      return payload || {};
    }

    function normalize(item) {
      const platform = item.current
        ? IS_DESKTOP
          ? 'desktop'
          : 'web'
        : item.kind === 'desktop'
          ? 'desktop'
          : 'web';
      return {
        id: item.id,
        name: item.name || item.id || T.unnamed,
        platform,
        status: item.status === 'running' ? 'running' : 'stopped',
        port: item.port ? Number(item.port) : null,
        pid: item.pid ? Number(item.pid) : null,
        home: item.home || '',
        createdAt: item.createdAt || null,
        current: Boolean(item.current),
      };
    }

    function formatDate(value) {
      if (!value) return T.none;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return T.none;
      return date.toLocaleDateString(ZH ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    function icon(name, size = 16) {
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      };
      if (name === 'plus') return h('svg', common, h('path', { d: 'M12 5v14M5 12h14' }));
      if (name === 'search') {
        return h(
          'svg',
          common,
          h('circle', { cx: 11, cy: 11, r: 6.5 }),
          h('path', { d: 'M16 16l4.2 4.2' }),
        );
      }
      if (name === 'refresh') {
        return h(
          'svg',
          common,
          h('path', { d: 'M20 11a8 8 0 1 0-2.4 5.7' }),
          h('path', { d: 'M20 4v7h-7' }),
        );
      }
      if (name === 'trash') {
        return h(
          'svg',
          common,
          h('path', { d: 'M4 7h16' }),
          h('path', { d: 'M10 11v6M14 11v6' }),
          h('path', { d: 'M7 7l.8 12.1A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.9L17 7' }),
          h('path', { d: 'M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7' }),
        );
      }
      if (name === 'play') {
        return h(
          'svg',
          { ...common, fill: 'currentColor', stroke: 'none' },
          h('path', { d: 'M8 5.5v13l10-6.5z' }),
        );
      }
      if (name === 'stop') {
        return h('svg', common, h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 }));
      }
      if (name === 'external') {
        return h(
          'svg',
          common,
          h('path', { d: 'M14 4h6v6' }),
          h('path', { d: 'M20 4l-9 9' }),
          h('path', { d: 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4' }),
        );
      }
      if (name === 'monitor') {
        return h(
          'svg',
          common,
          h('rect', { x: 3, y: 4.5, width: 18, height: 12, rx: 2 }),
          h('path', { d: 'M8.5 20h7M12 16.5V20' }),
        );
      }
      if (name === 'globe') {
        return h(
          'svg',
          common,
          h('circle', { cx: 12, cy: 12, r: 8 }),
          h('path', { d: 'M4 12h16' }),
          h('path', { d: 'M12 4a13.2 13.2 0 0 1 0 16' }),
          h('path', { d: 'M12 4a13.2 13.2 0 0 0 0 16' }),
        );
      }
      if (name === 'layers') {
        return h(
          'svg',
          common,
          h('path', { d: 'M12 3l9 5-9 5-9-5 9-5z' }),
          h('path', { d: 'M3 13l9 5 9-5' }),
        );
      }
      if (name === 'close') {
        return h('svg', common, h('path', { d: 'M6 6l12 12M18 6L6 18' }));
      }
      if (name === 'restart') {
        return h(
          'svg',
          common,
          h('path', { d: 'M20 8.5A8.2 8.2 0 1 0 20.4 15' }),
          h('path', { d: 'M20 3.5v5h-5' }),
        );
      }
      if (name === 'copy') {
        return h(
          'svg',
          common,
          h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
          h('path', { d: 'M5 15V6.2A1.2 1.2 0 0 1 6.2 5H15' }),
        );
      }
      return h('svg', common);
    }

    function StatusDot(props) {
      return h('span', { className: 'im-dot ' + (props.running ? 'is-running' : '') });
    }

    function Badge(props) {
      return h('span', { className: 'im-badge ' + (props.tone || '') }, props.children);
    }

    function Card(props) {
      const item = props.item;
      const running = item.status === 'running';
      const isCurrent = item.current;
      const busy = props.busy;

      let actions;
      if (isCurrent) {
        actions = h(
          'div',
          { className: 'im-card-actions' },
          h('span', { className: 'im-current-pill' }, T.currentPill),
          h('span', { className: 'im-card-id' }, 'LOCAL'),
        );
      } else {
        const buttons = [];
        if (running) {
          buttons.push(
            h(
              'button',
              {
                type: 'button',
                className: 'im-btn im-btn-primary im-btn-sm',
                disabled: busy,
                onClick: () => props.onStop(item),
              },
              icon('stop', 13),
              h('span', null, T.stop),
            ),
          );
          if (item.platform === 'web') {
            buttons.push(
              h(
                'button',
                {
                  type: 'button',
                  className: 'im-btn im-btn-ghost im-btn-sm',
                  disabled: busy,
                  onClick: () => props.onOpen(item),
                },
                icon('external', 13),
                h('span', null, T.open),
              ),
            );
          }
          buttons.push(
            h(
              'button',
              {
                type: 'button',
                className: 'im-btn im-btn-ghost im-btn-sm',
                disabled: busy,
                onClick: () => props.onRestart(item),
              },
              icon('restart', 13),
              h('span', null, T.restart),
            ),
          );
        } else {
          buttons.push(
            h(
              'button',
              {
                type: 'button',
                className: 'im-btn im-btn-primary im-btn-sm',
                disabled: busy,
                onClick: () => props.onStart(item),
              },
              icon('play', 13),
              h('span', null, T.start),
            ),
          );
        }
        actions = h(
          'div',
          { className: 'im-card-actions' },
          h('div', { className: 'im-card-buttons' }, ...buttons),
          h('span', { className: 'im-card-id' }, item.platform === 'desktop' ? 'WINDOWS' : 'WEB'),
        );
      }

      return h(
        'article',
        { className: 'im-card' + (isCurrent ? ' is-current' : '') + (props.selected ? ' is-selected' : '') },
        h(
          'div',
          { className: 'im-card-top' },
          isCurrent
            ? null
            : h('input', {
                type: 'checkbox',
                className: 'im-select',
                checked: Boolean(props.selected),
                disabled: busy || props.batchBusy,
                onChange: () => props.onSelect(item),
                'aria-label': T.selected.replace('{n}', item.name),
              }),
          h('div', { className: 'im-tile ' + item.platform }, icon(item.platform === 'desktop' ? 'monitor' : 'globe', 19)),
          h(
            'div',
            { className: 'im-card-name' },
            h('div', { className: 'im-card-title', title: item.name }, item.name),
            h(
              'div',
              { className: 'im-card-status' },
              h(StatusDot, { running }),
              h('span', null, running ? T.running : T.stopped),
            ),
          ),
          isCurrent
            ? null
            : h(
                'div',
                { className: 'im-card-tools' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'im-icon-btn',
                    title: T.clone,
                    'aria-label': T.clone,
                    disabled: busy || props.batchBusy,
                    onClick: () => props.onClone(item),
                  },
                  icon('copy', 15),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'im-icon-btn',
                    title: T.deleteConfirm,
                    'aria-label': T.deleteConfirm,
                    disabled: busy || props.batchBusy,
                    onClick: () => props.onDelete(item),
                  },
                  icon('trash', 15),
                ),
              ),
        ),
        h(
          'div',
          { className: 'im-badges' },
          h(Badge, { tone: 'is-platform' }, item.platform === 'desktop' ? 'WINDOWS' : 'WEB'),
          isCurrent ? h(Badge, { tone: 'is-current' }, T.currentBadge) : null,
        ),
        h(
          'div',
          { className: 'im-meta' },
          h(
            'div',
            { className: 'im-meta-row' },
            h('span', null, T.port),
            h('b', null, item.port ? String(item.port) : T.none),
          ),
          h(
            'div',
            { className: 'im-meta-row' },
            h('span', null, T.created),
            h('b', null, isCurrent ? T.currentHint : formatDate(item.createdAt)),
          ),
        ),
        actions,
      );
    }

    function AddTile(props) {
      return h(
        'button',
        { type: 'button', className: 'im-card is-add', disabled: props.busy, onClick: props.onClick },
        h('span', { className: 'im-add-icon' }, icon('plus', 20)),
        h('span', { className: 'im-add-title' }, T.newInstance),
      );
    }

    function Empty(props) {
      return h(
        'div',
        { className: 'im-empty' },
        h('div', { className: 'im-empty-icon' }, icon('layers', 30)),
        h('div', { className: 'im-empty-title' }, T.emptyTitle),
        h('div', { className: 'im-empty-desc' }, T.emptyDesc),
        h(
          'button',
          { type: 'button', className: 'im-btn im-btn-primary', onClick: props.onCreate },
          icon('plus', 15),
          h('span', null, T.emptyAction),
        ),
      );
    }

    function OptionCard(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'im-option ' + (props.selected ? 'is-selected' : ''),
          onClick: props.onSelect,
          'aria-pressed': props.selected ? 'true' : 'false',
        },
        h('span', { className: 'im-option-title' }, props.label),
        h('span', { className: 'im-option-desc' }, props.desc),
      );
    }

    function NewDialog(props) {
      const [name, setName] = useState('');
      const [platform, setPlatform] = useState('web');

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [props]);

      const submit = () => {
        props.onCreate({ name: name.trim() || T.unnamed, platform });
      };

      return h(
        'div',
        {
          className: 'im-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) props.onClose();
          },
        },
        h(
          'div',
          { className: 'im-dialog', role: 'dialog', 'aria-modal': 'true' },
          h(
            'div',
            { className: 'im-dialog-head' },
            h('h2', { className: 'im-dialog-title' }, T.createTitle),
            h(
              'button',
              { type: 'button', className: 'im-icon-btn', onClick: props.onClose, 'aria-label': T.cancel },
              icon('close', 16),
            ),
          ),
          h(
            'div',
            { className: 'im-dialog-body' },
            h(
              'label',
              { className: 'im-field' },
              h('span', { className: 'im-field-label' }, T.nameLabel),
              h('input', {
                className: 'im-input',
                value: name,
                placeholder: T.namePlaceholder,
                autoFocus: true,
                maxLength: 40,
                onChange: (event) => setName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submit();
                },
              }),
            ),
            h(
              'div',
              { className: 'im-field' },
              h('span', { className: 'im-field-label' }, T.platform),
              h(
                'div',
                { className: 'im-options' },
                PLATFORMS.map((item) =>
                  h(OptionCard, {
                    key: item.id,
                    label: item.label,
                    desc: item.desc,
                    selected: platform === item.id,
                    onSelect: () => setPlatform(item.id),
                  }),
                ),
              ),
            ),
            h('p', { className: 'im-note' }, T.permHint),
          ),
          h(
            'div',
            { className: 'im-dialog-foot' },
            h('button', { type: 'button', className: 'im-btn im-btn-ghost', onClick: props.onClose }, T.cancel),
            h('button', { type: 'button', className: 'im-btn im-btn-primary', onClick: submit }, T.create),
          ),
        ),
      );
    }

    const css = `
.im-page { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 22px 26px 16px; overflow: hidden; background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1f2328); font-family: inherit; }
.im-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex: none; }
.im-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: .01em; }
.im-sub { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-head-actions { display: flex; align-items: center; gap: 8px; }
.im-toolbar { display: flex; align-items: center; gap: 10px; flex: none; }
.im-search { position: relative; flex: 0 1 300px; display: flex; align-items: center; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-search svg { position: absolute; left: 10px; pointer-events: none; }
.im-search input { width: 100%; height: 32px; box-sizing: border-box; padding: 0 10px 0 32px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, #e3e5e8); background: var(--dsw-alias-bg-layer-1, #fafafa); color: var(--dsw-alias-label-primary, #1f2328); font-size: 12.5px; outline: none; font-family: inherit; }
.im-search input:focus { border-color: var(--dsw-alias-brand-primary, #2f6a43); }
.im-sort { height: 32px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, #e3e5e8); background: var(--dsw-alias-bg-layer-1, #fafafa); color: var(--dsw-alias-label-primary, #1f2328); font-size: 12.5px; padding: 0 8px; outline: none; font-family: inherit; }
.im-count { margin-left: auto; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-error { flex: none; padding: 9px 12px; border-radius: 9px; font-size: 12px; line-height: 1.5; background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #c2410c) 9%, transparent); color: var(--dsw-alias-state-error-primary, #c2410c); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #c2410c) 26%, transparent); }
.im-error button { margin-left: 10px; border: none; background: transparent; color: inherit; text-decoration: underline; cursor: pointer; font-size: 12px; font-family: inherit; }
.im-grid { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 12px; align-content: start; padding: 1px 1px 6px; }
.im-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1, #e3e5e8); background: var(--dsw-alias-bg-layer-1, #fafafa); transition: border-color .15s ease, box-shadow .15s ease; }
.im-card:hover { border-color: var(--dsw-alias-border-l2, #cdd2d8); box-shadow: 0 4px 18px rgba(15, 23, 42, .06); }
.im-card.is-current { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6a43) 32%, var(--dsw-alias-border-l1, #e3e5e8)); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6a43) 5%, var(--dsw-alias-bg-layer-1, #fafafa)); }
.im-card.is-selected { border-color: var(--dsw-alias-brand-primary, #2f6a43); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary, #2f6a43) inset; }
.im-select { width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary, #2f6a43); flex: none; cursor: pointer; }
.im-card-tools { display: flex; align-items: center; gap: 2px; flex: none; }
.im-batch { flex: none; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 9px; border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6a43) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6a43) 6%, var(--dsw-alias-bg-base, #fff)); }
.im-batch-label { margin-right: auto; font-size: 12px; font-weight: 600; color: var(--dsw-alias-brand-primary, #2f6a43); }
.im-card-top { display: flex; align-items: flex-start; gap: 10px; }
.im-tile { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; flex: none; background: var(--dsw-alias-bg-layer-2, #f0f1f3); color: var(--dsw-alias-brand-primary, #2f6a43); }
.im-tile.desktop { color: var(--dsw-alias-state-warn-primary, #b7791f); }
.im-card-name { flex: 1 1 auto; min-width: 0; }
.im-card-title { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.im-card-status { margin-top: 3px; display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-secondary, #9aa0a6); flex: none; }
.im-dot.is-running { background: var(--dsw-alias-state-success-primary, #2f9e44); box-shadow: 0 0 0 3px rgba(47, 158, 68, .14); }
.im-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.im-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--dsw-alias-border-l1, #e3e5e8); color: var(--dsw-alias-label-secondary, #6b7280); background: var(--dsw-alias-bg-base, #fff); }
.im-badge.is-current { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6a43) 40%, transparent); color: var(--dsw-alias-brand-primary, #2f6a43); }
.im-meta { display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }
.im-meta-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-meta-row b { font-weight: 500; color: var(--dsw-alias-label-primary, #3c4043); text-align: right; }
.im-card-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px; }
.im-card-buttons { display: flex; align-items: center; gap: 6px; }
.im-card-id { font-size: 9.5px; letter-spacing: .12em; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.im-current-pill { display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12px; color: var(--dsw-alias-brand-primary, #2f6a43); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6a43) 10%, transparent); }
.im-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 13px; border-radius: 8px; border: 1px solid transparent; font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap; font-family: inherit; }
.im-btn svg { flex: none; }
.im-btn:disabled { opacity: .5; cursor: default; }
.im-btn-primary { background: var(--dsw-alias-brand-primary, #2f6a43); color: var(--dsw-alias-bg-base, #ffffff); }
.im-btn-primary:hover:not(:disabled) { filter: brightness(1.04); }
.im-btn-ghost { background: var(--dsw-alias-bg-layer-1, #fafafa); border-color: var(--dsw-alias-border-l1, #e3e5e8); color: var(--dsw-alias-label-primary, #1f2328); }
.im-btn-ghost:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2, #cdd2d8); }
.im-btn-sm { height: 28px; padding: 0 11px; font-size: 12px; }
.im-icon-btn { width: 26px; height: 26px; display: grid; place-items: center; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; flex: none; }
.im-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f0f1f3); color: var(--dsw-alias-label-primary, #1f2328); }
.im-icon-btn:disabled { opacity: .45; cursor: default; }
.im-card.is-add { align-items: center; justify-content: center; gap: 8px; border-style: dashed; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; min-height: 196px; font-family: inherit; }
.im-card.is-add:hover { border-color: var(--dsw-alias-brand-primary, #2f6a43); color: var(--dsw-alias-brand-primary, #2f6a43); }
.im-add-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: var(--dsw-alias-bg-layer-1, #fafafa); }
.im-add-title { font-size: 12.5px; font-weight: 500; }
.im-empty { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px dashed var(--dsw-alias-border-l1, #d8dbe0); border-radius: 14px; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-empty-icon { width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; background: var(--dsw-alias-bg-layer-1, #fafafa); color: var(--dsw-alias-label-secondary, #9aa0a6); margin-bottom: 2px; }
.im-empty-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #1f2328); }
.im-empty-desc { font-size: 12px; max-width: 360px; text-align: center; line-height: 1.6; }
.im-empty .im-btn { margin-top: 8px; }
.im-foot { flex: none; text-align: center; font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.im-overlay { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(15, 23, 42, .34); padding: 16px; }
.im-dialog { width: 480px; max-width: 100%; max-height: calc(100vh - 48px); overflow-y: auto; box-sizing: border-box; background: var(--dsw-alias-bg-base, #ffffff); border: 1px solid var(--dsw-alias-border-l1, #e3e5e8); border-radius: 14px; box-shadow: 0 24px 70px rgba(15, 23, 42, .28); padding: 18px 20px 16px; }
.im-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.im-dialog-title { margin: 0; font-size: 16px; font-weight: 600; }
.im-dialog-body { display: flex; flex-direction: column; gap: 16px; padding: 16px 0 4px; }
.im-field { display: flex; flex-direction: column; gap: 8px; }
.im-field-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #1f2328); }
.im-input { height: 34px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, #e3e5e8); background: var(--dsw-alias-bg-layer-1, #fafafa); color: var(--dsw-alias-label-primary, #1f2328); font-size: 13px; padding: 0 11px; outline: none; font-family: inherit; box-sizing: border-box; }
.im-input:focus { border-color: var(--dsw-alias-brand-primary, #2f6a43); }
.im-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.im-option { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 10px 11px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1, #e3e5e8); background: var(--dsw-alias-bg-layer-1, #fafafa); cursor: pointer; font-family: inherit; }
.im-option.is-selected { border-color: var(--dsw-alias-brand-primary, #2f6a43); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f6a43) 8%, transparent); }
.im-option-title { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary, #1f2328); }
.im-option-desc { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-note { margin: 0; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-dialog-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1, #e3e5e8); margin-top: 4px; }
.im-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 70; max-width: min(460px, calc(100vw - 40px)); padding: 9px 15px; border-radius: 999px; background: #1f2328; color: #ffffff; font-size: 12px; box-shadow: 0 10px 30px rgba(15, 23, 42, .25); }
.im-loading { flex: 1 1 auto; display: grid; place-items: center; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.im-no-match { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); padding: 2px 1px; }
`;

    function PanelIcon(props) {
      const size = props.size || 18;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('rect', { x: 3.5, y: 8, width: 11, height: 11, rx: 2.2 }),
        h('path', { d: 'M8 8V6.2A2.2 2.2 0 0 1 10.2 4h8.3A2.2 2.2 0 0 1 20.7 6.2v8.3A2.2 2.2 0 0 1 18.5 16.7H16' }),
      );
    }

    function App() {
      const [items, setItems] = useState([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [query, setQuery] = useState('');
      const [sort, setSort] = useState('created');
      const [dialogOpen, setDialogOpen] = useState(false);
      const [busy, setBusy] = useState('');
      const [selected, setSelected] = useState([]);
      const [toast, setToast] = useState('');
      const timer = useRef(null);

      const showToast = (message) => {
        setToast(message);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(''), 3400);
      };

      useEffect(() => {
        return () => {
          if (timer.current) clearTimeout(timer.current);
        };
      }, []);

      const loadList = async (announce) => {
        setLoading(true);
        try {
          const data = await api();
          const list = Array.isArray(data.instances) ? data.instances : [];
          setItems(list.map(normalize));
          setSelected((prev) => prev.filter((id) => list.some((entry) => entry.id === id && !entry.current)));
          setError('');
          if (announce) showToast(`${list.length} / ${list.length}`);
        } catch (err) {
          setError((err && err.message) || T.loadFailed);
        } finally {
          setLoading(false);
        }
      };

      useEffect(() => {
        loadList(false);
      }, []);

      const run = async (body, successText) => {
        if (busy) return;
        setBusy(body.id || body.action);
        setError('');
        try {
          const data = await api(body);
          await loadList(false);
          const message = (data && data.result && data.result.message) || successText;
          if (message) showToast(message);
        } catch (err) {
          showToast((err && err.message) || T.actionFailed);
        } finally {
          setBusy('');
        }
      };

      const create = async (draft) => {
        setDialogOpen(false);
        await run({ action: 'create', name: draft.name, platform: draft.platform }, T.createdToast.replace('{name}', draft.name));
      };

      const remove = async (item) => {
        if (!window.confirm(T.deleteConfirm)) return;
        await run({ action: 'delete', id: item.id }, T.deletedToast);
      };

      const start = (item) => run({ action: 'start', id: item.id });
      const stop = (item) => run({ action: 'stop', id: item.id });
      const open = (item) => run({ action: 'open', id: item.id });
      const restart = (item) => run({ action: 'restart', id: item.id });
      const clone = (item) => run({ action: 'clone', id: item.id });
      const toggleSelect = (item) =>
        setSelected((prev) =>
          prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
        );

      const selectedItems = items.filter((item) => selected.includes(item.id) && !item.current);

      const batch = async (kind) => {
        const chosen = selectedItems;
        if (!chosen.length) return;
        if (kind === 'delete' && !window.confirm(T.batchConfirm.replace('{n}', String(chosen.length)))) return;
        setBusy('batch');
        setError('');
        let doneCount = 0;
        let skipped = 0;
        for (const item of chosen) {
          if (kind === 'start' && item.status === 'running') {
            skipped += 1;
            continue;
          }
          if (kind === 'stop' && item.status !== 'running') {
            skipped += 1;
            continue;
          }
          if (kind === 'delete' && item.status === 'running') {
            skipped += 1;
            continue;
          }
          try {
            await api({ action: kind, id: item.id });
            doneCount += 1;
          } catch {
            skipped += 1;
          }
        }
        await loadList(false);
        setSelected([]);
        setBusy('');
        showToast(
          T.batchDone.replace('{n}', String(doneCount)) +
            (skipped ? ` · ${T.batchSkipped.replace('{n}', String(skipped))}` : ''),
        );
      };

      const visible = items
        .filter((item) => {
          const needle = query.trim().toLowerCase();
          if (!needle) return true;
          return item.name.toLowerCase().indexOf(needle) !== -1 || String(item.port || '').indexOf(needle) !== -1;
        })
        .sort((a, b) => {
          if (a.current && !b.current) return -1;
          if (b.current && !a.current) return 1;
          if (sort === 'name') return a.name.localeCompare(b.name);
          if (sort === 'status') return (b.status === 'running' ? 1 : 0) - (a.status === 'running' ? 1 : 0);
          const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return right - left;
        });

      return h(
        'div',
        { className: 'im-page' },
        h(
          'div',
          { className: 'im-head' },
          h(
            'div',
            null,
            h('h1', { className: 'im-title' }, T.title),
            h('p', { className: 'im-sub' }, T.subtitle),
          ),
          h(
            'div',
            { className: 'im-head-actions' },
            h(
              'button',
              { type: 'button', className: 'im-btn im-btn-ghost', disabled: loading, onClick: () => loadList(true) },
              icon('refresh', 14),
              h('span', null, T.refresh),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'im-btn im-btn-primary',
                disabled: Boolean(busy),
                onClick: () => setDialogOpen(true),
              },
              icon('plus', 15),
              h('span', null, T.newInstance),
            ),
          ),
        ),
        h(
          'div',
          { className: 'im-toolbar' },
          h(
            'div',
            { className: 'im-search' },
            icon('search', 15),
            h('input', {
              value: query,
              placeholder: T.search,
              onChange: (event) => setQuery(event.target.value),
            }),
          ),
          h(
            'select',
            { className: 'im-sort', value: sort, onChange: (event) => setSort(event.target.value) },
            h('option', { value: 'created' }, T.sortCreated),
            h('option', { value: 'name' }, T.sortName),
            h('option', { value: 'status' }, T.sortStatus),
          ),
          h('span', { className: 'im-count' }, `${visible.length} / ${items.length}`),
        ),
        selectedItems.length > 0
          ? h(
              'div',
              { className: 'im-batch' },
              h('span', { className: 'im-batch-label' }, T.selected.replace('{n}', String(selectedItems.length))),
              h(
                'button',
                { type: 'button', className: 'im-btn im-btn-ghost im-btn-sm', disabled: Boolean(busy), onClick: () => batch('start') },
                icon('play', 13),
                h('span', null, T.batchStart),
              ),
              h(
                'button',
                { type: 'button', className: 'im-btn im-btn-ghost im-btn-sm', disabled: Boolean(busy), onClick: () => batch('stop') },
                icon('stop', 13),
                h('span', null, T.batchStop),
              ),
              h(
                'button',
                { type: 'button', className: 'im-btn im-btn-ghost im-btn-sm', disabled: Boolean(busy), onClick: () => batch('delete') },
                icon('trash', 13),
                h('span', null, T.batchDelete),
              ),
              h(
                'button',
                { type: 'button', className: 'im-btn im-btn-ghost im-btn-sm', disabled: Boolean(busy), onClick: () => setSelected([]) },
                h('span', null, T.batchClear),
              ),
            )
          : null,
        error
          ? h(
              'div',
              { className: 'im-error' },
              error,
              h('button', { type: 'button', onClick: () => loadList(false) }, T.retry),
            )
          : null,
        loading && items.length === 0
          ? h('div', { className: 'im-loading' }, T.loading)
          : items.length === 0
            ? h(Empty, { onCreate: () => setDialogOpen(true) })
            : h(
                'div',
                { className: 'im-grid' },
                visible.length === 0 ? h('div', { className: 'im-no-match' }, T.noMatch) : null,
                visible.map((item) =>
                  h(Card, {
                    key: item.id,
                    item,
                    busy: busy === item.id,
                    batchBusy: busy === 'batch',
                    selected: selected.includes(item.id),
                    onSelect: toggleSelect,
                    onStart: start,
                    onStop: stop,
                    onOpen: open,
                    onRestart: restart,
                    onClone: clone,
                    onDelete: remove,
                  }),
                ),
                h(AddTile, { busy: Boolean(busy), onClick: () => setDialogOpen(true) }),
              ),
        h('div', { className: 'im-foot' }, T.tip),
        toast ? h('div', { className: 'im-toast' }, toast) : null,
        dialogOpen ? h(NewDialog, { onClose: () => setDialogOpen(false), onCreate: create }) : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        if (!ctx.slots || typeof ctx.slots.inject !== 'function') return;
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.pluginCss = 'dsh-instance-manager/panel.css';
          style.textContent = css;
          document.head.append(style);
          return () => style.remove();
        });
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'instance-manager', order: 22, label: () => T.nav },
            PanelIcon,
          ),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'instance-manager' }, App),
        );
      },
    };
  },
});
