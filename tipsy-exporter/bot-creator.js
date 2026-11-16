(function (root) {
  'use strict';
  const origins = { tipsy: 'https://tipsy.chat', character_ai: 'https://character.ai' };
  const tipPath = '(?:/[a-z]{2}(?:-[a-z]{2})?)?';
  const idOK = (platform, id) => typeof id === 'string' &&
    (platform === 'tipsy' ? /^\d{6,30}$/ : /^[\w-]{6,100}$/).test(id);
  const parse = value => {
    try { const u = new URL(value); return !u.username && !u.password ? u : null; }
    catch { return null; }
  };
  const platformOf = value => Object.keys(origins).find(key => origins[key] === parse(value)?.origin);
  function profile(value) {
    const u = parse(value), platform = platformOf(value);
    if (platform === 'tipsy' && new RegExp('^'+tipPath+'/profile/\\d{6,30}/?$','i').test(u.pathname) ||
        platform === 'character_ai' && /^\/profile(?:\/[\w.-]{1,100})?\/?$/.test(u.pathname)) {
      return { platform, url: u.origin + u.pathname.replace(/\/$/, '') };
    }
    return null;
  }
  function editor(value) {
    const u = parse(value), platform = platformOf(value);
    let id;
    if (platform === 'tipsy' && new RegExp('^'+tipPath+'/update/?$','i').test(u.pathname)) id = u.searchParams.get('character_id');
    if (platform === 'character_ai') id = u.pathname.match(/^\/character\/([\w-]+)\/edit\/?$/)?.[1];
    return platform && idOK(platform, id) ? { platform, id, url: u.origin + u.pathname +
      (platform === 'tipsy' ? '?character_id=' + id : '') } : null;
  }
  function target(platform, id, value) {
    if (!idOK(platform, id)) return null;
    const r = platform === 'tipsy' ? profile(value) : editor(value);
    if (!r || r.platform !== platform || platform !== 'tipsy' && r.id !== id) return null;
    return { ...r, id };
  }
  function media(value) {
    const u = parse(value);
    return u?.protocol === 'https:' && ['img.tipsy.chat', 'characterai.io'].includes(u.hostname) && !u.port ? u.href : null;
  }
  function caiAvatar(c) {
    if (media(c.avatar_url)) return c.avatar_url;
    return typeof c.avatar_file_name === 'string' && /^[\w./%-]{1,400}$/.test(c.avatar_file_name) &&
      !c.avatar_file_name.split('/').some(x => !x || x === '..' || x === '.' || /%2e|%2f|%5c/i.test(x))
      ? 'https://characterai.io/' + c.avatar_file_name : null;
  }
  const fieldsBySite = {
    tipsy: {
      name: ['nickname'], tagline: ['introduction', 'tagline'], description: ['description', 'introduction'],
      definition: ['background'], greeting: ['greeting'], scenario: ['scenario'], tags: ['tags', 'tag_ids'],
      visibility: ['is_public'], example_dialogue: ['dialog_style', 'example_dialogue', 'example_dialogues'],
      author_note: ['author_note'], reply_requirements: ['reply_requirement'], gender: ['gender'],
      rich_content: ['rich_content'], custom_prompt: ['custom_prompt'], voice: ['voice_param'],
      conversation_style: ['conversation_style'], card_tagline: ['card_tagline'], world_books: ['world_books'], linked_characters: ['role_characters'],
      plot_file: ['plot_file'], show_background: ['show_background'], content_type: ['content_type'],
    },
    character_ai: {
      name: ['name'], tagline: ['title'], description: ['description'], definition: ['definition'], greeting: ['greeting'],
      alternate_greetings: ['additional_greetings'], tags: ['tags', 'categories'], visibility: ['visibility'],
      dynamic_greeting: ['dynamic_greeting_enabled'], definition_visibility: ['copyable'],
      voice: ['default_voice_id', 'voice_id'], lorebook: ['lorebook_id', 'lorebook_unavailable'],
      image_generation: ['img_gen_enabled'], image_prompt: ['base_img_prompt'],
      strip_image_prompt: ['strip_img_prompt_from_msg'], allow_dynamic_greeting: ['allow_dynamic_greeting'],
      conversation_settings: ['conversation_state_definition'],
    },
  };
  // Copy only documented character fields, and cap site-controlled data before crossing the bridge.
  const nestedKeys = new Set('id name title content text label role message voice_id speed reply_requirement lorebook_id display_name tag_id tag_name key world_book_key entry_count character_id nickname image_url plot_file_key content_prefix tagline greeting_rich_text optimization_code output_format_config type keywords entries enabled description rules initial_value variables operator value condition conditions actions'.split(' '));
  function fieldValue(value, depth = 0, budget = { left: 1500000 }, characterId) {
    if (depth > 10 || --budget.left < 0) return null;
    if (typeof value === 'string') {
      budget.left -= value.length;
      return budget.left >= 0 ? value : null;
    }
    if (value == null || typeof value === 'boolean' || Number.isFinite(value)) return value ?? null;
    if (Array.isArray(value)) return value.slice(0, 500).map(x => fieldValue(x, depth + 1, budget, characterId));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key, val]) => nestedKeys.has(key) &&
        !(characterId && (key === 'id' || key === 'character_id') &&
          (val === characterId || typeof val === 'number' && String(val) === characterId)))
      .map(([key, val]) => [key, fieldValue(val, depth + 1, budget, characterId)]));
    return null;
  }
  function snapshot(platform, id, raw, tags, rich) {
    if (!idOK(platform, id) || !raw || typeof raw !== 'object') return null;
    const tipsy = platform === 'tipsy', c = tipsy ? raw.character : raw;
    if (!c || (tipsy ? c.character_id : c.external_id) !== id || tipsy && typeof raw.background !== 'string') return null;
    const name = tipsy ? c.nickname : c.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 500) return null;
    const source = tipsy ? { ...c, ...raw, ...(rich ? { rich_content: rich } : {}) }
      : { ...c, ...(Array.isArray(tags) ? { tags } : {}) };
    const values = {}, assets = [], budget = { left: 1500000 };
    for (const [field, keys] of Object.entries(fieldsBySite[platform])) {
      const key = keys.find(key => Object.hasOwn(source, key) && source[key] !== undefined);
      if (key) values[field] = { key, value: fieldValue(source[key], 0, budget) };
    }
    const add = (role, value) => {
      const url = media(value);
      if (url && assets.length < 100 && !assets.some(x => x.role === role && x.url === url)) assets.push({ role, url });
    };
    if (tipsy) {
      add('avatar', c.face_url); add('cover', raw.origin_image_url || c.origin_image_url || c.image_url);
      add('background', raw.origin_pc_image_url || c.origin_pc_image_url || c.pc_image_url);
      add('reference', c.reference_image_url);
      for (const image of [...(Array.isArray(raw.images) ? raw.images.slice(0, 100) : []), ...(Array.isArray(c.images) ? c.images.slice(0, 100) : [])]) {
        add('gallery', image?.origin_image_url || image?.image_url);
      }
    } else {
      add('avatar', caiAvatar(c)); add('background', c.background_image_url);
    }
    return { id, name, values, assets, clipped: budget.left < 0 };
  }
  function caiEditor(data, id) {
    const props = data?.props?.pageProps;
    const c = props?.prefetchedCharacterDetailed;
    const owner = props?.user?.user?.username;
    if (data?.page !== '/character/[id]/edit' || !idOK('character_ai', id) || data.query?.id !== id) return null;
    if (typeof owner !== 'string' || !owner || owner !== c?.user__username) return null;
    return snapshot('character_ai', id, c, props.prefetchedCharacterTags);
  }
  function model(route, data) {
    if (!idOK(route?.platform, route?.id) || !editor(data?.url) || editor(data.url).platform !== route.platform ||
        editor(data.url).id !== route.id || data.id !== route.id || typeof data.name !== 'string' || !data.name.trim()) {
      throw Error('The source editor does not match this character.');
    }
    const fields = {};
    const warnings = ['Only saved settings available in the source editor response are included.'];
    if (data.clipped) warnings.push('Some fields exceeded the export size limit.');
    for (const [field, keys] of Object.entries(fieldsBySite[route.platform])) {
      const item = data.values?.[field], key = keys.includes(item?.key) ? item.key : null;
      const value = key ? fieldValue(item.value, 0, undefined, route.id) : null;
      const empty = value === '' || Array.isArray(value) && !value.length;
      const status = value == null ? 'missing' : empty ? 'empty' :
        ['world_books','linked_characters','plot_file','lorebook'].includes(field) ? 'metadata_only' : 'available';
      fields[field] = { value, status, source: key ? 'editor.' + key : 'editor' };
    }
    const assets = (Array.isArray(data.assets) ? data.assets.slice(0, 100) : []).filter(x =>
      ['avatar','cover','background','reference','gallery'].includes(x?.role) && media(x.url))
      .map(({role,url}) => ({role,url}));
    const value = key => fields[key]?.value;
    const tags = Array.isArray(value('tags')) ? value('tags').map(x =>
      typeof x === 'string' ? x : x?.display_name || x?.name || x?.tag_name).filter(x => typeof x === 'string') : [];
    const string = key => typeof value(key) === 'string' ? value(key) : '';
    const capturedAt = new Date().toISOString();
    const examples = route.platform === 'tipsy' && Array.isArray(value('example_dialogue'))
      ? root.TipsyExporterCore.examples(value('example_dialogue')).value : string('example_dialogue');
    const source = { kind: 'creator_editor',
      values: Object.fromEntries(Object.entries(fields).filter(([,f]) => f.status !== 'missing').map(([k,f]) => [k,f.value])) };
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: {
      name: data.name, description: string('description'), personality: string('definition'), scenario: string('scenario'),
      first_mes: string('greeting'), mes_example: examples, creator_notes: string('author_note'),
      system_prompt: '', post_history_instructions: '', creator: '', character_version: '',
      alternate_greetings: Array.isArray(value('alternate_greetings')) ? value('alternate_greetings').filter(x => typeof x === 'string') : [],
      tags, extensions: { [route.platform]: source },
    } };
    return { schema: 'bot_character_v1', platform: route.platform, id: route.id, name: data.name,
      captured_at: capturedAt, fields, assets, source, card, warnings };
  }
  root.BotCreator = Object.freeze({ origins, platformOf, profile, editor, target, idOK, media, caiAvatar, snapshot, caiEditor, model });
})(globalThis);
