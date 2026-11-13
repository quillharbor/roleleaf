(function (root) {
  'use strict';
  const VERSION = '0.5.4';
  const CHANNEL = 'tipsy-character-exporter-v1';
  const MAX_BYTES = 16 * 1024 * 1024;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' ? v : '';
  const charFields = [
    'character_id', 'creator_id', 'nickname', 'gender', 'introduction', 'greeting',
    'background', 'public_background', 'show_background', 'scenario', 'dialog_style',
    'author_note', 'image_url', 'face_url', 'pc_image_url', 'animated_image_url',
    'video_url', 'tags', 'tag_ids', 'is_translated', 'lang', 'content_type',
    'character_type', 'is_public', 'nsfw', 'created_at', 'updated_at',
    'world_books', 'world_book_keys', 'plot_file', 'custom_prompt',
    'voice_param', 'voice_supported', 'conversation_style'
  ];

  // The page bridge only accepts character data. It never reads request headers,
  // cookies, browser storage or the current user's profile. Chat capture is
  // handled separately and is never embedded in character cards.
  function clean(value, depth = 0) {
    if (depth > 20) throw new Error('Data is nested too deeply');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(v => clean(v, depth + 1));
    if (!object(value)) return null;
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (/^(?:__proto__|constructor|prototype|authorization|cookie|cookies|set-cookie|token|access_token|refresh_token|password|email|headers|request)$/i.test(key)) continue;
      out[key] = clean(v, depth + 1);
    }
    return out;
  }

  function project(raw) {
    if (!object(raw) || !object(raw.character)) throw new Error('Character response is missing the character field');
    const id = raw.character.character_id;
    if (typeof id !== 'string' || !/^\d{6,30}$/.test(id)) throw new Error('Invalid character ID');
    if (typeof raw.character.nickname !== 'string') throw new Error('Invalid character name');
    const character = {};
    for (const key of charFields) if (has(raw.character, key)) character[key] = clean(raw.character[key]);
    const result = { character };
    if (object(raw.creator) && typeof raw.creator.nickname === 'string') result.creator = { nickname: raw.creator.nickname };
    for (const key of ['rich_content', 'world_books', 'plot_file', 'custom_prompt']) {
      if (has(raw, key)) result[key] = clean(raw[key]);
    }
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) throw new Error('Character data exceeds the 16 MB limit');
    return result;
  }

  function publicEndpoint(url) {
    try {
      const u = new URL(url, 'https://tipsy.chat');
      return u.origin === 'https://api.tipsy.chat' && u.pathname === '/api/v1/character/get/public';
    } catch { return false; }
  }

  function roleId(url) {
    try {
      const u = new URL(url);
      if (u.origin !== 'https://tipsy.chat') return null;
      return u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?chat\/(\d{6,30})(?:\/|$)/i)?.[1] || null;
    } catch { return null; }
  }

  function record(raw, capturedAt = new Date().toISOString()) {
    return { source: project(raw), capturedAt, endpoint: 'https://api.tipsy.chat/api/v1/character/get/public' };
  }

  function stringState(obj, key) {
    if (!has(obj, key) || obj[key] === null) return { state: 'missing', chars: 0 };
    if (typeof obj[key] !== 'string') return { state: 'unsupported', chars: 0 };
    return { state: obj[key].trim() ? 'present' : 'empty', chars: [...obj[key]].length };
  }

  function examples(rows) {
    const parts = [], warnings = [];
    let turnBlock = [];
    const flush = () => {
      if (turnBlock.length) parts.push('<START>\n' + turnBlock.join('\n'));
      turnBlock = [];
    };
    if (!Array.isArray(rows)) return { value: '', warnings: rows == null ? [] : ['Unrecognized example format. The source data retains the original.'] };
    for (const row of rows) {
      if (!object(row) || typeof row.message !== 'string') {
        warnings.push('Some examples could not be converted. See the source data.');
        continue;
      }
      if (!row.message.trim()) continue;
      if (row.role === 'user' || row.role === 'assistant') {
        turnBlock.push(`${row.role === 'user' ? '{{user}}' : '{{char}}'}: ${row.message}`);
      } else {
        flush();
        // "all" can contain a full dialogue or several characters. Never
        // relabel the whole block as an assistant turn or drop the original.
        parts.push(/^\s*<START>/i.test(row.message) ? row.message : '<START>\n' + row.message);
        warnings.push(row.role === 'all'
          ? 'The role=all example was copied to mes_example. Check speaker detection in the target tool.'
          : 'Examples with unknown speakers were copied as provided. Check their format in the target tool.');
      }
    }
    flush();
    return { value: parts.join('\n\n'), warnings: [...new Set(warnings)] };
  }

  function worldBooks(source) {
    const raw = has(source, 'world_books') ? source.world_books : source.character.world_books;
    if (raw === undefined || raw === null) return { state: 'missing', books: [], reportedEntries: 0, receivedEntries: 0 };
    if (!Array.isArray(raw)) return { state: 'unsupported', books: [], reportedEntries: 0, receivedEntries: 0 };
    const books = raw.map((b, i) => {
      const entries = Array.isArray(b?.entries) ? b.entries : object(b?.entries) ? Object.values(b.entries) : [];
      return {
        name: text(b?.name) || `Lorebook ${i + 1}`,
        enabled: typeof b?.enabled === 'boolean' ? b.enabled : null,
        reportedEntries: Number.isSafeInteger(b?.entry_count) && b.entry_count >= 0 ? b.entry_count : null,
        receivedEntries: entries.filter(e => typeof e?.content === 'string' && e.content.trim()).length,
        keyPresent: typeof b?.world_book_key === 'string' && Boolean(b.world_book_key.trim())
      };
    });
    const receivedEntries = books.reduce((n, b) => n + b.receivedEntries, 0);
    return {
      state: !books.length ? 'empty' : receivedEntries ? 'body_unmapped' : 'metadata_only',
      books, reportedEntries: books.reduce((n, b) => n + (b.reportedEntries || 0), 0), receivedEntries
    };
  }

  function background(source) {
    const c = source.character;
    for (const key of ['public_background', 'background']) {
      if (stringState(c, key).state === 'present') return { ...stringState(c, key), field: key, value: c[key] };
    }
    const key = has(c, 'public_background') ? 'public_background' : 'background';
    return { ...stringState(c, key), field: key, value: '' };
  }

  function report(entry) {
    const source = project(entry.source), c = source.character;
    const bg = background(source), wb = worldBooks(source), ex = examples(c.dialog_style);
    const fields = {
      description: { ...stringState(c, 'introduction'), source: 'character.introduction' },
      first_mes: { ...stringState(c, 'greeting'), source: 'character.greeting' },
      personality: { state: bg.state, chars: bg.chars, source: `character.${bg.field}` },
      scenario: { ...stringState(c, 'scenario'), source: 'character.scenario' },
      mes_example: { state: ex.value ? 'present' : has(c, 'dialog_style') ? (Array.isArray(c.dialog_style) ? 'empty' : 'unsupported') : 'missing', chars: [...ex.value].length, source: 'character.dialog_style' },
      character_book: { state: wb.state, source: 'world_books', mapped: false }
    };
    const warnings = [...ex.warnings];
    if (bg.state !== 'present') warnings.push('The standalone background is missing, so the character definition could not be verified.');
    if (wb.state === 'metadata_only') warnings.push(`Lorebook metadata only: ${wb.books.length} books and ${wb.reportedEntries} reported entries. Entry text and triggers are missing.`);
    else if (wb.state === 'body_unmapped') warnings.push('Lorebook text is in the source data. Its mapping to character_book is unverified.');
    else if (wb.state === 'missing') warnings.push('The source response omitted the lorebook field. The character may still have a lorebook.');
    else if (wb.state === 'unsupported') warnings.push('Unrecognized lorebook structure. The source data retains the original.');
    if (c.is_translated === true) warnings.push('The source marks this content as translated. The original language version is unverified.');
    if (source.rich_content) warnings.push('The extension data retains the original rich text. Formatting may vary in the target tool.');
    if (source.custom_prompt || c.custom_prompt) warnings.push('Custom instructions are preserved in their original structure.');
    if (source.plot_file || c.plot_file) warnings.push('Story attachment fields are preserved. Metadata and previews may omit the full text.');
    return {
      format: 'tipsy_export_report_v1', exporter_version: VERSION,
      character_id: c.character_id, name: c.nickname,
      source_url: `https://tipsy.chat/chat/${c.character_id}`,
      captured_at: entry.capturedAt, exported_at: new Date().toISOString(),
      completeness: 'not_verified', fields, world_books: wb,
      is_translated: c.is_translated ?? null,
      unmapped_fields: ['system_prompt', 'post_history_instructions', 'character_book'],
      warnings
    };
  }

  function card(entry) {
    const source = project(entry.source), c = source.character, audit = report({ ...entry, source });
    const tags = tagNames(c.tags);
    const note = '[Tipsy export] This card contains the available data. The full character definition is unverified.' + (audit.warnings.length ? '\n' + audit.warnings.join('\n') : '');
    return {
      spec: 'chara_card_v2', spec_version: '2.0',
      data: {
        name: c.nickname, description: text(c.introduction), personality: background(source).value,
        scenario: text(c.scenario), first_mes: text(c.greeting), mes_example: examples(c.dialog_style).value,
        creator_notes: [text(c.author_note), note].filter(Boolean).join('\n\n'),
        system_prompt: '', post_history_instructions: '', alternate_greetings: [],
        tags: [...new Set(tags)], creator: text(source.creator?.nickname), character_version: '',
        extensions: { tipsy: { exporter_version: VERSION, source_url: audit.source_url, captured_at: entry.capturedAt, source, report: audit } }
      }
    };
  }

  function tagNames(rows) {
    if (!Array.isArray(rows)) return [];
    return [...new Set(rows.map(t => typeof t === 'string' ? t :
      [t?.name, t?.tag_name, t?.desc, t?.alias].find(v => typeof v === 'string' && v.trim()) || '')
      .map(t => t.trim()).filter(Boolean))];
  }

  function filename(name, id, suffix) {
    const safe = text(name).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0,75) || 'Tipsy character';
    return `${safe}-${id}.${suffix}`;
  }

  root.TipsyExporterCore = Object.freeze({ VERSION, CHANNEL, MAX_BYTES, project, publicEndpoint, roleId, record, report, card, examples, worldBooks, background, filename, tagNames });
})(globalThis);
