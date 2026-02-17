(function registerEorgCompose(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  const modules = (root.modules = root.modules || {});

  modules.compose = {
    mount(ctx) {
      const doc = ctx.document;

      function refresh() {
        const composePanels = doc.querySelectorAll('.AD, .M9, div[role="dialog"] .aDh');
        composePanels.forEach((panel) => panel.classList.add('eorg-compose'));
      }

      refresh();
      return { refresh, destroy() {} };
    }
  };
})(window);
