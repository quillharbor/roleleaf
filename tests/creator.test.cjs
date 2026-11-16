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

test('Character.AI editor rejects nonowners and retains saved private settings only', () => {
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
});

test('Tipsy packages use the original creator definition, contain no chats and preserve images independently', async () => {
  const avatar = 'https://img.tipsy.chat/avatar.png';
  const raw = { character: { character_id: tipsyId, nickname: '角色 🌙', is_public: false, background: 'public version',
    greeting: 'Authored opening', face_url: avatar, dialog_style: [{ role: 'assistant', message: 'Hello' }] },
    background: 'Original authored definition', origin_image_url: 'https://img.tipsy.chat/cover.png',
    world_books: [{ name: 'Book', world_book_key: 'key', entry_count: 2, email: 'must-not-export' }] };
  assert.equal(C.snapshot('tipsy', tipsyId, { character: raw.character }), null);
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
  assert.match(built.manifest.character_id.ciphertext, /^[a-f0-9]{512}$/);
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
    { role: 'avatar', status: 'saved', path: 'assets/avatar.png' },
    { role: 'message_image', status: 'saved', path: 'assets/chat.png' },
  ];
  const out = await P.build({ model, conversations: [chat], scope: { actual: 'current_conversation' },
    assets, files: assets.map(asset => ({ path: asset.path, data: new Uint8Array([1]) })),
    cardPNG: new Uint8Array([1]), started: '2026-11-16' });
  const files = Object.fromEntries(out.files.map(file => [file.path, file.data]));
  assert.deepEqual(JSON.parse(files['character/character.json']), { name: 'Moon' });
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
