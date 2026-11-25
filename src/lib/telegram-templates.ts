import { MS_IN_DAY } from "@/lib/site";
import { formatCurrency, formatDuration } from "@/lib/utils";

export const TELEGRAM_ANNOUNCEMENT_MAX_LENGTH = 16_384;

const buttons = {
  site: { text: "Перейти на сайт ↗", path: "/" },
  account: { text: "Открыть личный кабинет ↗", path: "/dashboard" },
  telegram: { text: "Открыть личный кабинет ↗", path: "/dashboard/account#telegram" },
  balance: { text: "Посмотреть баланс ↗", path: "/dashboard#balance" },
  topUp: { text: "Пополнить баланс ↗", path: "/dashboard#top-up" },
} as const;

export type TelegramButton = keyof typeof buttons;

export function telegramReplyMarkup(button: TelegramButton | undefined, baseUrl: string | undefined) {
  if (!button || !baseUrl || !URL.canParse(baseUrl)) return undefined;

  const destination = buttons[button];
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return undefined;
  return { inline_keyboard: [[{ text: destination.text, url: new URL(destination.path, base).href }]] };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function message(category: string, title: string, body: string) {
  return `${category}\n\n<b>${title}</b>\n\n${body}`;
}

const notice = "🛡 1VPN · Уведомление";
const subscription = "🔒 1VPN · Подписка";

export function queuedTelegramText(text: string) {
  if (/^\S+ 1VPN · /u.test(text)) return text;
  return `${notice}\n\n${text.replace(/^<b>1VPN<\/b>\s*/u, "")}`;
}

export const telegramTemplates = {
  start: () => message(notice, "Подключите Telegram", "Откройте личный кабинет, перейдите в раздел Telegram и нажмите «Открыть бота»."),
  linkExpired: () => message(notice, "Ссылка привязки недействительна", "Создайте новую ссылку в личном кабинете."),
  linkTaken: () => message(notice, "Telegram уже привязан", "Этот Telegram связан с другим аккаунтом 1VPN."),
  linkUsed: () => message(notice, "Не удалось подтвердить привязку", "Ссылка уже использована или аккаунт недоступен."),
  linkRecorded: () => message(notice, "Telegram добавлен", "Проверьте статус привязки в личном кабинете. Если требуется подтверждение, откройте бота из раздела Telegram."),
  linked: () => message(notice, "Telegram подключён", "Ваш аккаунт успешно привязан. Теперь вы будете получать уведомления о балансе и подписке.\n\nМожно возвращаться в личный кабинет."),
  topUp: (amount: number, balance: number, admin = false) => message(
    "💳 1VPN · Оплата",
    "Баланс пополнен",
    `${admin ? "Администратор зачислил" : "На счёт зачислено"}: ${formatCurrency(amount, 2)}\nТекущий баланс: ${formatCurrency(balance, 2)}`,
  ),
  gift: (days: number, description: string) => message(
    "🎁 1VPN · Подписка", `Вам начислено ${formatDuration(days, "day")}`, escapeHtml(description),
  ),
  lowBalance: (balance: number, remainingMs: number) => {
    const time = remainingMs >= MS_IN_DAY ? formatDuration(1, "day")
      : remainingMs >= 3_600_000 ? formatDuration(Math.floor(remainingMs / 3_600_000), "hour")
        : undefined;
    const estimate = time ? `\nПо текущему тарифу средств хватит примерно на ${time}.` : "";
    return message("⚠️ 1VPN · Баланс", "Баланс скоро закончится", `На счёте осталось ${formatCurrency(balance, 2)}.${estimate}`);
  },
  expired: (hours: number) => message(
    subscription, "Доступ приостановлен",
    `На балансе закончились средства. Пополните счёт в течение ${formatDuration(hours, "hour")}, чтобы сохранить подписку.`,
  ),
  deleted: () => message(subscription, "Ссылка подписки удалена", "Ваш аккаунт исключён из группы VPN. Пополните баланс, чтобы создать доступ заново."),
  ban: (banned: boolean) => banned
    ? message(subscription, "Доступ приостановлен", "Доступ к VPN временно приостановлен администратором.")
    : message("✅ 1VPN · Подписка", "Ограничение снято", "Администратор снял блокировку. Статус VPN и ссылку подписки можно проверить в личном кабинете."),
};

const announcementHeader = "📢 1VPN · Объявление";
const announcementTitle = "Новости сервиса";

function splitPosition(text: string, limit: number) {
  if (text.length <= limit) return text.length;

  const slice = text.slice(0, limit);
  // Keep words and ordinary URLs together at page boundaries.
  const wordBoundary = slice.search(/\s(?=\S*$)/u);
  if (wordBoundary >= 0) return wordBoundary + 1;
  return /[\uD800-\uDBFF]$/.test(slice) ? limit - 1 : limit;
}

export function telegramAnnouncement(text: string, withPhoto: boolean) {
  const firstLimit = (withPhoto ? 1024 : 4096) - announcementHeader.length - announcementTitle.length - 4;
  const firstWord = /^https?:\/\/\S+/i.exec(text)?.[0];
  const firstCut = firstWord && firstWord.length > firstLimit && firstWord.length <= 4096
    ? 0 : splitPosition(text, firstLimit);
  const parts = [message(announcementHeader, announcementTitle, escapeHtml(text.slice(0, firstCut)))];

  for (let rest = text.slice(firstCut); rest;) {
    const cut = splitPosition(rest, 4096);
    parts.push(escapeHtml(rest.slice(0, cut)));
    rest = rest.slice(cut);
  }
  return parts;
}
