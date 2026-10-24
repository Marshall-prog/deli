/* Дели — чистая логика расчётов и кодирования ссылки.
   Без DOM, без зависимостей: работает и в браузере, и в тестах (QuickJS).
   Всё в копейках (kop), чтобы не накапливалась ошибка float. */
(function (root) {
  'use strict';

  /* ---------- числа и форматирование ---------- */

  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v === null || v === undefined) return 0;
    var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function toKop(rubles) { return Math.round(num(rubles) * 100); }
  function toRub(kop) { return kop / 100; }

  // 12345.6 -> "12 345,6"
  function fmtNum(n) {
    var neg = n < 0;
    var a = Math.abs(n);
    var int = Math.floor(a + 1e-9);
    var frac = Math.round((a - int) * 100);
    if (frac >= 100) { int += 1; frac -= 100; }
    var s = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (frac > 0) s += ',' + (frac % 10 === 0 ? String(frac / 10) : ('0' + frac).slice(-2));
    return (neg ? '−' : '') + s;
  }

  function fmtRub(kop) { return fmtNum(kop / 100) + ' ₽'; }

  // kop -> "1 200" (без символа)
  function fmtPlain(kop) { return fmtNum(kop / 100); }

  /* ---------- модель ---------- */

  function emptyBill() {
    return {
      v: 1,
      title: '',
      people: [],                 // ['Иван', 'Петя']
      items: [],                  // {n: 'Пицца', p: 1200, by: ['Иван','Петя']} или старый {by: 'Иван'}
      disc: { t: 'pct', v: 0 },   // t: 'pct' | 'fixed'
      tip: { t: 'pct', v: 0 },
      split: 'equal',             // всегда equal
      paid: {}                    // { 'Иван': 1200 } — доплаты, снятые по ссылке
    };
  }

  function normalizePayers(it, people) {
    var list = [];
    if (Array.isArray(it.bys)) {
      for (var i = 0; i < it.bys.length; i++) {
        var n = String(it.bys[i] || '').trim().slice(0, 24);
        if (n) list.push(n);
      }
    } else if (it.by !== undefined && it.by !== null && it.by !== '') {
      list.push(String(it.by).trim().slice(0, 24));
    }
    // фильтр по участникам, убираем дубли
    var out = [], seen = {};
    for (var j = 0; j < list.length; j++) {
      var nm = list[j];
      if (!nm) continue;
      // оставляем только тех, кто есть в списке участников (если список есть)
      if (people && people.length) {
        var ok = false;
        for (var p = 0; p < people.length; p++) if (people[p] === nm) { ok = true; break; }
        if (!ok) continue;
      }
      var key = nm.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(nm);
    }
    if (!out.length && people && people.length) out = [people[0]];
    return out;
  }

  function sanitize(bill) {
    var b = emptyBill();
    if (!bill || typeof bill !== 'object') return b;
    b.title = String(bill.title || '').slice(0, 60);
    if (Array.isArray(bill.people)) {
      var seen = {};
      for (var i = 0; i < bill.people.length; i++) {
        var name = String(bill.people[i] || '').trim().slice(0, 24);
        if (!name) continue;
        var key = name.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        b.people.push(name);
      }
    }
    if (Array.isArray(bill.items)) {
      for (var j = 0; j < bill.items.length; j++) {
        var it = bill.items[j];
        if (!it) continue;
        var price = num(it.p);
        if (!(price > 0)) continue;
        var bys = normalizePayers(it, b.people);
        b.items.push({
          n: String(it.n || '').trim().slice(0, 40),
          p: price,
          bys: bys,
          by: bys[0] || ''
        });
      }
    }
    if (bill.disc && (bill.disc.t === 'pct' || bill.disc.t === 'fixed')) {
      b.disc = { t: bill.disc.t, v: Math.max(0, num(bill.disc.v)) };
    }
    if (bill.tip && (bill.tip.t === 'pct' || bill.tip.t === 'fixed')) {
      b.tip = { t: bill.tip.t, v: Math.max(0, num(bill.tip.v)) };
    }
    b.split = 'equal';
    if (bill.paid && typeof bill.paid === 'object') {
      for (var k in bill.paid) {
        if (!Object.prototype.hasOwnProperty.call(bill.paid, k)) continue;
        var amount = num(bill.paid[k]);
        if (amount > 0) b.paid[k] = amount;
      }
    }
    return b;
  }

  /* ---------- расчёт ---------- */

  // Раздаёт целые копейки по остатку (largest remainder), чтобы сумма долей = итогу.
  function distribute(raw) {
    var out = [], i;
    var rest = [], sum = 0;
    for (i = 0; i < raw.length; i++) {
      var f = Math.floor(raw[i]);
      out.push(f);
      rest.push(raw[i] - f);
      sum += f;
    }
    var target = Math.round(raw.reduce(function (a, b) { return a + b; }, 0));
    var need = target - sum;
    var order = [];
    for (i = 0; i < rest.length; i++) order.push(i);
    order.sort(function (a, b) { return rest[b] - rest[a]; });
    var ptr = 0;
    while (need > 0 && order.length) {
      out[order[ptr % order.length]] += 1;
      ptr++; need--;
    }
    var rev = order.slice().reverse();
    ptr = 0;
    while (need < 0 && rev.length) {
      out[rev[ptr % rev.length]] -= 1;
      ptr++; need++;
    }
    return out;
  }

  function compute(billRaw) {
    var bill = sanitize(billRaw);
    var people = bill.people;
    var N = people.length;

    // 1. Нормализуем позиции: считаем долю каждого плательщика в каждой позиции
    var normalizedItems = [];
    var itemsTotal = 0;
    var anyItem = false;

    // baseShares[name] = сумма долей по позициям (до скидки/чаевых)
    var baseShares = {};
    for (var i = 0; i < people.length; i++) baseShares[people[i]] = 0;

    for (var j = 0; j < bill.items.length; j++) {
      var it = bill.items[j];
      var k = toKop(it.p);
      if (k <= 0) continue;
      var bys = normalizePayers(it, people);
      if (!bys.length) continue;
      anyItem = true;
      itemsTotal += k;

      // делим цену позиции поровну между её плательщиками
      var per = Math.floor(k / bys.length);
      var rem = k % bys.length;
      for (var b2 = 0; b2 < bys.length; b2++) {
        var add = per + (b2 < rem ? 1 : 0);
        baseShares[bys[b2]] = (baseShares[bys[b2]] || 0) + add;
      }

      normalizedItems.push({ n: it.n, p: it.p, k: k, bys: bys });
    }

    // 2. Скидка и чаевые считаем в рублях/процентах от суммы позиций
    var discK = bill.disc.t === 'fixed'
      ? toKop(bill.disc.v)
      : Math.round(itemsTotal * bill.disc.v / 100);
    if (discK < 0) discK = 0;
    if (discK > itemsTotal) discK = itemsTotal;

    var baseAfterDisc = itemsTotal - discK;

    var tipK = bill.tip.t === 'fixed'
      ? toKop(bill.tip.v)
      : Math.round(baseAfterDisc * bill.tip.v / 100);
    if (tipK < 0) tipK = 0;

    var total = baseAfterDisc + tipK;

    // 3. Скидка и чаевые распределяем ПОРОВНУ между ВСЕМИ участниками
    // Используем distribute для корректного округления копеек
    var discRaw = [], tipRaw = [];
    for (var p = 0; p < N; p++) {
      discRaw.push(N ? discK / N : 0);
      tipRaw.push(N ? tipK / N : 0);
    }
    var discShares = distribute(discRaw);
    var tipShares = distribute(tipRaw);

    // 4. Итоговые доли: базовая доля - равная_скидка + равные_чаевые
    var shares = [];
    for (var p = 0; p < N; p++) {
      var who = people[p];
      shares.push(baseShares[who] - discShares[p] + tipShares[p]);
    }

    // 4. Кто сколько заплатил: сумма долей позиций, где он платил + ручные отметки
    var paidBy = {};
    for (var q = 0; q < people.length; q++) paidBy[people[q]] = 0;
    for (var m = 0; m < normalizedItems.length; m++) {
      var it2 = normalizedItems[m];
      var k2 = it2.k;
      var bys2 = it2.bys;
      if (!bys2.length) continue;
      var per = Math.floor(k2 / bys2.length);
      var rem = k2 % bys2.length;
      for (var b2 = 0; b2 < bys2.length; b2++) {
        var addPay = per + (b2 < rem ? 1 : 0);
        if (addPay <= 0) continue;
        if (paidBy[bys2[b2]] === undefined) paidBy[bys2[b2]] = 0;
        paidBy[bys2[b2]] += addPay;
      }
    }
    for (var name in bill.paid) {
      if (!Object.prototype.hasOwnProperty.call(bill.paid, name)) continue;
      if (paidBy[name] === undefined) paidBy[name] = 0;
      paidBy[name] += toKop(bill.paid[name]);
    }

    // 5. Результат
    var rows = [];
    var paidTotal = 0;
    for (var r = 0; r < N; r++) {
      var who = people[r];
      var share = shares[r];
      var paid = paidBy[who] || 0;
      paidTotal += paid;
      rows.push({ name: who, share: share, paid: paid, balance: paid - share });
    }

    return {
      people: people,
      rows: rows,
      itemsTotal: itemsTotal,
      discount: discK,
      tip: tipK,
      base: baseAfterDisc,
      total: total,
      paidTotal: paidTotal,
      remaining: total - paidTotal,
      split: 'equal',
      hasItems: anyItem
    };
  }

  /* ---------- base64url + UTF-8 (без TextEncoder/btoa) ---------- */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function b64encode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      out += b2 === undefined ? '=' : B64[b2 & 63];
    }
    return out;
  }

  function b64decode(str) {
    var clean = String(str).replace(/[^A-Za-z0-9+/]/g, '');
    var bytes = [], buf = 0, bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var v = B64.indexOf(clean.charAt(i));
      if (v < 0) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buf >> bits) & 255);
      }
    }
    return bytes;
  }

  function utf8Encode(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c < 0x10000) {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8Decode(bytes) {
    var out = '', i = 0;
    while (i < bytes.length) {
      var b = bytes[i++], c;
      if (b < 0x80) {
        c = b;
      } else if (b < 0xe0) {
        c = ((b & 0x1f) << 6) | (bytes[i++] & 63);
      } else if (b < 0xf0) {
        c = ((b & 0x0f) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      } else {
        c = ((b & 0x07) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      }
      out += String.fromCodePoint(c);
    }
    return out;
  }

  /* ---------- ссылки ---------- */

  function pack(billRaw) {
    var b = sanitize(billRaw);
    var pd = [];
    for (var k in b.paid) {
      if (Object.prototype.hasOwnProperty.call(b.paid, k)) pd.push([k, b.paid[k]]);
    }
    var payload = {
      v: 1,
      t: b.title,
      p: b.people,
      i: b.items.map(function (it) {
        var bys = normalizePayers(it, b.people);
        return [it.n, it.p, bys];
      }),
      d: [b.disc.t, b.disc.v],
      tp: [b.tip.t, b.tip.v],
      s: 'e',
      pd: pd
    };
    var json = JSON.stringify(payload);
    return b64encode(utf8Encode(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unpack(str) {
    if (!str) return null;
    var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    var bytes = b64decode(b64);
    if (!bytes.length) return null;
    var json;
    try { json = utf8Decode(bytes); } catch (e) { return null; }
    var p;
    try { p = JSON.parse(json); } catch (e2) { return null; }
    if (!p || typeof p !== 'object') return null;

    var bill = emptyBill();
    bill.title = String(p.t || '');
    if (Array.isArray(p.p)) bill.people = p.p.map(function (x) { return String(x); });
    if (Array.isArray(p.i)) {
      bill.items = p.i.map(function (x) {
        if (Array.isArray(x[2])) {
          return { n: String(x[0] || ''), p: num(x[1]), bys: x[2] };
        }
        // старый формат
        return { n: String(x[0] || ''), p: num(x[1]), by: String(x[2] || '') };
      });
    }
    if (Array.isArray(p.d)) bill.disc = { t: p.d[0] === 'fixed' ? 'fixed' : 'pct', v: num(p.d[1]) };
    if (Array.isArray(p.tp)) bill.tip = { t: p.tp[0] === 'fixed' ? 'fixed' : 'pct', v: num(p.tp[1]) };
    bill.split = 'equal';
    if (Array.isArray(p.pd)) {
      for (var i = 0; i < p.pd.length; i++) {
        if (p.pd[i] && p.pd[i][0]) bill.paid[p.pd[i][0]] = num(p.pd[i][1]);
      }
    }
    return sanitize(bill);
  }

  function billUrl(bill, base) {
    var b = base || '';
    if (b.charAt(b.length - 1) !== '/') b += '/';
    return b + '#b=' + pack(bill);
  }

  function readHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    var params = h.split('&');
    for (var i = 0; i < params.length; i++) {
      var kv = params[i].split('=');
      if (kv[0] === 'b') return unpack(kv.slice(1).join('='));
    }
    return null;
  }

  /* ---------- тексты ---------- */

  function summaryText(billRaw, res) {
    var r = res || compute(billRaw);
    var lines = [];
    var title = (billRaw && billRaw.title ? String(billRaw.title) : 'Счёт');
    lines.push(title + ' — всего ' + fmtRub(r.total));
    if (r.discount > 0) lines.push('скидка −' + fmtRub(r.discount));
    if (r.tip > 0) lines.push('чаевые +' + fmtRub(r.tip));
    for (var i = 0; i < r.rows.length; i++) {
      var row = r.rows[i];
      var line = row.name + ': заплатил ' + fmtRub(row.paid) + ', должен ' + fmtRub(row.share);
      if (row.balance > 0) line += ' (скидка ' + fmtRub(row.balance) + ')';
      else if (row.balance < 0) line += ' (не хватает ' + fmtRub(-row.balance) + ')';
      lines.push(line);
    }
    lines.push('Оплачено ' + fmtRub(r.paidTotal) + ' из ' + fmtRub(r.total));
    return lines.join('\n');
  }

  function statusText(billRaw, res, who, amountKop) {
    var r = res || compute(billRaw);
    var title = (billRaw && billRaw.title ? String(billRaw.title) : 'Счёт');
    return who + ' заплатил ' + fmtRub(amountKop) + ' по счёту «' + title + '» (итого ' + fmtRub(r.total) + ')';
  }

  root.Dela = {
    num: num,
    toKop: toKop,
    toRub: toRub,
    fmtNum: fmtNum,
    fmtRub: fmtRub,
    fmtPlain: fmtPlain,
    emptyBill: emptyBill,
    sanitize: sanitize,
    compute: compute,
    pack: pack,
    unpack: unpack,
    billUrl: billUrl,
    readHash: readHash,
    summaryText: summaryText,
    statusText: statusText
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
