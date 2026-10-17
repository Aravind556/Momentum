import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../core/env.js";
import type { Services } from "../../core/context.js";
import { emailLog } from "../../core/db/schema.js";
import { notify } from "./notify.js";
import { pushNotifier } from "./push.js";

export interface Recipient {
  userId: string;
  email: string;
  name: string;
}

export interface Message {
  subject: string;
  /** Short line for in-app notifications. */
  summary: string;
  /** Plain-text body (the HTML version is generated from it). */
  lines: string[];
  link?: string;
  /** Push only: a newer notification with the same tag replaces the older one. */
  tag?: string;
}

/**
 * A way to reach a user. Email and in-app ship today; web push, Telegram or Discord would be one
 * more implementation registered with `registerNotifier`.
 */
export interface Notifier {
  id: string;
  send(s: Services, to: Recipient, msg: Message): Promise<void>;
}

/* ---------------------------------------------------------------- email */

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}
/** Emails "sent" without SMTP configured (development and tests). */
export const outbox: SentMail[] = [];

let transport: Transporter | null = null;
function smtp(): Transporter | null {
  if (!env.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transport;
}

const escape = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function html(msg: Message) {
  const body = msg.lines.map((l) => (l.startsWith("• ") ? `<li>${escape(l.slice(2))}</li>` : `<p>${escape(l)}</p>`)).join("\n");
  const wrapped = body.replace(/(<li>[\s\S]*<\/li>)/, "<ul>$1</ul>");
  const cta = msg.link ? `<p><a href="${escape(msg.link)}" style="color:#4f5fd6">Open today's plan</a></p>` : "";
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#15181d">${wrapped}${cta}<p style="color:#8a919c;font-size:12px">You can change reminders in Settings.</p></div>`;
}

export const emailNotifier: Notifier = {
  id: "email",
  async send(_s, to, msg) {
    const text = [...msg.lines, ...(msg.link ? ["", msg.link] : []), "", "You can change reminders in Settings."].join("\n");
    const t = smtp();
    if (!t) {
      outbox.push({ to: to.email, subject: msg.subject, text });
      if (!env.isTest) console.log(`[mail] (SMTP not configured) to ${to.email}: ${msg.subject}\n${text}\n`);
      return;
    }
    await t.sendMail({ from: env.smtp.from, to: to.email, subject: msg.subject, text, html: html(msg) });
  },
};

export const inAppNotifier: Notifier = {
  id: "in_app",
  async send(s, to, msg) {
    await notify(s.db, to.userId, "reminder", { message: msg.summary, link: "/" }, `reminder:${msg.subject}:${new Date(s.now()).toISOString().slice(0, 10)}`);
  },
};

const notifiers: Notifier[] = [emailNotifier, inAppNotifier, pushNotifier];
export function registerNotifier(n: Notifier) {
  notifiers.push(n);
}

/**
 * Sends a message once per `key` per channel, on the given channels. The log row is written first
 * (unique key), so concurrent or repeated reminder runs can never double-send.
 */
export async function deliver(s: Services, to: Recipient, key: string, msg: Message, channels: string[]) {
  let sent = 0;
  for (const n of notifiers.filter((x) => channels.includes(x.id))) {
    const [claimed] = await s.db.insert(emailLog).values({ userId: to.userId, key, channel: n.id }).onConflictDoNothing().returning({ id: emailLog.id });
    if (!claimed) continue;
    try {
      await n.send(s, to, msg);
      sent += 1;
    } catch (err) {
      console.error(`[notify] ${n.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
