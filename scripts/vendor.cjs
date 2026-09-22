const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
for (const [source, target] of [
  ['peerjs/dist/peerjs.min.js', 'peerjs.min.js'],
  ['peerjs/LICENSE', 'peerjs.LICENSE'],
  ['qrcode-generator/dist/qrcode.js', 'qrcode.js'],
]) fs.copyFileSync(path.join(root, 'node_modules', source), path.join(root, 'vendor', target));
