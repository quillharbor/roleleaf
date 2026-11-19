'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const bridgeSource = fs.readFileSync('tipsy-exporter/creator-bridge.js', 'utf8');
const creatorSource = fs.readFileSync('tipsy-exporter/bot-creator.js', 'utf8');

function bridge({ href = 'https://character.ai/', next = null, anchors = [], images = [] } = {}) {
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
      querySelectorAll: selector => selector === 'img' ? images : anchors,
    },
    window: { addEventListener() {}, top: null },
    chrome: { runtime: { id: 'extension', onMessage: { addListener(fn) { handler = fn; } } } },
  });
  context.window.top = context.window;
  vm.runInContext(creatorSource, context);
  vm.runInContext(bridgeSource, context);
  return () => new Promise(resolve => handler({ type: 'BOT_CREATOR', action: 'profile' }, { id: 'extension' }, resolve));
}

function creatorRead({ href = 'https://character.ai/', next = null, images = [], otherImages = [] } = {}) {
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
      querySelectorAll: selector => selector === 'input[type="file"][accept*="image"]'
        ? [{ labels: [{ querySelectorAll: () => images }], closest: () => null }]
        : selector === 'img' ? otherImages : [],
    },
    window: { addEventListener() {}, top: null },
    chrome: { runtime: { id: 'extension', onMessage: { addListener(fn) { handler = fn; } } } },
  });
  context.window.top = context.window;
  vm.runInContext(creatorSource, context);
  vm.runInContext(bridgeSource, context);
  const id = next?.query?.id;
  return new Promise(resolve => handler({ type: 'BOT_CREATOR', action: 'read', characterId: id }, { id: 'extension' }, resolve));
}

function image(src, alt, { round = true, size = 1200 } = {}) {
  return {
    src, currentSrc: src, alt, naturalWidth: size, naturalHeight: size,
    parentElement: { className: round ? 'relative flex overflow-hidden rounded-full' : 'relative overflow-hidden' },
  };
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

test('creator read uses the visible character avatar when avatar_file_name is empty', async () => {
  const id = 'Synthetic_Bot-123';
  const href = `https://character.ai/character/${id}/edit`;
  const next = {
    page: '/character/[id]/edit', query: { id },
    props: { pageProps: {
      user: { user: { username: 'Synthetic_Owner' } },
      prefetchedCharacterDetailed: {
        external_id: id, user__username: 'Synthetic_Owner', name: 'Synthetic Bot',
        avatar_file_name: '', visibility: 'PRIVATE',
      },
      prefetchedCharacterTags: [],
    } },
  };
  const result = await creatorRead({ href, next, otherImages: [
    image('https://characterai.io/pfp-fallbacks/7.webp', 'Synthetic Bot', { size: 2000 }),
  ], images: [
    image('https://characterai.io/pfp-fallbacks/7.webp', 'Synthetic Bot', { round: false }),
    image('https://characterai.io/other-upload.webp', 'Synthetic Bot'),
    image('https://characterai.io/pfp-fallbacks/2.webp', 'Other Character'),
    image('https://characterai.io/pfp-fallbacks/6.webp', 'Synthetic Bot'),
    image('https://characterai.io/pfp-fallbacks/0.webp', 'Synthetic_Owner'),
  ] });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.assets)), [
    { role: 'avatar', url: 'https://characterai.io/pfp-fallbacks/6.webp' },
    { role: 'cover', url: 'https://characterai.io/pfp-fallbacks/6.webp' },
  ]);
});

test('creator read does not guess an avatar when no matching visible image exists', async () => {
  const id = 'Synthetic_Bot-123';
  const href = `https://character.ai/character/${id}/edit`;
  const next = {
    page: '/character/[id]/edit', query: { id },
    props: { pageProps: {
      user: { user: { username: 'Synthetic_Owner' } },
      prefetchedCharacterDetailed: {
        external_id: id, user__username: 'Synthetic_Owner', name: 'Synthetic Bot',
        avatar_file_name: '', visibility: 'PRIVATE',
      },
      prefetchedCharacterTags: [],
    } },
  };
  const result = await creatorRead({ href, next, images: [
    image('https://characterai.io/pfp-fallbacks/2.webp', 'Other Character'),
    image('https://characterai.io/pfp-fallbacks/0.webp', 'Synthetic_Owner'),
  ] });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.assets)), []);
});

test('creator read keeps the primary avatar URL so the downloader can report failures before falling back', async () => {
  const id = 'Synthetic_Bot-123';
  const href = `https://character.ai/character/${id}/edit`;
  const next = {
    page: '/character/[id]/edit', query: { id },
    props: { pageProps: {
      user: { user: { username: 'Synthetic_Owner' } },
      prefetchedCharacterDetailed: {
        external_id: id, user__username: 'Synthetic_Owner', name: 'Synthetic Bot',
        avatar_file_name: 'i/400/static/avatars/missing.png', visibility: 'PRIVATE',
      },
      prefetchedCharacterTags: [],
    } },
  };
  const result = await creatorRead({
    href, next,
    images: [image('https://characterai.io/pfp-fallbacks/6.webp', 'Synthetic Bot')],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.assets)), [
    { role: 'avatar', url: 'https://characterai.io/i/400/static/avatars/missing.png',
      fallback_url: 'https://characterai.io/pfp-fallbacks/6.webp' },
    { role: 'cover', url: 'https://characterai.io/i/400/static/avatars/missing.png' },
  ]);
});
