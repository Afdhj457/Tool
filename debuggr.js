(function (global) {
  'use strict';

  // ========== 配置 ==========
  const DEFAULTS = {
    position: 'bottom-right',   // bottom-right | bottom-left | top-right | top-left
    width: 420,
    height: 320,
    maxLogs: 500,
    hotkey: 'F12',              // 打开/关闭面板
    autoHook: true,             // 自动劫持 console
  };

  // ========== 日志存储 ==========
  const logs = [];

  // ========== 内部状态 ==========
  let panel = null;
  let logContainer = null;
  let inputEl = null;
  let visible = false;
  const breakpoints = new Set();
  let originalConsole = {};

  // ========== 工具函数 ==========
  function format(v, depth = 0) {
    if (depth > 3) return '[深度过深]';
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    const t = typeof v;
    if (t === 'string') return JSON.stringify(v);
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
    if (t === 'function') return `[Function: ${v.name || 'anonymous'}]`;
    if (t === 'symbol') return v.toString();
    if (Array.isArray(v)) {
      if (v.length > 20) {
        return '[' + v.slice(0, 20).map(x => format(x, depth + 1)).join(', ') + `, …${v.length - 20} more]`;
      }
      return '[' + v.map(x => format(x, depth + 1)).join(', ') + ']';
    }
    if (v instanceof Error) return v.stack || v.message;
    if (v instanceof HTMLElement) return `<${v.tagName.toLowerCase()}>`;
    if (v instanceof Node) return `#${v.nodeName}`;
    if (t === 'object') {
      try {
        const keys = Object.keys(v);
        if (keys.length > 15) {
          return '{' + keys.slice(0, 15).map(k => `${k}: ${format(v[k], depth + 1)}`).join(', ') + ', …}';
        }
        return '{' + keys.map(k => `${k}: ${format(v[k], depth + 1)}`).join(', ') + '}';
      } catch (e) {
        return String(v);
      }
    }
    return String(v);
  }

  function timestamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  }

  // ========== 创建面板 ==========
  function createPanel(opts) {
    if (panel) return;

    // 主容器
    panel = document.createElement('div');
    panel.id = '__js_debugger_panel__';
    Object.assign(panel.style, {
      position: 'fixed',
      width: opts.width + 'px',
      height: opts.height + 'px',
      background: '#1e1f29',
      color: '#f8f8f2',
      fontFamily: "'Fira Code','JetBrains Mono',Consolas,monospace",
      fontSize: '12.5px',
      borderRadius: '10px',
      boxShadow: '0 12px 32px rgba(0,0,0,.55), 0 0 0 1px #44475a',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 2147483647,
      overflow: 'hidden',
      transition: 'opacity .15s, transform .15s',
    });

    // 位置
    const pos = opts.position;
    const margin = '16px';
    if (pos.includes('bottom')) panel.style.bottom = margin;
    else panel.style.top = margin;
    if (pos.includes('right')) panel.style.right = margin;
    else panel.style.left = margin;

    // 标题栏
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px',
      background: '#21222c',
      borderBottom: '1px solid #44475a',
      cursor: 'move',
      userSelect: 'none',
      flexShrink: 0,
    });
    header.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:#ff5555;margin-right:6px"></span>
      <span style="width:10px;height:10px;border-radius:50%;background:#f1fa8c;margin-right:6px"></span>
      <span style="width:10px;height:10px;border-radius:50%;background:#50fa7b;margin-right:10px"></span>
      <span style="flex:1;color:#bd93f9;font-weight:600;letter-spacing:.5px">JS 调试器</span>
    `;

    // 按钮组
    const btnWrap = document.createElement('div');
    btnWrap.style.display = 'flex';
    btnWrap.style.gap = '6px';

    const mkBtn = (text, title, fn) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      Object.assign(b.style, {
        background: '#44475a',
        color: '#f8f8f2',
        border: '1px solid #6272a4',
        borderRadius: '6px',
        padding: '2px 8px',
        fontSize: '11px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      });
      b.onmouseenter = () => (b.style.background = '#6272a4');
      b.onmouseleave = () => (b.style.background = '#44475a');
      b.onclick = fn;
      return b;
    };

    const clearBtn = mkBtn('清空', '清空日志', () => clearLogs());
    const closeBtn = mkBtn('✕', '关闭 (F12)', () => toggle(false));
    btnWrap.appendChild(clearBtn);
    btnWrap.appendChild(closeBtn);
    header.appendChild(btnWrap);

    // 日志区
    logContainer = document.createElement('div');
    Object.assign(logContainer.style, {
      flex: '1',
      overflowY: 'auto',
      padding: '8px 12px',
      lineHeight: '1.55',
      fontFamily: 'inherit',
      fontSize: '12px',
    });

    // 输入区
    const inputWrap = document.createElement('div');
    Object.assign(inputWrap.style, {
      display: 'flex',
      borderTop: '1px solid #44475a',
      background: '#21222c',
      flexShrink: 0,
    });
    const prefix = document.createElement('span');
    prefix.textContent = '›';
    Object.assign(prefix.style, {
      padding: '8px 6px 8px 12px',
      color: '#50fa7b',
      fontWeight: 'bold',
      userSelect: 'none',
    });
    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = '输入表达式并回车求值…';
    Object.assign(inputEl.style, {
      flex: '1',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: '#f8f8f2',
      padding: '8px 12px 8px 0',
      fontFamily: 'inherit',
      fontSize: '12px',
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = inputEl.value.trim();
        if (code) {
          logLine('input', '› ' + code);
          try {
            const result = (0, eval)(code);
            logLine('result', '← ' + format(result));
          } catch (err) {
            logLine('error', '✖ ' + err.message);
          }
        }
        inputEl.value = '';
      }
      e.stopPropagation();
    });
    inputWrap.appendChild(prefix);
    inputWrap.appendChild(inputEl);

    panel.appendChild(header);
    panel.appendChild(logContainer);
    panel.appendChild(inputWrap);

    // 拖动
    makeDraggable(panel, header);

    document.body.appendChild(panel);

    // 初始隐藏
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(12px)';
    panel.style.pointerEvents = 'none';

    // 初始日志
    logLine('system', '调试器已加载 · 按 ' + opts.hotkey + ' 切换面板');
  }

  // ========== 拖动 ==========
  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const rect = el.getBoundingClientRect();
      // 切换为 left/top 定位
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      ox = rect.left;
      oy = rect.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = (ox + e.clientX - sx) + 'px';
      el.style.top = (oy + e.clientY - sy) + 'px';
    });
    window.addEventListener('mouseup', () => (dragging = false));
  }

  // ========== 日志写入 ==========
  const LEVEL_COLORS = {
    system: '#6272a4',
    log: '#f8f8f2',
    info: '#8be9fd',
    warn: '#f1fa8c',
    error: '#ff5555',
    debug: '#bd93f9',
    result: '#50fa7b',
    input: '#bd93f9',
  };

  function logLine(level, text) {
    const entry = { level, text, time: timestamp() };
    logs.push(entry);
    if (logs.length > DEFAULTS.maxLogs) logs.shift();

    if (!logContainer) return;

    const line = document.createElement('div');
    Object.assign(line.style, {
      borderLeft: `3px solid ${LEVEL_COLORS[level] || '#6272a4'}`,
      paddingLeft: '8px',
      marginBottom: '3px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      color: LEVEL_COLORS[level] || '#f8f8f2',
      animation: '__dbg_fade .12s ease',
    });
    const ts = document.createElement('span');
    ts.textContent = entry.time + ' ';
    Object.assign(ts.style, { color: '#6272a4', fontSize: '10.5px' });
    line.appendChild(ts);
    line.appendChild(document.createTextNode(text));

    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  function clearLogs() {
    logs.length = 0;
    if (logContainer) logContainer.innerHTML = '';
    logLine('system', '日志已清空');
  }

  // ========== 显示/隐藏 ==========
  function toggle(show) {
    if (!panel) createPanel(DEFAULTS);
    visible = typeof show === 'boolean' ? show : !visible;
    if (visible) {
      panel.style.opacity = '1';
      panel.style.transform = 'translateY(0)';
      panel.style.pointerEvents = 'auto';
      if (inputEl) setTimeout(() => inputEl.focus(), 50);
    } else {
      panel.style.opacity = '0';
      panel.style.transform = 'translateY(12px)';
      panel.style.pointerEvents = 'none';
    }
  }

  // ========== 劫持 console ==========
  function hookConsole() {
    const levels = ['log', 'info', 'warn', 'error', 'debug'];
    levels.forEach((lv) => {
      originalConsole[lv] = console[lv];
      console[lv] = function (...args) {
        originalConsole[lv].apply(console, args);
        const text = args.map(a => format(a)).join(' ');
        logLine(lv, text);
      };
    });

    // 捕获全局错误
    window.addEventListener('error', (e) => {
      logLine('error', `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      logLine('error', '未处理的 Promise 拒绝: ' + format(e.reason));
    });
  }

  // ========== 断点能力（针对函数调用，浏览器端限制较大） ==========
  // 提供 debugger 语句配合：在代码里写 __DEBUGGER__.break() 就会停住
  // 也可以调用 __DEBUGGER__.log(...) 输出
  const api = {
    log: (...args) => logLine('log', args.map(a => format(a)).join(' ')),
    info: (...args) => logLine('info', args.map(a => format(a)).join(' ')),
    warn: (...args) => logLine('warn', args.map(a => format(a)).join(' ')),
    error: (...args) => logLine('error', args.map(a => format(a)).join(' ')),

    // 触发浏览器原生断点（需 DevTools 打开）
    break: () => { debugger; },

    // 简单的断言
    assert: (cond, msg) => {
      if (!cond) logLine('error', '断言失败: ' + (msg || ''));
    },

    // 计时
    time: (label) => console.time(label),
    timeEnd: (label) => console.timeEnd(label),

    // 手动打开 / 关闭面板
    show: () => toggle(true),
    hide: () => toggle(false),
    toggle: () => toggle(),

    // 清空
    clear: clearLogs,

    // 配置
    config: (opts) => Object.assign(DEFAULTS, opts),

    // 版本
    version: '1.0.0',
  };

  // ========== 快捷键 ==========
  function bindHotkey() {
    window.addEventListener('keydown', (e) => {
      if (e.key === DEFAULTS.hotkey || e.code === DEFAULTS.hotkey) {
        e.preventDefault();
        toggle();
      }
    });
  }

  // ========== 初始化 ==========
  function init() {
    // 尽早创建面板以便捕获早期日志
    if (document.body) {
      createPanel(DEFAULTS);
    } else {
      document.addEventListener('DOMContentLoaded', () => createPanel(DEFAULTS));
    }

    if (DEFAULTS.autoHook) hookConsole();
    bindHotkey();

    // 注入样式（动画）
    if (!document.getElementById('__dbg_style__')) {
      const s = document.createElement('style');
      s.id = '__dbg_style__';
      s.textContent = `@keyframes __dbg_fade { from { opacity: 0; transform: translateX(-4px);} to {opacity:1;transform:none;} }`;
      (document.head || document.documentElement).appendChild(s);
    }
  }

  // 暴露到全局
  global.__DEBUGGER__ = api;

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // CommonJS / ESM 兼容
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);