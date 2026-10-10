// PoC adapter for browser storage APIs or an application persistence service.
// Provider functions can use IndexedDB/OPFS, fetch, a host bridge, etc.
// This adapter contains no provider-specific or Node.js dependencies.
export class CallbackJournal {
  constructor({count, read, appendAt, readSession, writeSession}) {
    for (const [name, fn] of Object.entries({count, read, appendAt, readSession, writeSession})) {
      if (typeof fn !== 'function') throw new TypeError('callback ' + name);
    }
    Object.assign(this, {count, read, appendAt, readSession, writeSession});
  }
}
