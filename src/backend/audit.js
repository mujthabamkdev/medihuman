import { newId } from './security.js';

/** Append-only, metadata-only audit event. Never store PHI or request bodies. */
export function addAuditEvent(state, {
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  outcome = 'success',
}, now) {
  state.auditLogs ||= [];
  state.auditLogs.push({
    id: newId(),
    actorUserId,
    action,
    entityType,
    entityId,
    outcome,
    createdAt: new Date(now).toISOString(),
  });
}
