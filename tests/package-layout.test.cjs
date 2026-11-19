'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extensionFiles } = require('../scripts/package.cjs');

test('Chrome package uses the exporter folder', () => {
  const files = extensionFiles();
  assert.ok(files.length >= 20);
  assert.ok(files.some(file => file.path === 'exporter/manifest.json'));
  assert.ok(files.every(file => file.path.startsWith('exporter/')));
  assert.ok(!files.some(file => file.path.startsWith('tipsy-exporter/')));
  assert.ok(!files.some(file => /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(file.path)));
  assert.ok(!files.some(file => /PRIVATE KEY/.test(
    Buffer.from(file.data).toString('utf8'),
  )));
  const manifest = JSON.parse(Buffer.from(files.find(file => file.path === 'exporter/manifest.json').data).toString('utf8'));
  assert.ok(manifest.host_permissions.includes('https://chat-attachments-prod.a4a46ba0803ca197cf9724979695aaf8.r2.cloudflarestorage.com/*'));
  assert.ok(!manifest.host_permissions.some(permission => permission.includes('*.' )));
});
