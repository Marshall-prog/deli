#!/usr/bin/env python3
"""Браузерный тест «Дели» на настоящем Chromium (playwright).

    python3 tests/browser_test.py [base_url]

Проверяет: добавление людей и позиций, расчёт, скидку, ссылку, режим гостя,
отметку оплаты, сохранение состояния, отсутствие ошибок в консоли.
Скриншоты кладёт в /tmp/opencode/dela-shots/.
"""
import pathlib
import sys

sys.path.insert(0, "/home/marshall/work/.pylibs")
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8123/"
SHOTS = pathlib.Path("/tmp/opencode/dela-shots")
SHOTS.mkdir(parents=True, exist_ok=True)

errors = []
checks = 0


def check(cond, msg, detail=""):
    global checks
    checks += 1
    if not cond:
        raise AssertionError(f"{msg} {detail}".strip())


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            locale="ru-RU",
            timezone_id="Europe/Moscow",
        )
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(BASE)
        page.wait_for_selector("#view-bill:not([hidden])")

        # --- люди ---
        for name in ("Иван", "Петя"):
            page.fill("#personName", name)
            page.click("#addPerson")
        check(page.locator("#peopleList .chip").count() == 2, "добавлены два участника")
        check(page.locator("#peopleList").inner_text().count("Иван") == 1, "Иван в списке")

        # дубль не добавляется
        page.fill("#personName", "иван")
        page.click("#addPerson")
        check(page.locator("#peopleList .chip").count() == 2, "дубль по имени не добавлен")

        # --- позиции ---
        page.fill("#itemName", "Пицца")
        page.fill("#itemPrice", "1200")
        page.select_option("#itemPayer", "Иван")
        page.click("#addItem")
        page.fill("#itemName", "Сок")
        page.fill("#itemPrice", "300")
        page.select_option("#itemPayer", "Петя")
        page.click("#addItem")
        check(page.locator("#itemsList .item-row").count() == 2, "две позиции в списке")

        total = page.inner_text("#results .total")
        check(total == "1 500 ₽", "итог 1 500 ₽", f"(получено {total})")

        shares = page.locator("#results .row .amt").all_inner_texts()
        check(shares == ["750 ₽", "750 ₽"], "доли по 750 ₽", f"(получено {shares})")

        # --- скидка 10% ---
        page.fill("#discVal", "10")
        page.wait_for_timeout(120)
        total = page.inner_text("#results .total")
        check(total == "1 350 ₽", "итог со скидкой 1 350 ₽", f"(получено {total})")
        shares = page.locator("#results .row .amt").all_inner_texts()
        check(shares == ["675 ₽", "675 ₽"], "доли после скидки", f"(получено {shares})")

        page.fill("#title", "Ужин")
        page.wait_for_timeout(80)
        page.screenshot(path=str(SHOTS / "01-bill.png"), full_page=True)

        # --- режим «по заказам» ---
        page.click('#splitMode button[data-split="items"]')
        page.wait_for_timeout(80)
        shares = page.locator("#results .row .amt").all_inner_texts()
        check(shares == ["1 080 ₽", "270 ₽"], "деление по заказам", f"(получено {shares})")
        page.click('#splitMode button[data-split="equal"]')
        page.wait_for_timeout(80)

        # --- ссылка ---
        page.click("#makeLink")
        page.wait_for_selector("#shareSheet:not([hidden])")
        url = page.input_value("#shareUrl")
        check("#b=" in url, "в ссылке есть payload")
        check(len(url) < 900, "ссылка короткая", f"({len(url)} символов)")
        page.screenshot(path=str(SHOTS / "02-sheet.png"))
        page.click("#closeSheet")

        # --- сохранение состояния ---
        page.reload()
        page.wait_for_selector("#view-bill:not([hidden])")
        check(page.inner_text("#results .total") == "1 350 ₽", "счёт сохранился после перезагрузки")
        check(page.input_value("#title") == "Ужин", "название сохранилось")

        # --- service worker ---
        page.wait_for_timeout(1200)
        sw = page.evaluate("() => navigator.serviceWorker.getRegistrations().then(r => r.length)")
        check(sw >= 1, "service worker зарегистрирован", f"(получено {sw})")

        # --- офлайн: после первого визита страница живёт без сети ---
        page.wait_for_timeout(1500)
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector("#view-bill:not([hidden])", timeout=8000)
        check(page.inner_text("#results .total") == "1 350 ₽", "счёт открылся офлайн")
        ctx.set_offline(False)

        # --- режим гостя ---
        guest_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ru-RU")
        guest = guest_ctx.new_page()
        guest.on("pageerror", lambda e: errors.append(f"guest pageerror: {e}"))
        guest.goto(url)
        guest.wait_for_selector("#view-my:not([hidden])")
        check(guest.locator("#view-bill").is_hidden(), "режим создателя скрыт у гостя")
        check("1 350" in guest.inner_text("#myTotal"), "гость видит итог")

        guest.click("#myPeople .chip:has-text('Петя')")
        guest.wait_for_timeout(100)
        share_box = guest.inner_text("#myShare")
        check("675 ₽" in share_box, "гость видит свою долю", f"(получено: {share_box!r})")
        check("осталось 375 ₽" in share_box, "гость видит остаток с учётом своих позиций", f"(получено: {share_box!r})")

        paid_value = guest.input_value("#myPaid")
        check(paid_value == "375.00", "сумма к оплате подставлена (доля минус уже оплаченное)", f"(получено {paid_value})")

        guest.click("#myPaidBtn")
        guest.wait_for_selector("#shareSheet:not([hidden])")
        status_url = guest.input_value("#shareUrl")
        check(status_url != url, "ссылка со статусом отличается от исходной")
        guest.screenshot(path=str(SHOTS / "03-guest.png"), full_page=True)

        # --- создатель видит отметку ---
        back = ctx.new_page()
        back.on("pageerror", lambda e: errors.append(f"back pageerror: {e}"))
        back.goto(status_url)
        back.wait_for_selector("#view-my:not([hidden])")
        back.click("#myPeople .chip:has-text('Петя')")
        back.wait_for_timeout(100)
        check("уже оплачена" in back.inner_text("#myShare").lower(), "оплата отмечена в ссылке",
              f"(получено: {back.inner_text('#myShare')!r})")
        back.screenshot(path=str(SHOTS / "04-status.png"), full_page=True)

        # --- светлая тема ---
        page.click("#themeToggle")
        page.wait_for_timeout(120)
        check(page.get_attribute("html", "data-theme") == "light", "тема переключилась")
        page.screenshot(path=str(SHOTS / "05-light.png"), full_page=True)

        # --- вёрстка: нет горизонтального выезда, кнопки достаточно крупные ---
        page.click("#themeToggle")
        page.wait_for_timeout(100)
        layout = page.evaluate("""() => ({
            scrollW: document.documentElement.scrollWidth,
            innerW: window.innerWidth,
            buttons: Array.from(document.querySelectorAll('.btn')).filter(b => b.offsetParent !== null).map(b => {
                const r = b.getBoundingClientRect();
                return { h: Math.round(r.height), w: Math.round(r.width) };
            }),
            inputs: Array.from(document.querySelectorAll('input, select')).filter(i => i.offsetParent !== null).map(i => {
                const r = i.getBoundingClientRect();
                return { w: Math.round(r.width), h: Math.round(r.height) };
            })
        })""")
        check(layout["scrollW"] <= layout["innerW"] + 1, "нет горизонтального выезда",
              f"(scrollWidth {layout['scrollW']} > innerWidth {layout['innerW']})")
        small = [b for b in layout["buttons"] if b["h"] < 40]
        check(not small, "все кнопки выше 40px", f"(мелкие: {small})")
        narrow = [i for i in layout["inputs"] if i["w"] < 60]
        check(not narrow, "поля ввода не схлопнулись", f"(узкие: {narrow})")

        browser.close()

    if errors:
        print("FAIL: ошибки в консоли:")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    print(f"OK: {checks} браузерных проверок, ошибок в консоли нет")
    print("скриншоты:", SHOTS)


if __name__ == "__main__":
    main()
