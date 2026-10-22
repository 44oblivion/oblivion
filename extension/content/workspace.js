/* Oblivion workspace — original UI, isolated from the site's CSS and scripts. */
(async function () {
  'use strict';
  if (document.querySelector('#oblivion-workspace')) return;
  const ext = typeof chrome !== 'undefined' ? chrome : browser;
  const C = OblivionCore;
  function pageAccount() {
    try {
      return String(
        JSON.parse(document.querySelector('[data-app-data]')?.getAttribute('data-app-data') || '{}')
          .userId || '',
      );
    } catch {
      return '';
    }
  }
  const request = (command, payload = {}) =>
    new Promise((resolve, reject) => {
      ext.runtime.sendMessage(
        { app: 'oblivion', command, payload, accountId: pageAccount() },
        (response) => {
          if (ext.runtime.lastError) reject(new Error(ext.runtime.lastError.message));
          else if (!response?.ok)
            reject(new Error(response?.error || 'Фоновая страница недоступна.'));
          else resolve(response.result);
        },
      );
    });
  const e = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  function markup(target, html) {
    const parsed = new DOMParser().parseFromString(String(html), 'text/html');
    for (const node of parsed.querySelectorAll('script,iframe,object,embed,link,meta,base,form'))
      node.remove();
    for (const node of parsed.querySelectorAll('*'))
      for (const attr of [...node.attributes]) {
        const key = attr.name.toLowerCase();
        if (key.startsWith('on') || key === 'srcdoc') node.removeAttribute(attr.name);
        if (
          ['href', 'src', 'xlink:href'].includes(key) &&
          !/^(https?:|moz-extension:|safari-web-extension:|data:image\/png;base64,|#)/i.test(
            attr.value,
          )
        )
          node.removeAttribute(attr.name);
      }
    target.replaceChildren(
      ...[...parsed.body.childNodes].map((node) => document.importNode(node, true)),
    );
  }
  const format = (n) =>
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n) || 0);
  const uid = () => crypto.randomUUID();
  const host = document.createElement('div');
  host.id = 'oblivion-workspace';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.append(host);
  const sheet = document.createElement('style');
  try {
    sheet.textContent = await (await fetch(ext.runtime.getURL('content/workspace.css'))).text();
  } catch {
    sheet.textContent =
      ':host{position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#14161c;color:white;padding:20px}';
  }
  shadow.append(sheet);
  const dock = document.createElement('button');
  dock.className = 'dock';
  markup(
    dock,
    '<img width="26" height="26" style="border-radius:8px" src="' +
      ext.runtime.getURL('icons/oblivion.png') +
      '" alt=""> OBLIVION <small>WORKSPACE</small>',
  );
  shadow.append(dock);
  let state,
    me,
    view = 'overview',
    backdrop = null,
    rows = [],
    chatCache = [],
    activeChat = '',
    dialog = null,
    historyType = 'orders';
  let lastFocus = null;
  const pages = [
    ['overview', '◒', 'Обзор'],
    ['chats', '◌', 'Чаты'],
    ['lots', '▦', 'Лоты'],
    ['automation', '↻', 'Автоматизация'],
    ['ai', '✳', 'AI-студия'],
    ['appearance', '◐', 'Оформление'],
    ['notes', '▤', 'Заметки'],
    ['settings', '⚙', 'Настройки'],
  ];
  function toast(message) {
    shadow.querySelector('.toast')?.remove();
    const node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.textContent = message;
    shadow.append(node);
    setTimeout(() => node.remove(), 5000);
  }
  async function busy(button, action) {
    if (button) button.disabled = true;
    try {
      return await action();
    } catch (error) {
      toast(error.message);
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }
  async function patch(value) {
    state.preferences = await request('settings', { patch: value });
    applyAppearance();
  }
  function close() {
    backdrop?.remove();
    backdrop = null;
    dialog = null;
    lastFocus?.focus();
  }
  function button(label, action, cls = '') {
    const node = document.createElement('button');
    node.textContent = label;
    node.className = cls;
    node.onclick = () => busy(node, action);
    return node;
  }
  function download(name, value, type = 'application/json') {
    const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {
      type,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function file(input, callback, json = false) {
    input.onchange = () =>
      busy(null, async () => {
        const item = input.files[0];
        if (!item) return;
        if (item.size > 10_000_000) throw new Error('Файл слишком большой.');
        const text = await item.text();
        await callback(json ? JSON.parse(text) : text);
        input.value = '';
      });
  }
  function formValues(container) {
    return Object.fromEntries(
      [...container.querySelectorAll('[name]')].map((el) => [
        el.name,
        el.type === 'checkbox' ? el.checked : el.value,
      ]),
    );
  }
  function modal(title, html, actions) {
    dialog?.remove();
    dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    markup(
      dialog,
      `<div class="card"><div class="row between"><h2>${e(title)}</h2><button data-close aria-label="Закрыть окно">×</button></div><div data-body>${html}</div><div data-actions class="row"></div></div>`,
    );
    backdrop.querySelector('.shell').append(dialog);
    dialog.querySelector('[data-close]').onclick = () => {
      dialog?.remove();
      dialog = null;
    };
    for (const [label, fn, cls] of actions || [])
      dialog.querySelector('[data-actions]').append(button(label, () => fn(dialog), cls));
    dialog.querySelector('input,textarea,button')?.focus();
    return dialog;
  }
  const field = (name, label, value = '', type = 'text') =>
    `<label>${e(label)}<input type="${type}" name="${e(name)}" value="${e(value)}"></label>`;
  const area = (name, label, value = '') =>
    `<label>${e(label)}<textarea name="${e(name)}">${e(value)}</textarea></label>`;
  const check = (name, label, value) =>
    `<label class="check"><input type="checkbox" name="${e(name)}" ${value ? 'checked' : ''}>${e(label)}</label>`;
  function nativeInput() {
    return document.querySelector(
      '.chat-form textarea[name="content"], .chat textarea[name="content"], textarea[name="content"]',
    );
  }
  function insert(text) {
    const input = nativeInput();
    if (!input) {
      toast('Сначала откройте чат FunPay.');
      return;
    }
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    input.focus();
  }
  function chart(data) {
    const entries = Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-20);
    if (!entries.length) return '<div class="empty">Нет записей с распознанной датой.</div>';
    const max = Math.max(1, ...entries.map(([, n]) => n));
    const coords = entries.map(([, n], i) => [
      20 + (i * 680) / Math.max(1, entries.length - 1),
      140 - (n / max) * 115,
    ]);
    return `<svg class="chart" viewBox="0 0 720 170" role="img" aria-label="Выручка по дням"><line x1="20" y1="140" x2="700" y2="140" stroke="#353a46"/><polyline fill="none" stroke="#c6f36b" stroke-width="3" points="${coords.map((c) => c.join(',')).join(' ')}"/>${coords.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="#c6f36b"><title>${e(entries[i][0])}: ${format(entries[i][1])}</title></circle>`).join('')}<text x="20" y="165">${e(entries[0][0])}</text><text x="610" y="165">${e(entries.at(-1)[0])}</text></svg>`;
  }
  async function open(target) {
    if (target && pages.some((p) => p[0] === target)) view = target;
    if (backdrop) return render();
    lastFocus = document.activeElement;
    try {
      state = await request('state');
    } catch (error) {
      toast(error.message);
      return;
    }
    backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    markup(
      backdrop,
      '<section class="shell" role="dialog" aria-modal="true" aria-label="Oblivion"><aside class="sidebar"></aside><div class="main"><header class="topbar"></header><main class="page"></main></div></section>',
    );
    shadow.append(backdrop);
    backdrop.onclick = (event) => {
      if (event.target === backdrop) close();
    };
    const sidebar = backdrop.querySelector('.sidebar');
    markup(sidebar, '<div class="brand">OBLIVION<span>SELLER WORKSPACE / 0.1</span></div>');
    for (const [id, icon, label] of pages) {
      const b = button(
        '',
        () => {
          view = id;
          render();
        },
        'nav',
      );
      b.dataset.view = id;
      markup(b, `<b>${icon}</b>${label}`);
      sidebar.append(b);
    }
    const footer = document.createElement('div');
    footer.className = 'side-bottom';
    footer.textContent = 'Локальные данные. Ваш рабочий ритм.';
    sidebar.append(footer);
    render();
    backdrop.querySelector('[data-close-workspace]')?.focus();
  }
  function render() {
    if (!backdrop) return;
    backdrop
      .querySelectorAll('.nav')
      .forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    markup(
      backdrop.querySelector('.topbar'),
      `<div><h1>${e(pages.find((p) => p[0] === view)?.[2])}</h1><p>OBLIVION · ${me ? e(me.name) : 'Ваше рабочее пространство FunPay'}</p></div><button data-close-workspace aria-label="Закрыть Oblivion">×</button>`,
    );
    backdrop.querySelector('[data-close-workspace]').onclick = close;
    const page = backdrop.querySelector('.page');
    markup(page, '');
    ({ overview, chats, lots, automation, ai, appearance, notes, settings })[view](page);
  }
  function overview(page) {
    const total = C.totals(rows.filter((r) => r.currency === 'RUB'));
    markup(
      page,
      `<div class="row between"><p>История продаж, покупок и финансов хранится в этом браузере.</p><span class="pill">LOCAL FIRST</span></div><div class="row"><select data-type style="width:180px"><option value="orders">Продажи</option><option value="purchases">Покупки</option><option value="finance">Финансы</option></select><button data-sync class="primary">Обновить историю</button><button data-export>Экспорт CSV</button></div><div class="stats"><div class="card"><span class="eyebrow">Завершённые · RUB</span><b class="metric">${format(total.gross)} ₽</b><span class="muted">Суммы в других валютах не складываются</span></div><div class="card"><span class="eyebrow">Заказы</span><b class="metric">${total.completed}</b><span class="muted">${total.cancelled} отменено</span></div><div class="card"><span class="eyebrow">Средний чек · RUB</span><b class="metric">${format(total.average)} ₽</b><span class="muted">По завершённым заказам</span></div></div><div class="card"><div class="row between"><h2>Динамика выручки</h2><span class="pill">Доступные даты</span></div>${chart(total.byDay)}</div><div class="grid"><div class="card"><div class="row between"><h2>Цели</h2><button data-goal class="mini">Добавить</button></div><div data-goals></div></div><div class="card"><h2>Последние события</h2>${
        state.journal
          .slice(0, 5)
          .map(
            (j) =>
              `<div><span class="muted">${new Date(j.time).toLocaleTimeString('ru')}</span><div>${e(j.message)}</div></div>`,
          )
          .join('') || '<p>Автоматизация пока не запускалась.</p>'
      }</div></div><div class="card"><div class="row between"><h2>История</h2><input data-filter placeholder="Поиск заказа, покупателя, категории…" style="max-width:320px"></div><div data-history class="scroll"></div></div>`,
    );
    page.querySelector('[data-type]').value = historyType;
    const renderRows = () => {
      const term = page.querySelector('[data-filter]').value.toLowerCase();
      const filtered = rows.filter((r) =>
        [r.title, r.orderId, r.buyer, r.category].join(' ').toLowerCase().includes(term),
      );
      markup(
        page.querySelector('[data-history]'),
        filtered.length
          ? `<table><thead><tr><th>Заказ</th><th>Товар</th><th>Покупатель</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>${filtered
              .slice(0, 300)
              .map(
                (r) =>
                  `<tr><td>${e(r.orderId)}</td><td class="title">${e(r.title)}</td><td>${e(r.buyer)}</td><td>${format(r.amount)} ${e(r.currency)}</td><td>${e(r.status)}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<div class="empty">Загрузите историю FunPay или измените фильтр.</div>',
      );
    };
    page.querySelector('[data-filter]').oninput = renderRows;
    renderRows();
    page.querySelector('[data-sync]').onclick = (event) =>
      busy(event.currentTarget, async () => {
        const type = page.querySelector('[data-type]').value;
        historyType = type;
        me = await request('identity');
        const result = await request('sync', { type });
        rows = await request('ledger', { type });
        toast(
          `Обработано записей: ${result.total}${result.more ? '. Достигнут лимит страниц.' : ''}`,
        );
        render();
      });
    page.querySelector('[data-type]').onchange = () =>
      busy(null, async () => {
        historyType = page.querySelector('[data-type]').value;
        rows = await request('ledger', { type: historyType });
        render();
      });
    page.querySelector('[data-export]').onclick = () =>
      download(
        'oblivion-history.csv',
        C.tableCSV(rows, [
          'orderId',
          'title',
          'category',
          'buyer',
          'amount',
          'currency',
          'status',
          'dateLabel',
        ]),
        'text/csv;charset=utf-8',
      );
    page.querySelector('[data-goal]').onclick = () =>
      modal(
        'Новая цель',
        '<div class="list">' +
          field('name', 'Название') +
          field('amount', 'Сумма в RUB', '', 'number') +
          '</div>',
        [
          [
            'Добавить',
            async (d) => {
              const v = formValues(d);
              if (!(Number(v.amount) > 0)) throw new Error('Введите положительную сумму.');
              await patch({
                goals: [
                  ...state.preferences.goals,
                  { id: uid(), name: v.name, amount: Number(v.amount) },
                ],
              });
              d.remove();
              render();
            },
            'primary',
          ],
        ],
      );
    markup(
      page.querySelector('[data-goals]'),
      state.preferences.goals
        .map(
          (g) =>
            `<div style="margin:10px 0"><div class="row between"><span>${e(g.name)}</span><span class="muted">${format(total.gross)} / ${format(g.amount)}</span><button class="mini" data-remove-goal="${e(g.id)}">×</button></div><div class="bar"><i style="width:${Math.min(100, Math.max(0, (total.gross / g.amount) * 100))}%"></i></div></div>`,
        )
        .join('') || '<p>Добавьте цель по выручке.</p>',
    );
    page.querySelectorAll('[data-remove-goal]').forEach(
      (b) =>
        (b.onclick = () =>
          busy(b, async () => {
            await patch({
              goals: state.preferences.goals.filter((g) => g.id !== b.dataset.removeGoal),
            });
            render();
          })),
    );
  }
  function chats(page) {
    markup(
      page,
      `<div class="row"><button data-load class="primary">Загрузить чаты</button><button data-template>Новый шаблон</button><button data-export>Экспорт шаблонов</button><label class="file-label">Импорт шаблонов<input data-import type="file" accept="application/json"></label></div><div class="split"><div class="card"><input data-search placeholder="Найти чат…"><div data-chat-list class="list"></div></div><div class="card"><h2 data-chat-title>Выберите разговор</h2><input data-message-search placeholder="Поиск в загруженных сообщениях"><div data-messages class="messages"></div><textarea data-compose placeholder="Сообщение…"></textarea><div class="row"><button data-send class="primary">Отправить</button><button data-native>Вставить в чат сайта</button><label class="file-label">Картинки<input type="file" data-images accept="image/*" multiple></label></div><span data-image-count class="muted"></span></div></div><div class="card"><h2>Шаблоны</h2><p class="muted">Переменные: {buyer}, {order}, {lot}, {price}, {date}, {time}. Кнопка вставляет текст, отправка — отдельным действием.</p><div data-templates class="list"></div></div>`,
    );
    let images = [],
      messages = [];
    const composer = page.querySelector('[data-compose]');
    const drawMessages = () => {
      const term = page.querySelector('[data-message-search]').value.toLowerCase();
      markup(
        page.querySelector('[data-messages]'),
        messages
          .filter((m) => m.text.toLowerCase().includes(term))
          .map(
            (m, i) =>
              `<div class="bubble ${m.own ? 'own' : ''}"><small>${e(m.name || (m.own ? 'Вы' : 'Событие'))}</small>${e(m.text)}<div class="row"><button class="mini" data-quote="${i}">Ответить</button><button class="mini" data-translate="${i}">Перевести</button></div></div>`,
          )
          .join('') || '<div class="empty">Сообщений нет.</div>',
      );
      const shown = messages.filter((m) => m.text.toLowerCase().includes(term));
      page.querySelectorAll('[data-quote]').forEach(
        (b) =>
          (b.onclick = () => {
            composer.value = '> ' + shown[Number(b.dataset.quote)].text + '\n\n';
            composer.focus();
          }),
      );
      page.querySelectorAll('[data-translate]').forEach(
        (b) =>
          (b.onclick = () =>
            busy(b, async () => {
              const result = await request('ai', {
                task: 'translate',
                prompt: shown[Number(b.dataset.translate)].text,
                language: 'Russian',
              });
              modal('Перевод', '<p class="output">' + e(result.text) + '</p>');
            })),
      );
    };
    const drawChats = () => {
      const term = page.querySelector('[data-search]').value.toLowerCase();
      const list = page.querySelector('[data-chat-list]');
      markup(list, '');
      for (const chat of chatCache.filter((c) => c.name.toLowerCase().includes(term))) {
        const b = button(
          '',
          async () => {
            activeChat = chat.id;
            page.querySelector('[data-chat-title]').textContent = chat.name;
            const result = await request('messages', { id: chat.id });
            messages = result.messages;
            drawMessages();
          },
          'item',
        );
        markup(
          b,
          `<b>${e(chat.name)} ${chat.unread ? '●' : ''}</b><span class="muted">${e(chat.snippet.slice(0, 80))}</span>`,
        );
        list.append(b);
      }
    };
    page.querySelector('[data-load]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        chatCache = await request('chats');
        drawChats();
      });
    page.querySelector('[data-search]').oninput = drawChats;
    page.querySelector('[data-message-search]').oninput = drawMessages;
    drawChats();
    page.querySelector('[data-images]').onchange = (event) =>
      busy(null, async () => {
        const files = [...event.target.files];
        if (files.length > 10) throw new Error('Не более 10 изображений.');
        images = await Promise.all(
          files.map((f) => {
            if (f.size > 7_000_000) throw new Error('Изображение больше 7 МБ.');
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(f);
            });
          }),
        );
        page.querySelector('[data-image-count]').textContent = 'Изображений: ' + images.length;
      });
    page.querySelector('[data-send]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        if (!activeChat) throw new Error('Выберите чат.');
        if (!composer.value.trim() && !images.length) return;
        await request('send', { id: activeChat, text: composer.value, images });
        composer.value = '';
        images = [];
        page.querySelector('[data-image-count]').textContent = '';
        toast('Отправлено.');
      });
    page.querySelector('[data-native]').onclick = () => insert(composer.value);
    page.querySelector('[data-template]').onclick = () =>
      modal('Шаблон ответа', field('name', 'Название') + area('text', 'Текст'), [
        [
          'Сохранить',
          async (d) => {
            const v = formValues(d);
            if (!v.name || !v.text) throw new Error('Заполните название и текст.');
            await patch({ templates: [...state.preferences.templates, { id: uid(), ...v }] });
            d.remove();
            render();
          },
          'primary',
        ],
      ]);
    const list = page.querySelector('[data-templates]');
    for (const item of state.preferences.templates) {
      const row = document.createElement('div');
      row.className = 'row';
      row.append(
        button(item.name, () => {
          composer.value = C.template(item.text, {
            buyer: chatCache.find((c) => c.id === activeChat)?.name || '',
          });
          composer.focus();
        }),
        button(
          'Удалить',
          async () => {
            await patch({ templates: state.preferences.templates.filter((t) => t.id !== item.id) });
            render();
          },
          'mini',
        ),
      );
      list.append(row);
    }
    page.querySelector('[data-export]').onclick = () =>
      download('oblivion-templates.json', {
        format: 'oblivion-templates',
        templates: state.preferences.templates,
      });
    file(
      page.querySelector('[data-import]'),
      async (data) => {
        if (
          data.format !== 'oblivion-templates' ||
          !Array.isArray(data.templates) ||
          data.templates.some((t) => typeof t.name !== 'string' || typeof t.text !== 'string')
        )
          throw new Error('Неверный файл шаблонов.');
        await patch({
          templates: data.templates.map((t) => ({ id: uid(), name: t.name, text: t.text })),
        });
        render();
      },
      true,
    );
  }
  function lots(page) {
    const found = [
      ...document.querySelectorAll('a[href*="/lots/offer?"], a[href*="/lots/offerEdit?"]'),
    ]
      .map((a) => {
        const url = new URL(a.href);
        const id = url.searchParams.get('id') || url.searchParams.get('offer');
        const title =
          a.querySelector('.tc-desc-text, .tc-desc, .offer-tc-desc')?.textContent.trim() ||
          a.textContent.trim();
        return {
          id,
          title,
          price: C.money(a.querySelector('.tc-price, .offer-tc-price')?.textContent),
          href: a.href,
        };
      })
      .filter((item, i, all) => item.id && all.findIndex((other) => other.id === item.id) === i)
      .sort(
        (a, b) =>
          Number(state.preferences.pins.includes(b.id)) -
          Number(state.preferences.pins.includes(a.id)),
      );
    const prices = found
      .map((x) => x.price)
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    markup(
      page,
      `<div class="note">Откройте профиль или категорию FunPay: здесь появятся лоты с текущей страницы. Сохранение и клонирование доступны для собственных лотов.</div><div class="row"><input data-lot-id placeholder="ID своего лота" style="width:200px"><button data-edit class="primary">Редактировать</button><button data-categories>Поднять категории</button><button data-bulk>Массовая цена</button><button data-export>Экспорт лотов</button><label class="file-label">Импорт изменений<input data-import type="file" accept="application/json"></label></div><div class="stats"><div class="card"><span class="eyebrow">Лотов на странице</span><b class="metric">${found.length}</b></div><div class="card"><span class="eyebrow">Минимальная цена</span><b class="metric">${format(prices[0])}</b></div><div class="card"><span class="eyebrow">Медиана цены</span><b class="metric">${format(prices.length ? prices[Math.floor(prices.length / 2)] : 0)}</b></div></div><div class="card"><input data-search placeholder="Поиск лота…"><div data-lots class="scroll"></div></div>`,
    );
    const selected = new Set();
    const draw = () => {
      const term = page.querySelector('[data-search]').value.toLowerCase();
      markup(
        page.querySelector('[data-lots]'),
        `<table><thead><tr><th></th><th>Лот</th><th>Цена</th><th></th></tr></thead><tbody>${found
          .filter((l) => l.title.toLowerCase().includes(term))
          .map(
            (l) =>
              `<tr><td><input type="checkbox" data-select="${e(l.id)}" ${selected.has(l.id) ? 'checked' : ''}></td><td class="title"><a href="${e(l.href)}" target="_blank" rel="noopener">${e(l.title)}</a><div class="muted">${e(state.preferences.lotNotes[l.id] || '')}</div></td><td>${format(l.price)}</td><td><button class="mini" data-edit-id="${e(l.id)}">Изменить</button> <button class="mini" data-pin="${e(l.id)}">${state.preferences.pins.includes(l.id) ? '★' : '☆'}</button></td></tr>`,
          )
          .join('')}</tbody></table>`,
      );
      page
        .querySelectorAll('[data-select]')
        .forEach(
          (b) =>
            (b.onchange = () =>
              b.checked ? selected.add(b.dataset.select) : selected.delete(b.dataset.select)),
        );
      page
        .querySelectorAll('[data-edit-id]')
        .forEach((b) => (b.onclick = () => editLot(b.dataset.editId)));
      page.querySelectorAll('[data-pin]').forEach(
        (b) =>
          (b.onclick = () =>
            busy(b, async () => {
              const id = b.dataset.pin;
              await patch({
                pins: state.preferences.pins.includes(id)
                  ? state.preferences.pins.filter((x) => x !== id)
                  : [...state.preferences.pins, id],
              });
              draw();
            })),
      );
    };
    draw();
    page.querySelector('[data-search]').oninput = draw;
    page.querySelector('[data-edit]').onclick = () =>
      busy(null, () => editLot(page.querySelector('[data-lot-id]').value.trim()));
    async function editLot(id) {
      const lot = await request('lot', { id });
      const editable = lot.fields.filter(([key]) =>
        /^(price|amount)$|^fields\[(summary|desc)\]/.test(key),
      );
      const labels = (key) =>
        key === 'price'
          ? 'Цена'
          : key === 'amount'
            ? 'Количество'
            : (key.includes('[summary]') ? 'Название' : 'Описание') +
              (key.includes('[en]') ? ' · EN' : ' · RU');
      modal(
        'Редактирование лота ' + id,
        '<div class="list">' +
          editable
            .map(([key, value]) =>
              key.includes('desc') ? area(key, labels(key), value) : field(key, labels(key), value),
            )
            .join('') +
          area('localNote', 'Личная заметка', state.preferences.lotNotes[id] || '') +
          '<p class="muted">Клонирование создаёт новый лот с теми же параметрами категории.</p></div>',
        [
          [
            'Сохранить',
            async (d) => {
              const v = formValues(d);
              await request('lotSave', { id, changes: v });
              await patch({ lotNotes: { ...state.preferences.lotNotes, [id]: v.localNote } });
              d.remove();
              toast('FunPay принял изменения.');
            },
            'primary',
          ],
          [
            'Клонировать',
            async (d) => {
              await request('lotSave', { id, changes: formValues(d), duplicate: true });
              toast('Запрос клонирования принят. Проверьте профиль.');
            },
          ],
          [
            'Экспорт',
            async () =>
              download('oblivion-lot-' + id + '.json', { format: 'oblivion-lots', lots: [lot] }),
          ],
        ],
      );
    }
    page.querySelector('[data-categories]').onclick = (event) =>
      busy(event.currentTarget, async () => {
        const categories = await request('categories');
        const d = modal('Поднятие категорий', '<div data-list class="list"></div>');
        for (const c of categories)
          d.querySelector('[data-list]').append(
            button(c.name, async () => {
              await request('raise', { category: c });
              toast('FunPay принял запрос.');
            }),
          );
      });
    page.querySelector('[data-bulk]').onclick = () => {
      if (!selected.size) return toast('Выберите свои лоты галочками.');
      modal(
        'Цена для ' + selected.size + ' лотов',
        field('delta', 'Изменение цены в процентах', '0', 'number') +
          '<p class="muted">Например, 5 повышает цену на 5%, −5 снижает. Выполняется последовательно, без автоматического повтора ошибок.</p>',
        [
          [
            'Применить',
            async (d) => {
              const delta = Number(formValues(d).delta);
              if (!Number.isFinite(delta) || delta < -99 || delta > 1000)
                throw new Error('Укажите процент от −99 до 1000.');
              for (const id of selected) {
                const lot = await request('lot', { id });
                const price = Math.round(C.money(lot.price) * (1 + delta / 100) * 100) / 100;
                await request('lotSave', { id, changes: { price } });
              }
              d.remove();
              toast('Цены обработаны. Перезагрузите страницу.');
            },
            'primary',
          ],
        ],
      );
    };
    page.querySelector('[data-export]').onclick = (event) =>
      busy(event.currentTarget, async () => {
        const items = [];
        for (const id of selected.size ? selected : found.map((l) => l.id))
          items.push(await request('lot', { id }));
        download('oblivion-lots.json', { format: 'oblivion-lots', lots: items });
      });
    file(
      page.querySelector('[data-import]'),
      async (data) => {
        if (data.format !== 'oblivion-lots' || !Array.isArray(data.lots) || data.lots.length > 100)
          throw new Error('Неверный файл лотов.');
        modal(
          'Импорт ' + data.lots.length + ' лотов',
          '<p>Изменения применятся к исходным ID ваших лотов. Проверьте резервную копию перед продолжением. Новые лоты эта операция не создаёт.</p>',
          [
            [
              'Применить изменения',
              async (d) => {
                for (const item of data.lots) {
                  if (!item.id || !Array.isArray(item.fields))
                    throw new Error('Неверная запись лота.');
                  await request('lotSave', {
                    id: item.id,
                    changes: Object.fromEntries(item.fields),
                  });
                }
                d.remove();
                toast('Импорт завершён.');
              },
              'primary',
            ],
          ],
        );
      },
      true,
    );
  }
  function automation(page) {
    const prefs = state.preferences;
    markup(
      page,
      `<div class="note">Правила обрабатывают только новые события после первого фонового прохода. Автовыдача резервирует товар до отправки; при неопределённом ответе повторная выдача блокируется до ручной проверки.</div><div class="grid"><div class="card"><h2>Поднятие лотов</h2>${check('bumpEnabled', 'Поднимать собственные категории по расписанию', prefs.bump.enabled)}${field('interval', 'Интервал, минут (минимум 5)', prefs.bump.interval, 'number')}<div class="row"><button data-bump-save class="primary">Сохранить</button><button data-cycle>Проверить сейчас</button></div><p class="muted">Таймер FunPay имеет приоритет. Неудачные запросы не повторяются немедленно.</p></div><div class="card"><div class="row between"><h2>Автоответчик</h2><button data-new-rule class="mini">Добавить правило</button></div><div data-rules class="list"></div></div></div><div class="card"><div class="row between"><h2>Автовыдача</h2><button data-new-stock>Добавить склад</button></div><p class="muted">Товары хранятся локально и исключены из обычного экспорта настроек. Резервирование выполняется до отправки.</p><div data-stock class="list"></div></div><div class="card"><div class="row between"><h2>Состояние лотов по расписанию</h2><button data-schedule>Запланировать</button></div>${check('restoreEnabled', 'Включить запланированные изменения', prefs.autoRestore.enabled)}<div data-schedules class="list"></div><button data-restore-save>Сохранить расписание</button></div><div class="card"><h2>Журнал</h2><div class="scroll"><table><thead><tr><th>Время</th><th>Событие</th></tr></thead><tbody>${state.journal.map((j) => `<tr><td>${e(new Date(j.time).toLocaleString('ru'))}</td><td>${e(j.message)}</td></tr>`).join('')}</tbody></table></div></div>`,
    );
    page.querySelector('[data-bump-save]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        await patch({
          bump: {
            enabled: page.querySelector('[name=bumpEnabled]').checked,
            interval: Number(page.querySelector('[name=interval]').value),
          },
        });
        toast('Расписание сохранено.');
      });
    page.querySelector('[data-cycle]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        await request('cycle');
        state = await request('state');
        render();
      });
    page.querySelector('[data-new-rule]').onclick = () =>
      modal(
        'Новое правило',
        '<div class="list">' +
          field('name', 'Название') +
          field('keywords', 'Слова через запятую (пусто — любое сообщение)') +
          area('reply', 'Ответ') +
          check('enabled', 'Включить правило', false) +
          '</div>',
        [
          [
            'Сохранить',
            async (d) => {
              const v = formValues(d);
              if (!v.reply.trim()) throw new Error('Введите ответ.');
              await patch({ rules: [...prefs.rules, { id: uid(), ...v }] });
              d.remove();
              render();
            },
            'primary',
          ],
        ],
      );
    const ruleList = page.querySelector('[data-rules]');
    for (const rule of prefs.rules) {
      const row = document.createElement('div');
      row.className = 'row';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = rule.enabled;
      toggle.setAttribute('aria-label', 'Включить правило ' + rule.name);
      toggle.onchange = () =>
        busy(toggle, () =>
          patch({
            rules: prefs.rules.map((r) =>
              r.id === rule.id ? { ...r, enabled: toggle.checked } : r,
            ),
          }),
        );
      const title = document.createElement('span');
      title.textContent = rule.name || rule.keywords || 'Любое сообщение';
      row.append(
        toggle,
        title,
        button(
          'Удалить',
          async () => {
            await patch({ rules: prefs.rules.filter((r) => r.id !== rule.id) });
            render();
          },
          'mini',
        ),
      );
      ruleList.append(row);
    }
    page.querySelector('[data-new-stock]').onclick = () =>
      modal(
        'Склад автовыдачи',
        '<div class="list">' +
          field('name', 'Название склада') +
          field('match', 'Фрагмент названия товара в заказе') +
          area('items', 'Товары: одна строка — одна выдача') +
          area('message', 'Сообщение: {lot} заменится товаром', 'Спасибо за покупку!\n{lot}') +
          check('enabled', 'Разрешить выдачу новым оплаченным заказам', false) +
          '</div>',
        [
          [
            'Создать склад',
            async (d) => {
              const v = formValues(d);
              const items = v.items
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);
              if (!v.match.trim() || !items.length || !v.message.includes('{lot}'))
                throw new Error('Укажите товар, склад и переменную {lot}.');
              await patch({
                inventories: [
                  ...prefs.inventories,
                  {
                    id: uid(),
                    name: v.name,
                    match: v.match,
                    items,
                    message: v.message,
                    enabled: v.enabled,
                    reservations: [],
                  },
                ],
              });
              d.remove();
              render();
            },
            'primary',
          ],
        ],
      );
    const stockList = page.querySelector('[data-stock]');
    for (const stock of prefs.inventories) {
      const card = document.createElement('div');
      card.className = 'card';
      markup(
        card,
        `<div class="row between"><b>${e(stock.name)}</b><span class="pill">Остаток ${stock.items.length}</span></div><p>${e(stock.match)}</p><div data-stock-actions class="row"></div><div class="muted">${(stock.reservations || []).map((r) => 'Заказ ' + e(r.order) + ': ' + e(r.status)).join('<br>') || 'Выдач пока нет.'}</div>`,
      );
      card.querySelector('[data-stock-actions]').append(
        button(stock.enabled ? 'Приостановить' : 'Включить', async () => {
          await patch({
            inventories: prefs.inventories.map((i) =>
              i.id === stock.id ? { ...i, enabled: !i.enabled } : i,
            ),
          });
          render();
        }),
        button('Пополнить', () =>
          modal('Пополнение склада', area('items', 'Новые товары, по одному на строку'), [
            [
              'Добавить',
              async (d) => {
                const values = formValues(d)
                  .items.split(/\r?\n/)
                  .map((x) => x.trim())
                  .filter(Boolean);
                await patch({
                  inventories: prefs.inventories.map((i) =>
                    i.id === stock.id ? { ...i, items: [...i.items, ...values] } : i,
                  ),
                });
                d.remove();
                render();
              },
              'primary',
            ],
          ]),
        ),
      );
      for (const reservation of stock.reservations || []) {
        if (!['uncertain', 'reserved'].includes(reservation.status)) continue;
        card.querySelector('[data-stock-actions]').append(
          button(
            'Проверить заказ ' + reservation.order,
            () =>
              modal(
                'Проверка выдачи',
                `<p>Откройте заказ ${e(reservation.order)} и убедитесь, был ли товар отправлен. Зарезервированная строка:</p><pre class="output">${e(reservation.value)}</pre>`,
                [
                  [
                    'Отметить выданным',
                    async (d) => {
                      await request('resolveDelivery', {
                        stock: stock.id,
                        order: reservation.order,
                        delivered: true,
                      });
                      state = await request('state');
                      d.remove();
                      render();
                    },
                  ],
                  [
                    'Вернуть на склад',
                    async (d) => {
                      await request('resolveDelivery', {
                        stock: stock.id,
                        order: reservation.order,
                        delivered: false,
                      });
                      state = await request('state');
                      d.remove();
                      render();
                    },
                  ],
                ],
              ),
            'mini',
          ),
        );
      }
      stockList.append(card);
    }
    page.querySelector('[data-schedule]').onclick = () =>
      modal(
        'Запланировать изменение',
        '<div class="list">' +
          field('lot', 'ID своего лота') +
          field('at', 'Дата и время', '', 'datetime-local') +
          check('active', 'Включить лот (иначе отключить)', true) +
          '</div>',
        [
          [
            'Добавить',
            async (d) => {
              const v = formValues(d);
              const at = new Date(v.at).getTime();
              if (!/^\d+$/.test(v.lot) || !Number.isFinite(at) || at <= Date.now())
                throw new Error('Укажите ID лота и время в будущем.');
              await patch({
                autoRestore: {
                  schedule: [
                    ...prefs.autoRestore.schedule,
                    { id: uid(), lot: v.lot, at, active: v.active, enabled: true, done: false },
                  ],
                },
              });
              d.remove();
              render();
            },
            'primary',
          ],
        ],
      );
    markup(
      page.querySelector('[data-schedules]'),
      prefs.autoRestore.schedule
        .map(
          (i) =>
            `<div class="row between"><span>Лот ${e(i.lot)} · ${e(new Date(i.at).toLocaleString('ru'))} · ${i.active ? 'включить' : 'отключить'} · ${i.done ? 'обработан' : 'ожидает'}</span><button class="mini" data-remove-schedule="${e(i.id)}">Удалить</button></div>`,
        )
        .join('') || '<p>Расписание пусто.</p>',
    );
    page.querySelectorAll('[data-remove-schedule]').forEach(
      (b) =>
        (b.onclick = () =>
          busy(b, async () => {
            await patch({
              autoRestore: {
                schedule: prefs.autoRestore.schedule.filter(
                  (i) => i.id !== b.dataset.removeSchedule,
                ),
              },
            });
            render();
          })),
    );
    page.querySelector('[data-restore-save]').onclick = () =>
      busy(null, async () => {
        await patch({
          autoRestore: { enabled: page.querySelector('[name=restoreEnabled]').checked },
        });
        toast('Сохранено.');
      });
  }
  function ai(page) {
    markup(
      page,
      `<div class="note">В AI отправляется только текст, который вы вводите здесь или явно выбираете для перевода. Переписка не загружается провайдеру автоматически. Ключ и разрешение на отправку задаются в настройках.</div><div class="grid"><div class="card"><h2>Текстовая студия</h2><label>Задача<select name="task"><option value="reply">Ответ покупателю</option><option value="lot">Название и описание лота</option><option value="rewrite">Улучшить текст</option><option value="translate">Перевести</option><option value="review">Ответить на отзыв</option><option value="audit">Проверить описание магазина</option><option value="image">Создать изображение · OpenAI</option></select></label>${field('language', 'Язык перевода', 'English')}${area('prompt', 'Исходный текст или описание задачи')}<button data-generate class="primary">Сгенерировать</button></div><div class="card"><h2>Результат</h2><div data-output class="output muted">Ответ появится здесь.</div><div class="row"><button data-copy>Копировать</button><button data-insert>Вставить в чат</button><button data-save>Сохранить</button></div></div></div>`,
    );
    let result;
    page.querySelector('[data-generate]').onclick = (event) =>
      busy(event.currentTarget, async () => {
        const v = formValues(page);
        result = await request('ai', { task: v.task, prompt: v.prompt, language: v.language });
        const output = page.querySelector('[data-output]');
        markup(output, '');
        output.classList.remove('muted');
        if (result.image) {
          const image = document.createElement('img');
          image.className = 'preview';
          image.alt = 'Изображение, созданное по вашему запросу';
          if (!result.image.startsWith('data:image/png;base64,'))
            throw new Error('Провайдер вернул неподдерживаемый формат изображения.');
          image.src = result.image;
          output.append(image);
        } else output.textContent = result.text || 'Провайдер вернул пустой ответ.';
      });
    page.querySelector('[data-copy]').onclick = () =>
      busy(null, async () => {
        if (!result?.text) throw new Error('Сначала получите текстовый ответ.');
        await navigator.clipboard.writeText(result.text);
        toast('Скопировано.');
      });
    page.querySelector('[data-insert]').onclick = () => {
      if (result?.text) insert(result.text);
    };
    page.querySelector('[data-save]').onclick = () => {
      if (result?.text) download('oblivion-answer.txt', result.text, 'text/plain');
      if (result?.image) {
        const a = document.createElement('a');
        a.href = result.image;
        a.download = 'oblivion-image.png';
        a.click();
      }
    };
  }
  function appearance(page) {
    const a = state.preferences.appearance;
    const presets = [
      { name: 'Orbit', mode: 'dark', accent: '#c6f36b' },
      { name: 'Polar', mode: 'light', accent: '#2464e8' },
      { name: 'Violet', mode: 'dark', accent: '#b8a0ff' },
      { name: 'Amber', mode: 'dark', accent: '#ffd28e' },
    ];
    markup(
      page,
      `<div class="card"><h2>Темы Oblivion</h2><div data-presets class="row"></div><div class="row"><button data-export>Экспорт темы</button><label class="file-label">Импорт темы<input data-import type="file" accept="application/json"></label></div></div><div class="grid"><div class="card"><h2>Внешний вид FunPay</h2><label>Тема<select name="mode"><option value="system">Как в системе</option><option value="dark">Тёмная</option><option value="light">Светлая</option><option value="original">Оригинальная FunPay</option></select></label>${field('accent', 'Акцентный цвет', a.accent, 'color')}<label>Шрифт<select name="font"><option value="system-ui">Системный</option><option value="Georgia">Georgia</option><option value="monospace">Моноширинный</option></select></label>${field('size', 'Размер текста', a.size, 'number')}<label>Плотность<select name="density"><option value="normal">Обычная</option><option value="compact">Компактная</option></select></label>${check('hideBalance', 'Скрыть баланс на странице', a.hideBalance)}${check('cursor', 'Орбитальный курсор', a.cursor)}<button data-save class="primary">Применить</button></div><div class="card"><h2>Свой фон и звук</h2><p class="muted">Файлы остаются в локальном хранилище. Для звука Safari/Firefox может потребоваться клик по странице.</p><label class="file-label">Выбрать фон<input data-background type="file" accept="image/*"></label><button data-clear-background>Убрать фон</button><label class="file-label">Выбрать звук<input data-sound type="file" accept="audio/*"></label><label>Громкость<input name="volume" type="range" min="0" max="1" step="0.05" value="${a.volume}"></label><div class="row"><button data-play>Прослушать</button><button data-clear-sound>Стандартный звук</button></div><details><summary>Свой CSS</summary>${area('css', 'CSS для страницы FunPay', a.css)}<button data-css>Применить CSS</button></details></div></div>`,
    );
    page.querySelector('[name=mode]').value = a.mode;
    page.querySelector('[name=font]').value = a.font;
    page.querySelector('[name=density]').value = a.density;
    for (const preset of presets)
      page.querySelector('[data-presets]').append(
        button(preset.name, async () => {
          await patch({ appearance: { mode: preset.mode, accent: preset.accent } });
          render();
        }),
      );
    page.querySelector('[data-save]').onclick = (event) =>
      busy(event.currentTarget, async () => {
        const v = formValues(page);
        await patch({
          appearance: {
            mode: v.mode,
            accent: v.accent,
            font: v.font,
            size: Number(v.size),
            density: v.density,
            cursor: v.cursor,
            hideBalance: v.hideBalance,
            volume: Number(v.volume),
          },
        });
        toast('Оформление применено.');
      });
    const readMedia = (selector, key, max, mime) => {
      page.querySelector(selector).onchange = (event) =>
        busy(null, async () => {
          const f = event.target.files[0];
          if (!f) return;
          if (!f.type.startsWith(mime) || f.size > max)
            throw new Error('Неподдерживаемый тип или слишком большой файл.');
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(f);
          });
          await patch({ appearance: { [key]: data } });
          toast('Файл сохранён локально.');
        });
    };
    readMedia('[data-background]', 'background', 3_000_000, 'image/');
    readMedia('[data-sound]', 'sound', 2_000_000, 'audio/');
    page.querySelector('[data-clear-background]').onclick = () =>
      busy(null, () => patch({ appearance: { background: '' } }));
    page.querySelector('[data-clear-sound]').onclick = () =>
      busy(null, () => patch({ appearance: { sound: '' } }));
    page.querySelector('[data-play]').onclick = (event) =>
      busy(event.currentTarget, async () => {
        if (!state.preferences.appearance.sound) throw new Error('Сначала выберите свой звук.');
        const audio = new Audio(state.preferences.appearance.sound);
        audio.volume = Number(page.querySelector('[name=volume]').value);
        await audio.play();
      });
    page.querySelector('[data-css]').onclick = () =>
      busy(null, () => patch({ appearance: { css: page.querySelector('[name=css]').value } }));
    page.querySelector('[data-export]').onclick = () =>
      download('oblivion-theme.json', {
        format: 'oblivion-theme',
        appearance: state.preferences.appearance,
      });
    file(
      page.querySelector('[data-import]'),
      async (value) => {
        if (value.format !== 'oblivion-theme') throw new Error('Неверный формат темы.');
        await patch({ appearance: C.normalize({ appearance: value.appearance }).appearance });
        render();
      },
      true,
    );
  }
  function notes(page) {
    markup(
      page,
      `<div class="grid"><div class="card"><h2>Заметки о покупателе</h2>${field('user', 'ID пользователя FunPay')}${area('note', 'Личная заметка')}<div class="row"><button data-note-read>Открыть</button><button data-note-save class="primary">Сохранить</button></div><p class="muted">Заметки видны только вам, хранятся в браузере и не публикуются на FunPay.</p></div><div class="card"><h2>Чёрный список автоматизации</h2><p class="muted">Автоответы пользователям из списка отключены. Сам FunPay не блокирует этих людей.</p>${field('blocked', 'ID пользователей через запятую', state.preferences.blocked.join(', '))}<button data-blocked-save>Сохранить</button><h2>Калькулятор валют</h2>${field('amount', 'Сумма', '100', 'number')}<div class="row"><select name="from">${Object.keys(
        state.preferences.currency.rates,
      )
        .map((c) => `<option>${e(c)}</option>`)
        .join('')}</select><span>→</span><select name="to">${Object.keys(
        state.preferences.currency.rates,
      )
        .map((c) => `<option>${e(c)}</option>`)
        .join(
          '',
        )}</select></div><b data-result class="metric"></b><p class="muted">Используются ваши ручные курсы из настроек. Это не текущие рыночные котировки.</p></div></div><div class="card"><h2>Сохранённые заметки</h2><div class="list">${
        Object.entries(state.preferences.notes)
          .map(([id, text]) => `<div><b>${e(id)}</b><p>${e(text)}</p></div>`)
          .join('') || '<p>Заметок пока нет.</p>'
      }</div></div>`,
    );
    page.querySelector('[data-note-read]').onclick = () => {
      page.querySelector('[name=note]').value =
        state.preferences.notes[page.querySelector('[name=user]').value.trim()] || '';
    };
    page.querySelector('[data-note-save]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        const v = formValues(page);
        if (!/^\d+$/.test(v.user)) throw new Error('Введите числовой ID.');
        await patch({ notes: { ...state.preferences.notes, [v.user]: v.note } });
        toast('Заметка сохранена.');
      });
    page.querySelector('[data-blocked-save]').onclick = () =>
      busy(null, async () => {
        const values = page
          .querySelector('[name=blocked]')
          .value.split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        if (values.some((v) => !/^\d+$/.test(v))) throw new Error('Укажите числовые ID.');
        await patch({ blocked: [...new Set(values)] });
        toast('Список сохранён.');
      });
    const calculate = () => {
      const v = formValues(page);
      const rates = state.preferences.currency.rates;
      page.querySelector('[data-result]').textContent =
        format((C.money(v.amount) * rates[v.from]) / rates[v.to]) + ' ' + v.to;
    };
    page.querySelector('[name=to]').value = 'USD';
    page
      .querySelectorAll('[name=amount],[name=from],[name=to]')
      .forEach((n) => (n.oninput = calculate));
    calculate();
  }
  function settings(page) {
    const prefs = state.preferences,
      ai = prefs.ai,
      tg = prefs.integrations.telegram,
      dc = prefs.integrations.discord;
    markup(
      page,
      `<div class="grid"><div class="card" data-ai-card><h2>AI-провайдер</h2><label>Провайдер<select name="provider"><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="gemini">Google Gemini</option></select></label>${field('model', 'Модель', ai.model)}${field('key', 'API-ключ (локальное хранение)', ai.key, 'password')}${check('consent', 'Разрешаю отправлять введённый мной текст выбранному AI-провайдеру. Могут действовать его тарифы.', ai.consent)}<div class="row"><button data-ai-save class="primary">Сохранить</button><button data-ai-permission>Разрешить сервис</button></div></div><div class="card"><h2>Telegram и Discord</h2>${check('telegramEnabled', 'Отправлять уведомления в Telegram', tg.enabled)}${field('token', 'Токен Telegram-бота', tg.token, 'password')}${field('chat', 'ID вашего чата Telegram', tg.chat)}<p class="muted">Команды бота: /stats, /pause, /help. Обрабатываются только из указанного чата.</p>${check('discordEnabled', 'Отправлять уведомления в Discord', dc.enabled)}${field('webhook', 'Discord webhook', dc.webhook, 'password')}<p class="muted">При включении имена покупателей и фрагменты сообщений передаются выбранному сервису.</p><div class="row"><button data-integrations-save>Сохранить</button><button data-notify-permission>Разрешить сервисы</button><button data-test>Тест</button></div></div></div><div class="grid"><div class="card"><h2>Резервная копия</h2><p>Ключи, токены и склад автовыдачи исключены из обычной копии. Автоматизация при импорте выключается.</p><div class="row"><button data-backup>Экспорт настроек</button><label class="file-label">Импорт настроек<input data-restore type="file" accept="application/json"></label></div></div><div class="card"><h2>Курсы валют вручную</h2>${Object.entries(
        prefs.currency.rates,
      )
        .map(([key, value]) => field('rate-' + key, 'RUB за 1 ' + key, value, 'number'))
        .join(
          '',
        )}<button data-rates>Сохранить курсы</button></div></div><div class="card"><h2>Oblivion 0.1.0 · Firefox</h2><p>Независимая реализация для FunPay. Работа фоновых задач требует запущенного браузера и действующей сессии. Поддержку функций и ограничения смотрите в README репозитория.</p><div class="row"><button data-data-consent>Разрешить передачу данных сервисам</button><button data-identity>Проверить вход FunPay</button><button data-pause class="danger">Остановить всю автоматизацию</button></div><p class="muted">Горячая клавиша: Alt+Shift+O. Escape закрывает рабочее пространство.</p></div>`,
    );
    page.querySelector('[name=provider]').value = ai.provider;
    page.querySelector('[data-ai-save]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        const v = formValues(page.querySelector('[data-ai-card]'));
        await patch({ ai: v });
        toast('AI-настройки сохранены.');
      });
    const permit = (button, origins) => {
      button.disabled = true;
      ext.permissions.request({ origins: origins.map((origin) => origin + '/*') }, (granted) => {
        button.disabled = false;
        toast(granted ? 'Доступ разрешён.' : 'Доступ не предоставлен.');
      });
    };
    page.querySelector('[data-ai-permission]').onclick = (ev) => {
      const provider = page.querySelector('[name=provider]').value;
      permit(ev.currentTarget, [
        {
          openai: 'https://api.openai.com',
          openrouter: 'https://openrouter.ai',
          gemini: 'https://generativelanguage.googleapis.com',
        }[provider],
      ]);
    };
    page.querySelector('[data-notify-permission]').onclick = (ev) => {
      const v = formValues(page);
      const origins = [];
      if (v.telegramEnabled) origins.push('https://api.telegram.org');
      if (v.discordEnabled) origins.push('https://discord.com');
      if (origins.length) permit(ev.currentTarget, origins);
      else toast('Сначала выберите сервис.');
    };
    page.querySelector('[data-integrations-save]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        const v = formValues(page);
        await patch({
          integrations: {
            telegram: { enabled: v.telegramEnabled, token: v.token, chat: v.chat },
            discord: { enabled: v.discordEnabled, webhook: v.webhook },
          },
        });
        toast('Интеграции сохранены.');
      });
    page.querySelector('[data-test]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        await request('notifyTest');
        toast('Проверка завершена. Проверьте журнал и выбранный канал.');
      });
    page.querySelector('[data-backup]').onclick = (ev) =>
      busy(ev.currentTarget, async () => download('oblivion-backup.json', await request('backup')));
    file(
      page.querySelector('[data-restore]'),
      async (backup) => {
        await request('restore', { backup });
        state = await request('state');
        applyAppearance();
        render();
        toast('Импорт выполнен. Автоматизация выключена.');
      },
      true,
    );
    page.querySelector('[data-rates]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        const rates = Object.fromEntries(
          Object.keys(prefs.currency.rates).map((key) => [
            key,
            Number(page.querySelector('[name="rate-' + key + '"]').value),
          ]),
        );
        if (Object.values(rates).some((v) => !Number.isFinite(v) || v <= 0))
          throw new Error('Курсы должны быть положительными.');
        rates.RUB = 1;
        await patch({ currency: { rates } });
        toast('Курсы сохранены.');
      });
    page.querySelector('[data-data-consent]').onclick = (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      ext.permissions.request(
        {
          data_collection: [
            'websiteContent',
            'personalCommunications',
            'authenticationInfo',
            'personallyIdentifyingInfo',
            'financialAndPaymentInfo',
          ],
        },
        (granted) => {
          b.disabled = false;
          toast(
            granted
              ? 'Передача данных разрешена для функций, которые вы включите.'
              : 'Передача данных не разрешена.',
          );
        },
      );
    };
    page.querySelector('[data-identity]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        me = await request('identity');
        toast('Вход выполнен: ' + me.name);
        render();
      });
    page.querySelector('[data-pause]').onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        await request('pause');
        state = await request('state');
        toast('Вся автоматизация и внешние уведомления остановлены.');
        render();
      });
  }
  let pageStyle,
    cursor,
    audioSrc = '',
    audioListener;
  function applyAppearance() {
    if (!state) return;
    const a = state.preferences.appearance;
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'oblivion-page-style';
      document.head.append(pageStyle);
    }
    const dark =
      a.mode === 'dark' ||
      (a.mode === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
    const accent = /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent : '#c6f36b';
    const font = ['system-ui', 'Georgia', 'monospace'].includes(a.font) ? a.font : 'system-ui';
    const background = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(a.background)
      ? a.background
      : '';
    pageStyle.textContent =
      (a.mode !== 'original'
        ? `body{font-family:${font}!important;font-size:${a.size}px!important;background-color:${dark ? '#101218' : '#f5f6f9'}!important;color:${dark ? '#e1e5ee' : '#212632'}!important} ${dark ? '.content,.content-with-cd,.content-with-cd-wide,.chat,.chat-header,.chat-detail,.chat-form,.tc-item,.panel,.modal-content,.dropdown-menu{background-color:#191c25!important;color:#dce1ed!important;border-color:#343a48!important}input,textarea,select{background-color:#13151d!important;color:#e1e5ee!important;border-color:#353b49!important}.tc-item:hover{background-color:#242936!important}' : ''} .btn-primary{background-color:${accent}!important;border-color:${accent}!important;color:${dark ? '#151b0e' : '#fff'}!important}`
        : '') +
      (background
        ? `body{background-image:url("${background}")!important;background-size:cover!important;background-attachment:fixed!important}`
        : '') +
      (a.hideBalance
        ? '.balance,.badge-balance,.user-link-balance{filter:blur(8px)!important}'
        : '') +
      (a.density === 'compact'
        ? '.tc-item{padding-top:7px!important;padding-bottom:7px!important}.chat-msg-item{margin-bottom:4px!important}'
        : '') +
      '\n' +
      String(a.css || '')
        .replace(/@import[^;]+;/gi, '')
        .replace(/url\([^)]*\)/gi, 'none');
    host.style.setProperty('--accent', accent);
    if (a.cursor && !cursor && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
      cursor = document.createElement('div');
      cursor.style.cssText =
        'pointer-events:none;position:fixed;width:22px;height:22px;border:1px solid ' +
        accent +
        ';border-radius:50%;z-index:2147483645;transform:translate(-50%,-50%)';
      document.documentElement.append(cursor);
    }
    if (!a.cursor && cursor) {
      cursor.remove();
      cursor = null;
    }
    const player = document.querySelector('audio.loud');
    if (player) {
      player.volume = a.volume;
      if (a.sound && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(a.sound)) {
        if (audioSrc !== a.sound) {
          player.src = a.sound;
          audioSrc = a.sound;
          player.load();
        }
      } else if (audioSrc) {
        player.src = 'https://funpay.com/audio/chat_loud.mp3';
        audioSrc = '';
        player.load();
      }
    }
  }
  document.addEventListener(
    'pointermove',
    (event) => {
      if (cursor) {
        cursor.style.left = event.clientX + 'px';
        cursor.style.top = event.clientY + 'px';
      }
    },
    { passive: true },
  );
  const systemTheme = matchMedia('(prefers-color-scheme:dark)');
  systemTheme.addEventListener('change', applyAppearance);
  // Never expose commands through window.postMessage or page globals.
  ext.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== ext.runtime.id || message?.app !== 'oblivion-ui') return false;
    if (message.action === 'open') {
      open(message.view);
      respond({ opened: true });
    }
    return false;
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.preferences?.newValue && state) {
      state.preferences = C.normalize(changes.preferences.newValue);
      applyAppearance();
    }
  });
  shadow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (dialog) {
        dialog.remove();
        dialog = null;
      } else close();
      event.stopPropagation();
    }
    if (event.key === 'Tab' && backdrop) {
      const scope = dialog || backdrop;
      const elements = [...scope.querySelectorAll('button,input,textarea,select,a[href]')].filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && shadow.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && shadow.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyO') {
      event.preventDefault();
      backdrop ? close() : open();
    }
  });
  // A native-chat helper uses the input API; it never auto-submits a message.
  function attachChatTools() {
    const input = nativeInput();
    if (!input || input.dataset.oblivionTools) return;
    input.dataset.oblivionTools = '1';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin:6px 0;flex-wrap:wrap';
    const tools = [
      ['◒ Oblivion', () => open('chats')],
      ['Шаблоны', () => open('chats')],
      ['AI', () => open('ai')],
      [
        'Ответить на выделение',
        () => {
          const text = window.getSelection()?.toString();
          if (text) {
            input.value = '> ' + text.slice(0, 3000) + '\n\n' + input.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
          }
        },
      ],
    ];
    for (const [label, fn] of tools) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-default btn-xs';
      b.textContent = label;
      b.onclick = fn;
      bar.append(b);
    }
    const counter = document.createElement('small');
    counter.style.cssText = 'margin-left:auto;align-self:center;opacity:.6';
    bar.append(counter);
    const count = () => {
      counter.textContent = input.value.length + ' символов';
    };
    input.addEventListener('input', count);
    count();
    input.parentElement.append(bar);
  }
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      attachChatTools();
    }, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  dock.onclick = () => open();
  try {
    state = await request('state');
    applyAppearance();
    attachChatTools();
  } catch (error) {
    toast(error.message);
  }
})();
