# MediHuman operations checklist

Production data contains health information. Deployment owner must complete this checklist before accepting real patient data.

## Monitoring

- Monitor `/api/health` HTTP status, latency, and `backend` value.
- Alert on non-2xx responses, Supabase RPC errors, authentication failures, rate-limit failures, and backup failures.
- Keep application logs free of request bodies, cookies, access tokens, patient IDs, and provider payloads.
- Use a log retention period approved by privacy/legal owner.

## Backup and restore

1. Run `STORE_BACKEND=supabase npm run backup:supabase` before migrations.
2. Store backup outside repository and deployment filesystem with restricted access.
3. Encrypt backup storage, define retention, and record checksum/owner.
4. Test restore into an isolated Supabase project before relying on backup.
5. Run restore drill at least quarterly and after schema changes.

## Incident response

1. Disable public writes or set deployment to maintenance mode.
2. Revoke Supabase service-role key and auth encryption key if exposure is suspected.
3. Revoke all application sessions through account/session controls.
4. Preserve redacted logs and timeline; do not copy PHI into tickets or chat.
5. Assess affected records and notify privacy/legal owner according to applicable law.
6. Rotate secrets, restore verified data, and document corrective action.

## Privacy/legal gate

- Confirm data-processing agreement, retention, deletion, export, clinician verification, consent, AI provider, email provider, and backup-region decisions.
- Confirm Supabase project access, production SMTP, redirect allowlist, RLS migration, and service-role secret storage.
- Do not treat passing automated tests as clinical, legal, or regulatory approval.
