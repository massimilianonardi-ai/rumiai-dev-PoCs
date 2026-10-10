// PoC 063 browser IndexedDB adapter for the existing AsyncHistory journal port.
// No browser storage APIs are imported by the text/history engine.
// A connection is owned by the adapter; use a distinct database per editor
// session in tests. Multi-tab writers and crash consistency are out of scope.
function complete(tx, makeRequests) {
  return new Promise((resolve, reject) => {
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    try { makeRequests(value => { result = value; }); }
    catch (error) { try { tx.abort(); } catch {} reject(error); }
  });
}
export class IndexedDBJournal {
  constructor(db, length) { this.db = db; this.length = length; }
  static async open(name) {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    if (typeof name !== 'string' || !name) throw new TypeError('database name');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('entries')) database.createObjectStore('entries');
        if (!database.objectStoreNames.contains('session')) database.createObjectStore('session');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB database blocked'));
    });
    return new IndexedDBJournal(db, await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly');
      const request = tx.objectStore('entries').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    }));
  }
  async count() { return this.length; }
  async read(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) throw new RangeError('journal index');
    const tx = this.db.transaction('entries', 'readonly');
    const value = await complete(tx, finish => {
      const request = tx.objectStore('entries').get(index);
      request.onsuccess = () => finish(request.result);
    });
    if (value === undefined) throw new Error('journal record missing: ' + index);
    return value;
  }
  async appendAt(index, entry) {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.length) throw new RangeError('append index');
    const tx = this.db.transaction('entries', 'readwrite');
    await complete(tx, () => {
      const store = tx.objectStore('entries');
      if (index < this.length) store.delete(IDBKeyRange.lowerBound(index));
      store.put(entry, index);
    });
    this.length = index + 1;
  }
  async readSession() {
    const tx = this.db.transaction('session', 'readonly');
    const value = await complete(tx, finish => {
      const request = tx.objectStore('session').get('state');
      request.onsuccess = () => finish(request.result);
    });
    return value ?? null;
  }
  async writeSession(state) {
    const tx = this.db.transaction('session', 'readwrite');
    await complete(tx, () => tx.objectStore('session').put(state, 'state'));
  }
  close() { this.db.close(); }
}
