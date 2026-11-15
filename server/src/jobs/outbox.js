// FR-NOT-02 email outbox: notification rows with channel Email and no sent_at are
// sent here, with up to MAX_ATTEMPTS tries. Each row is claimed before sending, so
// two workers never send the same email twice.
import { sendNotificationEmail } from '../lib/emails.js';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export const MAX_ATTEMPTS = 5;

export async function sendPendingEmails({ limit = 50 } = {}) {
  const due = await db.notification.findMany({
    where: { channel: 'Email', sent_at: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { created_at: 'asc' },
    take: limit,
    include: {
      user: { select: { email: true, full_name: true, status: true } },
      contact: { select: { email: true, full_name: true } },
      workspace: { select: { name: true, brand_color: true } },
    },
  });
  let sent = 0;
  for (const n of due) {
    const claimed = await db.notification.updateMany({ where: { id: n.id, sent_at: null, attempts: n.attempts }, data: { attempts: { increment: 1 } } });
    if (claimed.count !== 1) continue;
    const person = n.user ?? n.contact;
    if (!person || (n.user && n.user.status !== 'Active')) {
      await db.notification.update({ where: { id: n.id }, data: { attempts: MAX_ATTEMPTS, last_error: 'Recipient is not active' } });
      continue;
    }
    const p = n.payload ?? {};
    try {
      await sendNotificationEmail({
        to: person.email,
        fullName: person.full_name,
        workspaceName: n.workspace.name,
        brandColor: n.contact_id ? n.workspace.brand_color : undefined,
        subject: p.subject ?? p.title ?? 'Notification',
        paragraphs: [p.text ?? p.title].filter(Boolean),
        link: p.link ?? null,
        replyTo: n.contact_id ? (p.reply_to ?? undefined) : undefined,
      });
      await db.notification.update({ where: { id: n.id }, data: { sent_at: new Date(), last_error: null } });
      sent += 1;
    } catch (err) {
      logger.warn({ err, notificationId: n.id }, 'Notification email failed');
      await db.notification.update({ where: { id: n.id }, data: { last_error: String(err.message ?? err).slice(0, 500) } });
    }
  }
  return sent;
}
