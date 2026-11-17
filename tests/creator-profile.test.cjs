'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const bridgeSource = fs.readFileSync('tipsy-exporter/creator-bridge.js', 'utf8');
const creatorSource = fs.readFileSync('tipsy-exporter/bot-creator.js', 'utf8');

function bridge({ href = 'https://character.ai/', next = null, anchors = [] } = {}) {
  let handler;
  const context = vm.createContext({
    URL,
    location: new URL(href),
    crypto: require('node:crypto').webcrypto,
    setTimeout,
    clearTimeout,
    document: {
      getElementById: id => id === '__NEXT_DATA__' ? { textContent: next ? JSON.stringify(next) : '' } : null,
      querySelector: () => null,
      querySelectorAll: () => anchors,
    },
    window: { addEventListener() {}, top: null },
    chrome: { runtime: { id: 'extension', onMessage: { addListener(fn) { handler = fn; } } } },
  });
  context.window.top = context.window;
  vm.runInContext(creatorSource, context);
  vm.runInContext(bridgeSource, context);
  return () => new Promise(resolve => handler({ type: 'BOT_CREATOR', action: 'profile' }, { id: 'extension' }, resolve));
}

test('Character.AI profile URL uses the signed-in page state instead of a fixed discovery URL', async () => {
  const request = bridge({ next: { props: { pageProps: { user: { user: { username: 'Synthetic_Owner' } } } } } });
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://character.ai/profile/Synthetic_Owner');
});
test('Character.AI profile URL falls back to an explicit My profile link', async () => {
  const request = bridge({
    anchors: [{
      href: 'https://character.ai/profile/Synthetic_Owner',
      getAttribute: () => 'My profile',
      textContent: '',
    }],
  });
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://character.ai/profile/Synthetic_Owner');
});

test('Character.AI profile URL is unavailable rather than guessing /profile', async () => {
  const request = bridge({ next: { props: { pageProps: {} } } });
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.url, null);
});

test('Character.AI profile URL ignores a generic /profile link', async () => {
  const request = bridge({
    anchors: [{
      href: 'https://character.ai/profile',
      getAttribute: () => 'Profile',
      textContent: '',
    }],
  });
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.url, null);
});

test('Character.AI profile URL rejects unsafe usernames', async () => {
  const request = bridge({ next: { props: { pageProps: { user: { user: { username: '../other' } } } } } });
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.url, null);
});

test('Character.AI profile URL accepts the current own-profile path when it matches the signed-in user', async () => {
  const request = bridge({
    href: 'https://character.ai/profile/Synthetic_Owner',
    next: { props: { pageProps: { user: { user: { username: 'Synthetic_Owner' } } } } },
  });
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://character.ai/profile/Synthetic_Owner');
});
