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
});
