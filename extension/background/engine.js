'use strict';
const External = {
  async allowed(origin) {
    const data_collection = ['websiteContent', 'personalCommunications', 'authenticationInfo'];
    if (['https://api.telegram.org', 'https://discord.com'].includes(origin))
      data_collection.push('personallyIdentifyingInfo', 'financialAndPaymentInfo');
    return new Promise((resolve) =>
      api.permissions.contains({ origins: [origin + '/*'], data_collection }, resolve),
    );
  },
  async json(origin, route, options = {}) {
    if (!(await this.allowed(origin)))
      throw new Error('Разрешите доступ к сервису в настройках Oblivion.');
    const response = await fetch(origin + route, {
      ...options,
      signal: AbortSignal.timeout(60000),
      credentials: 'omit',
    });
    if (!response.ok) throw new Error('Внешний сервис: HTTP ' + response.status);
    if (response.status === 204) return {};
    const data = await response.json();
    if (data.error || data.ok === false)
      throw new Error('Сервис отклонил запрос. Проверьте настройки и лимиты.');
    return data;
  },
  async ai(task, prompt, language = 'English') {
    const { ai } = await Store.settings();
    if (!ai.key || !ai.consent)
      throw new Error(
        'Укажите API-ключ и разрешите отправку введённого текста выбранному AI-провайдеру.',
      );
    const instructions = {
      reply:
        'Write a concise, polite reply to a customer. Do not invent fulfillment, refunds, or guarantees.',
      translate: 'Translate the text into ' + language + '. Output only the translation.',
      lot: 'Write a concise listing title and accurate description. Do not invent product attributes.',
      audit:
        'Audit these listings. Identify ambiguity, missing details and pricing inconsistencies. Do not invent market facts.',
      review: 'Write a courteous response to this review. Do not invent events.',
      rewrite: 'Improve clarity and grammar, preserving facts and tone.',
    };
    if (!(task in instructions) && task !== 'image') throw new Error('Неизвестный AI-инструмент.');
    if (!prompt || prompt.length > 50000) throw new Error('Введите текст до 50 000 символов.');
    if (task === 'image') {
      if (ai.provider !== 'openai') throw new Error('Изображения доступны через OpenAI.');
      const result = await this.json('https://api.openai.com', '/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.key },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
      });
      const item = result.data?.[0];
      if (!item) throw new Error('Провайдер не вернул изображение.');
      return { image: item.b64_json ? 'data:image/png;base64,' + item.b64_json : item.url };
    }
    if (ai.provider === 'gemini') {
      const result = await this.json(
        'https://generativelanguage.googleapis.com',
        '/v1beta/models/' + encodeURIComponent(ai.model) + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ai.key },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: instructions[task] }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          }),
        },
      );
      return {
        text: result.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '',
      };
    }
    const origin =
      ai.provider === 'openrouter' ? 'https://openrouter.ai' : 'https://api.openai.com';
    const result = await this.json(
      origin,
      ai.provider === 'openrouter' ? '/api/v1/chat/completions' : '/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.key },
        body: JSON.stringify({
          model: ai.model,
          messages: [
            { role: 'system', content: instructions[task] },
            { role: 'user', content: prompt },
          ],
        }),
      },
    );
    return { text: result.choices?.[0]?.message?.content || '' };
  },
  async telegram(config, method, values) {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(config.token)) throw new Error('Некорректный токен Telegram.');
    return this.json('https://api.telegram.org', '/bot' + config.token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
  },
  async notify(text, settings) {
    if (typeof Engine !== 'undefined' && Engine.pauseRequested) return;
    const { telegram, discord } = settings.integrations;
    if (telegram.enabled && telegram.token && telegram.chat) {
      try {
        await this.telegram(telegram, 'sendMessage', {
          chat_id: telegram.chat,
          text: String(text).slice(0, 4000),
        });
      } catch {
        await Store.log('error', 'Telegram: уведомление не отправлено.');
      }
    }
    if (discord.enabled && discord.webhook) {
      try {
        const url = OblivionCore.safeURL(discord.webhook, ['https://discord.com']);
        if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname))
          throw new Error('Некорректный Discord webhook.');
        await this.json(url.origin, url.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: String(text).slice(0, 1900),
            allowed_mentions: { parse: [] },
          }),
        });
      } catch {
        await Store.log('error', 'Discord: уведомление не отправлено.');
      }
    }
  },
};
const Engine = {
  running: false,
  pauseRequested: false,
  async cycle() {
    if (this.running) return;
    this.running = true;
    this.pauseRequested = false;
    try {
      const settings = await Store.settings();
      const active =
        settings.bump.enabled ||
        settings.rules.some((r) => r.enabled) ||
        settings.inventories.some((i) => i.enabled) ||
        settings.autoRestore.enabled ||
        settings.integrations.telegram.enabled ||
        settings.integrations.discord.enabled;
      if (!active) return;
      const me = await FunPay.identity(true);
      if (settings.automationAccount !== me.id) {
        await Store.log(
          'pause',
          'Аккаунт FunPay изменился. Заново сохраните настройки автоматизации из нужного аккаунта.',
        );
        return;
      }
      const { automation = {} } = await Store.read('automation');
      const state = automation[me.id] || {
        messages: {},
        orders: {},
        bumped: {},
        initialized: false,
        telegramOffset: 0,
      };
      const ruleSig = settings.rules
        .filter((r) => r.enabled)
        .map((r) => r.id)
        .sort()
        .join(',');
      const inventorySig = settings.inventories
        .filter((i) => i.enabled)
        .map((i) => i.id)
        .sort()
        .join(',');
      const notifySig =
        String(settings.integrations.telegram.enabled) +
        ':' +
        String(settings.integrations.discord.enabled);
      const replyWarmup = !state.initialized || state.ruleSig !== ruleSig;
      const deliveryWarmup =
        !state.initialized || state.inventorySig !== inventorySig || state.notifySig !== notifySig;
      state.knownChats ||= [];
      const save = async () => {
        automation[me.id] = state;
        await Store.write({ automation });
      };
      // Establish a baseline. Existing conversations/orders must never trigger retroactive replies/delivery.
      const chats = await FunPay.chats();
      const candidates = !replyWarmup
        ? chats.filter((c) => c.unread).slice(0, 5)
        : chats.slice(0, 20);
      for (const chat of candidates) {
        if (this.pauseRequested) return;
        const details = await FunPay.messages(chat.id);
        const last = details.messages.filter((m) => !m.own && !m.system).at(-1);
        if (!last) continue;
        const previous = state.messages[chat.id];
        state.messages[chat.id] = last.id;
        await save();
        if (
          replyWarmup ||
          (!previous && state.knownChats.includes(chat.id)) ||
          previous === last.id ||
          settings.blocked.includes(last.author)
        )
          continue;
        const rule = OblivionCore.matchRule(settings.rules, last);
        if (rule && !this.pauseRequested) {
          await FunPay.send(chat.id, OblivionCore.template(rule.reply, { buyer: chat.name }));
          await Store.log('reply', 'Автоответ отправлен в чат ' + chat.id);
        }
        await External.notify(
          'Oblivion · сообщение от ' + chat.name + '\n' + last.text.slice(0, 400),
          settings,
        );
      }
      state.knownChats = [...new Set([...state.knownChats, ...chats.map((c) => c.id)])].slice(
        -5000,
      );
      if (this.pauseRequested) return;
      if (
        settings.inventories.some((i) => i.enabled) ||
        settings.integrations.telegram.enabled ||
        settings.integrations.discord.enabled
      ) {
        const doc = await FunPay.page('/orders/trade?state=paid');
        const orders = FunPay.rows(doc, 'orders');
        for (const order of orders.filter((o) => o.status === 'paid')) {
          if (this.pauseRequested) return;
          if (state.orders[order.id]) continue;
          state.orders[order.id] = {
            state: !deliveryWarmup ? 'observed' : 'baseline',
            time: Date.now(),
          };
          await save();
          if (deliveryWarmup) continue;
          await External.notify(
            'Oblivion · новый заказ ' + order.id + '\n' + order.title,
            settings,
          );
          const inventory = settings.inventories.find(
            (i) =>
              i.enabled &&
              String(i.match || '').trim() &&
              order.title.toLowerCase().includes(i.match.toLowerCase()),
          );
          if (!inventory || !inventory.items?.length) continue;
          const detail = await FunPay.page('/orders/' + encodeURIComponent(order.id) + '/');
          const chatId = detail.querySelector('.chat[data-id]')?.dataset.id;
          if (!chatId) {
            await Store.log(
              'error',
              'Заказ ' + order.id + ': чат не определён, выдача остановлена.',
            );
            continue;
          }
          const code = inventory.items.shift();
          inventory.reservations = [
            ...(inventory.reservations || []),
            { order: order.id, value: code, status: 'reserved', time: Date.now() },
          ];
          await Store.update({ inventories: settings.inventories });
          state.orders[order.id].state = 'reserved';
          await save();
          try {
            if (this.pauseRequested) {
              inventory.reservations.at(-1).status = 'uncertain';
              await Store.update({ inventories: settings.inventories });
              return;
            }
            await FunPay.send(
              chatId,
              OblivionCore.template(inventory.message || '{lot}', {
                buyer: order.buyer,
                order: order.id,
                lot: code,
                price: order.amount,
              }),
            );
            state.orders[order.id].state = 'delivered';
            inventory.reservations.at(-1).status = 'delivered';
            await Store.update({ inventories: settings.inventories });
            await save();
            await Store.log('delivery', 'Выдан товар по заказу ' + order.id);
          } catch {
            // A lost HTTP response does not prove failure. Never replay an uncertain delivery.
            state.orders[order.id].state = 'uncertain';
            inventory.reservations.at(-1).status = 'uncertain';
            await Store.update({ inventories: settings.inventories });
            await save();
            await Store.log(
              'error',
              'Выдача по заказу ' +
                order.id +
                ' требует ручной проверки. Зарезервированный товар сохранён.',
            );
          }
        }
      }
      if (settings.bump.enabled) {
        const categories = settings.bump.categories.length
          ? settings.bump.categories
          : await FunPay.categories();
        for (const category of categories) {
          if (this.pauseRequested) return;
          const key = category.game + ':' + category.node;
          if (Date.now() - (state.bumped[key] || 0) < settings.bump.interval * 60000) continue;
          state.bumped[key] = Date.now();
          await save();
          try {
            await FunPay.raise(category);
            await Store.log('bump', 'Поднята категория ' + category.name);
          } catch {
            await Store.log(
              'error',
              'Категория ' + category.name + ': FunPay не подтвердил поднятие.',
            );
          }
        }
      }
      if (settings.autoRestore.enabled) {
        for (const item of settings.autoRestore.schedule.filter(
          (i) => i.enabled && i.at && i.at <= Date.now() && !i.done,
        )) {
          if (this.pauseRequested) return;
          item.done = true;
          await Store.update({ autoRestore: settings.autoRestore });
          try {
            await FunPay.saveLot(item.lot, { active: item.active ? 'on' : '' });
            await Store.log('schedule', 'Обработан лот ' + item.lot);
          } catch {
            await Store.log(
              'error',
              'Лот ' + item.lot + ': проверьте состояние после запланированной операции.',
            );
          }
        }
      }
      if (settings.integrations.telegram.enabled && settings.integrations.telegram.chat) {
        const tg = settings.integrations.telegram;
        const result = await External.telegram(tg, 'getUpdates', {
          offset: state.telegramOffset,
          timeout: 0,
          allowed_updates: ['message'],
        });
        for (const update of result.result || []) {
          state.telegramOffset = update.update_id + 1;
          await save();
          if (String(update.message?.chat?.id) !== String(tg.chat)) continue;
          const command = update.message.text?.split(/\s/)[0];
          let answer = '';
          if (command === '/stats') {
            const rows = (await Ledger.all('orders')).filter((r) => r.owner === me.id);
            const stats = OblivionCore.totals(rows);
            answer = `Заказов: ${stats.completed}\nВыручка: ${stats.gross.toFixed(2)}`;
          }
          if (command === '/pause') {
            await Store.update({
              bump: { enabled: false },
              rules: settings.rules.map((r) => ({ ...r, enabled: false })),
              inventories: settings.inventories.map((i) => ({ ...i, enabled: false })),
              autoRestore: { enabled: false },
            });
            answer = 'Автоматизация остановлена.';
          }
          if (command === '/help' || command === '/start')
            answer = 'Oblivion\n/stats — локальная статистика\n/pause — остановить автоматизацию';
          if (answer)
            await External.telegram(tg, 'sendMessage', { chat_id: tg.chat, text: answer });
        }
      }
      state.ruleSig = ruleSig;
      state.inventorySig = inventorySig;
      state.notifySig = notifySig;
      state.initialized = true;
      state.lastSuccess = Date.now();
      await save();
    } catch (error) {
      // Do not persist URLs, request bodies, tokens, or provider error payloads.
      await Store.log(
        'error',
        'Фоновая проверка остановлена. Проверьте вход FunPay, разрешения и журнал.',
      );
    } finally {
      this.running = false;
    }
  },
  start() {
    api.alarms.create('oblivion-cycle', { periodInMinutes: 1 });
  },
};
