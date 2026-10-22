/* Original small tools for native FunPay pages. They never auto-submit forms. */
(function () {
  'use strict';
  const ext = typeof chrome !== 'undefined' ? chrome : browser;
  const call = (command, payload = {}) =>
    new Promise((resolve, reject) =>
      ext.runtime.sendMessage(
        {
          app: 'oblivion',
          command,
          payload,
          accountId: (() => {
            try {
              return String(
                JSON.parse(
                  document.querySelector('[data-app-data]')?.getAttribute('data-app-data') || '{}',
                ).userId || '',
              );
            } catch {
              return '';
            }
          })(),
        },
        (response) =>
          response?.ok
            ? resolve(response.result)
            : reject(new Error(response?.error || 'Oblivion недоступен.')),
      ),
    );
  function tool(label, parent, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-default btn-xs';
    button.textContent = label;
    button.style.margin = '4px';
    button.onclick = async () => {
      button.disabled = true;
      try {
        await action(button);
      } catch (error) {
        button.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    parent.append(button);
    return button;
  }
  const profile = location.pathname.match(/^\/users\/(\d+)\/?$/);
  if (profile) {
    const anchor = document.querySelector('.user-profile, .profile, .user-header, .profile-header');
    if (anchor)
      tool('◒ Личная заметка', anchor, async () => {
        const state = await call('state');
        const box = document.createElement('div');
        const shadow = box.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent =
          ':host{position:fixed;inset:0;background:#05070acc;z-index:2147483647;display:grid;place-items:center;font:14px system-ui;color:#eaf0f8}section{background:#171b24;padding:24px;border:1px solid #343e4e;border-radius:16px;width:min(500px,85vw)}textarea{display:block;box-sizing:border-box;width:100%;height:150px;background:#10131a;color:#eaf0f8;border:1px solid #3b465b;border-radius:9px;padding:10px;font:inherit}button{padding:10px 15px;border:0;border-radius:8px;background:#c6f36b;color:#17200c;cursor:pointer;margin:12px 8px 0 0}p{white-space:pre-wrap;color:#a6b4ca}';
        const section = document.createElement('section');
        section.setAttribute('role', 'dialog');
        section.setAttribute('aria-label', 'Заметка о пользователе');
        const heading = document.createElement('h2');
        heading.textContent = 'Пользователь ' + profile[1];
        const textarea = document.createElement('textarea');
        textarea.value = state.preferences.notes[profile[1]] || '';
        textarea.setAttribute('aria-label', 'Личная заметка');
        const status = document.createElement('p');
        section.append(heading, textarea, status);
        tool('Сохранить', section, async () => {
          await call('settings', {
            patch: { notes: { ...state.preferences.notes, [profile[1]]: textarea.value } },
          });
          box.remove();
        });
        tool('История покупателя', section, async () => {
          const rows = await call('buyerHistory', { user: profile[1] });
          status.textContent = rows.length
            ? rows
                .slice(0, 20)
                .map((r) => `${r.orderId} · ${r.title} · ${r.amount} ${r.currency}`)
                .join('\n')
            : 'В локальной истории продаж этот покупатель пока не найден.';
        });
        tool('Закрыть', section, async () => box.remove());
        shadow.append(style, section);
        document.documentElement.append(box);
        textarea.focus();
        box.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') box.remove();
        });
      });
  }
  const order = location.pathname.match(/^\/orders\/([a-z0-9_-]+)\/?$/i);
  if (order && !['trade', 'sales', 'purchases'].includes(order[1])) {
    const parent = document.querySelector('.order-header, .order-info, h1');
    if (parent) {
      const timer = tool('◷ Таймер Oblivion', parent, async (button) => {
        const value = await call('timer', { order: order[1], action: 'toggle' });
        button.dataset.start = value.started || '';
        button.dataset.elapsed = value.elapsed || 0;
      });
      let interval;
      call('timer', { order: order[1], action: 'get' })
        .then((value) => {
          timer.dataset.start = value.started || '';
          timer.dataset.elapsed = value.elapsed || 0;
          interval = setInterval(() => {
            const elapsed =
              Number(timer.dataset.elapsed) +
              (timer.dataset.start ? Date.now() - Number(timer.dataset.start) : 0);
            const seconds = Math.floor(elapsed / 1000);
            timer.textContent =
              '◷ ' +
              String(Math.floor(seconds / 3600)).padStart(2, '0') +
              ':' +
              String(Math.floor(seconds / 60) % 60).padStart(2, '0') +
              ':' +
              String(seconds % 60).padStart(2, '0') +
              (timer.dataset.start ? ' · стоп' : ' · старт');
          }, 1000);
        })
        .catch(() => {});
      window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
    }
  }
  // Export a readable card from a review's text; no third-party images or HTML screenshots.
  for (const review of document.querySelectorAll('.review-container, .review-item')) {
    if (review.querySelector('[data-oblivion-card]')) continue;
    const text = review.querySelector('.review-item-text, .review-text')?.textContent.trim();
    if (!text) continue;
    const button = tool('◒ Карточка отзыва', review, async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 680;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#11141c';
      ctx.fillRect(0, 0, 1200, 680);
      ctx.fillStyle = '#c6f36b';
      ctx.font = 'bold 23px system-ui';
      ctx.fillText('OBLIVION / CUSTOMER REVIEW', 65, 80);
      ctx.fillStyle = '#f1f3f8';
      ctx.font = '30px system-ui';
      const words = text.slice(0, 1800).split(/\s+/);
      let line = '',
        y = 160;
      for (const word of words) {
        if (ctx.measureText(line + word).width > 1060) {
          ctx.fillText(line, 65, y);
          y += 47;
          line = '';
          if (y > 560) {
            line = '…';
            break;
          }
        }
        line += word + ' ';
      }
      ctx.fillText(line, 65, y);
      ctx.fillStyle = '#94a3bb';
      ctx.font = '20px system-ui';
      ctx.fillText('FunPay · ' + new Date().toLocaleDateString('ru'), 65, 625);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'oblivion-review.png';
      a.click();
    });
    button.dataset.oblivionCard = '1';
  }
})();
