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
