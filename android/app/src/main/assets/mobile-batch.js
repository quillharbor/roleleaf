(function (root) {
  'use strict';
  // Keep completed packages within a bounded memory budget.
  async function run({ bots, signal, collect, progress, limit = 120 * 1024 * 1024 }) {
    const files = [], results = []; let bytes = 0, messages = 0, images = 0;
    for (const [index, bot] of bots.entries()) {
      if (signal.aborted) break;
      progress(index, bots.length, bot);
      try {
        const output = await collect(bot);
        if (bytes + output.bytes.length > limit) {
          results.push({ id: bot.id, status: 'failed', error: 'Batch size limit reached. Export fewer characters at a time.' });
          break;
        }
        files.push({ filename: output.filename, bytes: output.bytes });
        bytes += output.bytes.length; messages += output.messages; images += output.images;
        results.push({ id: bot.id, status: output.partial ? 'partial' : 'complete_current_conversation' });
      } catch (error) {
        results.push({ id: bot.id, name: bot.name, status: signal.aborted ? 'cancelled' : 'failed', error: error.message });
      }
    }
    const done = new Set(results.map(r => r.id));
    for (const bot of bots) if (!done.has(bot.id)) results.push({ id: bot.id, name: bot.name, status: 'skipped' });
    return { files, results, bytes, messages, images, stopped: signal.aborted,
      partial: signal.aborted || results.some(r => r.status !== 'complete_current_conversation') };
  }
  root.MobileBatch = { run };
})(globalThis);
