// Entirely synthetic. Do not replace with account data, HARs or private chats.
const makeRows = total => Array.from({length: total}, (_, index) => {
  const sequence = index + 1;
  return {
    sequence: String(sequence),
    sender_type: sequence % 2 ? 'character' : 'user',
    content_type: sequence === total ? 'relationship_reward' : 'text',
    content: sequence === total ? '{"reward":1}' : `Synthetic message ${sequence} 🌙\n{{user}} 与 {{char}} — 原文`,
    timestamp: 1700000000 + sequence
  };
});
module.exports = [20, 14].flatMap((total, index) => {
  const rows = makeRows(total), character_id = String(100000001 + index);
  const page = (sequence, data) => ({
    request: {character_id, sequence, size: 10, language_code: 'en', chat_mode: 'group_chat'},
    response: {code: 0, data}
  });
  const latest = page('0', rows.slice(-10));
  // Repeated latest page exercises deduplication before the older page arrives.
  return [latest, latest, page(String(total - 10), rows.slice(0, -10))];
});
