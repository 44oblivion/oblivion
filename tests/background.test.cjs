const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../extension/shared/core.js');
const read = (name) =>
  fs.readFileSync(path.join(__dirname, '../extension/background', name), 'utf8');
function engineFixture({
  preferences = C.defaults(),
  chats = [],
  messages = {},
  orders = [],
} = {}) {
  const saved = { preferences, automation: {}, journal: [] };
  const sent = [];
  const raised = [];
  const notifications = [];
  const context = vm.createContext({
    console,
    URL,
    Date,
    AbortSignal,
    FormData,
    structuredClone,
    OblivionCore: C,
    api: { permissions: { contains: (_p, cb) => cb(true) }, alarms: { create() {} } },
    Store: {
      settings: async () => structuredClone(saved.preferences),
      read: async (keys) =>
        typeof keys === 'string'
          ? { [keys]: structuredClone(saved[keys]) }
          : structuredClone(saved),
      write: async (value) => Object.assign(saved, structuredClone(value)),
      update: async (patch) => {
        saved.preferences = C.normalize(C.merge(saved.preferences, patch));
        return structuredClone(saved.preferences);
      },
      log: async (kind, message) => saved.journal.push({ kind, message }),
    },
    Ledger: { all: async () => [] },
    FunPay: {
      identity: async () => ({ id: '7' }),
      chats: async () => chats,
      messages: async (id) => ({ node: 'chat-' + id, messages: messages[id] || [] }),
      send: async (id, text) => sent.push({ id, text }),
      page: async () => ({ querySelector: () => ({ dataset: { id: '10' } }) }),
      rows: () => orders,
      categories: async () => [{ game: '1', node: '2', name: 'Game' }],
      raise: async (item) => raised.push(item),
      saveLot: async () => ({}),
    },
    fetch: async () => {
      throw Error('Network forbidden in tests');
    },
  });
  vm.runInContext(
    read('engine.js') + '\nglobalThis.engine=Engine;globalThis.external=External;',
    context,
  );
  context.external.notify = async (text) => notifications.push(text);
  return {
    context,
    saved,
    sent,
    raised,
    notifications,
    engine: context.engine,
    chats,
    messages,
    orders,
  };
}
test('disabled engine makes no requests', async () => {
  const f = engineFixture();
  await f.engine.cycle();
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.saved.automation, {});
});
test('baseline skips old messages; new messages reply once; new chats receive first reply', async () => {
  const p = C.defaults();
  p.rules = [{ id: 'r', enabled: true, keywords: 'hi', reply: 'hello {buyer}' }];
  const f = engineFixture({
    preferences: p,
    chats: [{ id: '10', name: 'A', unread: true }],
    messages: { 10: [{ id: 'old', author: '9', text: 'hi' }] },
  });
  await f.engine.cycle();
  assert.equal(f.sent.length, 0);
  f.messages[10] = [{ id: 'new', author: '9', text: 'hi' }];
  await f.engine.cycle();
  assert.equal(f.sent.length, 1);
  await f.engine.cycle();
  assert.equal(f.sent.length, 1);
  f.chats.push({ id: '20', name: 'B', unread: true });
  f.messages[20] = [{ id: 'first', author: '8', text: 'hi' }];
  await f.engine.cycle();
  assert.equal(f.sent.length, 2);
});
test('changing enabled rules creates a fresh baseline', async () => {
  const p = C.defaults();
  p.rules = [{ id: 'r', enabled: true, reply: 'first' }];
  const f = engineFixture({
    preferences: p,
    chats: [{ id: '10', unread: true }],
    messages: { 10: [{ id: 'old', author: '9', text: 'hello' }] },
  });
  await f.engine.cycle();
  f.saved.preferences.rules = [{ id: 'other', enabled: true, reply: 'new' }];
  f.messages[10] = [{ id: 'second', author: '9', text: 'hello' }];
  await f.engine.cycle();
  assert.equal(f.sent.length, 0);
});
test('blacklist prevents auto replies', async () => {
  const p = C.defaults();
  p.rules = [{ id: 'r', enabled: true, reply: 'hi' }];
  p.blocked = ['9'];
  const f = engineFixture({
    preferences: p,
    chats: [{ id: '10', unread: true }],
    messages: { 10: [{ id: 'old', author: '9', text: 'hello' }] },
  });
  await f.engine.cycle();
  f.messages[10] = [{ id: 'new', author: '9', text: 'hello' }];
  await f.engine.cycle();
  assert.equal(f.sent.length, 0);
});
test('delivery reserves before sending and never retries uncertain outcome', async () => {
  const p = C.defaults();
  p.inventories = [
    {
      id: 's',
      name: 'Stock',
      enabled: true,
      match: 'Game',
      message: '{lot}',
      items: ['ONE', 'TWO'],
      reservations: [],
    },
  ];
  const f = engineFixture({ preferences: p });
  await f.engine.cycle();
  f.orders.push({ id: '42', title: 'Game', status: 'paid' });
  f.context.FunPay.send = async () => {
    assert.equal(f.saved.preferences.inventories[0].items.length, 1);
    assert.equal(f.saved.preferences.inventories[0].reservations[0].status, 'reserved');
    throw Error('lost response');
  };
  await f.engine.cycle();
  assert.equal(f.saved.preferences.inventories[0].reservations[0].status, 'uncertain');
  await f.engine.cycle();
  assert.equal(f.saved.preferences.inventories[0].items.length, 1);
});
test('enabling stock after other automation baselines existing paid orders', async () => {
  const p = C.defaults();
  p.bump.enabled = true;
  const f = engineFixture({ preferences: p });
  await f.engine.cycle();
  f.saved.preferences.inventories = [
    { id: 's', enabled: true, match: 'Game', message: '{lot}', items: ['ONE'], reservations: [] },
  ];
  f.orders.push({ id: '42', title: 'Game', status: 'paid' });
  await f.engine.cycle();
  assert.equal(f.sent.length, 0);
  assert.equal(f.saved.preferences.inventories[0].items.length, 1);
});
test('raise respects persisted cooldown', async () => {
  const p = C.defaults();
  p.bump.enabled = true;
  const f = engineFixture({ preferences: p });
  await f.engine.cycle();
  await f.engine.cycle();
  assert.equal(f.raised.length, 1);
});
test('FunPay rows scope and price parser use HTML fixtures', () => {
  const dom = new JSDOM();
  const context = vm.createContext({
    DOMParser: dom.window.DOMParser,
    OblivionCore: C,
    URL,
    console,
  });
  vm.runInContext(read('funpay.js') + '\nglobalThis.fp=FunPay;', context);
  const doc = context.fp.document(
    '<a class="tc-item" href="/orders/abc/"><div class="tc-desc">Game</div><div class="tc-price">1 234,56 ₽</div><div class="tc-status">Завершён</div></a>',
  );
  const rows = context.fp.rows(doc, 'orders');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 1234.56);
  dom.window.close();
});
test('message router rejects unrelated senders and inherited command names', () => {
  const listeners = [];
  const context = vm.createContext({
    api: {
      runtime: {
        id: 'ours',
        getURL: (p) => 'moz-extension://ours/' + p,
        onMessage: { addListener: (fn) => listeners.push(fn) },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
      },
      alarms: { onAlarm: { addListener() {} } },
    },
    Engine: { start() {} },
    console,
    OblivionCore: C,
  });
  vm.runInContext(read('main.js'), context);
  assert.equal(
    listeners[0]({ app: 'oblivion', command: 'state' }, { id: 'other' }, () => {}),
    false,
  );
  assert.equal(
    listeners[0](
      { app: 'oblivion', command: 'toString' },
      { id: 'ours', url: 'https://funpay.com/' },
      () => {},
    ),
    false,
  );
  assert.equal(
    listeners[0](
      { app: 'oblivion', command: 'state' },
      { id: 'ours', url: 'https://evil.test/' },
      () => {},
    ),
    false,
  );
});
test('restoring preferences preserves local stock and credentials while disabling execution', async () => {
  const current = C.defaults();
  current.ai.key = 'local-key';
  current.inventories = [
    {
      id: 's',
      name: 'Stock',
      enabled: true,
      match: 'Game',
      message: '{lot}',
      items: ['private-code'],
      reservations: [],
    },
  ];
  let saved = current;
  const context = vm.createContext({
    console,
    OblivionCore: C,
    Engine: { running: false, start() {} },
    Store: {
      settings: async () => structuredClone(saved),
      update: async (patch) => {
        saved = C.normalize(C.merge(saved, patch));
        return saved;
      },
    },
    api: {
      runtime: {
        onMessage: { addListener() {} },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
      },
      alarms: { onAlarm: { addListener() {} } },
    },
  });
  vm.runInContext(read('main.js') + '\nglobalThis.commandMap=commands;', context);
  await context.commandMap.restore({
    backup: { format: 'oblivion', version: 1, preferences: C.defaults() },
  });
  assert.equal(saved.inventories[0].items[0], 'private-code');
  assert.equal(saved.inventories[0].enabled, false);
  assert.equal(saved.ai.key, 'local-key');
});
