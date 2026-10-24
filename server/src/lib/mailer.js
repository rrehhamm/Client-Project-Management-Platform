// Outgoing email through SMTP (Mailpit locally: http://localhost:8025).
import nodemailer from 'nodemailer';
import { config } from '../config.js';

const { mail } = config;

export const transport = nodemailer.createTransport({
  host: mail.host,
  port: mail.port,
  secure: mail.secure,
  auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
});

/** Send one email. `from` defaults to MAIL_FROM. */
export function sendMail({ to, subject, text, html, replyTo }) {
  return transport.sendMail({ from: mail.from, to, subject, text, html, replyTo });
}

/** Readiness probe: true when the SMTP server accepts a connection. */
export async function pingMail() {
  await transport.verify();
  return true;
}
