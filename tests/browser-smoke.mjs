import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function until(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check().catch(() => null);
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

export async function runBrowserSmoke(executable, origin, root, { email, admin, subscription, password, screenshotDir }) {
  const profile = join(root, "browser-profile");
  const browser = spawn(executable, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--no-first-run",
    "--no-default-browser-check", "--disable-gpu",
    "--disk-cache-size=1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  browser.on("error", (error) => console.error(error.message));
  const exited = once(browser, "exit").then(() => true, () => false);
  let socket;
  let send;
  try {
    const devtools = await until(() => readFile(join(profile, "DevToolsActivePort"), "utf8"), "Chromium DevTools");
    const port = devtools.split("\n")[0].trim();
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = pages.find(({ type }) => type === "page");
    assert.ok(page);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, "open");
    let nextId = 0;
    const callbacks = new Map();
    const observedRequests = new Set();
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.method === "Network.requestWillBeSent") observedRequests.add(data.params.request.url);
      const pending = callbacks.get(data.id);
      if (!pending) return;
      callbacks.delete(data.id);
      if (data.error) pending.reject(new Error(data.error.message));
      else pending.resolve(data.result);
    });
    send = async (method, params = {}) => {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        callbacks.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    };
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await send("Page.enable");
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Network.setBlockedURLs", { urls: ["https://*"] });

    await send("Browser.grantPermissions", {
      origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

    const inPage = (fn, ...args) => evaluate("(" + fn + ")(..." + JSON.stringify(args) + ")");
    const waitFor = (selector) => until(() => inPage((value) => Boolean(document.querySelector(value)), selector), selector);
    const click = async (selector, label) => {
      assert.ok(await inPage((query, text) => {
        const element = [...document.querySelectorAll(query)].find((item) => !text || item.textContent.trim() === text);
        if (!element || element.disabled) return false;
        element.focus();
        element.click();
        return true;
      }, selector, label), label ?? selector);
    };
    const key = async (name) => {
      const keyCode = { Escape: 27, Enter: 13, ArrowRight: 39 }[name];
      const event = { key: name, code: name, windowsVirtualKeyCode: keyCode };
      if (name === "Enter") {
        await send("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...event });
      } else {
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
      }
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
    };
    const navigate = async (path) => {
      await send("Page.navigate", { url: origin + path });
      await until(() => inPage((value) => location.pathname + location.search === value &&
        document.readyState === "complete" && Boolean(document.querySelector("main h1")), path), path);
    };
    const widths = [[320, 680], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]];
    const viewport = async (width, height) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
      await until(() => inPage((value) => Math.abs(document.documentElement.clientWidth - value) <= 12, width), "viewport " + width);
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
    };
    const capture = async (name) => {
      if (!screenshotDir) return;
      await evaluate("document.fonts.ready.then(() => true)");
      const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(join(screenshotDir, name + ".png"), Buffer.from(data, "base64"));
    };
    const captureLogoFrame = async () => {
      const clip = await inPage(() => {
        const { x, y, width, height } = document.querySelector(".hero-art img").getBoundingClientRect();
        return { x: x + scrollX, y: y + scrollY, width, height, scale: 1 };
      });
      const { data } = await send("Page.captureScreenshot", { format: "png", clip });
      return createHash("sha256").update(data).digest("hex");
    };
    const inspect = async (path, name) => {
      await navigate(path);
      for (const [width, height] of widths) {
        await viewport(width, height);
        const overflow = await inPage((limit) => document.documentElement.scrollWidth > limit
          ? { width: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("main *")]
            .filter((element) => element.getBoundingClientRect().right > limit + 1 ||
              element.clientWidth && element.scrollWidth + element.getBoundingClientRect().left > limit + 1)
            .slice(0, 8).map((element) => element.tagName + "." + element.className) }
          : null, width);
        assert.equal(overflow, null, path + " scrolls horizontally at " + width + "px: " + JSON.stringify(overflow));
        if (width === 390 || width === 1440) {
          if (path === "/") {
            await until(() => inPage(() => {
              const image = document.querySelector(".hero-art img");
              return image?.complete && image.naturalWidth > 0 && image.currentSrc.endsWith("/1vpn-one-network.svg");
            }), "animated hero logo");
          }
          await capture(name + (width === 390 ? "-mobile" : "-desktop"));
        }
      }
      console.log("PASS layout:", path, "at", widths.map(([width]) => width).join(", "), "px.");
    };
    const login = async (address) => {
      await navigate("/login");
      await inPage((account, secret) => {
        const emailField = document.querySelector("#login-email");
        emailField.value = account;
        document.querySelector("#login-password").value = secret;
        emailField.form.requestSubmit();
      }, address, password);
      await until(() => evaluate('location.pathname === "/dashboard" && document.querySelector("main h1") !== null'),
        "authenticated dashboard");
    };

    await inspect("/", "home");
    assert.deepEqual(await inPage(() => {
      const edition = document.querySelector(".site-header .brand-edition");
      return {
        title: document.querySelector("main h1").textContent.replace(/\s+/g, " "),
        edition: edition.textContent,
        color: getComputedStyle(edition).color,
      };
    }), { title: "Твой интернет. Твои правила.", edition: "STABLE", color: "rgb(99, 216, 160)" });
    assert.equal(await evaluate('document.querySelector(".hero-art img").fetchPriority'), "high");
    assert.match(await evaluate('document.querySelector("#faq").textContent'), /24\s*часа/);
    assert.ok(!observedRequests.has(origin + "/api/public/settings"), "SSR prices need no duplicate request");
    await viewport(390, 844);
    await click(".mobile-menu summary");
    await waitFor(".mobile-menu[open]");
    await key("Escape");
    await until(() => evaluate("!document.querySelector('.mobile-menu').open"), "mobile menu closes with Escape");
    const animatedFrame = await captureLogoFrame();
    await delay(420);
    assert.notEqual(await captureLogoFrame(), animatedFrame, "The SVG animates when motion is enabled");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert.equal(await evaluate("getComputedStyle(document.documentElement).scrollBehavior"), "auto");
    const staticLogo = await until(() => inPage(() => {
      const image = document.querySelector(".hero-art img");
      return image.complete && image.naturalWidth > 0 && image.currentSrc.endsWith("/1vpn-one-network-static.svg") && image.currentSrc;
    }), "static logo selection in reduced motion");
    const logoPixels = () => inPage(() => {
      const surface = document.createElement("canvas");
      surface.width = 160;
      surface.height = 160;
      surface.getContext("2d").drawImage(document.querySelector(".hero-art img"), 0, 0, 160, 160);
      return surface.toDataURL();
    });
    const staticFrame = await logoPixels();
    await delay(420);
    assert.ok(await logoPixels() === staticFrame, "The logo stays still with reduced motion");
    const staticSvg = await (await fetch(staticLogo)).text();
    assert.doesNotMatch(staticSvg, /<animate|@keyframes/i);
    await inPage(() => document.querySelector("#faq summary").focus());
    assert.equal(await evaluate("document.activeElement.tagName"), "SUMMARY");
    await key("Enter");
    await waitFor("#faq details[open]");
    await key("Enter");
    await until(() => evaluate('!document.querySelector("#faq details[open]")'), "FAQ closes with the keyboard");

    await inspect("/login", "login");
    await click("button[aria-label='Показать пароль']");
    assert.equal(await evaluate('document.querySelector("#login-password").type'), "text");
    await inPage((account) => {
      const emailField = document.querySelector("#login-email");
      emailField.value = account;
      document.querySelector("#login-password").value = "wrong-fixture-password";
      emailField.form.requestSubmit();
    }, email);
    await until(() => evaluate('document.querySelector("form [role=alert]")?.textContent.includes("Проверьте почту и пароль")'), "invalid login feedback");
    await click("button", "Забыли пароль?");
    await waitFor("#reset-email");
    await inspect("/register", "register");
    assert.ok(await evaluate('document.querySelector("#register-password").minLength === 8'));
    await login(email);
    await inspect("/dashboard", "dashboard");
    assert.equal(await evaluate('document.querySelector("#connection a[target=_blank]").href'), subscription);
    const copyButton = await inPage(() => {
      const element = document.querySelector("#connection button");
      element.scrollIntoView({ behavior: "instant", block: "center" });
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + width / 2, y: y + height / 2 };
    });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...copyButton });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...copyButton });
    await until(() => evaluate('document.querySelector("#connection button").textContent.includes("Скопировано")'), "clipboard feedback");
    assert.equal(await evaluate("navigator.clipboard.readText()"), subscription);

    await click("main button", "Пополнить");
    await waitFor("dialog[open]");
    assert.ok(await evaluate('document.querySelector("dialog[open]").contains(document.activeElement)'));
    assert.ok(await evaluate('document.querySelector("dialog[open]").innerText.includes("Тестовое пополнение")'));
    await click("dialog[open] input[value=sbp]");
    assert.equal(await evaluate('document.querySelector("dialog input:checked").value'), "sbp");
    await viewport(1440, 900);
    await capture("billing-desktop");
    await viewport(390, 844);
    await capture("billing-mobile");
    await key("Escape");
    await until(() => evaluate('!document.querySelector("dialog[open]")'), "dialog closes with Escape");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "Пополнить");
    await click("button[aria-label='Увеличить количество устройств']");
    await until(() => evaluate('document.querySelector("output").textContent === "2"'), "device stepper");
    await click("#devices button", "Сохранить");
    await until(() => evaluate('performance.getEntriesByType("resource").some((entry) => entry.name.endsWith("/dashboard") && entry.initiatorType === "fetch")'),
      "device limit response");

    await inspect("/dashboard/account", "account");
    assert.ok(await evaluate('Boolean(document.querySelector("input[name=newPassword]"))'));
    await click(".console-sidebar button", "Выйти");
    await until(() => evaluate('location.pathname === "/" || location.pathname === "/login"'), "sign out");

    await login(admin);
    await inspect("/admin", "admin");
    assert.ok(await evaluate('document.querySelector("#finance").innerText.includes("smoke-payment")'));
    await click("[role=tab]", "Тариф и подписка");
    await key("ArrowRight");
    await until(() => evaluate('document.querySelector("[role=tab][aria-selected=true]").textContent === "Сайт и защита"'),
      "keyboard navigation between settings tabs");
    await waitFor('[role=tabpanel]:not([hidden]) input[name=captchaEnabled]');
    await click("[role=tab]", "Тариф и подписка");
    await inPage(() => {
      document.querySelector('[name="pricePerDay"]').value = "53.5";
      document.querySelector('[name="trialDays"]').value = "3";
    });
    await click("#finance button", "Сохранить настройки");
    await until(() => evaluate('fetch("/api/public/settings").then((res) => res.json()).then((data) => data.monthlyPriceKopeks === 160500 && data.trialDays === 3)'),
      "saved daily tariff appears in the public API");
    const publicCopy = await inPage(async () => {
      const markup = await (await fetch("/")).text();
      const page = new DOMParser().parseFromString(markup, "text/html");
      return {
        price: page.querySelector(".hero-price").textContent,
        faq: page.querySelector("#faq").textContent,
      };
    });
    assert.match(publicCopy.price, /53,5\s*₽/);
    assert.match(publicCopy.faq, /3\s*дня/);
    assert.ok(await evaluate('document.querySelector("#nodes").textContent.includes("Timeweb")'));
    assert.ok(await evaluate('document.querySelector("#notifications").textContent.includes("Telegram")'));
    assert.ok(await evaluate('document.querySelector("#journal").textContent.includes("Журнал событий")'));
    await inPage((address) => {
      const field = document.querySelector('#users input[name="user"]');
      field.value = address;
      field.form.requestSubmit();
    }, email);
    await waitFor('dialog[open][data-layout="drawer"]');
    await viewport(1440, 900);
    await capture("admin-user-desktop");
    await viewport(390, 844);
    await capture("admin-user-mobile");
    await click('dialog[open] button', "Заблокировать пользователя");
    await until(() => evaluate('document.querySelectorAll("dialog[open]").length === 2'), "ban confirmation");
    await click('dialog[open] button', "Отмена");
    await until(() => evaluate('document.querySelectorAll("dialog[open]").length === 1'), "confirmation cancelled");
    await click('dialog[open] button', "Заблокировать пользователя");
    await until(() => evaluate('document.querySelectorAll("dialog[open]").length === 2'), "reopened confirmation");
    const focusState = () => inPage(() => ({
      active: document.activeElement?.getAttribute("aria-label"),
      layout: document.activeElement?.closest("dialog")?.dataset.layout,
      open: [...document.querySelectorAll("dialog[open]")].map((dialog) => dialog.dataset.layout),
    }));
    const beforeEscape = await until(async () => {
      const state = await focusState();
      return state.layout === "standard" && state;
    }, "confirmation owns keyboard focus");
    await key("Escape");
    await until(() => evaluate('document.querySelectorAll("dialog[open]").length === 1'), "Escape closes only the confirmation")
      .catch(async (error) => { console.error({ beforeEscape, afterEscape: await focusState() }); throw error; });
    await key("Escape");
    await until(() => evaluate('!document.querySelector("dialog[open]")'), "closed user drawer");
    await click("#gift-days button");
    await waitFor("dialog[open] input[name=days]");
    await inPage(() => {
      document.querySelector("dialog[open] input[name=days]").value = "1";
      document.querySelector("dialog[open] textarea[name=description]").value = "Obsidian QA gift";
    });
    await click("dialog[open] button", "Начислить всем");
    await until(() => evaluate('document.querySelectorAll("dialog[open]").length === 2'), "gift confirmation");
    await click("dialog[open][data-layout=standard] button", "Начислить дни");
    await until(() => evaluate('document.querySelector("dialog[open] [role=status]")?.textContent.includes("Ошибок баланса: 0")'),
      "gift days were applied");
    await key("Escape");
    await until(() => evaluate('!document.querySelector("dialog[open]")'), "closed gift dialog");
    await click("#maintenance-controls button");
    await waitFor("dialog[open]");
    await click("dialog[open] input[name=enabled]");
    await inPage(() => { document.querySelector("dialog[open] textarea[name=message]").value = "Obsidian QA maintenance"; });
    await click("dialog[open] button", "Сохранить режим");
    await until(() => evaluate('document.querySelector("dialog[open] [role=status]")?.textContent.includes("Технический режим включён")'),
      "maintenance settings were saved");
    console.log("PASS browser: menu, reduced motion, recovery form, login, clipboard, billing dialog, device limit, account, logout, admin search, confirmation, tariff, gift days and maintenance.");
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) {
      void send("Browser.close").catch(() => undefined);
      await Promise.race([exited, delay(5_000)]);
    }
    socket?.close();
    if (browser.exitCode === null && browser.pid) {
      browser.kill();
      await Promise.race([exited, delay(2_000)]);
    }
  }
}
