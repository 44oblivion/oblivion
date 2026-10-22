const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/shared/core.js');
test('all automation and third party integrations are off by default', () => {
  const s = C.defaults();
  assert.equal(s.bump.enabled, false);
  assert.equal(s.ai.consent, false);
  assert.equal(s.integrations.telegram.enabled, false);
  assert.equal(s.rules.length, 0);
});
test('independent defaults cannot share mutable arrays', () => {
  const a = C.defaults(),
    b = C.defaults();
  a.rules.push(1);
  assert.equal(b.rules.length, 0);
});
test('normalization clamps timing, appearance and unsafe rates', () => {
  const s = C.normalize({
    bump: { interval: 1 },
    appearance: { size: 500, volume: 5, mode: 'fake', accent: 'url(evil)' },
    currency: { rates: { USD: -10 } },
  });
  assert.equal(s.bump.interval, 5);
  assert.equal(s.appearance.size, 22);
  assert.equal(s.appearance.volume, 1);
  assert.equal(s.appearance.mode, 'system');
  assert.ok(s.currency.rates.USD > 0);
});
test('dynamic notes survive merging without prototype pollution', () => {
  const s = C.normalize(
    JSON.parse(
      '{"notes":{"42":"Buyer","__proto__":{"polluted":true}},"__proto__":{"polluted":true},"toString":"bad"}',
    ),
  );
  assert.equal(s.notes['42'], 'Buyer');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(s, 'toString'), false);
});
test('bad stock import is rejected before automation can use it', () => {
  assert.throws(() =>
    C.normalize({ inventories: [{ id: 'x', match: 'game', message: '{lot}', items: null }] }),
  );
  assert.throws(() =>
    C.normalize({
      inventories: [{ id: 'x', match: 'game', message: 'no code variable', items: ['code'] }],
    }),
  );
});
test('prices accept Russian and English decimal/thousands separators', () => {
  assert.equal(C.money('1 234,56 ₽'), 1234.56);
  assert.equal(C.money('$1,234.56'), 1234.56);
  assert.equal(C.money('€1.234,56'), 1234.56);
  assert.equal(C.money('not a price'), 0);
});
test('template substitution preserves unknown variables', () => {
  assert.equal(
    C.template('Hi {buyer}: {lot} {unknown}', { buyer: 'Mira', lot: 'A' }),
    'Hi Mira: A {unknown}',
  );
});
test('rules ignore own/system messages and disabled/expired rules', () => {
  const r = [{ id: 'a', enabled: true, keywords: 'hi,привет', reply: 'hello' }];
  assert.equal(C.matchRule(r, { id: '1', text: 'Привет!', own: true }), null);
  assert.equal(C.matchRule(r, { id: '1', text: 'hi', system: true }), null);
  assert.equal(C.matchRule(r, { id: '1', text: 'HI' }).id, 'a');
  assert.equal(C.matchRule([{ ...r[0], until: 1 }], { id: '1', text: 'hi' }, 2), null);
});
test('CSV neutralizes spreadsheet formulas even after whitespace', () => {
  const csv = C.tableCSV(
    [{ name: ' =HYPERLINK("x")', value: 'text;more\nline' }],
    ['name', 'value'],
  );
  assert.ok(csv.includes("' =HYPERLINK"));
  assert.ok(csv.includes('"text;more\nline"'));
});
test('statistics exclude unpaid and cancelled revenue and unknown dates', () => {
  const totals = C.totals([
    { amount: 100, status: 'complete', time: Date.UTC(2026, 9, 22) },
    { amount: 50, status: 'complete', time: null },
    { amount: 80, status: 'cancelled' },
    { amount: 99, status: 'paid' },
  ]);
  assert.equal(totals.gross, 150);
  assert.equal(totals.completed, 2);
  assert.equal(totals.cancelled, 1);
  assert.equal(totals.byDay['2026-10-22'], 100);
});
test('backup removes credentials, inventory and enabled automation', () => {
  const s = C.defaults();
  s.ai.key = 'secret';
  s.integrations.telegram.token = 'private';
  s.integrations.discord.webhook = 'private';
  s.inventories = [{ items: ['code'] }];
  s.rules = [{ enabled: true }];
  s.bump.enabled = true;
  const copy = C.redact(s);
  assert.equal(copy.ai.key, '');
  assert.equal(copy.integrations.telegram.token, '');
  assert.equal(copy.integrations.discord.webhook, '');
  assert.equal(copy.inventories.length, 0);
  assert.equal(copy.rules[0].enabled, false);
  assert.equal(s.ai.key, 'secret');
});
test('service URLs reject userinfo, HTTP, lookalikes and unrelated hosts', () => {
  for (const url of [
    'http://discord.com',
    'https://discord.com.evil.test',
    'https://user@discord.com',
    'https://evil.test',
  ])
    assert.throws(() => C.safeURL(url, ['https://discord.com']));
  assert.equal(
    C.safeURL('https://discord.com/api/webhooks/1/abc', ['https://discord.com']).hostname,
    'discord.com',
  );
});
test('history dates parse Russian text and reject impossible dates', () => {
  assert.equal(new Date(C.parseDate('22 октября 2026, 14:30')).getFullYear(), 2026);
  assert.equal(new Date(C.parseDate('22.10.2026')).getDate(), 22);
  assert.equal(C.parseDate('31.02.2026'), null);
  assert.equal(C.parseDate('unknown'), null);
  const reference = new Date(2026, 9, 22, 14).getTime();
  assert.equal(new Date(C.parseDate('вчера, 12:30', reference)).getDate(), 21);
});
