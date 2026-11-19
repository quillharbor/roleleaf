const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

globalThis.crypto ||= nodeCrypto.webcrypto;
globalThis.atob ||= value => Buffer.from(value, 'base64').toString('binary');

for (const file of ['core.js', 'png.js', 'bot-model.js', 'bot-creator.js', 'bot-package.js']) {
  require(path.join(root, 'tipsy-exporter', file));
}
require(path.join(root, 'tipsy-exporter', 'image-ref.js'));
require(path.join(root, 'tipsy-exporter', 'image-ref-config.js'));

const BotCreator = globalThis.BotCreator;
const BotModel = globalThis.BotModel;
const BotPackage = globalThis.BotPackage;
const ImageRef = globalThis.RoleLeafImageRef;

const png = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
  'base64',
));

async function reference(model, role, url, file, sha256) {
  return ImageRef.encrypt({
    platform: model.platform,
    botId: model.id,
    role,
    url,
    file,
    sha256,
    mime: 'image/png',
  });
}

async function main() {
  fs.mkdirSync(dist, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tipsy-exporter', 'manifest.json')));
  const sha256 = await BotPackage.sha(png);
  const file = `assets/${sha256}.png`;

  const id = 'character-Synthetic-Leaf-123';
  const href = `https://character.ai/character/${id}/edit`;
  const page = {
    page: '/character/[id]/edit',
    query: { id },
    props: { pageProps: {
      user: { user: { username: 'sample_owner' } },
      prefetchedCharacterDetailed: {
        external_id: id,
        user__username: 'sample_owner',
        name: 'Synthetic Leaf',
        description: 'Synthetic package for image reference integration testing.',
        greeting: 'Hello from the synthetic sample.',
        avatar_file_name: 'sample/avatar.png',
        background_image_url: 'https://characterai.io/sample/background.webp',
      },
      prefetchedCharacterTags: [],
    } },
  };
  const model = BotCreator.model(BotCreator.editor(href), {
    ...BotCreator.caiEditor(page, id),
    url: href,
  });
  const assets = [];
  for (const asset of model.assets) {
    assets.push({
      role: asset.role,
      url: asset.url,
      status: 'saved',
      path: file,
      sha256,
      ...await reference(model, asset.role, asset.url, file, sha256),
    });
  }
  const creatorOutput = await BotPackage.build({
    model,
    conversations: [],
    scope: { requested: 'creator_character', actual: 'creator_character' },
    assets,
    files: [{ path: file, data: png }],
    started: new Date().toISOString(),
  });
  const creatorIndex = JSON.parse(creatorOutput.files.find(item => item.path === 'assets/assets.json').data);
  if (creatorIndex.schema !== 'roleleaf_assets_v1' ||
      creatorIndex.assets.map(asset => asset.role).join(',') !== 'avatar,cover,background') {
    throw Error('Sample asset index does not match the expected creator roles.');
  }
  if (creatorIndex.assets.some(asset => !asset.image_id || !asset.sha256 || !asset.ref ||
      asset.file !== file || asset.mime !== 'image/png')) {
    throw Error('Sample asset index is incomplete.');
  }

  const chatRoute = BotModel.route(`https://character.ai/chat/${id}`);
  const chatModel = BotModel.normalize(chatRoute, {
    character: {
      external_id: id,
      name: model.name,
      description: 'Synthetic non-creator package.',
      greeting: 'Hello from the chat sample.',
    },
  });
  const chatURL = 'https://characterai.io/sample/chat-image.png';
  const chatReference = await reference(chatModel, 'message_image', chatURL, file, sha256);
  chatModel.assets = [{
    role: 'message_image', url: chatURL, conversation_id: 'synthetic-chat-1', message_id: 'synthetic-turn-1',
  }];
  const chatInput = {
    model: chatModel,
    conversations: [{
      id: 'synthetic-chat-1',
      scope: 'current_conversation',
      completeness: { complete_current_mainline: true, records: 1 },
      source_pages: [],
      messages: [{
        id: 'synthetic-turn-1',
        role: 'assistant',
        timestamp: null,
        content_type: 'text',
        content: 'Synthetic chat message.',
        candidates: [],
        source: {},
      }],
    }],
    scope: { actual: 'current_conversation', conversation_list_complete: false },
    started: new Date().toISOString(),
  };
  const chatOutput = await BotPackage.build({
    ...chatInput,
    assets: [{ ...chatModel.assets[0], status: 'saved', path: file, sha256, ...chatReference }],
    files: [{ path: file, data: png }],
  });
  const missingImageOutput = await BotPackage.build({
    ...chatInput,
    assets: [{ ...chatModel.assets[0], status: 'failed', path: null, error: 'Image HTTP 404' }],
    files: [],
  });
  const chatIndex = JSON.parse(chatOutput.files.find(item => item.path === 'assets/assets.json').data);
  if (chatIndex.schema !== 'roleleaf_assets_v1' ||
      chatIndex.assets.length !== 1 ||
      chatIndex.assets[0].role !== 'message_image' ||
      chatIndex.assets[0].conversation_id !== 'synthetic-chat-1' ||
      chatIndex.assets[0].message_id !== 'synthetic-turn-1') {
    throw Error('Chat asset index does not include its conversation coordinates.');
  }
  if (creatorOutput.manifest.match_id !== chatOutput.manifest.match_id) {
    throw Error('The creator and chat samples must belong to the same character.');
  }

  const creatorTarget = path.join(dist, `RoleLeaf-${manifest.version}-image-ref-creator-sample.zip`);
  const chatTarget = path.join(dist, `RoleLeaf-${manifest.version}-image-ref-chat-sample.zip`);
  const missingImageTarget = path.join(dist, `RoleLeaf-${manifest.version}-image-ref-missing-image-sample.zip`);
  fs.writeFileSync(creatorTarget, creatorOutput.bytes);
  fs.writeFileSync(chatTarget, chatOutput.bytes);
  fs.writeFileSync(missingImageTarget, missingImageOutput.bytes);
  fs.writeFileSync(path.join(dist, 'sample-assets-creator.json'), JSON.stringify(creatorIndex, null, 2) + '\n');
  fs.writeFileSync(path.join(dist, 'sample-assets-chat.json'), JSON.stringify(chatIndex, null, 2) + '\n');
  console.log(creatorTarget);
  console.log(chatTarget);
  console.log(missingImageTarget);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
