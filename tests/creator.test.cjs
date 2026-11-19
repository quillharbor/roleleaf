'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const name of ['core', 'png', 'bot-model', 'bot-creator', 'bot-package']) require('../tipsy-exporter/' + name);
const C = globalThis.BotCreator, P = globalThis.BotPackage;
const tipsyId = '1000000000123', caiId = 'character-Alpha';
const tipsyProfile = 'https://tipsy.chat/pt/profile/1000000000777';
const tipsyEditor = `https://tipsy.chat/pt/update?character_id=${tipsyId}`;
const caiEditor = `https://character.ai/character/${caiId}/edit`;

test('creator targets are site- and identity-bound and distinct from chat URLs', () => {
  assert.deepEqual(C.target('tipsy', tipsyId, tipsyProfile + '?ignore=1'), { platform: 'tipsy', id: tipsyId, url: tipsyProfile });
  assert.equal(C.editor(tipsyEditor)?.id, tipsyId);
  assert.equal(C.target('character_ai', caiId, caiEditor)?.url, caiEditor);
  assert.equal(C.target('character_ai', 'other-char', caiEditor), null);
  for (const url of ['https://character.ai.evil.test/profile/someone', 'https://someone@tipsy.chat/profile/1000000000777',
    'https://character.ai/chat/character-Alpha', 'https://tipsy.chat/create', 'https://tipsy.chat/profile/1000000000777/edit']) {
    assert.equal(C.profile(url), null); assert.equal(C.editor(url), null);
  }
});

test('avatar_file_name accepts every supported Character.AI address form', () => {
  assert.equal(C.caiAvatar({ avatar_file_name: 'i/400/static/avatars/a.png' }),
    'https://characterai.io/i/400/static/avatars/a.png');
  assert.equal(C.caiAvatar({ avatar_file_name: '/i/400/static/avatars/a.png' }),
    'https://characterai.io/i/400/static/avatars/a.png');
  assert.equal(C.caiAvatar({ avatar_file_name: '//characterai.io/i/400/static/avatars/a.png' }),
    'https://characterai.io/i/400/static/avatars/a.png');
  assert.equal(C.caiAvatar({ avatar_file_name: 'https://characterai.io/i/400/static/avatars/a.png' }),
    'https://characterai.io/i/400/static/avatars/a.png');
  assert.equal(C.caiAvatar({ avatar_url: 'https://characterai.io/uploaded/2026/11/19/a.jpg' }),
    'https://characterai.io/i/400/static/avatars/uploaded/2026/11/19/a.jpg');
  assert.equal(C.caiAvatar({ avatar_file_name: 'uploaded/2026/11/19/a.jpg' }),
    'https://characterai.io/i/400/static/avatars/uploaded/2026/11/19/a.jpg');
  for (const value of ['', ' ', '../other.png', '/../other.png', 'https://evil.test/a.png',
    'javascript:alert(1)', '//evil.test/a.png']) {
    assert.equal(C.caiAvatar({ avatar_file_name: value }), null, value);
  }
});

test('Character.AI creator assets include a cover and preserve the background separately', () => {
  const id = 'character-Cover';
  const href = `https://character.ai/character/${id}/edit`;
  const detail = { external_id: id, user__username: 'owner', name: 'Cover Bot',
    avatar_file_name: 'safe/avatar.png',
    background_image_url: 'https://characterai.io/safe/background.webp' };
  const page = { page: '/character/[id]/edit', query: { id },
    props: { pageProps: { user: { user: { username: 'owner' } }, prefetchedCharacterDetailed: detail,
      prefetchedCharacterTags: [] } } };
  const model = C.model(C.editor(href), { ...C.caiEditor(page, id), url: href });
  assert.deepEqual(model.assets, [
    { role: 'avatar', url: 'https://characterai.io/safe/avatar.png' },
    { role: 'cover', url: 'https://characterai.io/safe/background.webp' },
    { role: 'background', url: 'https://characterai.io/safe/background.webp' },
  ]);

  delete detail.background_image_url;
  const fallback = C.model(C.editor(href), { ...C.caiEditor(page, id), url: href });
  assert.deepEqual(fallback.assets, [
    { role: 'avatar', url: 'https://characterai.io/safe/avatar.png' },
    { role: 'cover', url: 'https://characterai.io/safe/avatar.png' },
  ]);
});

test('an unavailable Character.AI background falls back to the saved avatar for the cover', async () => {
  const context = vm.createContext({
    URL, AbortController, TextEncoder, TextDecoder, Uint8Array, DataView, crypto, atob, Blob,
    setTimeout, clearTimeout,
    createImageBitmap: async blob => {
      if (blob.type === 'image/jpeg') throw Error('Synthetic decode failure');
      return { close() {} };
    },
  });
  for (const file of ['core', 'png', 'bot-model', 'bot-package', 'image-ref', 'image-ref-config', 'collect-bot']) {
    vm.runInContext(fs.readFileSync(`tipsy-exporter/${file}.js`, 'utf8'), context);
  }
  const collect = vm.runInContext('collectImages', context);
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64'));
  const avatar = 'https://characterai.io/avatar.png';
  const background = 'https://characterai.io/missing.png';
  const model = {
    platform: 'character_ai', id: caiId, card: {},
    assets: [{ role: 'avatar', url: avatar }, { role: 'cover', url: background }, { role: 'background', url: background }],
  };
  const download = async url => {
    if (url === background) throw Error('Image HTTP 404');
    return { data: png, ext: 'png' };
  };
  const result = await collect(model, new AbortController().signal, () => {}, [], download);
  const [avatarAsset, coverAsset, backgroundAsset] = result.assets;
  assert.equal(coverAsset.status, 'saved');
  assert.equal(coverAsset.file, avatarAsset.file);
  assert.notEqual(coverAsset.image_id, avatarAsset.image_id);
  assert.equal(coverAsset.ref.split('.').length, 5);
  assert.equal(coverAsset.fallback.error, 'Image HTTP 404');
  assert.equal(backgroundAsset.status, 'failed');
  assert.equal(result.files.length, 1);

  const recovered = await collect({ ...model, assets: [
    { role: 'avatar', url: avatar },
    { role: 'cover', url: background },
    { role: 'background', url: background },
  ] }, new AbortController().signal, () => {}, [], async url => {
    if (url === avatar) throw Error('Image download failed: Image HTTP 404');
    return { data: png, ext: 'png' };
  });
  assert.equal(recovered.assets[0].status, 'saved');
  assert.equal(recovered.assets[0].fallback.error, 'Image HTTP 404');
  assert.equal(recovered.assets[0].path, recovered.assets[2].path);
  assert.notEqual(recovered.assets[0].image_id, recovered.assets[2].image_id);
  assert.equal(recovered.files.length, 1);

  const original = 'https://characterai.io/uploaded/original.png';
  const fallbackURL = 'https://characterai.io/i/400/static/avatars/uploaded/original.png';
  const requested = [];
  const explicit = await collect({ ...model, assets: [{ role: 'avatar', url: original, fallback_url: fallbackURL }] },
    new AbortController().signal, () => {}, [], async url => {
      requested.push(url);
      return { data: png, ext: 'png' };
    });
  assert.deepEqual(requested, [original]);
  assert.equal(explicit.assets[0].status, 'saved');

  const broken = await collect({ ...model, assets: [{ role: 'avatar', url: avatar }] },
    new AbortController().signal, () => {}, [], async () => ({
      data: Uint8Array.of(255, 216, 255, 0, 255, 217), ext: 'jpg',
    }));
  assert.equal(broken.assets[0].error, 'Image could not be decoded');
  assert.equal(broken.files.length, 0);

  context.RoleLeafImageRef.configure();
  const unconfigured = await collect(model, new AbortController().signal, () => {}, [], download);
  assert.equal(unconfigured.assets[0].error, 'Image reference encryption failed');
  assert.equal(unconfigured.files.length, 0);
});

test('the creator ZIP keeps Tipsy linked profiles and moves their saved images into the shared asset list', async () => {
  const signedURL = 'https://img.tipsy.chat/linked.webp?token=synthetic-linked';
  const badURL = 'https://img.tipsy.chat/missing.webp?token=synthetic-bad';
  const greetingURL = 'https://unlisted.example/image?token=synthetic-greeting';
  const data = C.snapshot('tipsy', tipsyId, { character: {
    character_id: tipsyId, nickname: 'Synthetic', greeting: `Hi ![diagram](${greetingURL})`,
    role_characters: [{ name: 'Linked', image_url: signedURL }, { name: 'Other', image_url: badURL }],
  } });
  const model = C.model(C.editor(tipsyEditor), { ...data, url: tipsyEditor });
  assert.deepEqual(model.assets, [{ role: 'reference', url: signedURL }, { role: 'reference', url: badURL }]);
  const save = { status: 'saved', path: 'assets/synthetic.webp', image_id: 'img_linked', sha256: 'a'.repeat(64),
    mime: 'image/webp', ref: 'header.key.iv.ciphertext.tag' };
  const zip = await P.build({ model, conversations: [], scope: { actual: 'creator_character' },
    assets: [{ ...model.assets[0], ...save }, { ...model.assets[1], status: 'failed', error: 'Image HTTP 404' }],
    files: [{ path: save.path, data: Uint8Array.of(1) }] });
  const contents = path => JSON.parse(zip.files.find(file => file.path === path).data);
  assert.deepEqual(contents('character/character.json').fields.linked_characters.value,
    [{ name: 'Linked', image_id: 'img_linked' }, { name: 'Other' }]);
  assert.equal(contents('character/card.json').data.first_mes, 'Hi diagram');
  assert.equal(contents('assets/assets.json').assets.length, 1);
  assert.doesNotMatch(Buffer.from(zip.bytes).toString(), /synthetic-(?:linked|bad|greeting)/);
});

test('Character.AI creator export verifies ownership and retains saved settings and source ID', async () => {
  const detail = { external_id: caiId, user__username: 'owner', name: 'Private Bot', visibility: 'PRIVATE',
    description: '', definition: 'Private authored definition', additional_greetings: ['Another opening'],
    avatar_file_name: 'safe/photo.png', token: 'must-not-export', email: 'must-not-export',
    dynamic_greeting_enabled: false, lorebook_id: 'linked' };
  const page = { page: '/character/[id]/edit', query: { id: caiId },
    props: { pageProps: { user: { user: { username: 'other' } }, prefetchedCharacterDetailed: detail,
      prefetchedCharacterTags: [{ tag_id: 'a', display_name: 'Adventure', token: 'must-not-export' }] } } };
  assert.equal(C.caiEditor(page, caiId), null);
  page.props.pageProps.user.user.username = 'owner';
  assert.equal(C.caiEditor(page, 'different-bot'), null);
  const model = C.model(C.editor(caiEditor), { ...C.caiEditor(page, caiId), url: caiEditor });
  assert.equal(model.fields.definition.value, detail.definition);
  assert.equal(model.fields.dynamic_greeting.value, false);
  assert.equal(model.fields.description.status, 'empty');
  assert.equal(model.fields.lorebook.status, 'metadata_only');
  assert.equal(model.fields.greeting.status, 'missing');
  assert.deepEqual(model.card.data.tags, ['Adventure']);
  assert.deepEqual(model.card.data.alternate_greetings, ['Another opening']);
  assert.equal(model.assets[0].url, 'https://characterai.io/safe/photo.png');
  assert.doesNotMatch(JSON.stringify(model), /must-not-export|username/);

  const built = await P.build({ model, conversations: [], scope: { actual: 'creator_character' },
    assets: [], files: [], started: '2026-11-13' });
  assert.equal(built.manifest.bot_id, caiId);
  assert.equal(JSON.parse(built.files.find(file => file.path === 'character/character.json').data).id, caiId);
});

test('creator packages omit failed image URLs from import metadata', async () => {
  const id = 'character-Beta';
  const href = `https://character.ai/character/${id}/edit`;
  const detail = { external_id: id, user__username: 'owner', name: 'Private Bot', visibility: 'PRIVATE',
    description: 'Synthetic', greeting: 'Hello' };
  const page = { page: '/character/[id]/edit', query: { id },
    props: { pageProps: { user: { user: { username: 'owner' } }, prefetchedCharacterDetailed: detail,
      prefetchedCharacterTags: [] } } };
  const model = C.model(C.editor(href), { ...C.caiEditor(page, id), url: href });
  const broken = 'https://characterai.io/missing-avatar.webp';
  const built = await P.build({
    model, conversations: [], scope: { requested: 'creator_character', actual: 'creator_character' },
    assets: [{ role: 'avatar', url: broken, status: 'failed', path: null, error: 'Image HTTP 404' }],
    files: [], started: '2026-11-19',
  });
  const character = JSON.parse(built.files.find(file => file.path === 'character/character.json').data);
  const assets = JSON.parse(built.files.find(file => file.path === 'assets/assets.json').data);
  assert.equal(character.assets, undefined);
  assert.deepEqual(assets, { schema: 'roleleaf_assets_v1', assets: [] });
  assert.equal(built.report.images.status, 'partial');
  assert.deepEqual(built.report.images.assets, [
    { role: 'avatar', url: broken, status: 'failed', path: null, error: 'Image HTTP 404' },
  ]);
  assert.match(built.report.warnings.join('\n'), /left out of the import metadata/);
});

test('creator import metadata uses local images and encrypted references', async () => {
  const id = 'character-Gamma';
  const href = `https://character.ai/character/${id}/edit`;
  const detail = { external_id: id, user__username: 'owner', name: 'Private Bot' };
  const page = { page: '/character/[id]/edit', query: { id },
    props: { pageProps: { user: { user: { username: 'owner' } }, prefetchedCharacterDetailed: detail,
      prefetchedCharacterTags: [] } } };
  const model = C.model(C.editor(href), { ...C.caiEditor(page, id), url: href });
  const saved = {
    role: 'avatar', url: 'https://characterai.io/avatar.png', status: 'saved',
    path: 'assets/avatar.png', file: 'assets/avatar.png', sha256: 'd'.repeat(64),
    mime: 'image/png', image_id: 'img_synthetic', ref: 'header.key.iv.ciphertext.tag',
  };
  const built = await P.build({
    model, conversations: [], scope: { requested: 'creator_character', actual: 'creator_character' },
    assets: [saved], files: [{ path: saved.path, data: new Uint8Array([1]) }], started: '2026-11-19',
  });
  const character = JSON.parse(built.files.find(file => file.path === 'character/character.json').data);
  const assets = JSON.parse(built.files.find(file => file.path === 'assets/assets.json').data);
  assert.equal(character.assets, undefined);
  assert.deepEqual(assets, {
    schema: 'roleleaf_assets_v1',
    assets: [{
      image_id: 'img_synthetic', role: 'avatar', file: 'assets/avatar.png',
      sha256: 'd'.repeat(64), mime: 'image/png', ref: 'header.key.iv.ciphertext.tag',
    }],
  });
  assert.equal(built.manifest.assets, undefined);
  assert.doesNotMatch(JSON.stringify(character), /characterai\.io/);
  assert.equal(built.report.images.assets[0].url, undefined);
});

test('Tipsy packages use the original creator definition, contain no chats and preserve images independently', async () => {
  const avatar = 'https://img.tipsy.chat/avatar.png';
  const raw = { character: { character_id: tipsyId, nickname: '角色 🌙', is_public: false, background: 'public version',
    greeting: 'Authored opening', face_url: avatar, dialog_style: [{ role: 'assistant', message: 'Hello' }] },
    background: 'Original authored definition', origin_image_url: 'https://img.tipsy.chat/cover.png',
    world_books: [{ name: 'Book', world_book_key: 'key', entry_count: 2, email: 'must-not-export' }],
    role_characters: [{ character_id: tipsyId, name: 'Self' }, { character_id: '1000000000799', name: 'Linked' }] };
  const partial = C.snapshot('tipsy', tipsyId, { character: raw.character });
  assert.equal(partial.values.definition, undefined);
  assert.equal(partial.values.greeting.value, 'Authored opening');
  const model = C.model(C.target('tipsy', tipsyId, tipsyProfile), { ...C.snapshot('tipsy', tipsyId, raw), url: tipsyEditor });
  assert.equal(model.fields.visibility.value, false);
  assert.equal(model.fields.definition.value, raw.background);
  assert.match(model.card.data.mes_example, /\{\{char\}\}: Hello/);
  const scope = { requested: 'creator_character', actual: 'creator_character' };
  const built = await P.build({ model, conversations: [], scope, assets: [], files: [], started: '2026-11-13' });
  assert.equal(built.report.chats.status, 'not_requested');
  assert.equal(built.report.character.status, 'partial');
  assert.equal(built.manifest.scope.actual, 'creator_character');
  assert.equal(built.manifest.is_creator, true);
  assert.equal(built.manifest.bot_id, tipsyId);
  assert.equal(JSON.parse(built.files.find(file => file.path === 'character/character.json').data).id, tipsyId);
  const ordinary = await P.build({ model, conversations: [], scope: { actual: 'current_conversation' },
    assets: [], files: [], started: '2026-11-16' });
  assert.match(built.manifest.match_id, /^[a-f0-9]{64}$/);
  assert.equal(built.manifest.match_id, ordinary.manifest.match_id);
  assert.equal(ordinary.manifest.bot_id, undefined);
  assert.equal(built.manifest.character_id, undefined);
  for (const file of built.files.filter(file => !['manifest.json', 'character/character.json'].includes(file.path))) {
    assert.ok(!file.data.includes(tipsyId), file.path);
  }
  assert.deepEqual(model.fields.linked_characters.value,
    [{ name: 'Self' }, { character_id: '1000000000799', name: 'Linked' }]);
  assert.ok(!built.files.some(item => item.path.startsWith('conversations/')));
  assert.match(built.files.find(item => item.path === 'README.html').data, /Creator backup/);
  assert.doesNotMatch(built.files.find(item => item.path === 'provenance/source.json').data, /must-not-export|public version/);
  assert.deepEqual(model.assets.map(a => a.role), ['avatar', 'cover']);
  await assert.rejects(P.build({ model, conversations: [{}], scope, assets: [], files: [] }), /cannot contain conversations/);
});

test('ordinary packages keep chat history and its media and omit profile fields and files', async () => {
  const role = C.editor(tipsyEditor);
  const model = C.model(role, { ...C.snapshot('tipsy', tipsyId, {
    character: { character_id: tipsyId, nickname: 'Moon', greeting: 'Private greeting', face_url: 'https://img.tipsy.chat/avatar.png' },
    background: 'Private definition',
  }), url: tipsyEditor });
  const chat = { id: 'chat-1', scope: 'current_conversation',
    completeness: { complete_current_mainline: true, character_id: tipsyId }, source_pages: [{ count: 1 }],
    messages: [{ id: 'turn-1', role: 'character', timestamp: null, content_type: 'text', content: 'Original chat',
      candidates: [{ candidate_id: 'candidate-2', raw_content: 'Alternate reply', botId: tipsyId }],
      source: { character: { definition: 'Private definition' }, character_id: tipsyId, image_url: 'https://img.tipsy.chat/chat.png', extra: { state: 'final' } },
    }],
  };
  const assets = [
    { role: 'avatar', status: 'saved', path: 'assets/avatar.png', file: 'assets/avatar.png',
      image_id: 'img_avatar', sha256: 'a'.repeat(64), mime: 'image/png', ref: 'avatar.ref' },
    { role: 'message_image', status: 'saved', path: 'assets/chat.png', file: 'assets/chat.png',
      image_id: 'img_chat', sha256: 'b'.repeat(64), mime: 'image/png', ref: 'chat.ref',
      conversation_id: 'chat-1', message_id: 'turn-1' },
  ];
  const out = await P.build({ model, conversations: [chat], scope: { actual: 'current_conversation' },
    assets, files: assets.map(asset => ({ path: asset.path, data: new Uint8Array([1]) })),
    cardPNG: new Uint8Array([1]), started: '2026-11-16' });
  const files = Object.fromEntries(out.files.map(file => [file.path, file.data]));
  assert.deepEqual(JSON.parse(files['character/character.json']), { name: 'Moon' });
  assert.deepEqual(JSON.parse(files['assets/assets.json']), {
    schema: 'roleleaf_assets_v1',
    assets: [{
      image_id: 'img_chat', role: 'message_image', file: 'assets/chat.png',
      sha256: 'b'.repeat(64), mime: 'image/png', ref: 'chat.ref',
      conversation_id: 'chat-1', message_id: 'turn-1',
    }],
  });
  assert.ok(files['assets/chat.png']);
  assert.ok(!files['assets/avatar.png'] && !files['character/card.png'] && !files['provenance/source.json']);
  const exported = JSON.parse(files['conversations/1-chat-1/messages.json']);
  assert.deepEqual(exported.source_pages, chat.source_pages);
  assert.equal(exported.messages[0].content, 'Original chat');
  assert.equal(exported.messages[0].candidates[0].raw_content, 'Alternate reply');
  assert.equal(exported.messages[0].source.extra.state, 'final');
  assert.match(files['README.html'], /Original chat/);
  assert.doesNotMatch(JSON.stringify(files), /Private definition|Private greeting|1000000000123/);
});
