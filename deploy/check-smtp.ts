import { createSmtpTransport, smtpFailure } from "../src/lib/smtp-transport";

async function main() {
  const { transport, from } = await createSmtpTransport(process.env);
  try {
    if (process.argv.includes("--send-test")) {
      await transport.sendMail({
        from,
        to: from.address,
        subject: "1VPN: проверка SMTP",
        text: "SMTP-сервер принял тестовое письмо от 1VPN.",
      });
      console.log("SMTP-сервер принял тестовое письмо для ящика SMTP_FROM_EMAIL.");
      return;
    }

    await transport.verify();
    console.log("Подключение и настройки авторизации SMTP прошли проверку.");
  } finally {
    transport.close();
  }
}

main().catch((error: unknown) => {
  const { hint, code, command, responseCode, timeout } = smtpFailure(error);
  const details = [code, command, responseCode, timeout].filter(Boolean).join(" ");
  console.error(`Проверка SMTP завершилась ошибкой${details ? ` (${details})` : ""}. ${hint}`);
  process.exitCode = 1;
});
