(function registerEorgToolbar(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  const modules = (root.modules = root.modules || {});

  function resolveMountHost(ctx) {
    if (ctx && ctx.shells && ctx.shells.top) {
      return { host: ctx.shells.top, fallback: false };
    }

    const anchor = ctx.document.querySelector('[role="banner"], div[gh="mtb"], .G-atb');
    if (anchor) {
      return { host: anchor, fallback: false };
    }

    return { host: ctx.document.body || ctx.document.documentElement, fallback: true };
  }

  function formatStatus(idx) {
    if (!idx) {
      return 'Index idle';
    }
    if (idx.state === 'running') {
      return 'Building local index... (' + idx.indexedCount + ')';
    }
    return 'Index ' + idx.state + ' (' + idx.indexedCount + ')';
  }

  function dispatchCommandPalette(doc) {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    doc.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true
    }));
  }

  function focusSearch(doc) {
    const input = doc.querySelector('input[aria-label*="Search" i], input[name="q"], input.gsfi');
    if (input && typeof input.focus === 'function') {
      input.focus();
      return;
    }
    dispatchCommandPalette(doc);
  }

  function createActionButton(doc, label, handler) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'eorg-shell-action';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function createStrip(doc) {
    const strip = doc.createElement('section');
    strip.id = 'eorg-utility-strip';
    strip.className = 'eorg-shell-panel eorg-shell-top';
    strip.setAttribute('aria-label', 'Eorg top utility strip');

    const searchFrame = doc.createElement('button');
    searchFrame.type = 'button';
    searchFrame.className = 'eorg-shell-search';
    searchFrame.innerHTML = [
      '<span class="eorg-shell-search-icon">⌕</span>',
      '<span class="eorg-shell-search-text">Search or ask AI a question</span>',
      '<span class="eorg-shell-kbd">Cmd/Ctrl+K</span>'
    ].join('');
    searchFrame.addEventListener('click', () => focusSearch(doc));

    const status = doc.createElement('div');
    status.className = 'eorg-shell-status';

    const actions = doc.createElement('div');
    actions.className = 'eorg-shell-actions';
    actions.append(
      createActionButton(doc, 'Command', () => dispatchCommandPalette(doc)),
      createActionButton(doc, 'Search', () => focusSearch(doc)),
      createActionButton(doc, 'Sync', () => doc.dispatchEvent(new Event('eorg:refresh-index', { bubbles: true })))
    );

    strip.append(searchFrame, status, actions);
    return { strip, status };
  }

  function attach(strip, mount, isFallback) {
    strip.classList.toggle('is-fallback', Boolean(isFallback));
    if (strip.parentElement !== mount) {
      mount.prepend(strip);
    }
  }

  modules.toolbar = {
    mount(ctx) {
      const doc = ctx.document;
      let strip = null;
      let status = null;

      function refresh() {
        const resolved = resolveMountHost(ctx);
        if (!resolved.host) {
          return;
        }

        if (!strip || !strip.isConnected || !status || !status.isConnected) {
          const created = createStrip(doc);
          strip = created.strip;
          status = created.status;
        }

        status.textContent = formatStatus(root.runtime && root.runtime.indexStatus);
        attach(strip, resolved.host, resolved.fallback);
      }

      refresh();
      return {
        refresh,
        destroy() {
          if (strip && strip.isConnected) {
            strip.remove();
          }
        }
      };
    }
  };
})(window);
