const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const C = require('../extension/shared/core.js');
const wait = () => new Promise((resolve) => setTimeout(resolve, 15));
async function fixture() {
  const errors = [],
    calls = [];
  const virtual = new VirtualConsole();
  virtual.on('jsdomError', (error) => {
    if (error.type === 'unhandled-exception') errors.push(error);
  });
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div class="chat"><form class="chat-form"><textarea name="content"></textarea></form></div></body></html>',
    {
      url: 'https://funpay.com/chat/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: virtual,
    },
  );
  const w = dom.window;
  w.structuredClone = structuredClone;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.fetch = async () => ({
    text: async () =>
      fs.readFileSync(path.join(__dirname, '../extension/content/workspace.css'), 'utf8'),
  });
  w.navigator.clipboard = { writeText: async () => {} };
  const state = { preferences: C.defaults(), journal: [], automation: {} };
  const attach = w.Element.prototype.attachShadow;
  let shadow;
  w.Element.prototype.attachShadow = function (options) {
    shadow = attach.call(this, options);
    return shadow;
  };
  w.chrome = {
    runtime: {
      id: 'ours',
      getURL: (p) => 'moz-extension://ours/' + p,
      onMessage: { addListener() {} },
      sendMessage(message, cb) {
        calls.push(message);
        let result;
        try {
          switch (message.command) {
            case 'state':
              result = structuredClone(state);
              break;
            case 'settings':
              if (message.payload.expectedRevision !== state.preferences.revision)
                throw new Error('STALE_SETTINGS: updated externally');
              const revision = state.preferences.revision + 1;
              state.preferences = C.normalize(C.merge(state.preferences, message.payload.patch));
              state.preferences.revision = revision;
              result = structuredClone(state.preferences);
              break;
            case 'identity':
              result = { id: '7', name: 'Demo' };
              break;
            case 'ledger':
              result = [];
              break;
            case 'chats':
              result = [{ id: '10', name: 'Mira', snippet: 'hello', unread: true }];
              break;
            case 'messages':
              result = {
                messages: [
                  { id: 'm', name: 'Mira', text: '<img src=x onerror=alert(1)>', own: false },
                ],
              };
              break;
            case 'pause':
              result = true;
              break;
            default:
              result = true;
          }
          cb({ ok: true, result });
        } catch (error) {
          cb({ ok: false, error: error.message });
        }
      },
    },
    storage: { onChanged: { addListener() {} } },
    permissions: { request: (_p, cb) => cb(true) },
  };
  w.eval(fs.readFileSync(path.join(__dirname, '../extension/shared/core.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../extension/shared/themes.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../extension/content/workspace.js'), 'utf8'));
  await wait();
  shadow.querySelector('.dock').click();
  await wait();
  return { dom, w, shadow, state, errors, calls, close: () => dom.window.close() };
}
test('all eight navigation pages render without runtime errors', async () => {
  const f = await fixture();
  try {
    assert.ok(f.shadow.querySelector('.shell'));
    for (const page of [
      'overview',
      'chats',
      'lots',
      'automation',
      'ai',
      'appearance',
      'notes',
      'settings',
    ]) {
      f.shadow.querySelector(`[data-view="${page}"]`).click();
      await wait();
      assert.ok(f.shadow.querySelector('.page').textContent.trim());
    }
    assert.deepEqual(f.errors, []);
  } finally {
    f.close();
  }
});
test('notes save via the background command and survive rerender', async () => {
  const f = await fixture();
  try {
    f.shadow.querySelector('[data-view=notes]').click();
    await wait();
    f.shadow.querySelector('[name=user]').value = '42';
    f.shadow.querySelector('[name=note]').value = 'Customer note';
    f.shadow.querySelector('[data-note-save]').click();
    await wait();
    assert.equal(f.state.preferences.notes['42'], 'Customer note');
  } finally {
    f.close();
  }
});
test('chat content is rendered as text, never executable HTML', async () => {
  const f = await fixture();
  try {
    f.shadow.querySelector('[data-view=chats]').click();
    await wait();
    f.shadow.querySelector('[data-load]').click();
    await wait();
    f.shadow.querySelector('[data-chat-list] button').click();
    await wait();
    const bubble = f.shadow.querySelector('.bubble');
    assert.ok(bubble.textContent.includes('<img'));
    assert.equal(bubble.querySelector('img'), null);
  } finally {
    f.close();
  }
});
test('empty and invalid rule forms cannot save automatic replies', async () => {
  const f = await fixture();
  try {
    f.shadow.querySelector('[data-view=automation]').click();
    await wait();
    f.shadow.querySelector('[data-new-rule]').click();
    await wait();
    f.shadow.querySelector('.modal [data-actions] button').click();
    await wait();
    assert.equal(f.state.preferences.rules.length, 0);
    assert.match(f.shadow.querySelector('.toast').textContent, /ответ/);
  } finally {
    f.close();
  }
});
test('Escape closes the workspace and reopening remains functional', async () => {
  const f = await fixture();
  try {
    f.shadow
      .querySelector('.shell')
      .dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(f.shadow.querySelector('.shell'), null);
    f.shadow.querySelector('.dock').click();
    await wait();
    assert.ok(f.shadow.querySelector('.shell'));
  } finally {
    f.close();
  }
});
test('stale forms refresh instead of overwriting newer settings', async () => {
  const f = await fixture();
  try {
    f.shadow.querySelector('[data-view=automation]').click();
    await wait();
    f.state.preferences.revision = 1;
    f.shadow.querySelector('[name=bumpEnabled]').checked = true;
    f.shadow.querySelector('[data-bump-save]').click();
    await wait();
    assert.equal(f.state.preferences.bump.enabled, false);
    assert.match(f.shadow.querySelector('.toast').textContent, /обновились/);
  } finally {
    f.close();
  }
});
test('theme preview never persists until Save and Cancel restores the saved page', async () => {
  const f = await fixture();
  try {
    f.shadow.querySelector('[data-view=appearance]').click();
    await wait();
    assert.equal(f.shadow.querySelectorAll('[data-theme]').length, 10);
    f.shadow.querySelector('[data-theme=nebula]').click();
    assert.equal(f.w.document.documentElement.dataset.oblivionTheme, 'dark');
    assert.equal(f.state.preferences.appearance.mode, 'original');
    f.shadow.querySelector('[data-cancel-theme]').click();
    assert.equal(f.w.document.documentElement.dataset.oblivionTheme, undefined);
    f.shadow.querySelector('[data-theme=porcelain]').click();
    f.shadow.querySelector('[data-save-theme]').click();
    await wait();
    assert.equal(f.state.preferences.appearance.theme, 'porcelain');
    assert.equal(f.w.document.documentElement.dataset.oblivionTheme, 'light');
    f.shadow.querySelector('[data-theme=noir]').click();
    f.shadow.querySelector('[data-show-page]').click();
    assert.equal(f.shadow.querySelector('.shell'), null);
    assert.ok(f.shadow.querySelector('.theme-preview-bar'));
    f.shadow.querySelector('.theme-preview-bar .quiet').click();
    assert.equal(f.w.document.documentElement.dataset.oblivionTheme, 'light');
    assert.deepEqual(f.errors, []);
  } finally {
    f.close();
  }
});
test('a closed-page theme preview can recover from an external settings revision without overwriting it', async () => {
  const f = await fixture();
  try {
    f.shadow.querySelector('[data-view=appearance]').click();
    await wait();
    f.shadow.querySelector('[data-theme=noir]').click();
    f.shadow.querySelector('[data-show-page]').click();
    f.state.preferences.revision++;
    f.state.preferences.appearance.volume = 0.3;
    f.shadow.querySelector('.theme-preview-bar .primary').click();
    await wait();
    assert.equal(f.state.preferences.appearance.mode, 'original');
    f.shadow.querySelector('.theme-preview-bar .primary').click();
    await wait();
    assert.equal(f.state.preferences.appearance.theme, 'noir');
    assert.equal(f.state.preferences.appearance.volume, 0.3);
    assert.deepEqual(f.errors, []);
  } finally {
    f.close();
  }
});
