(function registerEorgSidebar(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  const modules = (root.modules = root.modules || {});

  function goTo(mailbox) {
    const target = '#' + mailbox;
    if (location.hash !== target) {
      location.hash = target;
    }

    const anchors = Array.from(document.querySelectorAll('a[href], [role="link"], div[role="treeitem"]'));
    const match = anchors.find((el) => {
      const text = (el.textContent || '').trim().toLowerCase();
      const href = (el.getAttribute('href') || '').toLowerCase();
      return text === mailbox || href.includes('#' + mailbox);
    });

    if (match && typeof match.click === 'function') {
      match.click();
    }
  }

  function createNavButton(doc, label, mailbox) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'eorg-left-nav-btn';
    button.textContent = label;
    button.addEventListener('click', () => goTo(mailbox));
    return button;
  }

  function createPanel(doc) {
    const panel = doc.createElement('aside');
    panel.id = 'eorg-left-panel';
    panel.className = 'eorg-glass-panel eorg-left-panel';

    const title = doc.createElement('div');
    title.className = 'eorg-left-title';
    title.textContent = 'Eorg Mail';

    const subtitle = doc.createElement('div');
    subtitle.className = 'eorg-left-subtitle';
    subtitle.textContent = 'Private inbox';

    const nav = doc.createElement('div');
    nav.className = 'eorg-left-nav';
    nav.append(
      createNavButton(doc, 'Inbox', 'inbox'),
      createNavButton(doc, 'Drafts', 'drafts'),
      createNavButton(doc, 'Sent', 'sent')
    );

    const labels = doc.createElement('div');
    labels.className = 'eorg-labels';
    labels.innerHTML = [
      '<div class="eorg-labels-title">Labels</div>',
      '<div class="eorg-label-chip">Needs Reply</div>',
      '<div class="eorg-label-chip">To Do</div>',
      '<div class="eorg-label-chip">FYI</div>',
      '<div class="eorg-label-chip">Promotion</div>'
    ].join('');

    panel.append(title, subtitle, nav, labels);
    return panel;
  }

  modules.sidebar = {
    mount(ctx) {
      const doc = ctx.document;
      let panel = null;

      function refresh() {
        if (!panel || !panel.isConnected) {
          panel = createPanel(doc);
          doc.body.appendChild(panel);
        }
      }

      refresh();
      return {
        refresh,
        destroy() {
          if (panel && panel.isConnected) {
            panel.remove();
          }
        }
      };
    }
  };
})(window);
