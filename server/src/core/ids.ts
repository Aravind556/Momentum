import { randomBytes } from "node:crypto";

/** Human-friendly invite code without ambiguous characters (no 0/O, 1/I). */
export function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
