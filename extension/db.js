(function initEorgDb(global) {
  'use strict';

  const DB_NAME = 'eorg_mail_db';
  const DB_VERSION = 1;

  const STORES = {
    emails: { keyPath: 'id', indexes: ['threadId', 'dateEpoch', 'subject'] },
    threads: { keyPath: 'id', indexes: ['updatedAt'] },
    embeddings: { keyPath: 'id', indexes: ['emailId', 'model'] },
    index_jobs: { keyPath: 'id', indexes: ['status', 'updatedAt'] },
    kv: { keyPath: 'key', indexes: [] }
  };

  function req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  class EorgDB {
    constructor() {
      this._dbPromise = null;
    }

    async open() {
      if (this._dbPromise) {
        return this._dbPromise;
      }

      this._dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          for (const [name, def] of Object.entries(STORES)) {
            if (!db.objectStoreNames.contains(name)) {
              const store = db.createObjectStore(name, { keyPath: def.keyPath });
              for (const index of def.indexes) {
                store.createIndex(index, index, { unique: false });
              }
            }
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
      });

      return this._dbPromise;
    }

    async tx(storeName, mode, callback) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        Promise.resolve(callback(store, tx)).then((value) => {
          tx.oncomplete = () => resolve(value);
        }).catch((error) => {
          try {
            tx.abort();
          } catch (_e) {
            // no-op
          }
          reject(error);
        });

        tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
      });
    }

    async put(store, value) {
      return this.tx(store, 'readwrite', (s) => req(s.put(value)).then(() => value));
    }

    async bulkPut(store, values) {
      return this.tx(store, 'readwrite', async (s) => {
        for (const value of values) {
          await req(s.put(value));
        }
        return values.length;
      });
    }

    async get(store, key) {
      return this.tx(store, 'readonly', (s) => req(s.get(key)));
    }

    async getAll(store) {
      return this.tx(store, 'readonly', (s) => req(s.getAll()));
    }

    async getByIndex(store, indexName, key) {
      return this.tx(store, 'readonly', (s) => req(s.index(indexName).getAll(key)));
    }

    async setKV(key, value) {
      return this.put('kv', { key, value, updatedAt: Date.now() });
    }

    async getKV(key, fallback) {
      const item = await this.get('kv', key);
      return item ? item.value : fallback;
    }
  }

  global.EorgDB = EorgDB;
})(window);
