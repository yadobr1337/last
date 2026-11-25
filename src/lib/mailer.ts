import "server-only";

import { env } from "@/lib/env";
import { createSmtpTransport, smtpFailure } from "@/lib/smtp-transport";

export function canSendEmail() {
  return Boolean(env.SMTP_HOST?.trim() && env.SMTP_FROM_EMAIL);
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  let transport: Awaited<ReturnType<typeof createSmtpTransport>>["transport"] | undefined;
  try {
    const smtp = await createSmtpTransport(env);
    transport = smtp.transport;
    await transport.sendMail({
      ...params,
      from: smtp.from,
      to: { name: "", address: params.to },
    });
  } catch (error) {
    console.error("[smtp] delivery failed", smtpFailure(error));
    throw error;
  } finally {
    transport?.close();
  }
}
