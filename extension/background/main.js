'use strict';
let settingsQueue = Promise.resolve();
const mutateSettings = (patch) => {
  const job = settingsQueue.catch(() => {}).then(() => Store.update(patch));
  settingsQueue = job;
  return job;
};
const commands = {
  async state() {
    const prefs = await Store.settings();
    const { journal = [], automation = {} } = await Store.read(['journal', 'automation']);
    return { preferences: prefs, journal, automation };
  },
  async settings({ patch }) {
    if (Engine.running && (patch?.inventories || patch?.rules || patch?.autoRestore))
      throw new Error('Фоновая операция выполняется. Повторите изменение через несколько секунд.');
    return mutateSettings(patch);
  },
  async identity() {
    const me = await FunPay.identity(true);
    return { id: me.id, name: me.name };
  },
  async chats() {
    return FunPay.chats();
  },
  async messages({ id }) {
    return FunPay.messages(id);
  },
  async send({ id, text, images = [] }) {
    if (images.length > 10 || String(text || '').length > 20000)
      throw new Error('Сообщение слишком большое.');
    if (text) await FunPay.send(id, text);
    for (const image of images) {
      const upload = await FunPay.upload(image);
      await FunPay.send(id, '', upload.id);
    }
    return { sent: true };
  },
  async sync({ type }) {
    if (!['orders', 'purchases', 'finance'].includes(type))
      throw new Error('Неизвестный тип истории.');
    return FunPay.sync(type);
  },
  async ledger({ type }) {
    if (!['orders', 'purchases', 'finance'].includes(type))
      throw new Error('Неизвестный тип истории.');
    const me = await FunPay.identity();
    return (await Ledger.all(type)).filter((r) => r.owner === me.id);
  },
  async buyerHistory({ user }) {
    if (!/^\d+$/.test(String(user))) throw new Error('Некорректный ID покупателя.');
    const me = await FunPay.identity();
    return (await Ledger.all('orders')).filter(
      (r) => r.owner === me.id && r.buyerId === String(user),
    );
  },
  async timer({ order, action }) {
    if (!/^[a-z0-9_-]+$/i.test(String(order))) throw new Error('Некорректный заказ.');
    const me = await FunPay.identity();
    const { timers = {} } = await Store.read('timers');
    const key = me.id + ':' + order;
    const value = timers[key] || { started: 0, elapsed: 0 };
    if (action === 'toggle') {
      if (value.started) {
        value.elapsed += Math.max(0, Date.now() - value.started);
        value.started = 0;
      } else value.started = Date.now();
      timers[key] = value;
      await Store.write({ timers });
    }
    return value;
  },
  async lot({ id }) {
    return FunPay.lot(id);
  },
  async lotSave({ id, changes, duplicate }) {
    return FunPay.saveLot(id, changes, duplicate === true);
  },
  async categories() {
    return FunPay.categories();
  },
  async raise({ category }) {
    return FunPay.raise(category);
  },
  async ai({ task, prompt, language }) {
    return External.ai(task, prompt, language);
  },
  async notifyTest() {
    await External.notify('Oblivion · проверка уведомлений', await Store.settings());
    return true;
  },
  async cycle() {
    await Engine.cycle();
    return true;
  },
  async pause() {
    Engine.pauseRequested = true;
    const prefs = await Store.settings();
    return mutateSettings({
      bump: { enabled: false },
      autoRestore: { enabled: false },
      rules: prefs.rules.map((r) => ({ ...r, enabled: false })),
      inventories: prefs.inventories.map((i) => ({ ...i, enabled: false })),
      integrations: { telegram: { enabled: false }, discord: { enabled: false } },
    });
  },
  async resolveDelivery({ stock, order, delivered }) {
    if (Engine.running) throw new Error('Дождитесь окончания фоновой проверки.');
    const prefs = await Store.settings();
    const item = prefs.inventories.find((i) => i.id === stock);
    const reservation = item?.reservations?.find((r) => r.order === order);
    if (!reservation || !['reserved', 'uncertain'].includes(reservation.status))
      throw new Error('Резервирование уже обработано.');
    reservation.status = delivered ? 'delivered' : 'returned';
    if (!delivered) item.items.unshift(reservation.value);
    return mutateSettings({ inventories: prefs.inventories });
  },
  async backup() {
    return {
      format: 'oblivion',
      version: 1,
      preferences: OblivionCore.redact(await Store.settings()),
    };
  },
  async restore({ backup }) {
    if (backup?.format !== 'oblivion' || backup.version !== 1)
      throw new Error('Это не резервная копия Oblivion версии 1.');
    if (Engine.running) throw new Error('Дождитесь окончания фоновой проверки перед импортом.');
    const current = await Store.settings();
    const prefs = OblivionCore.redact(OblivionCore.normalize(backup.preferences));
    prefs.inventories = current.inventories.map((i) => ({ ...i, enabled: false }));
    prefs.ai.key = current.ai.key;
    prefs.integrations.telegram.token = current.integrations.telegram.token;
    prefs.integrations.discord.webhook = current.integrations.discord.webhook;
    return mutateSettings(prefs);
  },
};
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== api.runtime.id) return false;
  if (
    sender.url &&
    !sender.url.startsWith(api.runtime.getURL('')) &&
    !/^https:\/\/(?:[a-z0-9-]+\.)?funpay\.com\//i.test(sender.url)
  )
    return false;
  if (message?.app !== 'oblivion' || !Object.hasOwn(commands, message.command)) return false;
  Promise.resolve()
    .then(() => commands[message.command](message.payload || {}))
    .then((result) => respond({ ok: true, result }))
    .catch((error) => respond({ ok: false, error: error.message || 'Операция не выполнена.' }));
  return true;
});
api.runtime.onInstalled.addListener(async () => {
  await Store.settings().then((preferences) => Store.write({ preferences }));
  Engine.start();
});
api.runtime.onStartup.addListener(() => Engine.start());
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'oblivion-cycle') Engine.cycle();
});
Engine.start();
