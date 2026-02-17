(function registerEorgCommandBar(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  const modules = (root.modules = root.modules || {});

  function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  function focusCompose(doc) {
    const compose = doc.querySelector('div[gh="cm"], .T-I.T-I-KE.L3, [aria-label*="Compose"]');
    if (compose) compose.click();
  }

  function focusReply(doc) {
    const reply = doc.querySelector('[aria-label*="Reply"], [data-tooltip*="Reply"]');
    if (reply) reply.click();
  }

  function archiveCurrent(doc) {
    const archive = doc.querySelector('[aria-label*="Archive"], [data-tooltip*="Archive"]');
    if (archive) archive.click();
  }

  function applyLabel(doc, labelName) {
    if (!labelName.trim()) {
      return;
    }
    const labelsButton = doc.querySelector('[aria-label*="Label"], [data-tooltip*="Label"]');
    if (!labelsButton) {
      return;
    }
    labelsButton.click();
    setTimeout(() => {
      const input = doc.querySelector('input[aria-label*="Label"], input[aria-label*="Search labels"]');
      if (!input) {
        return;
      }
      input.focus();
      input.value = labelName;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => {
        const match = doc.querySelector('[role="menuitemcheckbox"], [role="option"]');
        if (match) {
          match.click();
        }
      }, 180);
    }, 180);
  }

  function gotoMailbox(mailbox) {
    const map = { inbox: '#inbox', sent: '#sent', drafts: '#drafts' };
    location.hash = map[mailbox] || '#inbox';
  }

  modules.commandbar = {
    mount(ctx) {
      const doc = ctx.document;
      const db = root.runtime.db;
      const ai = root.runtime.ai;
      const notify = root.runtime.notify || ((text) => console.log('[eorg]', text));

      let host = doc.getElementById('eorg-commandbar');
      if (!host) {
        host = doc.createElement('div');
        host.id = 'eorg-commandbar';
        host.className = 'eorg-cmdk';
        host.hidden = true;
        host.innerHTML = [
          '<div class="eorg-cmdk-backdrop" data-close="1"></div>',
          '<div class="eorg-cmdk-panel" role="dialog" aria-label="Command bar">',
          '<input class="eorg-cmdk-input" placeholder="Type a command" />',
          '<ul class="eorg-cmdk-list" role="listbox"></ul>',
          '</div>'
        ].join('');
        doc.body.appendChild(host);
      }

      const input = host.querySelector('.eorg-cmdk-input');
      const list = host.querySelector('.eorg-cmdk-list');
      let items = [];
      let selected = 0;
      let open = false;

      function getCommands() {
        return [
          { id: 'compose', label: 'compose', run: () => focusCompose(doc) },
          { id: 'reply', label: 'reply', run: () => focusReply(doc) },
          { id: 'archive', label: 'archive', run: () => archiveCurrent(doc) },
          { id: 'label', label: 'label ', run: (name) => applyLabel(doc, name) },
          { id: 'goto-inbox', label: 'goto inbox', run: () => gotoMailbox('inbox') },
          { id: 'goto-sent', label: 'goto sent', run: () => gotoMailbox('sent') },
          { id: 'goto-drafts', label: 'goto drafts', run: () => gotoMailbox('drafts') },
          {
            id: 'summarize',
            label: 'summarize',
            run: async () => {
              if (!ai || typeof ai.chat !== 'function') {
                notify('AI is not configured. Open settings first.', 'error');
                return;
              }
              const threadText = Array.from(doc.querySelectorAll('.a3s, .ii.gt')).map((n) => n.innerText).join('\n').slice(0, 12000);
              if (!threadText.trim()) return;
              const summary = await ai.chat([
                { role: 'system', content: 'Summarize this email thread in 5 concise bullets.' },
                { role: 'user', content: threadText }
              ]);
              notify('Summary: ' + summary.slice(0, 280));
            }
          },
          {
            id: 'draft-reply',
            label: 'draft reply',
            run: async () => {
              if (!ai || typeof ai.chat !== 'function') {
                notify('AI is not configured. Open settings first.', 'error');
                return;
              }
              const threadText = Array.from(doc.querySelectorAll('.a3s, .ii.gt')).map((n) => n.innerText).join('\n').slice(0, 12000);
              if (!threadText.trim()) return;
              const draft = await ai.chat([
                { role: 'system', content: 'Write a concise professional email reply draft.' },
                { role: 'user', content: threadText }
              ]);
              focusReply(doc);
              setTimeout(() => {
                const editable = doc.querySelector('[aria-label="Message Body"], div[contenteditable="true"]');
                if (editable) {
                  editable.focus();
                  doc.execCommand('insertText', false, draft);
                }
              }, 260);
            }
          },
          {
            id: 'triage',
            label: 'triage',
            run: async () => {
              if (!ai || typeof ai.chat !== 'function') {
                notify('AI is not configured. Open settings first.', 'error');
                return;
              }
              const threadText = Array.from(doc.querySelectorAll('.a3s, .ii.gt')).map((n) => n.innerText).join('\n').slice(0, 8000);
              if (!threadText.trim()) return;
              const triage = await ai.chat([
                { role: 'system', content: 'Return one label: urgent, action needed, fyi, newsletter.' },
                { role: 'user', content: threadText }
              ]);
              notify('Suggested triage: ' + triage.trim());
            }
          },
          {
            id: 'search',
            label: 'search ',
            run: async (query) => {
              if (!ai || typeof ai.embed !== 'function' || !db) {
                notify('Search index is not ready yet.', 'error');
                return;
              }
              if (!query.trim()) return;
              const qVec = (await ai.embed(query))[0];
              if (!qVec) return;
              const vectors = await db.getAll('embeddings');
              const scored = vectors.map((v) => ({ ...v, score: cosine(qVec, v.vector || []) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);
              const emails = [];
              for (const s of scored) {
                const email = await db.get('emails', s.emailId);
                if (email) emails.push(email.subject + ' - ' + email.sender);
              }
              notify('Top matches: ' + (emails.slice(0, 3).join(' | ') || 'None yet'));
            }
          }
        ];
      }

      function render() {
        const query = input.value.trim().toLowerCase();
        const all = getCommands();
          const filtered = all.filter((c) =>
            c.label.includes(query)
            || (query.startsWith('search ') && c.id === 'search')
            || (query.startsWith('label ') && c.id === 'label')
          );
        items = filtered;
        if (selected >= items.length) selected = 0;

        list.innerHTML = '';
        if (!items.length) {
          const li = doc.createElement('li');
          li.className = 'eorg-cmdk-item empty';
          li.textContent = 'No command found';
          list.appendChild(li);
          return;
        }

        items.forEach((item, idx) => {
          const li = doc.createElement('li');
          li.className = 'eorg-cmdk-item' + (idx === selected ? ' selected' : '');
          li.textContent = item.label;
          li.onclick = () => execute(item);
          list.appendChild(li);
        });
      }

      function execute(item) {
        let op;
        if (item.id === 'search') {
          op = item.run(input.value.replace(/^search\s*/i, ''));
        } else if (item.id === 'label') {
          op = item.run(input.value.replace(/^label\s*/i, ''));
        } else {
          op = item.run();
        }
        Promise.resolve(op).catch((error) => {
          notify('Command failed: ' + (error && error.message ? error.message : 'Unknown error'), 'error');
        });
        close();
      }

      function openPalette() {
        host.hidden = false;
        open = true;
        selected = 0;
        input.value = '';
        render();
        input.focus();
      }

      function close() {
        host.hidden = true;
        open = false;
      }

      function onKeydown(event) {
        const cmdk = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
        if (cmdk) {
          event.preventDefault();
          if (open) close(); else openPalette();
          return;
        }

        if (!open) return;

        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!items.length) return;
          selected += event.key === 'ArrowDown' ? 1 : -1;
          if (selected < 0) selected = items.length - 1;
          if (selected >= items.length) selected = 0;
          render();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (items[selected]) execute(items[selected]);
        }
      }

      function onClick(event) {
        const target = event.target;
        if (target && target.getAttribute('data-close') === '1') {
          close();
        }
      }

      doc.addEventListener('keydown', onKeydown, true);
      input.addEventListener('input', render);
      host.addEventListener('click', onClick);

      return {
        refresh() {
          if (open) render();
        },
        destroy() {
          doc.removeEventListener('keydown', onKeydown, true);
          input.removeEventListener('input', render);
          host.removeEventListener('click', onClick);
        }
      };
    }
  };
})(window);
