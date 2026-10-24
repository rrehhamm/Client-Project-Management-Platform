// Transactional email content. Plain text plus minimal, escaped HTML, carrying the
// workspace name (FR-PORT-07: no vendor branding).
import { config } from '../config.js';
import { sendMail } from './mailer.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export const appLink = (path) => new URL(path, config.appUrl).toString();

function render({ workspaceName, greetingName, paragraphs, action }) {
  const text = [
    `Hello ${greetingName},`,
    '',
    ...paragraphs,
    ...(action ? ['', `${action.label}: ${action.url}`] : []),
    '',
    `— ${workspaceName}`,
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>Hello ${escapeHtml(greetingName)},</p>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${action ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:#555">Or paste this link into your browser: ${escapeHtml(action.url)}</p>` : ''}
<p>— ${escapeHtml(workspaceName)}</p></body></html>`;
  return { text, html };
}

export function sendInviteEmail({ to, fullName, workspaceName, inviterName, token }) {
  const body = render({
    workspaceName,
    greetingName: fullName,
    paragraphs: [
      `${inviterName} invited you to join ${workspaceName}.`,
      'Set your password to activate your account. This link works once and expires in 7 days.',
    ],
    action: { label: 'Set your password', url: appLink(`/accept-invite?token=${token}`) },
  });
  return sendMail({ to, subject: `You're invited to ${workspaceName}`, ...body });
}

export function sendPasswordResetEmail({ to, fullName, workspaceName, token }) {
  const body = render({
    workspaceName,
    greetingName: fullName,
    paragraphs: [
      'We received a request to reset your password.',
      'This link works once and expires in 60 minutes. If you did not ask for this, you can ignore this email.',
    ],
    action: { label: 'Reset your password', url: appLink(`/reset-password?token=${token}`) },
  });
  return sendMail({ to, subject: `Reset your ${workspaceName} password`, ...body });
}

export function sendPasswordChangedEmail({ to, fullName, workspaceName }) {
  const body = render({
    workspaceName,
    greetingName: fullName,
    paragraphs: [
      'Your password was just changed and your other sessions were signed out.',
      'If this was not you, reset your password now and contact your workspace admin.',
    ],
    action: { label: 'Reset your password', url: appLink('/forgot-password') },
  });
  return sendMail({ to, subject: `Your ${workspaceName} password was changed`, ...body });
}

export function sendEmailChangeVerification({ to, fullName, workspaceName, token }) {
  const body = render({
    workspaceName,
    greetingName: fullName,
    paragraphs: [
      `Confirm this address to use it for signing in to ${workspaceName}.`,
      'This link works once and expires in 24 hours.',
    ],
    action: { label: 'Confirm email address', url: appLink(`/verify-email?token=${token}`) },
  });
  return sendMail({ to, subject: `Confirm your new ${workspaceName} email address`, ...body });
}

export function sendEmailChangeNotice({ to, fullName, workspaceName, newEmail }) {
  const body = render({
    workspaceName,
    greetingName: fullName,
    paragraphs: [
      `A request was made to change your sign-in email to ${newEmail}. It takes effect once the new address is confirmed.`,
      'If this was not you, change your password and contact your workspace admin.',
    ],
  });
  return sendMail({ to, subject: `Email change requested for your ${workspaceName} account`, ...body });
}
