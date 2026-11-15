// FR-WS-01 workspace settings. Everyone signed in reads the public fields (D-17);
// Owner/Admin read numbering and the currency lock, and change settings.
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { AppError, conflict, staleUpdate } from '../../lib/errors.js';
import { detectImageType, unsafeSvgReason } from '../../lib/images.js';
import { deleteObject, getFileUrl, putObject } from '../../lib/storage.js';

const SETTINGS_FIELDS = ['name', 'brand_color', 'timezone', 'currency', 'date_format', 'week_start_day'];

/** D-21: rates and time are in the workspace currency, so it locks once either exists. */
export async function currencyLocked(workspaceId, client = db) {
  const [rated, timed] = await Promise.all([
    client.user.count({
      where: { workspace_id: workspaceId, OR: [{ hourly_cost_rate: { not: null } }, { default_bill_rate: { not: null } }] },
    }),
    client.timeEntry.count({ where: { workspace_id: workspaceId } }),
  ]);
  return rated + timed > 0;
}

export async function toWorkspaceDto(workspace, viewer) {
  const dto = {
    id: workspace.id,
    name: workspace.name,
    // Signed for the public storage address (S3_PUBLIC_ENDPOINT), so it works behind the proxy
    logo_url: workspace.logo_key ? (await getFileUrl(workspace.logo_key, { inline: true })).url : null,
    brand_color: workspace.brand_color,
    timezone: workspace.timezone,
    currency: workspace.currency,
    date_format: workspace.date_format,
    week_start_day: workspace.week_start_day,
  };
  if (can(viewer, 'workspace.readAdmin')) {
    Object.assign(dto, {
      invoice_prefix: workspace.invoice_prefix,
      next_invoice_number: workspace.next_invoice_number,
      proposal_prefix: workspace.proposal_prefix,
      next_proposal_number: workspace.next_proposal_number,
      currency_locked: await currencyLocked(workspace.id),
      version: workspace.version,
    });
  }
  return dto;
}

export async function getWorkspaceFor(viewer) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id } });
  return toWorkspaceDto(ws, viewer);
}

export async function updateWorkspace(viewer, { version, ...changes }, req) {
  const before = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id } });
  if (changes.currency && changes.currency !== before.currency && (await currencyLocked(before.id))) {
    throw conflict(
      'The workspace currency cannot change because user rates or time entries already use it',
      [{ field: 'currency', message: 'Locked: rates or time entries exist' }],
    );
  }
  const res = await db.workspace.updateMany({
    where: { id: before.id, version },
    data: { ...changes, version: { increment: 1 }, updated_by: viewer.id },
  });
  if (res.count !== 1) throw staleUpdate();
  const after = await db.workspace.findUniqueOrThrow({ where: { id: before.id } });
  const changed = SETTINGS_FIELDS.filter((k) => k in changes && before[k] !== after[k]);
  if (changed.length) {
    await writeAudit({ req, action: 'workspace.updated', entityType: 'Workspace', entityId: before.id, before: pick(before, changed), after: pick(after, changed) });
  }
  return toWorkspaceDto(after, viewer);
}

const unsupported = (message) => new AppError(415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, message);

/** PUT /workspace/logo with the raw PNG or SVG as the body. */
export async function uploadLogo(viewer, { body, declaredType }, req) {
  const detected = detectImageType(body);
  if (!detected) throw unsupported('The logo must be a PNG or SVG image');
  if (declaredType && declaredType !== detected) throw unsupported('The file content does not match its type');
  if (detected === 'image/svg+xml') {
    const reason = unsafeSvgReason(body);
    if (reason) throw unsupported(reason);
  }
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id } });
  const key = `workspaces/${ws.id}/logo-${randomUUID()}.${detected === 'image/png' ? 'png' : 'svg'}`;
  await putObject(key, body, detected);
  const after = await db.workspace.update({
    where: { id: ws.id },
    data: { logo_key: key, version: { increment: 1 }, updated_by: viewer.id },
  });
  await writeAudit({ req, action: 'workspace.logo_updated', entityType: 'Workspace', entityId: ws.id, after: { type: detected, bytes: body.length } });
  if (ws.logo_key) await deleteObject(ws.logo_key).catch((err) => req.log?.warn({ err }, 'Old logo not removed'));
  return toWorkspaceDto(after, viewer);
}

export async function removeLogo(viewer, req) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: viewer.workspace_id } });
  if (!ws.logo_key) return toWorkspaceDto(ws, viewer);
  const after = await db.workspace.update({
    where: { id: ws.id },
    data: { logo_key: null, version: { increment: 1 }, updated_by: viewer.id },
  });
  await writeAudit({ req, action: 'workspace.logo_removed', entityType: 'Workspace', entityId: ws.id });
  await deleteObject(ws.logo_key).catch((err) => req.log?.warn({ err }, 'Old logo not removed'));
  return toWorkspaceDto(after, viewer);
}
