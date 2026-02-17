(function registerEorgChatbot(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  const modules = (root.modules = root.modules || {});

  function addMessage(log, role, text) {
    const item = document.createElement('div');
    item.className = 'eorg-chat-msg ' + (role === 'user' ? 'is-user' : 'is-assistant');
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  modules.chatbot = {
    mount(ctx) {
      const doc = ctx.document;
      let panel = null;
      let log = null;
      let input = null;
      let send = null;

      async function onSend() {
        const value = (input.value || '').trim();
        if (!value) {
          return;
        }

        input.value = '';
        addMessage(log, 'user', value);

        const ai = root.runtime && root.runtime.ai;
        if (!ai || typeof ai.chat !== 'function') {
          addMessage(log, 'assistant', 'AI is not ready. Open extension settings and configure provider/key.');
          return;
        }

        send.disabled = true;
        addMessage(log, 'assistant', 'Thinking...');

        try {
          const reply = await ai.chat([
            { role: 'system', content: 'You are an inbox copilot. Give concise and useful replies.' },
            { role: 'user', content: value }
          ]);

          const pending = log.querySelector('.eorg-chat-msg.is-assistant:last-child');
          if (pending && pending.textContent === 'Thinking...') {
            pending.textContent = reply || 'No response returned.';
          } else {
            addMessage(log, 'assistant', reply || 'No response returned.');
          }
        } catch (error) {
          const message = error && error.message ? error.message : 'Request failed';
          addMessage(log, 'assistant', 'Error: ' + message);
        } finally {
          send.disabled = false;
        }
      }

      function refresh() {
        if (panel && panel.isConnected) {
          return;
        }

        panel = doc.createElement('aside');
        panel.id = 'eorg-right-panel';
        panel.className = 'eorg-glass-panel eorg-right-panel';

        panel.innerHTML = [
          '<div class="eorg-chat-head">Copilot</div>',
          '<div class="eorg-chat-sub">Ask about this inbox</div>',
          '<div class="eorg-chat-log" id="eorg-chat-log"></div>',
          '<div class="eorg-chat-input-wrap">',
          '<input class="eorg-chat-input" id="eorg-chat-input" placeholder="Ask anything..." />',
          '<button class="eorg-chat-send" id="eorg-chat-send" type="button">Send</button>',
          '</div>'
        ].join('');

        doc.body.appendChild(panel);

        log = panel.querySelector('#eorg-chat-log');
        input = panel.querySelector('#eorg-chat-input');
        send = panel.querySelector('#eorg-chat-send');

        send.addEventListener('click', onSend);
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSend();
          }
        });

        addMessage(log, 'assistant', 'I can summarize, draft replies, and help triage your email.');
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
