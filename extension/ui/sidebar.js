(function registerEorgSidebar(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  const modules = (root.modules = root.modules || {});

  function findSidebar(doc) {
    return doc.querySelector('.aeN, div[role="navigation"]');
  }

  modules.sidebar = {
    mount(ctx) {
      const doc = ctx.document;
      let chip = null;

      function refresh() {
        const sidebar = findSidebar(doc);
        if (!sidebar) {
          return;
        }

        sidebar.classList.add('eorg-sidebar');
        if (chip && chip.isConnected) {
          return;
        }

        chip = doc.createElement('div');
        chip.className = 'eorg-sidebar-chip';
        chip.textContent = 'Private Local Index';
        sidebar.prepend(chip);
      }

      refresh();
      return {
        refresh,
        destroy() {
          if (chip && chip.isConnected) {
            chip.remove();
          }
        }
      };
    }
  };
})(window);
