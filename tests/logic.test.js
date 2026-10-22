/* Тесты логики «Дели». Запуск: QuickJS (dukpy) — см. README, раздел «Тесты». */
(function () {
  var D = globalThis.Dela;
  var passed = 0;

  function eq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(msg + ' → получено ' + JSON.stringify(actual) + ', ожидалось ' + JSON.stringify(expected));
    }
    passed++;
  }

  function near(actual, expected, msg) {
    if (Math.abs(actual - expected) > 1e-9) {
      throw new Error(msg + ' → получено ' + actual + ', ожидалось ' + expected);
    }
    passed++;
  }

  /* ---------- форматирование ---------- */
  eq(D.fmtNum(1234), '1 234', 'fmtNum целое');
  eq(D.fmtNum(1234.5), '1 234,5', 'fmtNum с дробью');
  eq(D.fmtNum(1234.56), '1 234,56', 'fmtNum копейки');
  eq(D.fmtNum(0), '0', 'fmtNum ноль');
  eq(D.fmtNum(-400), '−400', 'fmtNum минус');
  eq(D.fmtRub(150000), '1 500 ₽', 'fmtRub');

  /* ---------- базовый расчёт ---------- */
  var b1 = D.sanitize({
    people: ['Иван', 'Петя'],
    items: [{ n: 'Пицца', p: 1200, by: 'Иван' }, { n: 'Сок', p: 800, by: 'Петя' }]
  });
  var r1 = D.compute(b1);
  eq(r1.itemsTotal, 200000, 'сумма позиций');
  eq(r1.total, 200000, 'итого');
  eq(r1.rows.length, 2, 'строк расчёта');
  eq(r1.rows[0].share, 100000, 'доля пополам (Иван)');
  eq(r1.rows[1].share, 100000, 'доля пополам (Петя)');
  eq(r1.rows[0].paid, 120000, 'Иван заплатил за пиццу');
  eq(r1.rows[1].paid, 80000, 'Петя заплатил за сок');
  eq(r1.rows[0].balance, 20000, 'переплата Ивана');
  eq(r1.rows[1].balance, -20000, 'долг Пети');
  eq(r1.paidTotal, 200000, 'оплачено всего');

  /* ---------- делим по заказам ---------- */
  var b2 = D.sanitize({
    people: ['Иван', 'Петя'],
    items: [{ n: 'Стейк', p: 1500, by: 'Иван' }, { n: 'Салат', p: 500, by: 'Петя' }],
    split: 'items'
  });
  var r2 = D.compute(b2);
  eq(r2.rows[0].share, 150000, 'доля по заказам (Иван)');
  eq(r2.rows[1].share, 50000, 'доля по заказам (Петя)');

  /* ---------- скидка ---------- */
  var b3 = D.sanitize({
    people: ['Иван', 'Петя'],
    items: [{ n: 'Пицца', p: 2000, by: 'Иван' }],
    disc: { t: 'pct', v: 10 }
  });
  var r3 = D.compute(b3);
  eq(r3.discount, 20000, 'скидка 10%');
  eq(r3.total, 180000, 'итог после скидки');
  eq(r3.rows[0].share, 90000, 'доля после скидки');

  /* ---------- фиксированная скидка больше суммы не уводит итог в минус ---------- */
  var b4 = D.sanitize({
    people: ['Иван'],
    items: [{ n: 'Кофе', p: 300, by: 'Иван' }],
    disc: { t: 'fixed', v: 500 }
  });
  var r4 = D.compute(b4);
  eq(r4.discount, 30000, 'скидка обрезана по сумме');
  eq(r4.total, 0, 'итог не отрицательный');

  /* ---------- чаевые считаются от суммы после скидки ---------- */
  var b5 = D.sanitize({
    people: ['Иван', 'Петя'],
    items: [{ n: 'Пицца', p: 2000, by: 'Иван' }],
    disc: { t: 'pct', v: 10 },
    tip: { t: 'pct', v: 10 }
  });
  var r5 = D.compute(b5);
  eq(r5.base, 180000, 'база после скидки');
  eq(r5.tip, 18000, 'чаевые 10% от базы');
  eq(r5.total, 198000, 'итог с чаевыми');
  eq(r5.rows[0].share, 99000, 'доля с чаевыми');

  /* ---------- фиксированные чаевые ---------- */
  var b6 = D.sanitize({
    people: ['Иван'],
    items: [{ n: 'Пицца', p: 1000, by: 'Иван' }],
    tip: { t: 'fixed', v: 150 }
  });
  eq(D.compute(b6).total, 115000, 'итог с фиксированными чаевыми');

  /* ---------- копейки не теряются ---------- */
  var b7 = D.sanitize({
    people: ['Иван', 'Петя'],
    items: [{ n: 'Кофе', p: 133.33, by: 'Иван' }, { n: 'Чай', p: 66.67, by: 'Петя' }]
  });
  var r7 = D.compute(b7);
  eq(r7.itemsTotal, 20000, 'сумма с копейками');
  eq(r7.rows[0].share + r7.rows[1].share, r7.total, 'сумма долей равна итогу');

  /* ---------- остаток от деления не теряется ---------- */
  var b8 = D.sanitize({
    people: ['А', 'Б', 'В'],
    items: [{ n: 'Счёт', p: 1000, by: 'А' }]
  });
  var r8 = D.compute(b8);
  eq(r8.rows[0].share + r8.rows[1].share + r8.rows[2].share, 100000, '1000 на троих — без потери копейки');
  eq(r8.rows[0].share, 33334, 'первая доля');
  eq(r8.rows[2].share, 33333, 'третья доля');

  /* ---------- ручные отметки об оплате ---------- */
  var b9 = D.sanitize({
    people: ['Иван', 'Петя'],
    items: [{ n: 'Пицца', p: 2000, by: 'Петя' }],
    paid: { 'Иван': 1000 }
  });
  var r9 = D.compute(b9);
  eq(r9.rows[0].paid, 100000, 'ручная оплата учтена');
  eq(r9.rows[1].paid, 200000, 'оплата по позициям учтена');
  eq(r9.paidTotal, 300000, 'оплачено всего с ручной отметкой');
  eq(r9.remaining, -100000, 'остаток считается со знаком');

  /* ---------- sanitize чистит мусор ---------- */
  var b10 = D.sanitize({
    people: ['Иван', 'иван', '  Петя  ', ''],
    items: [{ n: 'Пусто', p: 0, by: 'Иван' }, { n: 'Норм', p: 100, by: 'Петя' }]
  });
  eq(b10.people.length, 2, 'дубли и пустые убраны');
  eq(b10.items.length, 1, 'позиция с нулевой ценой убрана');
  eq(b10.people[1], 'Петя', 'имя обрезано');

  /* ---------- без людей и позиций ---------- */
  var r11 = D.compute(D.emptyBill());
  eq(r11.total, 0, 'пустой счёт — ноль');
  eq(r11.rows.length, 0, 'пустой счёт — нет строк');

  /* ---------- упаковка ссылки: русский текст ---------- */
  var bill = D.sanitize({
    title: 'Ужин в «Шаурме»',
    people: ['Иван', 'Петя'],
    items: [{ n: 'Шаурма', p: 450, by: 'Иван' }, { n: 'Компот', p: 120.5, by: 'Петя' }],
    disc: { t: 'pct', v: 5 },
    tip: { t: 'fixed', v: 50 },
    split: 'items',
    paid: { 'Петя': 120.5 }
  });
  var packed = D.pack(bill);
  eq(packed.indexOf('='), -1, 'base64url без padding');
  eq(packed.indexOf('+'), -1, 'base64url без +');
  eq(packed.indexOf('/'), -1, 'base64url без /');

  var back = D.unpack(packed);
  eq(back.title, 'Ужин в «Шаурме»', 'название восстановлено');
  eq(back.people.join(','), 'Иван,Петя', 'люди восстановлены');
  eq(back.items.length, 2, 'позиции восстановлены');
  eq(back.items[1].n, 'Компот', 'название позиции восстановлено');
  eq(back.items[1].p, 120.5, 'цена позиции восстановлена');
  eq(back.disc.t, 'pct', 'тип скидки восстановлен');
  eq(back.disc.v, 5, 'скидка восстановлена');
  eq(back.tip.t, 'fixed', 'тип чаевых восстановлен');
  eq(back.tip.v, 50, 'чаевые восстановлены');
  eq(back.split, 'items', 'режим деления восстановлен');
  eq(back.paid['Петя'], 120.5, 'отметки об оплате восстановлены');
  eq(D.compute(back).total, D.compute(bill).total, 'итог после round-trip совпал');

  /* ---------- чтение ссылки из hash ---------- */
  var url = D.billUrl(bill, 'https://example.org/app/');
  eq(url.indexOf('https://example.org/app/#b='), 0, 'ссылка собрана правильно');
  var fromHash = D.readHash(url.split('#')[1]);
  eq(fromHash.title, 'Ужин в «Шаурме»', 'счёт прочитан из hash');
  eq(D.readHash('b=' + packed + '&x=1').people.length, 2, 'hash с параметрами разобран');
  eq(D.readHash('x=1'), null, 'мусорный hash → null');
  eq(D.readHash(''), null, 'пустой hash → null');
  eq(D.unpack('не-base64-совсем'), null, 'битая ссылка → null');

  /* ---------- тексты ---------- */
  var sum = D.summaryText(bill, D.compute(bill));
  eq(sum.indexOf('Иван: заплатил') === 0, false, 'сводка начинается с названия');
  eq(sum.indexOf('всего') > -1, true, 'в сводке есть итог');
  eq(sum.indexOf('Петя') > -1, true, 'в сводке есть участники');
  var st = D.statusText(bill, D.compute(bill), 'Петя', 12050);
  eq(st.indexOf('Петя заплатил 120,5 ₽') === 0, true, 'статус-текст корректен');

  return 'OK: ' + passed + ' проверок пройдено';
})();
