const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const C = require('../extension/shared/core.js');
const T = require('../extension/shared/themes.js');
test('ten original palettes keep primary and secondary text readable on every surface', () => {
  assert.equal(T.catalog.length, 10);
  assert.equal(new Set(T.catalog.map((p) => p.id)).size, 10);
  for (const p of T.catalog) {
    for (const text of ['text', 'muted'])
      for (const surface of ['bg', 'surface', 'raised'])
        assert.ok(T.contrast(p[text], p[surface]) >= 4.5, `${p.id}: ${text}/${surface}`);
    const { tokens } = T.resolve(T.preset(p.id));
    assert.ok(T.contrast(tokens.accent, tokens.ink) >= 4.5);
    assert.ok(T.contrast(tokens.link, tokens.surface) >= 4.5);
  }
});
test('system mode follows the OS; arbitrary accent colors receive readable link and button text', () => {
  for (const mode of [false, true]) {
    assert.equal(T.resolve({ mode: 'system' }, mode).mode, mode ? 'dark' : 'light');
  }
  for (const p of T.catalog)
    for (const accent of ['#000000', '#ffffff', '#777777', '#eeee00']) {
      const { tokens } = T.resolve({ ...T.preset(p.id), accent });
      assert.ok(T.contrast(tokens.accent, tokens.ink) >= 4.5);
      assert.ok(T.contrast(tokens.link, tokens.surface) >= 4.5);
    }
});
test('native mode removes theme, decoration hiding, image and custom CSS; zero radius is retained', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const d = dom.window.document;
  T.apply(d, {
    ...C.defaults().appearance,
    ...T.preset('nebula'),
    radius: 0,
    css: '.hello{color:red}',
    background: 'data:image/png;base64,AAAA',
  });
  assert.equal(d.documentElement.dataset.oblivionTheme, 'dark');
  assert.equal(d.documentElement.dataset.oblivionDecor, 'hide');
  assert.equal(d.documentElement.style.getPropertyValue('--ob-radius'), '0px');
  assert.equal(d.documentElement.dataset.oblivionImage, 'on');
  T.apply(d, { ...C.defaults().appearance });
  assert.equal(d.documentElement.dataset.oblivionTheme, undefined);
  assert.equal(d.documentElement.dataset.oblivionDecor, 'show');
  assert.equal(d.documentElement.dataset.oblivionImage, 'off');
  assert.equal(d.querySelector('#oblivion-custom-style').textContent, '');
  dom.window.close();
});
test('theme collections normalize independently and reject oversized collections', () => {
  const prefs = C.normalize({
    favoriteThemes: ['noir', 'noir'],
    savedThemes: [
      { id: 'custom-x', name: 'My noir', appearance: { ...T.preset('noir'), radius: 0 } },
    ],
  });
  assert.deepEqual(prefs.favoriteThemes, ['noir']);
  assert.equal(prefs.savedThemes[0].appearance.theme, 'noir');
  assert.equal(prefs.savedThemes[0].appearance.radius, 0);
  assert.throws(() =>
    C.normalize({
      savedThemes: Array.from({ length: 13 }, (_, i) => ({
        id: String(i),
        name: 'x',
        appearance: {},
      })),
    }),
  );
});
