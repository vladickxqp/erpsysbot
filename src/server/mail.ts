/**
 * Sending e-mail over SMTP. Optional: without SMTP_HOST the app works and
 * shows links to copy instead (invitations, password links).
 */
import { createTransport } from "nodemailer";
import { mailFrom, smtp } from "./settings";

export type Mail = {
  to: string;
  subject: string;
  text: string;
  /** Where answers go: the company, not the address the server sends from. */
  replyTo?: string;
  attachments?: { filename: string; content: Uint8Array; contentType?: string }[];
};

type Sender = (mail: Mail) => Promise<void | { messageId?: string }>;

let sender: Sender | null = null;
/** Tests replace the transport; null puts the real one back. */
let override: Sender | null = null;

export function setMailSender(fn: Sender | null): void {
  override = fn;
}

/**
 * Mails per company and day (MAIL_DAILY_LIMIT, default 200): the server's
 * sender address must not become anyone's spam cannon. Counted in memory,
 * reset with the day.
 */
const sentToday = new Map<string, { day: string; count: number }>();

export function takeMailBudget(organizationId: string): boolean {
  const limit = Number(process.env.MAIL_DAILY_LIMIT) > 0 ? Math.floor(Number(process.env.MAIL_DAILY_LIMIT)) : 200;
  const day = new Date().toISOString().slice(0, 10);
  const entry = sentToday.get(organizationId);
  const count = entry?.day === day ? entry.count : 0;
  if (count >= limit) return false;
  sentToday.set(organizationId, { day, count: count + 1 });
  return true;
}

/** A few of one kind per day, e.g. links to one address: mail must not be turned on someone. */
export function takeMailThrottle(key: string, perDay = 5): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const entry = sentToday.get(key);
  const count = entry?.day === day ? entry.count : 0;
  if (count >= perDay) return false;
  sentToday.set(key, { day, count: count + 1 });
  return true;
}

export function mailAvailable(): boolean {
  return override !== null || smtp() !== null;
}

export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailAvailable()) return false;
  await deliverMail(mail);
  return true;
}

/** Hands the mail to the server; throws when it does not take it. */
export async function deliverMail(mail: Mail): Promise<{ messageId: string | null }> {
  if (override) return { messageId: (await override(mail))?.messageId ?? null };
  const config = smtp();
  if (!config) throw new Error("no mail server");
  sender ??= (() => {
    const transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });
    return async (m: Mail) => {
      const info = await transport.sendMail({
        from: mailFrom() ?? config.user,
        to: m.to,
        replyTo: m.replyTo,
        subject: m.subject,
        text: m.text,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
      });
      return { messageId: info.messageId };
    };
  })();
  return { messageId: (await sender(mail))?.messageId ?? null };
}
