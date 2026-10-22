'use strict';
// Adapter derived from the HTML/forms and runner protocol of FunPay's public website.
// No third-party extension code or private backend is included.
const FunPay = {
  session: null,
  sessionAt: 0,
  mutation: Promise.resolve(),
  document(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  },
  appData(doc) {
    try {
      return JSON.parse(
        doc.querySelector('[data-app-data]')?.getAttribute('data-app-data') || '{}',
      );
    } catch {
      throw new Error('FunPay изменил формат данных страницы.');
    }
  },
  async request(route, options = {}) {
    const url = new URL(route, 'https://funpay.com');
    if (url.origin !== 'https://funpay.com') throw new Error('Недопустимый адрес FunPay.');
    const response = await fetch(url.href, {
      ...options,
      credentials: 'include',
      signal: AbortSignal.timeout(30000),
      redirect: 'follow',
    });
    if (new URL(response.url || url).origin !== 'https://funpay.com')
      throw new Error('FunPay перенаправил запрос на другой сайт.');
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'Лимит FunPay. Повторите позже.'
          : `FunPay: HTTP ${response.status}`,
      );
    if (/login|account\/login/.test(new URL(response.url || url).pathname))
      throw new Error('Войдите в FunPay в Safari.');
    return response;
  },
  async page(route) {
    const response = await this.request(route);
    const raw = await response.text();
    if ((response.headers.get('content-type') || '').includes('json')) {
      const json = JSON.parse(raw);
      if (json.error) throw new Error(String(json.error));
      return this.document(json.html || json.content || json.data?.html || '');
    }
    return this.document(raw);
  },
  async identity(force = false) {
    if (!force && this.session && Date.now() - this.sessionAt < 30000) return this.session;
    const doc = await this.page('/');
    const app = this.appData(doc);
    if (!app.userId || !app['csrf-token'])
      throw new Error('Войдите в FunPay и разрешите расширению доступ к сайту.');
    this.session = {
      id: String(app.userId),
      csrf: app['csrf-token'],
      name:
        doc.querySelector('.user-link-name, .user-link .name')?.textContent.trim() ||
        String(app.userId),
    };
    this.sessionAt = Date.now();
    return this.session;
  },
  serial(work) {
    const next = this.mutation.catch(() => {}).then(work);
    this.mutation = next.finally(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    // Avoid an unhandled rejection in the pacing chain; the caller still receives next.
    this.mutation.catch(() => {});
    return next;
  },
  async post(route, values, raw = false) {
    return this.serial(async () => {
      const identity = await this.identity();
      const body = values instanceof FormData ? values : new URLSearchParams(values);
      if (!body.has('csrf_token')) body.set('csrf_token', identity.csrf);
      const response = await this.request(route, {
        method: 'POST',
        body,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (raw) return response.text();
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error('FunPay вернул неожиданный ответ; операция не повторяется автоматически.');
      }
      if (result.error)
        throw new Error(
          typeof result.error === 'string' ? result.error : JSON.stringify(result.error),
        );
      if (result.url && /login/.test(result.url)) throw new Error('Сессия FunPay истекла.');
      return result;
    });
  },
  async chats() {
    const me = await this.identity();
    const doc = await this.page('/chat/');
    return [...doc.querySelectorAll('.contact-item[data-id]')].map((el) => ({
      id: String(el.dataset.id),
      name:
        el.querySelector('.contact-item-name, .name')?.textContent.trim() ||
        el.textContent.trim().slice(0, 70),
      unread:
        el.classList.contains('unread') || Number(el.querySelector('.badge')?.textContent) > 0,
      snippet: el.querySelector('.contact-item-message, .message')?.textContent.trim() || '',
      owner: me.id,
    }));
  },
  async messages(chatId) {
    if (!/^\d+$/.test(String(chatId))) throw new Error('Некорректный ID чата.');
    const me = await this.identity();
    const doc = await this.page('/chat/?node=' + encodeURIComponent(chatId));
    const chat = doc.querySelector('.chat[data-name]');
    if (!chat) throw new Error('Чат недоступен.');
    const rows = [...doc.querySelectorAll('.chat-msg-item')].map((el) => {
      const author =
        el
          .querySelector('a[href*="/users/"]')
          ?.getAttribute('href')
          ?.match(/\/users\/(\d+)/)?.[1] || '';
      const classes = el.className;
      return {
        id: el.id || el.dataset.id || '',
        chat: String(chatId),
        text: el.querySelector('.chat-msg-text')?.textContent.trim() || '',
        author,
        own: author === me.id || /chat-msg-own/.test(classes),
        system: /chat-msg-(?:notification|event)/.test(classes) || !author,
        name: el.querySelector('.chat-msg-author')?.textContent.trim() || '',
        images: [...el.querySelectorAll('.chat-img-link')].map((a) => a.href),
      };
    });
    return {
      node: chat.dataset.name,
      messages: rows,
      buyer: doc.querySelector('.chat-header .name, .chat-detail .name')?.textContent.trim() || '',
    };
  },
  async send(chatId, content, imageId) {
    const { node } = await this.messages(chatId);
    const data = {
      node,
      last_message: -1,
      content: String(content || ''),
      compact: 0,
      show_avatar: 1,
    };
    if (imageId) data.image_id = imageId;
    const result = await this.post('/runner/', {
      objects: '[]',
      request: JSON.stringify({ action: 'chat_message', data }),
    });
    if (!result.response || result.response.error || result.response.url)
      throw new Error(String(result.response?.error || 'FunPay не подтвердил отправку.'));
    return { sent: true };
  },
  async upload(dataURL, offer = false) {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(dataURL) || dataURL.length > 10_000_000)
      throw new Error('Допустимо изображение до 7 МБ.');
    const blob = await (await fetch(dataURL)).blob();
    const form = new FormData();
    form.set('file', blob, 'oblivion-image.' + (blob.type.split('/')[1] || 'png'));
    const result = await this.post(offer ? '/file/addOfferImage' : '/file/addChatImage', form);
    const id = result.fileId || result.file_id || result.id;
    if (!id) throw new Error('FunPay не вернул ID изображения.');
    return { id, result };
  },
  rows(doc, type) {
    return [...doc.querySelectorAll('.tc-item')]
      .map((el) => {
        const href =
          el.getAttribute('href') || el.querySelector('a[href]')?.getAttribute('href') || '';
        const id =
          el.dataset.order ||
          el.dataset.transaction ||
          new URL(href || '/', 'https://funpay.com').searchParams.get('id') ||
          href.match(/\/orders\/([a-z0-9_-]+)\//i)?.[1];
        if (!id) return null;
        const statusText = (
          el.querySelector('.tc-status, .order-status')?.textContent || el.textContent
        ).toLocaleLowerCase();
        const status = /отмен|cancel|возврат|refund/.test(statusText)
          ? 'cancelled'
          : /заверш|выполнен|закрыт|complete|closed/.test(statusText)
            ? 'complete'
            : 'paid';
        const dateNode = el.querySelector('time, .tc-date');
        const rawDate =
          dateNode?.getAttribute('datetime') ||
          dateNode?.getAttribute('title') ||
          dateNode?.textContent.trim() ||
          '';
        const timestamp = OblivionCore.parseDate(rawDate);
        return {
          id: String(id),
          type,
          title: el.querySelector('.tc-desc-text, .tc-title, .tc-desc')?.textContent.trim() || '',
          category: el.querySelector('.tc-game')?.textContent.trim() || '',
          amount: OblivionCore.money(el.querySelector('.tc-price')?.textContent),
          currency: /\$/.test(el.querySelector('.tc-price')?.textContent || '')
            ? 'USD'
            : /€/.test(el.querySelector('.tc-price')?.textContent || '')
              ? 'EUR'
              : 'RUB',
          buyerId:
            el
              .querySelector('.tc-user a[href*="/users/"], a[href*="/users/"]')
              ?.getAttribute('href')
              ?.match(/\/users\/(\d+)/)?.[1] || '',
          buyer: el.querySelector('.media-user-name, .tc-user')?.textContent.trim() || '',
          status,
          dateLabel: rawDate,
          time: timestamp,
          captured: Date.now(),
          href: new URL(href || '/', 'https://funpay.com').href,
        };
      })
      .filter(Boolean);
  },
  async sync(type, maxPages = 20) {
    const owner = (await this.identity()).id;
    const route =
      type === 'finance' ? '/account/balance' : type === 'purchases' ? '/orders/' : '/orders/trade';
    let next = '',
      pages = 0,
      total = 0;
    const cursors = new Set();
    do {
      const doc = await this.page(route + (next ? '?continue=' + encodeURIComponent(next) : ''));
      const rows = this.rows(doc, type).map((row) => ({
        ...row,
        owner,
        id: owner + ':' + row.id,
        orderId: row.id,
      }));
      total += await Ledger.put(type, rows);
      next = doc.querySelector('input[name="continue"]')?.value || '';
      if (!rows.length || cursors.has(next)) break;
      cursors.add(next);
      pages++;
    } while (next && pages < maxPages);
    return { total, more: !!next && pages >= maxPages };
  },
  formFields(form) {
    const pairs = [];
    for (const field of form.querySelectorAll('input[name], textarea[name], select[name]')) {
      if (
        field.disabled ||
        ['submit', 'button', 'file', 'reset'].includes(field.type) ||
        (['checkbox', 'radio'].includes(field.type) && !field.checked)
      )
        continue;
      if (field.tagName === 'SELECT' && field.multiple)
        for (const option of field.selectedOptions) pairs.push([field.name, option.value]);
      else pairs.push([field.name, field.value]);
    }
    return pairs;
  },
  async lot(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Некорректный ID лота.');
    const doc = await this.page('/lots/offerEdit?offer=' + encodeURIComponent(id));
    const form = [...doc.querySelectorAll('form')].find(
      (f) => f.action.includes('offerSave') || f.querySelector('[name="offer_id"]'),
    );
    if (!form) throw new Error('Откройте собственный лот, доступный для редактирования.');
    const fields = this.formFields(form);
    const get = (key) => fields.find(([k]) => k === key)?.[1] || '';
    return {
      fieldNames: [...form.querySelectorAll('[name]')].map((el) => el.name),
      id: String(id),
      node: get('node_id'),
      title: get('fields[summary][ru]') || get('fields[summary][en]'),
      price: get('price'),
      fields: fields.filter(([k]) => !/csrf|token/i.test(k)),
    };
  },
  async saveLot(id, changes, duplicate = false) {
    const current = await this.lot(id);
    const params = new URLSearchParams(current.fields);
    const allowed = new Set(current.fieldNames);
    for (const [key, value] of Object.entries(changes || {})) {
      if (!allowed.has(key) || /csrf|token|offer_id|node_id/i.test(key)) continue;
      params.set(key, String(value));
    }
    if (duplicate) params.set('offer_id', '0');
    return this.post('/lots/offerSave', params);
  },
  async categories() {
    const me = await this.identity();
    const doc = await this.page('/users/' + me.id + '/');
    return [...doc.querySelectorAll('.js-lot-raise[data-game][data-node]')].map((button) => ({
      game: button.dataset.game,
      node: button.dataset.node,
      name:
        button
          .closest('.offer, .profile, section, .mb20')
          ?.querySelector('h3, h2, .offer-list-title')
          ?.textContent.trim() || button.dataset.node,
    }));
  },
  async raise(category) {
    if (!/^\d+$/.test(String(category.game)) || !/^[\d,\s]+$/.test(String(category.node)))
      throw new Error('Неверная категория.');
    const result = await this.post('/lots/raise', {
      game_id: String(category.game),
      node_id: String(category.node),
    });
    if (result.modal || result.url) throw new Error('FunPay требует подтверждение на сайте.');
    return result;
  },
};
