/* Original Oblivion palettes and contrast-aware tokens. No remote theme code. */
(function (root) {
  'use strict';
  const catalog = [
    {
      id: 'orbit',
      name: 'Orbit',
      note: 'Графит и лайм',
      mode: 'dark',
      bg: '#10141c',
      surface: '#191f2b',
      raised: '#263144',
      text: '#f1f5fb',
      muted: '#a5b2c7',
      border: '#42516a',
      accent: '#c6f36b',
      atmosphere: 'orbit',
    },
    {
      id: 'noir',
      name: 'Noir',
      note: 'Спокойный монохром',
      mode: 'dark',
      bg: '#121212',
      surface: '#1c1c1c',
      raised: '#2b2b2b',
      text: '#f2f2f2',
      muted: '#b0b0b0',
      border: '#4b4b4b',
      accent: '#dedede',
      atmosphere: 'none',
    },
    {
      id: 'nebula',
      name: 'Nebula',
      note: 'Фиолетовый вечер',
      mode: 'dark',
      bg: '#151221',
      surface: '#211c32',
      raised: '#302840',
      text: '#f3edff',
      muted: '#c1b2d8',
      border: '#57486e',
      accent: '#c1a3ff',
      atmosphere: 'aurora',
    },
    {
      id: 'abyss',
      name: 'Abyss',
      note: 'Глубокий синий',
      mode: 'dark',
      bg: '#081620',
      surface: '#102534',
      raised: '#19384b',
      text: '#e5f5ff',
      muted: '#aec9d8',
      border: '#3d647b',
      accent: '#67d7ef',
      atmosphere: 'orbit',
    },
    {
      id: 'forest',
      name: 'Forest',
      note: 'Мягкий хвойный',
      mode: 'dark',
      bg: '#0e1a16',
      surface: '#162820',
      raised: '#233d31',
      text: '#e5f5eb',
      muted: '#b3ccb9',
      border: '#4b6a57',
      accent: '#96d5a7',
      atmosphere: 'aurora',
    },
    {
      id: 'ember',
      name: 'Ember',
      note: 'Тёплый янтарь',
      mode: 'dark',
      bg: '#20140f',
      surface: '#2d2119',
      raised: '#443225',
      text: '#fff1e6',
      muted: '#d6bba5',
      border: '#795b45',
      accent: '#f3b77d',
      atmosphere: 'glow',
    },
    {
      id: 'sakura',
      name: 'Sakura',
      note: 'Приглушённый розовый',
      mode: 'dark',
      bg: '#22151e',
      surface: '#30202c',
      raised: '#472e3e',
      text: '#ffeef7',
      muted: '#dab6cb',
      border: '#785269',
      accent: '#f2a8cd',
      atmosphere: 'glow',
    },
    {
      id: 'porcelain',
      name: 'Porcelain',
      note: 'Чистый светлый',
      mode: 'light',
      bg: '#f3f6fc',
      surface: '#ffffff',
      raised: '#e8eef8',
      text: '#202d45',
      muted: '#52627c',
      border: '#b6c4db',
      accent: '#355cdf',
      atmosphere: 'none',
    },
    {
      id: 'linen',
      name: 'Linen',
      note: 'Бумага и тёплый свет',
      mode: 'light',
      bg: '#f6f1e7',
      surface: '#fffaf1',
      raised: '#eee4d1',
      text: '#352b20',
      muted: '#6d5f4d',
      border: '#c7b49d',
      accent: '#82602d',
      atmosphere: 'glow',
    },
    {
      id: 'arctic',
      name: 'Arctic',
      note: 'Прохладный дневной',
      mode: 'light',
      bg: '#eff7f8',
      surface: '#ffffff',
      raised: '#deecef',
      text: '#16323a',
      muted: '#436670',
      border: '#a5c1c9',
      accent: '#006c86',
      atmosphere: 'orbit',
    },
  ];
  const hex = (value) => /^#[0-9a-f]{6}$/i.test(value);
  const rgb = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  function mix(a, b, amount) {
    return (
      '#' +
      rgb(a)
        .map((n, i) =>
          Math.round(n * (1 - amount) + rgb(b)[i] * amount)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }
  function luminance(value) {
    return rgb(value)
      .map((n) => {
        const v = n / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function contrast(a, b) {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function readable(color, background, minimum = 4.5) {
    if (contrast(color, background) >= minimum) return color;
    const target =
      contrast('#ffffff', background) > contrast('#111111', background) ? '#ffffff' : '#111111';
    for (let i = 1; i <= 20; i++) {
      const value = mix(color, target, i / 20);
      if (contrast(value, background) >= minimum) return value;
    }
    return target;
  }
  function resolve(appearance = {}, prefersDark = false) {
    const mode = appearance.mode === 'system' ? (prefersDark ? 'dark' : 'light') : appearance.mode;
    let palette = catalog.find((p) => p.id === appearance.theme) || catalog[0];
    if (mode === 'light' && palette.mode !== 'light')
      palette = catalog.find((p) => p.id === 'porcelain');
    if (mode === 'dark' && palette.mode !== 'dark') palette = catalog[0];
    const accent = hex(appearance.accent) ? appearance.accent : palette.accent;
    const ink = contrast('#000000', accent) >= contrast('#ffffff', accent) ? '#000000' : '#ffffff';
    const tokens = {
      ...palette,
      accent,
      ink,
      link: readable(accent, palette.surface),
      hover: mix(palette.raised, palette.text, 0.07),
      soft: mix(palette.surface, accent, 0.12),
    };
    return { active: mode === 'dark' || mode === 'light', mode: palette.mode, tokens };
  }
  function preset(id) {
    const p = catalog.find((p) => p.id === id);
    if (!p) throw new Error('Неизвестная тема.');
    return {
      theme: p.id,
      preset: p.id,
      mode: p.mode,
      accent: p.accent,
      atmosphere: p.atmosphere,
      hideDecor: true,
      css: '',
    };
  }
  function sanitizeCSS(value) {
    const css = String(value || '')
      .slice(0, 30000)
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // Reject escaped identifiers rather than allowing obfuscated remote URLs/imports.
    if (css.includes('\\')) return '';
    return css
      .replace(/@import[^;]*(;|$)/gi, '')
      .replace(/(?:url|(?:-webkit-)?image-set)\s*\([^;}]*/gi, 'none')
      .replace(/(?:https?:|javascript:|data:)/gi, 'blocked:');
  }
  function apply(document, appearance, prefersDark = false) {
    const result = resolve(appearance, prefersDark),
      html = document.documentElement;
    if (!html) return result;
    const { tokens: t } = result;
    for (const [key, value] of Object.entries({
      bg: t.bg,
      surface: t.surface,
      raised: t.raised,
      text: t.text,
      muted: t.muted,
      border: t.border,
      accent: t.accent,
      'accent-ink': t.ink,
      link: t.link,
      hover: t.hover,
      soft: t.soft,
      font: ['system-ui', 'Georgia', 'monospace'].includes(appearance.font)
        ? appearance.font
        : 'system-ui',
      size: Math.max(11, Math.min(22, Number(appearance.size) || 14)) + 'px',
      radius:
        Math.max(0, Math.min(24, Number.isFinite(appearance.radius) ? appearance.radius : 12)) +
        'px',
    }))
      html.style.setProperty('--ob-' + key, value);
    if (result.active) html.dataset.oblivionTheme = result.mode;
    else delete html.dataset.oblivionTheme;
    html.dataset.oblivionDecor = appearance.hideDecor && result.active ? 'hide' : 'show';
    html.dataset.oblivionDensity = appearance.density === 'compact' ? 'compact' : 'normal';
    html.dataset.oblivionAtmosphere = result.active
      ? ['none', 'orbit', 'aurora', 'glow', 'grid'].includes(appearance.atmosphere)
        ? appearance.atmosphere
        : 'none'
      : 'none';
    html.dataset.oblivionBalance = appearance.hideBalance ? 'hidden' : 'visible';
    let style = document.getElementById('oblivion-custom-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'oblivion-custom-style';
      (document.head || html).append(style);
    }
    const image = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(
      appearance.background,
    )
      ? appearance.background
      : '';
    html.style.setProperty('--ob-image', image ? `url("${image}")` : 'none');
    html.style.setProperty(
      '--ob-background-shade',
      String(Math.max(40, Math.min(95, Number(appearance.backgroundShade) || 82)) / 100),
    );
    html.dataset.oblivionImage = image && result.active ? 'on' : 'off';
    style.textContent = result.active ? sanitizeCSS(appearance.css) : '';
    return result;
  }
  root.OblivionThemes = { catalog, contrast, mix, readable, resolve, preset, apply, sanitizeCSS };
  if (typeof module !== 'undefined') module.exports = root.OblivionThemes;
})(globalThis);
