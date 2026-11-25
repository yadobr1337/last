import Module from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const load = Module._load;
Module._load = function loadTestModule(specifier, ...args) {
  if (specifier === "server-only") return {};
  return load.call(this, specifier, ...args);
};

if (process.env.SITE1VPN_TEST_CHILD !== "1") {
  const root = mkdtempSync(join(tmpdir(), "site1vpn-test-"));
  Object.assign(process.env, {
    DATABASE_URL: `file:${join(root, "local.db").replaceAll("\\", "/")}`,
    NEXTAUTH_SECRET: "offline-test-secret-1vpn",
    NEXTAUTH_URL: "http://127.0.0.1:3719",
    YOOKASSA_SHOP_ID: "123456",
    YOOKASSA_SECRET_KEY: "live_mock_only",
    YOOKASSA_WEBHOOK_SECRET: "",
    YOOKASSA_RETURN_URL: "https://local.test/dashboard",
    CRON_SECRET: "",
    TELEGRAM_BOT_TOKEN: "12345:offline-mock",
    TELEGRAM_USE_CURL_IPV4: "false",
    SMARTCAPTCHA_SITE_KEY: "offline-captcha-site-key",
    SMARTCAPTCHA_SERVER_KEY: "offline-captcha-server-key",
    REMNAWAVE_BASE_URL: "",
    REMNAWAVE_API_TOKEN: "",
    AUTO_PROVISION_ENABLED: "false",
    NODE_ENV: "test",
  });
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
}

globalThis.fetch = async () => {
  throw new Error("Integration tests require a mocked external service.");
};
