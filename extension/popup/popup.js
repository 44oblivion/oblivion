'use strict';
const api = typeof chrome !== 'undefined' ? chrome : browser;
const status = document.querySelector('#status');
api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  status.textContent = /^https:\/\/(?:[a-z0-9-]+\.)?funpay\.com\//.test(tabs[0]?.url || '')
    ? 'FunPay открыт · готово'
    : 'Откройте FunPay для работы';
});
function open(view = 'overview') {
  api.tabs.query(
    { currentWindow: true, url: ['https://funpay.com/*', 'https://*.funpay.com/*'] },
    (tabs) => {
      const supported = tabs.filter((t) => !t.url?.startsWith('https://support.funpay.com/'));
      const tab = supported.find((t) => t.active) || supported[0];
      if (!tab) {
        api.tabs.create({ url: 'https://funpay.com/' });
        window.close();
        return;
      }
      api.tabs.update(tab.id, { active: true });
      api.tabs.sendMessage(tab.id, { app: 'oblivion-ui', action: 'open', view }, () => {
        if (api.runtime.lastError)
          status.textContent = 'Перезагрузите вкладку FunPay и нажмите ещё раз.';
        else window.close();
      });
    },
  );
}
document.querySelector('#open').onclick = () => open();
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => open(b.dataset.view)));
document.querySelector('#pause').onclick = () => {
  api.runtime.sendMessage({ app: 'oblivion', command: 'pause' }, (result) => {
    status.textContent = result?.ok ? 'Вся автоматизация остановлена' : 'Не удалось остановить';
  });
};
