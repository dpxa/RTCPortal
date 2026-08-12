export class HistoryService {
  constructor() {
    this.dbName = "rtcportal_history";
    this.dbVersion = 2;
    this.storeName = "transfers";
    this.chatStoreName = "chat";
    this.db = null;
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error("IndexedDB error:", event.target.error);
        reject(event.target.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("type", "type", { unique: false }); 
        }
        if (!db.objectStoreNames.contains(this.chatStoreName)) {
          const chatStore = db.createObjectStore(this.chatStoreName, {
            keyPath: "id",
            autoIncrement: true,
          });
          chatStore.createIndex("timestamp", "timestamp", { unique: false });
          chatStore.createIndex("peerId", "peerId", { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };
    });
  }

  async addRecord(record) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);

      const recordToSave = {
        ...record,
        timestamp: Date.now(),
      };

      const request = store.add(recordToSave);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getHistory() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([]);
        return;
      }
      const transaction = this.db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const index = store.index("timestamp");
      const request = index.getAll();

      request.onsuccess = () => resolve(request.result.reverse()); 
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async clearHistory() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }
      const transaction = this.db.transaction(
        [this.storeName, this.chatStoreName],
        "readwrite",
      );
      const store = transaction.objectStore(this.storeName);
      const chatStore = transaction.objectStore(this.chatStoreName);
      const requestA = store.clear();
      if (chatStore) {
        chatStore.clear();
      }

      requestA.onsuccess = () => resolve();
      requestA.onerror = (event) => reject(event.target.error);
    });
  }

  async addChatRecord(record) {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }
      const transaction = this.db.transaction(
        [this.chatStoreName],
        "readwrite",
      );
      const store = transaction.objectStore(this.chatStoreName);
      const recordToSave = {
        ...record,
        timestamp: Date.now(),
      };
      const request = store.add(recordToSave);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getChatHistory() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([]);
        return;
      }
      const transaction = this.db.transaction([this.chatStoreName], "readonly");
      const store = transaction.objectStore(this.chatStoreName);
      const index = store.index("timestamp");
      const request = index.getAll();

      request.onsuccess = () => resolve(request.result); 
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async clearChatHistory() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }
      const transaction = this.db.transaction(
        [this.chatStoreName],
        "readwrite",
      );
      const store = transaction.objectStore(this.chatStoreName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }
}

export const historyService = new HistoryService();
