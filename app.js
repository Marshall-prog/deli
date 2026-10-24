/* Дели — слой интерфейса. Вся математика в logic.js, здесь только DOM. */
(function () {
  'use strict';

  var D = globalThis.Dela;
  var LS_BILL = 'dela.bill.v1';
  var LS_THEME = 'dela.theme';
  var LS_ME = 'dela.me';

  var state = D.emptyBill();   // счёт создателя
  var incoming = null;         // счёт, открытый по ссылке
  var me = '';                 // кто я в чужом счёте

  function $(id) { return document.getElementById(id); }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------------- хранение ---------------- */

  function save() { store(LS_BILL, JSON.stringify(state)); }

  function load() {
    var raw = read(LS_BILL);
    if (raw) {
      try { state = D.sanitize(JSON.parse(raw)); } catch (e) { state = D.emptyBill(); }
    }
    me = read(LS_ME) || '';
  }

  /* ---------------- вспомогательное ---------------- */

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function copyText(text, okMessage) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); toast(okMessage); }
      catch (e) { toast('Не удалось скопировать — выдели текст вручную'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMessage); }, fallback);
    } else {
      fallback();
    }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ---------------- рендер: участники ---------------- */

  function renderPeople() {
    var box = $('peopleList');
    if (!box) return;
    box.innerHTML = '';
    state.people.forEach(function (name) {
      var chip = el('span', 'chip');
      chip.appendChild(el('span', null, name));
      var x = el('button', null, '×');
      x.type = 'button';
      x.title = 'Убрать участника';
      x.addEventListener('click', function () { removePerson(name); });
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  function removePerson(name) {
    state.people = state.people.filter(function (n) { return n !== name; });
    var fallback = state.people.length ? state.people[0] : '';
    state.items.forEach(function (it) { if (it.by === name) it.by = fallback; });
    delete state.paid[name];
    save();
    renderAll();
  }

  function addPerson() {
    var input = $('personName');
    var name = (input.value || '').trim();
    if (!name) return;
    var exists = state.people.some(function (n) { return n.toLowerCase() === name.toLowerCase(); });
    if (exists) { toast('Такой участник уже есть'); input.value = ''; return; }
    state.people.push(name);
    input.value = '';
    save();
    renderAll();
  }

  /* ---------------- рендер: плательщики ---------------- */

  function fillPayerSelect(select, value) {
    if (!select) return;
    select.innerHTML = '';
    state.people.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    if (!state.people.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— добавь участника —';
      select.appendChild(opt);
    }
    select.value = value !== undefined && value !== '' ? value : (state.people[0] || '');
  }

  function getBys(item) {
    if (Array.isArray(item.bys) && item.bys.length) return item.bys.slice();
    if (item.by) return [item.by];
    if (state.people.length) return [state.people[0]];
    return [];
  }

  function renderPayerOptions() {
    // больше не используется
  }

  /* ---------------- рендер: позиции ---------------- */

  function renderItems() {
    var box = $('itemsList');
    if (!box) return;
    box.innerHTML = '';

    state.items.forEach(function (item, idx) {
      var row = el('div', 'item-row');

      var name = el('input', 'nm');
      name.type = 'text';
      name.value = item.n || '';
      name.maxLength = 40;
      name.placeholder = 'Позиция';
      name.addEventListener('input', function () {
        state.items[idx].n = name.value;
        save();
      });

      var price = el('input', 'pr');
      price.type = 'number';
      price.inputMode = 'decimal';
      price.step = '0.01';
      price.min = '0';
      price.value = item.p;
      price.addEventListener('input', function () {
        state.items[idx].p = price.value;
        save();
        renderResults();
      });
      price.addEventListener('change', function () {
        if (!(D.num(price.value) > 0)) {
          state.items.splice(idx, 1);
          save();
          renderItems();
        }
        renderResults();
      });

      var payers = el('div', 'payers');
      if (!Array.isArray(state.items[idx].bys)) state.items[idx].bys = getBys(item);
      state.people.forEach(function (person) {
        var chip = el('button', 'chip' + (state.items[idx].bys.indexOf(person) >= 0 ? ' active' : ''), person);
        chip.type = 'button';
        chip.addEventListener('click', function () {
          var list = Array.isArray(state.items[idx].bys) ? state.items[idx].bys.slice() : [];
          var i2 = list.indexOf(person);
          if (i2 >= 0) {
            if (list.length === 1) {
              toast('Нужен хотя бы один плательщик');
              return;
            }
            list.splice(i2, 1);
          } else {
            list.push(person);
          }
          state.items[idx].bys = list;
          state.items[idx].by = list[0] || '';
          save();
          renderItems();
          renderResults();
        });
        payers.appendChild(chip);
      });
      if (!state.people.length) {
        payers.appendChild(el('div', 'hint', 'Сначала добавь участников'));
      }

      var del = el('button', 'del', '×');
      del.type = 'button';
      del.title = 'Удалить позицию';
      del.addEventListener('click', function () {
        state.items.splice(idx, 1);
        save();
        renderItems();
        renderResults();
      });

      row.appendChild(name);
      row.appendChild(price);
      row.appendChild(payers);
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  function addItem() {
    var name = $('itemName');
    var price = $('itemPrice');
    var value = D.num(price.value);
    if (!(value > 0)) { toast('Введи цену позиции'); price.focus(); return; }
    if (!state.people.length) { toast('Сначала добавь участников'); return; }
    state.items.push({
      n: (name.value || '').trim().slice(0, 40),
      p: value,
      bys: [state.people[0]],
      by: state.people[0]
    });
    name.value = '';
    price.value = '';
    save();
    renderItems();
    renderResults();
    name.focus();
  }

  /* ---------------- рендер: итоги ---------------- */

  function renderResults() {
    var box = $('results');
    if (!box) return;
    box.innerHTML = '';
    var r = D.compute(state);

    if (!state.people.length) {
      box.appendChild(el('div', 'breakdown', 'Добавь хотя бы одного участника — посчитаем доли.'));
      return;
    }

    box.appendChild(el('div', 'total', D.fmtRub(r.total)));

    var parts = [];
    if (r.discount > 0) parts.push('скидка −' + D.fmtRub(r.discount));
    if (r.tip > 0) parts.push('чаевые +' + D.fmtRub(r.tip));
    if (parts.length) box.appendChild(el('div', 'breakdown', parts.join(' · ')));

    var rows = el('div', 'rows');
    r.rows.forEach(function (row) {
      var item = el('div', 'row');
      item.appendChild(el('div', 'nm', row.name));
      item.appendChild(el('div', 'amt', D.fmtRub(row.share)));

      var note = el('div', 'note');
      if (row.balance > 0) {
        note.textContent = 'заплатил ' + D.fmtRub(row.paid) + ' · скидка ' + D.fmtRub(row.balance);
        note.classList.add('ok');
      } else if (row.balance < 0) {
        note.textContent = 'заплатил ' + D.fmtRub(row.paid) + ' · не хватает ' + D.fmtRub(-row.balance);
        note.classList.add('debt');
      } else {
        note.textContent = 'заплатил ' + D.fmtRub(row.paid) + ' · всё сходится';
        note.classList.add('ok');
      }
      item.appendChild(note);

      if (row.paid < row.share) {
        var mark = el('button', 'mark', '✓ отметил оплату');
        mark.type = 'button';
        mark.addEventListener('click', function () {
          var add = (row.share - row.paid) / 100;
          state.paid[row.name] = (state.paid[row.name] || 0) + add;
          save();
          renderResults();
          toast('Отмечено: ' + row.name);
        });
        item.appendChild(mark);
      }

      rows.appendChild(item);
    });
    box.appendChild(rows);

    var paidLine = el('div', 'paid-line', 'Оплачено ' + D.fmtRub(r.paidTotal) + ' из ' + D.fmtRub(r.total));
    box.appendChild(paidLine);
  }

  function renderAll() {
    renderPeople();
    renderItems();
    renderResults();
  }

  /* ---------------- режим гостя ---------------- */

  function renderGuest() {
    if (!incoming) return;
    var r = D.compute(incoming);

    $('myTitle').textContent = incoming.title || 'Счёт';
    $('myTotal').textContent = D.fmtRub(r.total);

    var chips = $('myPeople');
    chips.innerHTML = '';
    incoming.people.forEach(function (name) {
      var chip = el('span', 'chip' + (name === me ? ' active' : ''), name);
      chip.addEventListener('click', function () {
        me = name;
        store(LS_ME, me);
        renderGuest();
      });
      chips.appendChild(chip);
    });

    var box = $('myShare');
    box.innerHTML = '';
    var mine = null;
    for (var i = 0; i < r.rows.length; i++) if (r.rows[i].name === me) mine = r.rows[i];

    var input = $('myPaid');
    if (!mine) {
      box.appendChild(el('div', 'note', 'Выбери своё имя выше.'));
      input.value = '';
    } else {
      box.appendChild(el('div', 'amount', D.fmtRub(mine.share)));
      var note = el('div', 'note');
      if (mine.paid >= mine.share) {
        note.textContent = 'Твоя доля уже оплачена ✓';
      } else {
        note.textContent = 'Уже оплачено: ' + D.fmtRub(mine.paid) + ' · осталось ' + D.fmtRub(mine.share - mine.paid);
        if (document.activeElement !== input) {
          // type="number" принимает только точку — запятая сбрасывает значение
          input.value = ((mine.share - mine.paid) / 100).toFixed(2);
        }
      }
      box.appendChild(note);
    }

    var all = $('myAll');
    all.innerHTML = '';
    r.rows.forEach(function (row) {
      var item = el('div', 'row');
      item.appendChild(el('div', 'nm', row.name));
      item.appendChild(el('div', 'amt', D.fmtRub(row.share)));
      var n = el('div', 'note');
      n.textContent = 'оплачено ' + D.fmtRub(row.paid);
      item.appendChild(n);
      all.appendChild(item);
    });
  }

  function markGuestPaid() {
    if (!incoming) return;
    if (!me) { toast('Сначала выбери, кто ты в счёте'); return; }
    var amount = D.num($('myPaid').value);
    if (!(amount > 0)) { toast('Введи сумму оплаты'); return; }
    incoming.paid[me] = (incoming.paid[me] || 0) + amount;
    var url = D.billUrl(incoming, location.origin + location.pathname);
    var status = D.statusText(incoming, D.compute(incoming), me, D.toKop(amount));
    showSheet(url, 'Отправь ссылку со статусом тому, кто собирает счёт — у него сразу появятся отметки.', status);
    renderGuest();
  }

  /* ---------------- шторка со ссылкой ---------------- */

  var sheetUrl = '';

  function showSheet(url, hint, shareText) {
    sheetUrl = url;
    $('shareUrl').value = url;
    var hintText = hint || '';
    if (url.length > 1500) {
      hintText += ' Ссылка длинная (' + url.length + ' символов) — если мессенджер её обрежет, отправьте текстом или уберите пару позиций.';
    }
    $('shareHint').textContent = hintText;
    $('tgShare').href = 'https://t.me/share/url?url=' + encodeURIComponent(url) +
      '&text=' + encodeURIComponent(shareText || 'Счёт на всех');
    $('shareSheet').hidden = false;
  }

  function closeSheet() { $('shareSheet').hidden = true; }

  function makeLink() {
    if (!state.people.length) { toast('Сначала добавь участников'); return; }
    if (!state.items.length) { toast('Добавь хотя бы одну позицию'); return; }
    var url = D.billUrl(state, location.origin + location.pathname);
    showSheet(url, 'В ссылке — весь счёт. Отправь её в чат: каждый откроет и увидит свою долю.', D.summaryText(state, D.compute(state)));
  }

  /* ---------------- события ---------------- */

  function bind() {
    on('addPerson', 'click', addPerson);
    on('personName', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } });
    on('addItem', 'click', addItem);
    on('itemName', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    on('itemPrice', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

    on('title', 'input', function (e) { state.title = e.target.value; save(); renderResults(); });

    on('discVal', 'input', function (e) { state.disc.v = e.target.value; save(); renderResults(); });
    on('discType', 'change', function (e) { state.disc.t = e.target.value; save(); renderResults(); });
    on('tipVal', 'input', function (e) { state.tip.v = e.target.value; save(); renderResults(); });
    on('tipType', 'change', function (e) { state.tip.t = e.target.value; save(); renderResults(); });

    on('makeLink', 'click', makeLink);
    on('copySummary', 'click', function () {
      if (!state.people.length) { toast('Счёт пустой'); return; }
      copyText(D.summaryText(state, D.compute(state)), 'Сводка скопирована');
    });
    on('newBill', 'click', function () {
      if (!window.confirm('Сбросить текущий счёт?')) return;
      state = D.emptyBill();
      save();
      var t = $('title'); if (t) t.value = '';
      var dv = $('discVal'); if (dv) dv.value = '';
      var tv = $('tipVal'); if (tv) tv.value = '';
      var dt = $('discType'); if (dt) dt.value = 'pct';
      var tt = $('tipType'); if (tt) tt.value = 'pct';
      renderAll();
      toast('Новый счёт готов');
    });

    on('myPaidBtn', 'click', markGuestPaid);
    on('copyLink', 'click', function () { copyText(sheetUrl, 'Ссылка скопирована'); });
    on('closeSheet', 'click', closeSheet);
    on('shareSheet', 'click', function (e) { if (e.target === $('shareSheet')) closeSheet(); });

    on('themeToggle', 'click', function () {
      var root = document.documentElement;
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      store(LS_THEME, next);
      updateThemeButton();
    });

    window.addEventListener('hashchange', function () { location.reload(); });
  }

  function updateThemeButton() {
    var btn = $('themeToggle');
    if (!btn) return;
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    btn.textContent = light ? '☀' : '☾';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f4f6fa' : '#101319');
  }

  /* ---------------- service worker ---------------- */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн не критичен */ });
  }

  /* ---------------- старт ---------------- */

  function init() {
    load();

    // шорткат «Новый счёт» из манифеста
    if (/[?&]new=1/.test(location.search)) {
      state = D.emptyBill();
      save();
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* не критично */ }
    }

    var savedTheme = read(LS_THEME);
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeButton();

    var fromLink = D.readHash(location.hash);
    if (fromLink) {
      incoming = fromLink;
      $('view-bill').hidden = true;
      $('view-my').hidden = false;
      renderGuest();
    } else {
      $('title').value = state.title || '';
      $('discVal').value = state.disc.v ? state.disc.v : '';
      $('tipVal').value = state.tip.v ? state.tip.v : '';
      $('discType').value = state.disc.t;
      $('tipType').value = state.tip.t;
      renderAll();
    }

    bind();
    registerSW();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
