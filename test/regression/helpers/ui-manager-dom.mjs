// Minimal DOM fixture matching the element IDs uiManager.js looks up, so
// UIManager can be constructed under jsdom.

export const UI_MANAGER_HTML = `
<div id="my-id-display">Waiting for PIN...</div>
<div id="pin-action-buttons" hidden></div>
<button id="copy-id-btn"></button>
<button id="copy-link-btn"></button>
<button id="show-qr-btn">QR Code</button>
<div id="qr-code-wrapper" hidden><div id="qr-code-container"></div></div>
<input id="partner-id-field" />
<button id="connect-btn" disabled>Connect</button>
<span id="status-id-message"></span>
<div id="active-connection-container" hidden>
  <span id="active-connection-label"></span>
  <span id="active-connection-status"></span>
</div>
<button id="end-btn" hidden></button>
<div id="file-transfer-section" hidden>
  <input id="upload-field" type="file" />
  <input id="folder-upload-field" type="file" />
  <div id="drop-zone"></div>
  <button id="browse-files-btn"></button>
  <button id="browse-folder-btn"></button>
  <div id="file-name-display"></div>
  <button id="file-transfer-btn" disabled></button>
  <span id="file-status-message"></span>
  <div id="outgoing-folders-section" hidden><div id="outgoing-folders"></div></div>
  <div id="incoming-folders-section" hidden><div id="incoming-folders"></div></div>
  <div id="outgoing-files-section" hidden><div id="outgoing-files"></div></div>
  <div id="incoming-files-section" hidden><div id="incoming-files"></div></div>
</div>
<div id="transfer-history" hidden>
  <div class="erase-history-container"></div>
</div>
<div id="chat-section">
  <div id="chat-box"><div class="chat-placeholder">No messages yet...</div></div>
  <input id="chat-input" />
  <button id="send-chat-btn">Send</button>
  <button id="toggle-chat-btn" hidden>Open Chat</button>
</div>
<div id="chat-history-section" hidden><div id="chat-history-list"></div></div>
<span id="success-rate-display">-</span>
<span id="uptime-display">-</span>
<span id="total-data-display">-</span>
<span id="total-files-display">-</span>
<button id="theme-toggle"></button>
<button id="edit-nickname-btn" hidden></button>
`;

// Elements expected to affect document.title updates.
export const EXPECTED_TITLE = "RTCPortal - P2P Transfer Hub";
