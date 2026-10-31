// First Owner for an empty production database (release checklist step 5).
// Creates the workspace and an Owner in "Invited" state, then prints a one-time link
// (valid 7 days) where they choose their password, so no password ever appears on a
// command line or in shell history. It also emails the link when SMTP works.
//
// Usage (inside the API container):
//   node scripts/create-owner.js --email owner@agency.com --name "Full Name" \
//     --workspace "Agency name" [--timezone Asia/Amman] [--currency JOD]
import { parseArgs } from 'node:util';
import { CURRENCY_CODES, ROLES, emailSchema, isValidTimeZone } from '@cpm/shared';
import { createLinkToken } from '../src/auth/linkTokens.js';
import { config } from '../src/config.js';
import { writeAudit } from '../src/lib/audit.js';
import { db } from '../src/lib/db.js';
import { appLink, sendInviteEmail } from '../src/lib/emails.js';

const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    workspace: { type: 'string' },
    timezone: { type: 'string', default: 'UTC' },
    currency: { type: 'string', default: 'JOD' },
  },
});

function fail(message) {
  console.error(`create-owner: ${message}`);
  process.exit(1);
}

const email = emailSchema.safeParse(args.email ?? '');
if (!email.success) fail('--email must be a valid email address');
if (!args.name?.trim() || args.name.trim().length < 2) fail('--name is required');
if (!args.workspace?.trim() || args.workspace.trim().length < 2) fail('--workspace is required');
if (!isValidTimeZone(args.timezone)) fail(`--timezone "${args.timezone}" is not a known time zone`);
if (!CURRENCY_CODES.includes(args.currency)) fail(`--currency must be one of ${CURRENCY_CODES.join(', ')}`);

try {
  // Only for a fresh installation: never adds a second Owner or a second workspace
  if ((await db.user.count()) > 0 || (await db.workspace.count()) > 0) {
    fail('this database already has a workspace or users. Invite people from the Team page instead.');
  }
  const { owner, workspace, token } = await db.$transaction(async (tx) => {
    const ws = await tx.workspace.create({ data: { name: args.workspace.trim(), timezone: args.timezone, currency: args.currency } });
    const user = await tx.user.create({ data: { workspace_id: ws.id, email: email.data, full_name: args.name.trim(), role: ROLES.OWNER, status: 'Invited' } });
    const raw = await createLinkToken({ purpose: 'Invite', userId: user.id, workspaceId: ws.id, createdBy: null }, tx);
    await writeAudit({ workspaceId: ws.id, action: 'workspace.created', entityType: 'Workspace', entityId: ws.id, after: { name: ws.name, owner_email: user.email } }, tx);
    return { owner: user, workspace: ws, token: raw };
  });

  const link = appLink(`/accept-invite?token=${token}`);
  let emailed = false;
  try {
    await sendInviteEmail({ to: owner.email, fullName: owner.full_name, workspaceName: workspace.name, inviterName: 'The setup script', token });
    emailed = true;
  } catch (err) {
    console.warn(`Could not send the email (${err.message}). Give the link below to ${owner.email} yourself.`);
  }
  console.log(`\nWorkspace "${workspace.name}" created (${config.env}).`);
  console.log(`Owner: ${owner.full_name} <${owner.email}>${emailed ? ' — invitation emailed' : ''}`);
  console.log(`\nSet-password link (works once, valid 7 days):\n${link}\n`);
} finally {
  await db.$disconnect();
}
