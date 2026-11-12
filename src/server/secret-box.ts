/**
 * Secrets a company gives the app (a payment provider's keys) are kept
 * encrypted (AES-256-GCM). The key never lies in the database, so a copy of
 * the database alone reveals nothing: APP_SECRET_KEY when set, otherwise a
 * random key the server makes once and keeps in its upload volume, next to
 * the files and outside every database dump.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { uploadDir } from "./documents";

const VERSION = "v1";
let cached: { source: string; key: Buffer } | null = null;

function keyFile(): string {
  return path.join(uploadDir(), ".keys", "secret.key");
}

function secretKey(): Buffer {
  const own = (process.env.APP_SECRET_KEY ?? "").trim();
  const source = own ? `env:${own}` : `file:${keyFile()}`;
  if (cached?.source === source) return cached.key;
  let material: string;
  if (own) material = own;
  else {
    const file = keyFile();
    if (!existsSync(file)) {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      // "wx": two servers starting at once cannot overwrite each other's key.
      try {
        writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    material = readFileSync(file, "utf8").trim();
  }
  const key = createHash("sha256").update(material).digest();
  cached = { source, key };
  return key;
}

/** "v1.<iv>.<tag>.<data>" — the label lets a later key or method replace this one. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** The plain secret, or null when it was sealed with another key or changed. */
export function unseal(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "sk_test_…4242": enough to recognise a key, never enough to use it. */
export function hint(secret: string): string {
  const prefix = secret.match(/^[a-z]+_(test|live)_/)?.[0] ?? secret.slice(0, 3);
  return `${prefix}…${secret.slice(-4)}`;
}
