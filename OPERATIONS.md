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

### Medical records rollout and recovery

- `medical_records` is the canonical document collection; `prescriptions` is a synchronized compatibility mirror. Back up all 12 normalized tables, not only the old prescription table. Before applying the new schema, take a database-native snapshot or use the previous backend release's backup tool; the new backup tool expects `medical_records` to exist.
- Pause writers, take a private backup, then apply `20261021000002_create_medical_records.sql` before deploying the new backend. The migration adds the table, service-role-only permissions, prescription backfill and replacement RPC in one transaction. Do not deploy this backend against the old 11-table schema.
- After schema deployment, `STORE_BACKEND=supabase npm run migrate:records` can explicitly re-normalize the snapshot. Local JSON conversion requires an existing `DATA_FILE`: `DATA_FILE=.data/medihuman.json npm run migrate:records`. These commands are repeatable but write persistent state; never run them against an unreviewed target.
- Check record counts by type, stable prescription IDs, structured medication fields, dates, tags and file references. Validate patient isolation and doctor reads before/after revocation using synthetic accounts. Keep patient data out of deployment evidence.
- Backups store file references and metadata, not document bytes. File-store backup, retention, private access and byte deletion need a separate procedure when uploads are introduced; account deletion currently removes metadata only.
- Restore into an isolated project using the current schema first. Old JSON backups are upgraded automatically; restoring only the prescription mirror over newer canonical records does not overwrite those records. Full-state restore requires the existing explicit overwrite safeguard and may remove records absent from the backup.
- For rollback, stop writers and restore the reviewed pre-change snapshot with its matching schema/backend. Do not drop `medical_records` or roll back to a prescription-only backend after new generic records exist without a verified data-preservation plan.
- Offline check: `npm test`. Optional database check: `POSTGRES_CONTAINER=supabase_db_medihuman npm run check:records-db`; it creates/drops a disposable fixture database, never the app database. `supabase db lint --local` reports the installed schema, not unapplied migration files.

### Container deployment

- Build with the checked-in Dockerfile and Node pin. The build runs offline application tests and produces `public/`.
- Keep `PUBLIC_ROOT=public` in Docker/standalone production deployments. Serve only the generated browser directory, never backend source or private files. Mount durable JSON storage or configure Supabase; do not place data beneath `public/`.

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
