'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, signingEnvironment, notarizeDmg, validateArchiveEntries } = require('../scripts/desktop-release.cjs');

test('release entry rejects accidental test shortcuts and unknown arguments', () => {
  assert.throws(() => parseArgs(['release', '--local-electron', '--arch', process.arch]), /仅用于/);
  assert.throws(() => parseArgs(['test', '--arch', 'amd64']), /未知参数/);
  assert.throws(() => parseArgs(['release', '--skip-sign']), /未知参数/);
  assert.equal(parseArgs(['release']).arch, 'universal');
});

test('release preflight requires an exact Developer ID identity and an unambiguous notarization profile', () => {
  const identity = 'Developer ID Application: Example (TESTTEAM)';
  const env = { CSC_NAME: identity, APPLE_KEYCHAIN_PROFILE: 'test-notary' };
  const identities = `1) ABC "${identity}"\n 1 valid identities found`;
  assert.throws(() => signingEnvironment(env, '0 valid identities found'), /未找到/);
  assert.throws(() => signingEnvironment({ ...env, CSC_NAME: 'Apple Development: Example' }, identities), /未找到/);
  assert.throws(() => signingEnvironment({ CSC_NAME: identity }, identities), /APPLE_KEYCHAIN_PROFILE/);
  assert.throws(() => signingEnvironment({ ...env, APPLE_ID: 'example.invalid' }, identities), /混用凭据/);
  assert.deepEqual(signingEnvironment(env, identities), env);
});

test('notarytool process success is insufficient: Invalid must not staple or publish', () => {
  const calls = [];
  const execute = (cmd, args) => {
    calls.push([cmd, ...args]);
    return JSON.stringify({ id: 'synthetic-id', status: 'Invalid' });
  };
  assert.throws(() => notarizeDmg('/tmp/synthetic.dmg', { APPLE_KEYCHAIN_PROFILE: 'test' }, execute), /公证未通过/);
  assert.equal(calls.length, 1);
});

test('accepted notarization must still pass staple and ticket validation', () => {
  const calls = [];
  const execute = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'notarytool') return JSON.stringify({ id: 'synthetic-id', status: 'Accepted' });
    if (args[1] === 'validate') throw Error('ticket missing');
    return '';
  };
  assert.throws(() => notarizeDmg('/tmp/synthetic.dmg', { APPLE_KEYCHAIN_PROFILE: 'test', APPLE_KEYCHAIN: '/tmp/test.keychain' }, execute), /ticket missing/);
  assert.deepEqual(calls.map(call => call.slice(1, 3)), [['notarytool', 'submit'], ['stapler', 'staple'], ['stapler', 'validate']]);
  assert.ok(calls[0].includes('/tmp/test.keychain'));
});

test('packaged archive rejects nested old installers, dependencies and missing bridges', () => {
  const files = ['/package.json', '/desktop', '/desktop/main.cjs', '/desktop/site-preload.cjs', '/desktop/index.html',
    '/tipsy-exporter', '/tipsy-exporter/page.bundle.js', '/tipsy-exporter/bridge.bundle.js',
    '/tipsy-exporter/cai-page.bundle.js', '/tipsy-exporter/cai-bridge.bundle.js'];
  assert.doesNotThrow(() => validateArchiveEntries(files));
  for (const extra of ['/desktop/release-notarized/old.dmg', '/desktop/package-lock.json', '/node_modules/secret.txt', '/.env']) {
    assert.throws(() => validateArchiveEntries([...files, extra]), /非运行文件/);
  }
  assert.throws(() => validateArchiveEntries(files.filter(file => !file.endsWith('cai-bridge.bundle.js'))), /缺少运行文件/);
});
