(function (root) {
  'use strict';
  const MAX_BYTES = 32 * 1024 * 1024, MAX_RECORDS = 10000;
  const seq = s => typeof s === 'string' && /^\d{1,30}$/.test(s);
  function endpoint(url) {
    try { const u = new URL(url); return u.origin === 'https://api.tipsy.chat' ? u.pathname : ''; }
    catch { return ''; }
  }
  function request(body) {
    const b = typeof body === 'string' ? JSON.parse(body) : body;
    if (!b || typeof b.character_id !== 'string' || !/^\d{6,30}$/.test(b.character_id)) throw Error('Invalid character ID');
    const out = { character_id: b.character_id };
    for (const k of ['sequence', 'language_code', 'chat_mode', 'conversation_id']) {
      if (typeof b[k] === 'string' && b[k].length <= 100) out[k] = b[k];
    }
    if (Number.isSafeInteger(b.size)) out.size = b.size;
    return out;
  }
  function clean(v, depth = 0) {
    if (depth > 25) throw Error('Chat data is nested too deeply');
    if (v === null || ['string', 'boolean', 'number'].includes(typeof v)) return v;
    if (Array.isArray(v)) return v.map(x => clean(x, depth + 1));
    if (!v || typeof v !== 'object') return null;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^(?:__proto__|constructor|prototype|authorization|cookie|cookies|set-cookie|token|access_token|refresh_token|password|headers|request)$/i.test(k)) continue;
      out[k] = clean(x, depth + 1);
    }
    return out;
  }
  class History {
    constructor(characterId) {
      this.id = characterId; this.records = new Map(); this.pages = []; this.latest = false;
      this.ended = false; this.endReason = null; this.conversationId = null;
      this.context = null; this.error = ''; this.bytes = 0; this.revision = 0;
    }
    bind(id) {
      if (typeof id !== 'string' || !id || id.length > 100) return false;
      if (this.conversationId && this.conversationId !== id) return true;
      this.conversationId = id; return false;
    }
    accept(q, payload) {
      if (q.character_id !== this.id || !seq(q.sequence)) throw Error('Invalid chat history request scope');
      if (payload?.code !== 0 || !Array.isArray(payload.data)) throw Error('The chat history response was invalid. Sign in and try again.');
      if (q.conversation_id && this.conversationId && q.conversation_id !== this.conversationId) throw Error('The chat changed. Refresh the page and export again.');
      const context = JSON.stringify([q.language_code || '', q.chat_mode || '']);
      if (this.context && this.context !== context) throw Error('The chat or its language changed. Refresh the page and export again.');
      const rows = payload.data.map(m => {
        if (!m || !seq(m.sequence) || typeof m.sender_type !== 'string' || typeof m.content_type !== 'string' || typeof m.content !== 'string') throw Error('The response contains an unsupported message structure');
        return clean(m);
      });
      if (q.sequence !== '0' && rows.some(m => BigInt(m.sequence) > BigInt(q.sequence))) throw Error('The history cursor did not advance');
      if (new Set(rows.map(m => m.sequence)).size !== rows.length) throw Error('The page contains duplicate message sequence numbers. Export again.');
      const next = new Map(this.records);
      for (const m of rows) {
        const old = next.get(m.sequence);
        if (old && JSON.stringify(old) !== JSON.stringify(m)) throw Error('Messages changed during export. Refresh the page and export again.');
        next.set(m.sequence, m);
      }
      const bytes = new TextEncoder().encode(JSON.stringify([...next.values()])).length;
      if (next.size > MAX_RECORDS || bytes > MAX_BYTES) throw Error('Export reached the 10,000 message or 32 MB limit. You can save the available messages.');
      const previousMin = this.sorted()[0]?.sequence;
      this.records = next; this.bytes = bytes; this.context = context;
      if (q.sequence === '0') this.latest = true;
      if (q.conversation_id) this.conversationId = q.conversation_id;
      const min = this.sorted()[0]?.sequence;
      if (this.latest && (min === '1' || min === '0')) { this.ended = true; this.endReason = 'first_sequence_reached'; }
      if (!rows.length && (q.sequence === '0' || (previousMin && BigInt(q.sequence) === BigInt(previousMin) - 1n))) {
        this.ended = true; this.endReason = q.sequence === '0' ? 'empty_current_history' : 'empty_older_page';
      }
      const sequences = rows.map(m => BigInt(m.sequence)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      this.pages.push({ cursor: q.sequence, count: rows.length, captured_at: new Date().toISOString(),
        first_sequence: sequences[0]?.toString(),
        requested_through: q.sequence === '0' ? sequences.at(-1)?.toString() : q.sequence });
      if (this.pages.length > 1000) this.pages.shift();
      this.revision++; this.error = '';
    }
    sorted() { return [...this.records.values()].sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1); }
    summary() {
      const rows = this.sorted(), gaps = [];
      for (let i = 1; i < rows.length; i++) if (BigInt(rows[i].sequence) - BigInt(rows[i - 1].sequence) > 1n) gaps.push([rows[i - 1].sequence, rows[i].sequence]);
      const reachedStart = this.latest && this.ended && !this.error;
      // Require a captured response spanning every missing range. Reaching the
      // first sequence alone cannot rule out a missed page between two cursors.
      const gapsFromSource = reachedStart && gaps.length > 0 && gaps.every(([before, after]) =>
        this.pages.some(page => page.first_sequence !== undefined &&
          BigInt(page.first_sequence) <= BigInt(before) &&
          BigInt(page.requested_through) >= BigInt(after) - 1n));
      return { character_id: this.id, conversation_id: this.conversationId, latest_page_captured: this.latest,
        server_start_reached: this.ended, end_reason: this.endReason,
        records: rows.length, text_messages: rows.filter(m => m.content_type === 'text').length,
        events: rows.filter(m => m.content_type !== 'text').length,
        min_sequence: rows[0]?.sequence || null, max_sequence: rows.at(-1)?.sequence || null,
        sequence_gaps: gaps, gaps_from_source: gapsFromSource, pages: this.pages.length, bytes: this.bytes, error: this.error,
        complete_current_mainline: reachedStart && gaps.length === 0,
        all_regeneration_variants_verified: false };
    }
    export(name = '') {
      return { format: 'tipsy_chat_export_v1', exported_at: new Date().toISOString(),
        source: { character_id: this.id, character_name: name, url: `https://tipsy.chat/chat/${this.id}`,
          conversation_id: this.conversationId, request_context: this.context ? JSON.parse(this.context) : null },
        completeness: this.summary(),
        limitations: ['Covers the current chat thread as it existed during export.', 'Coverage of regenerated, edited, deleted, or reverted messages is unverified.',
          'Other saved chats are outside this export. Media references are included as returned by the source.', 'No AI-generated additions.'],
        pages: this.pages, records: this.sorted() };
    }
  }
  function transcript(data) {
    const c = data.completeness;
    const header = [`Tipsy chat history · ${data.source.character_name || data.source.character_id}`,
      `Export coverage: ${c.complete_current_mainline ? 'Reached the start of the current thread' : 'Partial history, completeness unverified'}`,
      `Text messages: ${c.text_messages}. Other events: ${c.events} (see JSON).`,
      'Coverage of regenerated replies is unverified. Original messages are preserved.'];
    return header.join('\n') + '\n\n' + data.records.filter(m => m.content_type === 'text').map(m =>
      `[${m.sequence}] ${m.sender_type} | unix=${m.timestamp ?? 'Unknown'}\n${m.content}`).join('\n\n');
  }
  root.TipsyExporterChat = Object.freeze({ History, endpoint, request, transcript, MAX_BYTES, MAX_RECORDS });
})(globalThis);
