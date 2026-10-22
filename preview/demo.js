/* Explicit offline UI preview. Never loaded by the extension manifest. */
// Open roots only in this offline preview so browser inspection tools can reach the UI.
const previewAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) {
  return previewAttachShadow.call(this, { ...options, mode: 'open' });
};
const demoPreferences = OblivionCore.defaults();
demoPreferences.goals = [{ id: 'demo-goal', name: 'Новый рабочий Mac', amount: 200000 }];
demoPreferences.templates = [
  {
    id: 'demo-template',
    name: 'Спасибо за покупку',
    text: 'Спасибо, {buyer}! Если появятся вопросы — напишите.',
  },
];
demoPreferences.appearance.mode = 'original';
const previewState = {
  preferences: demoPreferences,
  journal: [
    { time: Date.now() - 600000, kind: 'demo', message: 'Демо: импортировано 32 заказа' },
    { time: Date.now() - 1200000, kind: 'demo', message: 'Демо: обновлена личная заметка' },
  ],
  automation: {},
};
const demoRows = Array.from({ length: 32 }, (_, i) => ({
  id: String(i),
  orderId: 'DEMO-' + (1000 + i),
  title: ['Игровая валюта · пакет', 'Подарочная карта', 'Подписка на сервис'][i % 3],
  category: ['Игры', 'Карты', 'Сервисы'][i % 3],
  buyer: ['Mira', 'Nord', 'Echo'][i % 3],
  amount: 500 + ((i * 317) % 4000),
  currency: 'RUB',
  status: i === 7 ? 'cancelled' : 'complete',
  time: Date.UTC(2026, 9, 1 + Math.floor(i / 2)),
  dateLabel: 'Демонстрация',
}));
const demoBase = new URL('../extension/', location.href).href;
const changes = [];
window.chrome = {
  runtime: {
    id: 'oblivion-preview',
    getURL: (path) => demoBase + path,
    lastError: null,
    onMessage: { addListener() {} },
    sendMessage(message, callback) {
      try {
        let result;
        switch (message.command) {
          case 'state':
            result = structuredClone(previewState);
            break;
          case 'settings':
            previewState.preferences = OblivionCore.normalize(
              OblivionCore.merge(previewState.preferences, message.payload.patch),
            );
            result = structuredClone(previewState.preferences);
            break;
          case 'identity':
            result = { id: '100', name: 'Демо-магазин' };
            break;
          case 'sync':
            result = { total: demoRows.length, more: false };
            break;
          case 'ledger':
            result = demoRows;
            break;
          case 'chats':
            result = [
              {
                id: '200',
                name: 'Mira · демо',
                snippet: 'Здравствуйте! Подскажите по заказу.',
                unread: true,
              },
              { id: '201', name: 'Nord · демо', snippet: 'Спасибо, всё получил!', unread: false },
            ];
            break;
          case 'messages':
            result = {
              messages: [
                {
                  id: 'a',
                  name: 'Mira',
                  text: 'Здравствуйте! Когда будет готов заказ?',
                  own: false,
                },
                {
                  id: 'b',
                  name: 'Демо-магазин',
                  text: 'Здравствуйте! Уточняю детали и скоро вернусь с ответом.',
                  own: true,
                },
              ],
            };
            break;
          case 'backup':
            result = {
              format: 'oblivion',
              version: 1,
              preferences: OblivionCore.redact(previewState.preferences),
            };
            break;
          case 'pause':
            result = true;
            break;
          default:
            throw new Error('Это демо интерфейса. Реальные операции отключены.');
        }
        callback({ ok: true, result });
      } catch (error) {
        callback({ ok: false, error: error.message });
      }
    },
  },
  storage: { onChanged: { addListener: (fn) => changes.push(fn) } },
  permissions: { request: (_permissions, callback) => callback(false) },
};
document.querySelector('#demo-open').onclick = () =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyO', bubbles: true }),
  );
