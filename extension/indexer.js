(function initEorgIndexer(global) {
  'use strict';

  const STATES = {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETE: 'complete',
    ERROR: 'error'
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay(minMs, maxMs) {
    return Math.floor(minMs + Math.random() * (maxMs - minMs));
  }

  function toEpoch(dateText) {
    const parsed = Date.parse(dateText || '');
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function getEmailRows(doc) {
    return Array.from(doc.querySelectorAll('tr[role="row"]'));
  }

  function extractEmailFromRow(row, threadId) {
    const sender = row.querySelector('span[email], .yW span')?.getAttribute('email')
      || row.querySelector('span[email], .yW span')?.textContent?.trim()
      || '';
    const subject = row.querySelector('.bog, .y6 span')?.textContent?.trim() || '(no subject)';
    const snippet = row.querySelector('.y2')?.textContent?.trim() || '';
    const date = row.querySelector('td.xW span')?.getAttribute('title') || row.querySelector('td.xW span')?.textContent || '';

    const id = threadId || 'row-' + Math.random().toString(36).slice(2);

    return {
      id,
      threadId: id,
      sender,
      recipients: [],
      subject,
      body: snippet,
      snippet,
      labels: [],
      dateText: date,
      dateEpoch: toEpoch(date),
      updatedAt: Date.now()
    };
  }

  class EorgIndexer {
    constructor({ db, ai, documentRef, statusCallback }) {
      this.db = db;
      this.ai = ai;
      this.documentRef = documentRef;
      this.statusCallback = statusCallback || (() => {});
      this.state = STATES.IDLE;
      this.indexedCount = 0;
      this.shouldStop = false;
      this.lastTick = 0;
    }

    async start() {
      if (this.state === STATES.RUNNING) {
        return;
      }
      this.state = STATES.RUNNING;
      this.shouldStop = false;
      this.publishStatus();

      try {
        await this.scanLoop();
        if (!this.shouldStop) {
          this.state = STATES.COMPLETE;
          this.publishStatus();
        }
      } catch (error) {
        this.state = STATES.ERROR;
        this.publishStatus(error.message || 'Indexing failed');
      }
    }

    pause() {
      if (this.state !== STATES.RUNNING) {
        return;
      }
      this.shouldStop = true;
      this.state = STATES.PAUSED;
      this.publishStatus();
    }

    async scanLoop() {
      const doc = this.documentRef;
      let perMinute = 0;
      let windowStart = Date.now();

      for (let cycle = 0; cycle < 500 && !this.shouldStop; cycle += 1) {
        if (doc.visibilityState === 'hidden') {
          const rows = getEmailRows(doc).slice(0, 12);
          for (const row of rows) {
            if (this.shouldStop) {
              break;
            }

            const threadId = row.getAttribute('data-legacy-thread-id') || row.getAttribute('data-thread-id') || '';
            const email = extractEmailFromRow(row, threadId);

            const exists = await this.db.get('emails', email.id);
            if (exists) {
              continue;
            }

            await this.db.put('emails', email);

            try {
              const vectors = await this.ai.embed(email.subject + '\n' + email.body, { model: 'text-embedding-3-small' });
              if (vectors[0]) {
                await this.db.put('embeddings', {
                  id: 'emb-' + email.id,
                  emailId: email.id,
                  model: 'text-embedding-3-small',
                  vector: vectors[0],
                  updatedAt: Date.now()
                });
              }
            } catch (_embedError) {
              // Embedding failures are non-fatal.
            }

            this.indexedCount += 1;
            perMinute += 1;
            this.publishStatus();

            const now = Date.now();
            if (now - windowStart >= 60000) {
              perMinute = 0;
              windowStart = now;
            }

            if (perMinute >= 50) {
              await sleep(2200);
            } else {
              await sleep(randomDelay(800, 2000));
            }
          }

          const list = doc.querySelector('.AO, div[role="main"]');
          if (list) {
            list.scrollTop += 600;
          } else {
            global.scrollBy(0, 500);
          }
        } else {
          // Run only while tab is in the background to avoid disrupting active usage.
          await sleep(1200);
          continue;
        }

        await sleep(1200);
      }
    }

    publishStatus(error) {
      const status = {
        state: this.state,
        indexedCount: this.indexedCount,
        updatedAt: Date.now(),
        error: error || null
      };

      this.statusCallback(status);

      chrome.runtime.sendMessage({ type: 'INDEX_STATUS_SET', status }, () => {
        // No-op for disconnected listeners.
      });
    }
  }

  global.EorgIndexer = { EorgIndexer, STATES };
})(window);
