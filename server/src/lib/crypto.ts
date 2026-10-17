import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

/** AES-256-GCM. Output: "v1:" + base64(iv | tag | ciphertext). */
export function encryptJson(value: unknown, key: Buffer = env.encryptionKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptJson<T>(payload: string, key: Buffer = env.encryptionKey): T {
  if (!payload.startsWith("v1:")) throw new Error("Unknown ciphertext version");
  const buf = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

/** Human-friendly invitation code (no ambiguous characters), ~50 bits of entropy. */
export function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Signed, expiring state value for OAuth round-trips. */
export function signState(data: string, ttlMs = 10 * 60_000): string {
  const payload = `${data}.${Date.now() + ttlMs}.${randomBytes(8).toString("hex")}`;
  const sig = createHmac("sha256", env.encryptionKey).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(state: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 4) return null;
  const [data, exp, nonce, sig] = parts as [string, string, string, string];
  const expected = createHmac("sha256", env.encryptionKey).update(`${data}.${exp}.${nonce}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  return data;
}
