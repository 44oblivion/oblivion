/* Oblivion. Original implementation. No runtime dependencies. */
(function (root) {
  'use strict';
  const defaults = () => ({
    version: 1,
    revision: 0,
    automationAccount: '',
    appearance: {
      mode: 'original',
      theme: 'orbit',
      preset: 'orbit',
      atmosphere: 'none',
      hideDecor: true,
      radius: 12,
      backgroundShade: 82,
      accent: '#c6f36b',
      font: 'system-ui',
      size: 14,
      density: 'normal',
      cursor: false,
      background: '',
      css: '',
      hideBalance: false,
      sound: '',
      volume: 0.7,
    },
    favoriteThemes: [],
    savedThemes: [],
    templates: [],
    notes: {},
    lotNotes: {},
    blocked: [],
    pins: [],
    goals: [],
    rules: [],
    inventories: [],
    bump: { enabled: false, interval: 15, categories: [] },
    autoRestore: { enabled: false, schedule: [] },
    integrations: {
      telegram: { enabled: false, token: '', chat: '' },
      discord: { enabled: false, webhook: '' },
    },
    ai: { provider: 'openai', model: 'gpt-4.1-mini', key: '', consent: false },
    currency: { base: 'RUB', rates: { RUB: 1, USD: 95, EUR: 103, UAH: 2.3 } },
    profile: { description: '', banner: '', nickname: '' },
  });
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  function merge(base, patch) {
    const out = structuredClone(base);
    const dynamic = Object.keys(base).length === 0;
    for (const [key, value] of Object.entries(patch || {})) {
      if (
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        (!dynamic && !Object.hasOwn(base, key))
      )
        continue;
      if (dynamic) {
        out[key] = structuredClone(value);
        continue;
      }
      if (plain(base[key]) && plain(value)) out[key] = merge(base[key], value);
      else if (Array.isArray(base[key]) && Array.isArray(value)) out[key] = structuredClone(value);
      else if (typeof base[key] === typeof value) out[key] = value;
    }
    return out;
  }
  function normalize(value) {
    if (!plain(value)) throw new Error('Настройки должны быть объектом.');
    if (JSON.stringify(value).length > 8_000_000) throw new Error('Слишком большой файл настроек.');
    const out = merge(defaults(), value);
    out.bump.interval = Math.max(5, Math.min(1440, Number(out.bump.interval) || 15));
    out.appearance.volume = Math.max(0, Math.min(1, Number(out.appearance.volume) || 0));
    out.appearance.size = Math.max(11, Math.min(22, Number(out.appearance.size) || 14));
    out.appearance.radius = Math.max(
      0,
      Math.min(24, Number.isFinite(out.appearance.radius) ? out.appearance.radius : 12),
    );
    out.appearance.backgroundShade = Math.max(
      40,
      Math.min(95, Number(out.appearance.backgroundShade) || 82),
    );
    if (!['none', 'orbit', 'aurora', 'glow', 'grid'].includes(out.appearance.atmosphere))
      out.appearance.atmosphere = 'none';
    out.favoriteThemes = [
      ...new Set(out.favoriteThemes.filter((id) => typeof id === 'string')),
    ].slice(0, 50);
    if (out.savedThemes.length > 12) throw new Error('Можно сохранить до 12 своих тем.');
    out.savedThemes = out.savedThemes
      .filter(
        (t) =>
          plain(t) && typeof t.id === 'string' && typeof t.name === 'string' && plain(t.appearance),
      )
      .map((t) => ({
        id: t.id,
        name: t.name.slice(0, 60),
        appearance: normalize({ appearance: t.appearance }).appearance,
      }));
    if (!['system', 'dark', 'light', 'original'].includes(out.appearance.mode))
      out.appearance.mode = 'system';
    if (!/^#[0-9a-f]{6}$/i.test(out.appearance.accent)) out.appearance.accent = '#c6f36b';
    for (const key of ['notes', 'lotNotes'])
      out[key] = Object.fromEntries(
        Object.entries(out[key])
          .filter(([id, text]) => /^\d+$/.test(id) && typeof text === 'string')
          .map(([id, text]) => [id, text.slice(0, 10000)]),
      );
    out.blocked = [...new Set(out.blocked.filter((id) => /^\d+$/.test(String(id))).map(String))];
    out.templates = out.templates
      .filter((t) => plain(t) && typeof t.name === 'string' && typeof t.text === 'string')
      .map((t) => ({
        id: String(t.id || ''),
        name: t.name.slice(0, 100),
        text: t.text.slice(0, 20000),
      }));
    out.goals = out.goals.filter(
      (g) => plain(g) && typeof g.name === 'string' && Number.isFinite(g.amount) && g.amount > 0,
    );
    for (const [key, rate] of Object.entries(out.currency.rates))
      if (!Number.isFinite(rate) || rate <= 0)
        out.currency.rates[key] = defaults().currency.rates[key] || 1;
    out.currency.rates.RUB = 1;
    if (!['openai', 'openrouter', 'gemini'].includes(out.ai.provider)) out.ai.provider = 'openai';
    out.inventories = out.inventories
      .filter((i) => plain(i) && typeof i.id === 'string')
      .map((i) => {
        if (
          !Array.isArray(i.items) ||
          i.items.some((item) => typeof item !== 'string') ||
          i.items.length > 50000
        )
          throw new Error('Склад должен содержать список текстовых товаров.');
        if (
          typeof i.match !== 'string' ||
          !i.match.trim() ||
          typeof i.message !== 'string' ||
          !i.message.includes('{lot}')
        )
          throw new Error('Склад: укажите товар и переменную {lot} в сообщении.');
        return {
          id: i.id,
          name: String(i.name || ''),
          match: i.match,
          message: i.message.slice(0, 20000),
          enabled: i.enabled === true,
          items: i.items,
          reservations: Array.isArray(i.reservations)
            ? i.reservations.filter(
                (r) => plain(r) && typeof r.value === 'string' && typeof r.order === 'string',
              )
            : [],
        };
      });
    out.autoRestore.schedule = out.autoRestore.schedule.filter(
      (i) => plain(i) && /^\d+$/.test(String(i.lot)) && Number.isFinite(i.at),
    );
    out.rules = out.rules.filter(
      (r) => plain(r) && typeof r.id === 'string' && typeof r.reply === 'string',
    );
    if (out.rules.length > 500 || out.templates.length > 2000)
      throw new Error('Слишком много правил или шаблонов.');
    return out;
  }
  function money(raw) {
    let text = String(raw ?? '').replace(/[^\d.,\-]/g, '');
    if (text.includes(',') && text.includes('.')) {
      const decimal = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
      text = text.replace(decimal === ',' ? /\./g : /,/g, '').replace(',', '.');
    } else text = text.replace(',', '.');
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }
  function parseDate(raw, now = Date.now()) {
    const value = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}(?:t|$)/i.test(value)) {
      const n = Date.parse(value);
      return Number.isFinite(n) ? n : null;
    }
    const local = new Date(now);
    const clock = value.match(/(\d{1,2}):(\d{2})/);
    if (/сегодня|today|вчера|yesterday/.test(value)) {
      if (/вчера|yesterday/.test(value)) local.setDate(local.getDate() - 1);
      local.setHours(clock ? Number(clock[1]) : 0, clock ? Number(clock[2]) : 0, 0, 0);
      return local.getTime();
    }
    const numeric = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    const months = [
      'январ',
      'феврал',
      'март',
      'апрел',
      'ма',
      'июн',
      'июл',
      'август',
      'сентябр',
      'октябр',
      'ноябр',
      'декабр',
    ];
    const words = value.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
    let day, month, year;
    if (numeric) {
      day = Number(numeric[1]);
      month = Number(numeric[2]) - 1;
      year = Number(numeric[3]);
      if (year < 100) year += 2000;
    } else if (words) {
      day = Number(words[1]);
      month = months.findIndex((m) => words[2].startsWith(m));
      year = Number(words[3]) || local.getFullYear();
      if (!words[3] && month > local.getMonth()) year--;
    } else return null;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const date = new Date(
      year,
      month,
      day,
      clock ? Number(clock[1]) : 0,
      clock ? Number(clock[2]) : 0,
    );
    return date.getMonth() === month && date.getDate() === day ? date.getTime() : null;
  }
  function template(text, data = {}) {
    return String(text).replace(/\{(buyer|order|lot|price|date|time)\}/g, (all, key) =>
      String(
        data[key] ??
          (key === 'date'
            ? new Date().toLocaleDateString('ru')
            : key === 'time'
              ? new Date().toLocaleTimeString('ru')
              : all),
      ),
    );
  }
  function matchRule(rules, message, now = Date.now()) {
    if (message.own || message.system || !message.id || !message.text) return null;
    const text = message.text.toLocaleLowerCase();
    return (
      rules.find((rule) => {
        if (!rule.enabled || (rule.until && Number(rule.until) < now)) return false;
        const keys = String(rule.keywords || '')
          .split(',')
          .map((k) => k.trim().toLocaleLowerCase())
          .filter(Boolean);
        return !keys.length || keys.some((k) => text.includes(k));
      }) || null
    );
  }
  function tableCSV(rows, columns) {
    const cell = (v) =>
      '"' +
      String(v ?? '')
        .replace(/^[\s]*[=+@\-]/, "'$&")
        .replace(/"/g, '""') +
      '"';
    return (
      '\ufeff' +
      [columns, ...rows.map((row) => columns.map((c) => row[c]))]
        .map((row) => row.map(cell).join(';'))
        .join('\r\n')
    );
  }
  function totals(rows) {
    const byDay = {},
      byCategory = {};
    let gross = 0,
      completed = 0,
      cancelled = 0;
    for (const row of rows) {
      if (row.status === 'cancelled') {
        cancelled++;
        continue;
      }
      if (row.status !== 'complete') continue;
      const amount = Number(row.amount) || 0;
      gross += amount;
      completed++;
      if (row.time) {
        const day = new Date(row.time).toISOString().slice(0, 10);
        byDay[day] = (byDay[day] || 0) + amount;
      }
      byCategory[row.category || 'Прочее'] = (byCategory[row.category || 'Прочее'] || 0) + amount;
    }
    return {
      gross,
      completed,
      cancelled,
      average: completed ? gross / completed : 0,
      byDay,
      byCategory,
    };
  }
  function safeURL(value, origins) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !origins.includes(url.origin) || url.username || url.password)
      throw new Error('Адрес сервиса не разрешён.');
    return url;
  }
  function redact(settings) {
    const out = structuredClone(settings);
    out.automationAccount = '';
    out.ai.key = '';
    out.ai.consent = false;
    out.integrations.telegram.token = '';
    out.integrations.telegram.enabled = false;
    out.integrations.discord.webhook = '';
    out.integrations.discord.enabled = false;
    out.bump.enabled = false;
    out.rules = out.rules.map((r) => ({ ...r, enabled: false }));
    out.autoRestore.enabled = false;
    out.inventories = []; // delivery codes are credentials; export them only separately on request.
    return out;
  }
  const api = {
    defaults,
    merge,
    normalize,
    money,
    parseDate,
    template,
    matchRule,
    tableCSV,
    totals,
    safeURL,
    redact,
  };
  root.OblivionCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
