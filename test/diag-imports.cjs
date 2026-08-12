const fs = require("fs");
const src = fs.readFileSync(
  "C:/Users/Andre/Desktop/RTCPortal/public/js/ui/uiManager.js",
  "utf8",
);
const imports = [...src.matchAll(/from ["'](\.[^"']+)["']/g)].map((m) => m[1]);
console.log("relative imports:", imports);
