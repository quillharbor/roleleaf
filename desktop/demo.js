/* global BotModel */
'use strict';

const sites = {
  tipsy: {
    name: 'Tipsy', origin: 'https://tipsy.chat', imageOrigin: 'https://img.tipsy.chat',
    bots: [
      { id: '100000001', name: 'Luna · Moonlight Archivist', letter: 'L', color: 'violet', bio: 'Look for a missing letter in the midnight library.' },
      { id: '100000002', name: 'Sol · Coastal Guide', letter: 'S', color: 'amber', bio: 'Follow the tracks left by the tide to the lighthouse.' },
      { id: '100000003', name: 'Nova · Star Chart Maker', letter: 'N', color: 'mint', bio: 'Use an old star chart to trace an unexpected route.' },
    ],
  },
  character_ai: {
    name: 'Character.AI', origin: 'https://character.ai', imageOrigin: 'https://characterai.io',
    bots: [
      { id: 'Demo_Mira-001', name: 'Mira · Mountain Courier', letter: 'M', color: 'mint', bio: 'Deliver a postcard to a stranger in the valley.' },
      { id: 'Demo_Atlas-002', name: 'Atlas · Map Restorer', letter: 'A', color: 'violet', bio: 'Restore a lost trail on an old map.' },
      { id: 'Demo_Echo-003', name: 'Echo · Late Night Radio', letter: 'E', color: 'amber', bio: 'Take the first call from a listener after midnight.' },
    ],
  },
};
const colors = { violet: '#6251a9', amber: '#a76840', mint: '#338173' };
const startTime = Date.UTC(2026, 10, 10, 0);

for (const [platform, site] of Object.entries(sites)) {
  for (const bot of site.bots) {
    bot.route = BotModel.route(`${site.origin}/chat/${bot.id}`);
    bot.avatar = `${site.imageOrigin}/desktop-demo/${bot.id}.png`;
    bot.messages = [
      { role: 'character', content: `Welcome. ${bot.bio} Want to come along?` },
      { role: 'user', content: 'Sure. Where do we start?' },
      { role: 'character', content: platform === 'tipsy' ? 'We start here. Let me grab my notebook and we can talk on the way.' : 'Look out the window. The first clue is right there.' },
      { role: 'user', content: 'All right, ready to go.' },
    ].map((message, index) => ({ ...message, id: String(index + 1), content_type: 'text', timestamp: startTime + index * 60000, candidates: [], source: {} }));
  }
}

function demoTab(bot) {
  const { platform, id } = bot.route;
  const conversationId = `demo-${id}`;
  const completeness = { records: bot.messages.length, complete_current_mainline: true };
  const entry = platform === 'tipsy' ? {
    capturedAt: new Date().toISOString(),
    source: { character: { character_id: id, nickname: bot.name, introduction: bot.bio,
      greeting: bot.messages[0].content, background: 'A fictional character created for the RoleLeaf demo.',
      face_url: bot.avatar, tags: ['Adventure'] } },
  } : {
    capturedAt: new Date().toISOString(),
    character: { external_id: id, name: bot.name, description: bot.bio,
      greeting: bot.messages[0].content, has_definition: true, avatar_url: bot.avatar },
  };

  return {
    get: async () => ({ url: bot.route.url }),
    sendMessage: async (_tabId, message) => {
      if (message.characterId && message.characterId !== id) return { ok: false };
      const status = { character_id: id, conversation_id: conversationId,
        latest_page_captured: true, running: false, records: bot.messages.length };
      if (platform === 'character_ai') {
        return { ok: true, status, entry,
          conversations: [{ id: conversationId, completeness, messages: bot.messages }],
          scope: { actual: 'current_conversation', conversation_list_complete: false, archived_checked: false },
        };
      }
      return { ok: true, status, entry,
        data: { source: { character_id: id, conversation_id: conversationId }, completeness,
          records: bot.messages.map(({ id, role, content, content_type, timestamp }) => ({
            sequence: id, sender_type: role, content, content_type, timestamp,
          })), pages: [{ count: bot.messages.length }] },
      };
    },
  };
}

// The demo only serves bundled synthetic avatars through the existing image pipeline.
globalThis.fetch = async (url, { signal } = {}) => {
  const bot = Object.values(sites).flatMap(site => site.bots).find(item => item.avatar === url);
  if (!bot) throw Error('The demo only includes bundled images.');
  signal?.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const context = canvas.getContext('2d');
  context.fillStyle = colors[bot.color];
  context.fillRect(0, 0, 192, 192);
  context.fillStyle = '#fff';
  context.font = 'bold 100px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(bot.letter, 96, 100);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Could not create the demo avatar.');
  signal?.throwIfAborted();
  return new Response(blob, { status: 200 });
};
