(function registerEorgToolbar(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  const modules = (root.modules = root.modules || {});

  function findToolbar(doc) {
    return doc.querySelector('.G-atb, div[gh="mtb"], [role="banner"]');
  }

  modules.toolbar = {
    mount(ctx) {
      const doc = ctx.document;
      let button = null;
      let status = null;

      function refresh() {
        const toolbar = findToolbar(doc);
        if (!toolbar) {
          return;
        }

        toolbar.classList.add('eorg-toolbar');

        if (!button || !button.isConnected) {
          button = doc.createElement('button');
          button.className = 'eorg-toolbar-btn';
          button.type = 'button';
          button.textContent = 'Command K';
          button.addEventListener('click', () => {
            doc.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'k',
              metaKey: navigator.platform.toLowerCase().includes('mac'),
              ctrlKey: !navigator.platform.toLowerCase().includes('mac'),
              bubbles: true
            }));
          });
          toolbar.prepend(button);
        }

        if (!status || !status.isConnected) {
          status = doc.createElement('div');
          status.className = 'eorg-toolbar-status';
          status.textContent = 'Index idle';
          toolbar.append(status);
        }

        const idx = root.runtime && root.runtime.indexStatus;
        if (idx) {
          status.textContent = idx.state === 'running'
            ? 'Building local index... (' + idx.indexedCount + ')'
            : 'Index ' + idx.state + ' (' + idx.indexedCount + ')';
        }
      }

      refresh();
      return {
        refresh,
        destroy() {
          if (button && button.isConnected) {
            button.remove();
          }
          if (status && status.isConnected) {
            status.remove();
          }
        }
      };
    }
  };
})(window);
