'use strict';
const api = typeof chrome !== 'undefined' ? chrome : browser;
const Store = {
  read(keys) {
    return new Promise((resolve, reject) =>
      api.storage.local.get(keys, (value) =>
        api.runtime.lastError ? reject(new Error(api.runtime.lastError.message)) : resolve(value),
      ),
    );
  },
  write(value) {
    return new Promise((resolve, reject) =>
      api.storage.local.set(value, () =>
        api.runtime.lastError ? reject(new Error(api.runtime.lastError.message)) : resolve(),
      ),
    );
  },
  async settings() {
    const { preferences } = await this.read('preferences');
    return OblivionCore.normalize(preferences || {});
  },
  async update(patch) {
    const value = OblivionCore.normalize(OblivionCore.merge(await this.settings(), patch));
    if (typeof Engine !== 'undefined' && Engine.pauseRequested && Engine.running) {
      value.bump.enabled = false;
      value.autoRestore.enabled = false;
      value.rules = value.rules.map((r) => ({ ...r, enabled: false }));
      value.inventories = value.inventories.map((i) => ({ ...i, enabled: false }));
      value.integrations.telegram.enabled = false;
      value.integrations.discord.enabled = false;
    }
    await this.write({ preferences: value });
    return value;
  },
  async log(kind, message) {
    const { journal = [] } = await this.read('journal');
    journal.unshift({ time: Date.now(), kind, message: String(message).slice(0, 300) });
    await this.write({ journal: journal.slice(0, 200) });
  },
};
// Large histories use IndexedDB, separately from browser settings quota.
const Ledger = {
  promise: null,
  open() {
    if (!this.promise)
      this.promise = new Promise((resolve, reject) => {
        const request = indexedDB.open('oblivion-ledger', 1);
        request.onupgradeneeded = () => {
          for (const name of ['orders', 'purchases', 'finance'])
            request.result.createObjectStore(name, { keyPath: 'id' });
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.promise = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          this.promise = null;
          reject(request.error);
        };
      });
    return this.promise;
  },
  async put(name, rows) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      for (const row of rows) if (row.id) tx.objectStore(name).put(row);
      tx.oncomplete = () => resolve(rows.length);
      tx.onerror = () => reject(tx.error);
    });
  },
  async all(name) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const r = db.transaction(name).objectStore(name).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
};
