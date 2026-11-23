import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
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

export async function runBrowserSmoke(executable, origin, root, email, password) {
  const profile = join(root, "browser-profile");
  const browser = spawn(executable, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--no-first-run",
    "--no-default-browser-check", "--inprivate", "--incognito", "--disable-gpu",
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
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await send("Page.enable");
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Network.setBlockedURLs", { urls: ["https://*"] });

    for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width === 390 });
      await send("Page.navigate", { url: origin + "/" });
      await until(() => evaluate(`document.readyState === "complete" && Boolean(document.querySelector("main h1"))`), "homepage");
      const layout = await evaluate(`(() => {
        const logo = document.querySelector('img[alt="1VPN logo"]');
        return { viewport: innerWidth, width: document.documentElement.scrollWidth,
          logoWidth: logo?.naturalWidth, priority: logo?.fetchPriority };
      })()`);
      assert.equal(layout.viewport, width);
      assert.ok(layout.width <= width, `Horizontal scroll at ${width}px: ${layout.width}px`);
      assert.ok(layout.logoWidth > 0, "Hero image loaded");
      assert.equal(layout.priority, "high");
    }
    assert.ok(!observedRequests.has(origin + "/api/public/settings"), "SSR prices need no duplicate request");

    await send("Page.navigate", { url: origin + "/login" });
    await until(() => evaluate(`location.pathname === "/login" && document.readyState === "complete"`), "login form");
    await evaluate(`(() => {
      const email = document.querySelector('input[name="email"]');
      const password = document.querySelector('input[name="password"]');
      email.value = ${JSON.stringify(email)};
      password.value = ${JSON.stringify(password)};
      email.form.requestSubmit();
      return true;
    })()`);
    await until(() => evaluate(`location.pathname === "/dashboard" && document.querySelector("main h1") !== null`), "authenticated dashboard");
    console.log("PASS browser: home at 390, 768 and 1440px, hero priority, no duplicate pricing request and login.");
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
