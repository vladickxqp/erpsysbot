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
  attachments?: { filename: string; content: Uint8Array; contentType?: string }[];
};

type Sender = (mail: Mail) => Promise<void>;

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

export function mailAvailable(): boolean {
  return override !== null || smtp() !== null;
}

export async function sendMail(mail: Mail): Promise<boolean> {
  if (override) {
    await override(mail);
    return true;
  }
  const config = smtp();
  if (!config) return false;
  sender ??= (() => {
    const transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });
    return async (m: Mail) => {
      await transport.sendMail({
        from: mailFrom() ?? config.user,
        to: m.to,
        subject: m.subject,
        text: m.text,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
      });
    };
  })();
  await sender(mail);
  return true;
}
