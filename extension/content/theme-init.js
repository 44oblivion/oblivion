/* Runs at document_start: persisted themes are applied before the main workspace. */
(function () {
  'use strict';
  const ext = typeof chrome !== 'undefined' ? chrome : browser;
  const system = matchMedia('(prefers-color-scheme:dark)');
  let appearance,
    previewing = false;
  const apply = () => {
    if (appearance) OblivionThemes.apply(document, appearance, system.matches);
  };
  globalThis.OblivionAppearance = {
    preview(value) {
      previewing = true;
      appearance = value;
      apply();
    },
    restore(value) {
      previewing = false;
      appearance = value;
      apply();
    },
    get previewing() {
      return previewing;
    },
  };
  ext.storage.local.get('preferences', (result) => {
    if (!previewing) {
      appearance = OblivionCore.normalize(result.preferences || {}).appearance;
      apply();
    }
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.preferences && !previewing) {
      appearance = OblivionCore.normalize(changes.preferences.newValue || {}).appearance;
      apply();
    }
  });
  document.addEventListener('DOMContentLoaded', apply, { once: true });
  system.addEventListener('change', apply);
})();
