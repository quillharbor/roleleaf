'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { webcrypto } = nodeCrypto;

const atob = value => Buffer.from(value, 'base64').toString('binary');
const env = vm.createContext({
  URL, TextEncoder, Uint8Array, atob,
  crypto: webcrypto,
});
vm.runInContext(fs.readFileSync('tipsy-exporter/image-ref.js', 'utf8'), env);
const R = env.RoleLeafImageRef;

const pem = (label, bytes) => `-----BEGIN ${label}-----\n` +
  Buffer.from(bytes).toString('base64').match(/.{1,64}/g).join('\n') +
  `\n-----END ${label}-----`;

async function keyPair() {
  const pair = await webcrypto.subtle.generateKey({
    name: 'RSA-OAEP',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }, true, ['encrypt', 'decrypt']);
  const pub = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  const priv = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey: pem('PUBLIC KEY', pub), privateKey: pem('PRIVATE KEY', priv) };
}

function decrypt(compact, privatePem) {
  const [protectedHeader, encryptedKey, iv, ciphertext, tag] = compact.split('.');
  const key = nodeCrypto.privateDecrypt({
    key: nodeCrypto.createPrivateKey(privatePem),
    padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, Buffer.from(encryptedKey, 'base64url'));
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(protectedHeader));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return {
    header: JSON.parse(Buffer.from(protectedHeader, 'base64url').toString()),
    payload: JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString()),
  };
}

test('image references use randomized JWE and stable public image IDs', async () => {
  const pair = await keyPair();
  assert.equal(R.configure({ kid: 'roleleaf-image-v1', publicKey: pair.publicKey }), true);
  const input = {
    platform: 'character_ai',
    botId: 'character-Synthetic-123',
    role: 'avatar',
    url: 'https://characterai.io/i/400/static/avatars/synthetic.png?token=ignored',
    file: 'assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
    sha256: 'a'.repeat(64),
    mime: 'image/webp',
  };
  const first = await R.encrypt(input);
  const second = await R.encrypt(input);
  assert.match(first.image_id, /^img_[A-Za-z0-9_-]{22}$/);
  assert.equal(first.image_id, second.image_id);
  assert.notEqual(first.ref, second.ref);
  assert.equal(first.ref.split('.').length, 5);

  const opened = decrypt(first.ref, pair.privateKey);
  assert.deepEqual(opened.header, {
    alg: 'RSA-OAEP-256', enc: 'A256GCM', kid: 'roleleaf-image-v1',
    cty: 'roleleaf-image-ref+json',
  });
  assert.equal(opened.payload.bot_id, input.botId);
  assert.equal(opened.payload.role, input.role);
  assert.equal(opened.payload.source_url, 'https://characterai.io/i/400/static/avatars/synthetic.png');
  assert.equal(opened.payload.file, input.file);
  assert.equal(opened.payload.sha256, input.sha256);
});

test('image IDs include the bot identity without exposing it', async () => {
  const base = {
    platform: 'tipsy', role: 'cover',
    url: 'https://img.tipsy.chat/cover.png', sha256: 'b'.repeat(64),
  };
  const one = await R.imageId({ ...base, botId: '100000000001' });
  const same = await R.imageId({ ...base, botId: '100000000001' });
  const sameContentDifferentURL = await R.imageId({
    ...base, botId: '100000000001', url: 'https://img.tipsy.chat/other-copy.png',
  });
  const other = await R.imageId({ ...base, botId: '100000000002' });
  assert.equal(one, same);
  assert.equal(one, sameContentDifferentURL);
  assert.notEqual(one, other);
  assert.doesNotMatch(one, /100000000001/);
});

test('the shipped configuration contains only a public key', () => {
  const source = fs.readFileSync('tipsy-exporter/image-ref-config.js', 'utf8');
  assert.match(source, /-----BEGIN PUBLIC KEY-----/);
  assert.doesNotMatch(source, /PRIVATE KEY/);
  assert.match(source, /kid:\s*'roleleaf-image-v1'/);
});

test('image references fail closed when the public key is not configured', async () => {
  R.configure();
  assert.equal(R.enabled(), false);
  await assert.rejects(R.encrypt({
    platform: 'character_ai', botId: 'character-Synthetic-123', role: 'avatar',
    url: 'https://characterai.io/avatar.png', file: 'assets/a.png',
    sha256: 'c'.repeat(64), mime: 'image/png',
  }), /not configured/);
});
