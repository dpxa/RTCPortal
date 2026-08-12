class MockRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
  _succeed(value) {
    this.result = value;
    if (this.onsuccess) this.onsuccess({ target: this });
  }
  _fail(error) {
    this.error = error;
    if (this.onerror) this.onerror({ target: this });
  }
}

class MockIndex {
  constructor(store, keyPath) {
    this.store = store;
    this.keyPath = keyPath;
  }
  getAll() {
    const req = new MockRequest();
    const values = [...this.store.records.values()].sort(
      (a, b) => (a[this.keyPath] ?? 0) - (b[this.keyPath] ?? 0),
    );
    queueMicrotask(() => req._succeed(values));
    return req;
  }
}

class MockObjectStore {
  constructor(name, { keyPath, autoIncrement } = {}) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.records = new Map();
    this.indexes = new Map();
    this._nextId = 1;
  }
  createIndex(name, keyPath) {
    const index = new MockIndex(this, keyPath);
    this.indexes.set(name, index);
    return index;
  }
  index(name) {
    return this.indexes.get(name);
  }
  add(record) {
    const req = new MockRequest();
    let key = record[this.keyPath];
    if (key === undefined && this.autoIncrement) {
      key = this._nextId++;
      record[this.keyPath] = key;
    }
    this.records.set(key, record);

    queueMicrotask(() => req._succeed(key));
    return req;
  }
  getAll() {
    const req = new MockRequest();
    queueMicrotask(() => req._succeed([...this.records.values()]));
    return req;
  }
  clear() {
    const req = new MockRequest();
    this.records.clear();
    queueMicrotask(() => req._succeed(undefined));
    return req;
  }
}

class MockTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.storeNames = storeNames;
    this.mode = mode;
  }
  objectStore(name) {
    return this.db.objectStores.get(name);
  }
}

class MockDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.objectStores = new Map();
    this.objectStoreNames = { contains: (n) => this.objectStores.has(n) };
  }
  createObjectStore(name, options) {
    const store = new MockObjectStore(name, options);
    this.objectStores.set(name, store);
    return store;
  }
  transaction(storeNames, mode) {
    return new MockTransaction(this, storeNames, mode);
  }
}

class MockOpenRequest extends MockRequest {
  constructor(name, version) {
    super();
    this.name = name;
    this.version = version;
  }
}

let dbRegistry = new Map();

export function installIndexedDBMock() {
  globalThis.indexedDB = {
    open(name, version) {
      const req = new MockOpenRequest(name, version);
      let db = dbRegistry.get(name);
      if (!db) {
        db = new MockDatabase(name, version);
        dbRegistry.set(name, db);

        req.onupgradeneeded = null;

        queueMicrotask(() => {
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ target: { result: db } });
          }
          req._succeed(db);
        });
      } else {
        queueMicrotask(() => req._succeed(db));
      }
      return req;
    },
  };
}

export function resetIndexedDBMock() {
  dbRegistry = new Map();
  delete globalThis.indexedDB;
}
