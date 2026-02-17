(function initEorgContent(global) {
  'use strict';

  // Step 0 (default-first reset): keep extension active but do not mutate Gmail UI.
  const root = (global.__EORG__ = global.__EORG__ || {});
  if (root.started) {
    return;
  }

  root.started = true;
  root.phase = 'step0-default';
  root.features = {
    cmdk: false,
    chatbot: false,
    minimalTheme: false
  };
})(window);
