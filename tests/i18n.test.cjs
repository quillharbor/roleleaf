const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load({ saved, browserLanguage = 'zh-CN' } = {}) {
  const document = { documentElement: {}, querySelectorAll: () => [] };
  const context = vm.createContext({ document, navigator: { language: browserLanguage }, localStorage: { getItem: () => saved } });
  vm.runInContext(fs.readFileSync('tipsy-exporter/i18n.js', 'utf8'), context);
  return context;
}

test('language defaults to English and only remembers supported choices', () => {
  for (const saved of [null, 'zh', 'zh-CN', 'zh-Hans', 'unknown']) {
    const { RoleLeafI18n: i18n } = load({ saved });
    assert.equal(i18n.language, 'en');
    assert.deepEqual(Object.keys(i18n.languages), ['en', 'ar', 'ja', 'ko', 'zh-Hant']);
  }
  assert.equal(load({ saved: 'zh-Hant' }).RoleLeafI18n.language, 'zh-Hant');
});

test('translations retain all interpolation fields and Arabic uses RTL', () => {
  const context = load({ saved: 'ar' });
  const { RoleLeafI18n: i18n, document } = context;
  const register = i18n.register;
  const tokenSet = value => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
  i18n.register = rows => {
    const seen = new Set();
    for (const [source, ...translations] of rows) {
      assert.ok(!seen.has(source), source);
      seen.add(source);
      assert.equal(translations.length, 4, source);
      for (const translation of translations) {
        assert.ok(translation && translation !== source, source);
        assert.deepEqual(tokenSet(translation), tokenSet(source), source);
      }
    }
    register(rows);
  };
  const catalogs = ['tipsy-exporter/messages.js', 'site/messages.js'].filter(file => fs.existsSync(file));
  for (const file of catalogs) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  i18n.render();
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(document.documentElement.lang, 'ar');
  assert.match(i18n.t('Export ({count})', { count: 12 }), /(12|١٢)/u);
  i18n.select('ja');
  i18n.render();
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(i18n.t('Select {name}', { name: 'Luna <3' }), 'Luna <3 を選択');
});
