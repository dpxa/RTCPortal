import { JSDOM } from 'jsdom';
import { UI_MANAGER_HTML } from './ui-manager-dom.mjs';

let dom;
let originalFetch;

export function setupJSDOMEnv() {
  dom = new JSDOM(UI_MANAGER_HTML, { url: 'http://localhost/' });
  const window = dom.window;
  const document = window.document;

  globalThis.window = window;
  globalThis.document = document;
  globalThis.localStorage = window.localStorage;
  const mockMatchMedia = query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  });
  window.matchMedia = mockMatchMedia;
  globalThis.matchMedia = mockMatchMedia;

  window.navigator.storage = { getDirectory: async () => ({}) };
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  
  globalThis.indexedDB = {
    open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null })
  };

  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

  globalThis.Worker = class {
    addEventListener() {}
    postMessage() {}
    terminate() {}
  };

  globalThis.io = () => ({
    on: () => {},
    off: () => {},
    emit: () => {},
    disconnect: () => {},
    id: "mock-socket-id",
  });
  
  globalThis.RTCPeerConnection = class {
    addEventListener() {}
    close() {}
  };

  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => {};
  dom.originalSetInterval = originalSetInterval;

  return { window, document };
}

export function teardownJSDOMEnv() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.matchMedia;
  delete globalThis.Worker;
  delete globalThis.io;
  delete globalThis.RTCPeerConnection;
  globalThis.fetch = originalFetch;
  try {
    delete globalThis.navigator;
  } catch {
    Object.defineProperty(globalThis, 'navigator', { value: undefined });
  }
  
  if (dom && dom.window) {
    dom.window.close();
  }
  if (dom && dom.originalSetInterval) {
    globalThis.setInterval = dom.originalSetInterval;
  }
}
