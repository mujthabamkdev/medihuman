# MediHuman

MediHuman is a mobile-first progressive web app for organizing prescription capture, patient context, current medicines, reconciliation, clinician questions, and daily support. It is designed to make care conversations clearer; it does not diagnose, prescribe, or replace a pharmacist or clinician.

## Stack

- Plain HTML, CSS, and browser JavaScript
- Node.js 22 built-in HTTP server/API with secure-by-default JSON persistence
- PWA manifest and service worker
- Browser camera capture and best-effort Tesseract.js OCR with mandatory human review
- Node's built-in test runner for medication comparison, safety rules, and API security

## Requirements

- Node.js 22.11.0 (pinned in `.nvmrc` and `Dockerfile`)
- No application npm dependencies or extra system packages are required.

## Setup and run

```sh
npm ci --offline --no-audit --no-fund
npm test
npm run build
PUBLIC_ROOT=public npm start
```

Open <http://localhost:4173>. Set `PORT` to use another port:

```sh
PORT=8080 PUBLIC_ROOT=public npm start
```

Copy `.env.example` for environment variable names. The server does not read `.env` automatically; export variables in your shell or use a compatible environment loader. `PUBLIC_ROOT=public` serves only generated browser assets; do not expose the source directory as a production document root. Re-run `npm run build` after frontend changes.

## Demo accounts for testing

The repository ships a fictional but realistic dataset: patients keep a home medicine list, record the prescription they were given, and compare the two name lists to see what the pharmacy did or did not dispense. Clinicians then request access, read the approved record, and leave indications.

**Password for every account: `MediHuman@2026`**

### Clinicians

| Email | Name | Specialty | Access |
| --- | --- | --- | --- |
| `ananya.rao@clinic.example.com` | Dr. Ananya Rao | General Medicine | verified |
| `vikram.shetty@clinic.example.com` | Dr. Vikram Shetty | Cardiology | verified |
| `meera.iyer@clinic.example.com` | Dr. Meera Iyer | Endocrinology and Diabetology | verified |
| `rohan.gupta@clinic.example.com` | Dr. Rohan Gupta | Psychiatry | pending — records stay blocked |

### Patients

| Email | Name | Patient ID | Scenario |
| --- | --- | --- | --- |
| `ramesh.kumar@example.com` | Ramesh Kumar | `pid-7c1d4a92` | Diabetes and hypertension. A prescribed medicine was out of stock and an over-the-counter painkiller was added. |
| `sunita.devi@example.com` | Sunita Devi | `pid-b3e75c10` | Hypothyroidism. The pharmacy dispensed the brand form of the same thyroid tablet, so the names do not match. |
| `joseph.thomas@example.com` | Joseph Thomas | `pid-2fa09d7c` | Post-heart-attack care. A schedule medicine was not dispensed and a self-purchased painkiller conflicts with his kidney record. |
| `priya.menon@example.com` | Priya Menon | `pid-9d44b8e2` | Pregnancy, 28 weeks. Everything dispensed exactly as prescribed. Access was revoked, so it shows the revoked state. |
| `lakshmi.devi@example.com` | Lakshmi Devi | `pid-4c82f0a6` | COPD with a recorded penicillin allergy, and a penicillin-class antibiotic was dispensed. Access request pending. |
| `fatima.khan@example.com` | Fatima Khan | `pid-6e15b7d3` | Rheumatoid arthritis. The methotrexate label reads daily, but the medicine is taken once a week. |
| `ravi.shankar@example.com` | Ravi Shankar | `pid-1a90b4e5` | Reflux. An old acid medicine is still on the list next to the current one. |
| `anjali.sharma@example.com` | Anjali Sharma | `pid-5d37e9a1` | Migraine and anxiety. Ibuprofen is both prescribed and recorded as an allergy. Access request pending. |

### Seed the data

The dataset lives in `scripts/demo-data.js`; `scripts/seed-demo-data.js` applies it.

```sh
# seed the linked Supabase project (creates the matching auth accounts too)
npm run seed:demo -- --project-ref hagplohwjudzbenftljk

# or write the same data into the local JSON store
npm run seed:demo -- --local
```

Replace the project ref with your own. `--dry-run` prints the plan, `--purge` clears the existing demo rows first, and `--sql <file>` writes a plain SQL seed for `supabase db reset`.

### Two-step walkthrough

1. Sign in as `lakshmi.devi@example.com` → **Clinician access** → approve Dr. Ananya Rao's request.
2. Sign in as `ananya.rao@clinic.example.com` → **Approved patients** → select `pid-4c82f0a6` → read the high-priority penicillin-allergy indication → add your own indication.

The patient ID is what a clinician types to request access; it is not the name.

All of these accounts live on the shared demo project, so anyone can sign in as them. The data is fictional and is not medical advice. Change the demo password and use separate credentials before storing anything real.

## Docker

```sh
docker build -t medihuman .
docker run --rm -p 4173:4173 -v medihuman-data:/app/.data medihuman
```

Then open <http://localhost:4173>.

The image pins Node/Alpine, installs the lockfile offline, runs `npm test`, and builds browser assets before starting. It sets `PUBLIC_ROOT=public`; backend sources, migrations and private files are not web-accessible. Local data persists in the named volume. Supply production credentials with environment injection, never image layers. Once the base image is available, dependency installation, tests and the static build need no external network; live Supabase, Google sign-in and CDN OCR still require their services.

## Supabase persistence

Supabase is an optional server-side persistence backend. The app uses direct Node `fetch` against PostgREST; no Supabase SDK is bundled into the browser. This keeps dependencies and client egress small, and the service-role key never reaches the frontend.

The checked-in migrations store the application state in 12 normalized tables: `users`, `profiles`, `medicines`, `prescriptions`, `medical_records`, `reconciliations`, `access_requests`, `indications`, `notifications`, `audit_logs`, `sessions`, and `oauth_states`. Each table has canonical columns for queryable fields plus a `data` JSONB column that preserves the backend record contract. `medical_records` is canonical for documents; `prescriptions` remains a synchronized legacy mirror. There is no legacy singleton JSON state table or incremental read path.

Writes use the transaction-safe `medihuman_commit_normalized_state(next_state jsonb)` RPC. The RPC takes the complete normalized application state, serializes concurrent commits with a PostgreSQL advisory transaction lock, replaces rows in all 12 tables in one transaction, and returns `true`. The application refreshes all normalized tables before each write and sends the complete state to this RPC.

Persistence is service-role-only. Row-level security is enabled on all 12 tables; `public`, `anon`, and `authenticated` receive no table or RPC privileges. Only `service_role` can read or write normalized tables or execute `medihuman_commit_normalized_state`. Keep `SUPABASE_SERVICE_ROLE_KEY` exclusively in the server/runtime environment; it must never reach browser assets or client-side environment variables.

Apply schema to linked project:

```sh
supabase link --project-ref hagplohwjudzbenftljk
supabase db push
```

For a local schema check without changing a remote project:

```sh
supabase db lint --local
```

Set server-only environment variables before starting the app or deploying:

```sh
STORE_BACKEND=supabase
SUPABASE_URL=https://hagplohwjudzbenftljk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-me
SUPABASE_PUBLISHABLE_KEY=replace-me
MEDIHUMAN_PUBLIC_URL=https://your-deployment.example.com
MEDIHUMAN_AUTH_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Never put `SUPABASE_SERVICE_ROLE_KEY` in browser, `index.html`, `public/`, or `NEXT_PUBLIC_*` variables. Local JSON remains default until `STORE_BACKEND=supabase` is set.

When `STORE_BACKEND=supabase`, Supabase Auth handles email confirmation and recovery emails. The app keeps its existing HttpOnly application session, proxies confirmation links through `/api/auth/confirm`, blocks unconfirmed password login, and provides password recovery at the sign-in screen. Configure production SMTP and exact `/api/auth/confirm` redirect allowlisting in Supabase before release. TOTP MFA is enabled in the checked-in local Supabase config; production MFA enrollment/verification UI remains a separate release gate.

To import existing local `.data/medihuman.json`, first back it up, then run:

```sh
STORE_BACKEND=supabase npm run migrate:supabase
```

Migration refuses to overwrite a non-empty Supabase state. Set `SUPABASE_MIGRATE_OVERWRITE=1` only after an explicit backup and review.

Create a private JSON backup before migrations or maintenance. `backup:supabase` reads the complete normalized snapshot from all 12 tables and writes one JSON file outside Git-tracked paths with mode `0600`:

```sh
STORE_BACKEND=supabase npm run backup:supabase
```

Restore a reviewed backup only as an explicit operation:

```sh
DATA_FILE=.supabase-backups/medihuman-YYYY-MM-DDTHH-MM-SS-sssZ.json \
STORE_BACKEND=supabase SUPABASE_MIGRATE_OVERWRITE=1 npm run migrate:supabase
```

Restore is an explicit full-state replacement: the migration command normalizes the reviewed JSON backup and commits it through `medihuman_commit_normalized_state`, replacing rows across all 12 tables in one database transaction. `SUPABASE_MIGRATE_OVERWRITE=1` is required when the destination already contains records; review the backup and target before using it.

Concurrent writes are serialized by the normalized commit RPC's database transaction lock. Conflicting writes do not fall back to `/tmp` or local JSON. Vercel now defaults to `STORE_BACKEND=supabase`; set `STORE_BACKEND=json` only for intentional local/preview runs.

Supabase deployments use `medihuman_rate_limit_hit` for distributed API and authentication throttling. Each request sends one compact counter RPC and receives a boolean; counters contain IP-derived bucket keys only, not patient data. Local JSON mode keeps the in-process limiter for offline tests.

## Vercel deployment

Use Vercel's **Other** framework preset for a static frontend plus one shared `api/index.js` function. The checked-in `vercel.json` sets `framework: null`, `buildCommand: "npm run build"`, `outputDirectory: "public"`, and rewrites `/api/:path*` to that function; it also prevents stale service-worker caching. Do not select a Node/server framework or rewrite all non-API requests to a function: Vercel's automatic `server.js` backend detection can make `/api/health` work while `/`, `/index.html`, and `/styles.css` return JSON 404 responses.

In the Vercel dashboard, set **Project Settings → Build and Deployment** as follows before redeploying:

- **Framework Preset:** Other.
- **Root Directory:** the directory containing this `package.json` and `vercel.json` (`medihuman` when importing the parent repository; leave empty when this directory is the repository root).
- **Build Command:** `npm run build`.
- **Output Directory:** `public`.
- **Install Command:** leave the default; this project has no dependencies.
- **Node.js Version:** 22.x.

Remove conflicting dashboard overrides or align them with these values. `npm start` remains the local/Docker server command, not the Vercel build command.

`npm run build` recreates `public/` from an explicit browser-asset allowlist in `scripts/build-static.js`: HTML, stylesheets, service worker, both manifests, browser entrypoint/API client/OCR/domain modules, client modules, and icon. Add new browser assets to that allowlist when needed. Backend code, `server.js`, `.data`, environment files, and secrets are never copied. Generated `public/` is ignored by Git and Vercel uploads and rebuilt during deployment. The build module exports `buildStatic(outputDirectory)` for isolated checks; importing it does not run a build.

Vercel serves these files directly from its CDN and routes every `/api/:path*` request through `api/index.js`, which uses the shared serverless handler. This explicit rewrite avoids relying on catch-all function filenames for nested API paths. After deployment, check `/`, `/index.html`, `/styles.css`, `/api/health`, and a nested API path such as `/api/patient/profile`; the first three should return HTML/CSS, health should return JSON, and the nested path should return an application JSON response rather than a Vercel platform 404. If runtime logs report `No exports found in module "/var/task/server.mjs"`, confirm `server.js` includes its default handler export and recheck the Other preset. `/var/task` is Vercel's runtime filesystem, not a local project folder.

Use Vercel CLI without a global install:

```sh
npx --yes vercel login
npx --yes vercel
npx --yes vercel --prod
```

Set production environment variables in Vercel Project Settings or with `vercel env add`:

- `NODE_ENV=production`
- `STORE_BACKEND=supabase`
- `SUPABASE_URL=https://hagplohwjudzbenftljk.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only Supabase service-role key)
- `SUPABASE_PUBLISHABLE_KEY` (server-side Auth proxy key; legacy `SUPABASE_ANON_KEY` also accepted)
- `MEDIHUMAN_PUBLIC_URL` (exact public app origin used in Auth redirects)
- `MEDIHUMAN_CLINICIAN_ADMIN_KEY` (server-only clinician verification key)
- `MEDIHUMAN_SUMMARY_URL` (optional)
- `MEDIHUMAN_SUMMARY_API_KEY` (optional, server-side only)
- `MEDIHUMAN_SUMMARY_MODEL` (optional)
- `MEDIHUMAN_SUMMARY_APPROVED_HOSTS` (comma-separated exact HTTPS host allowlist)
- `MEDIHUMAN_SUMMARY_ALLOW_PHI=1` (explicit PHI-processing opt-in; otherwise rule-based summaries only)

Vercel `/tmp` storage is not used by default. With `STORE_BACKEND=supabase`, accounts, sessions, and patient records use the linked Supabase database. Production still needs scheduled backup execution, audit logging, backups retention, and privacy/legal review.

## Architecture

MediHuman uses small, dependency-free modules with one direction of ownership:

```text
index.html
└─ src/app.js                  composition entrypoint
   ├─ src/client/state.js      state shape and browser persistence
   ├─ src/client/ui.js         HTML primitives and SVG icons
   ├─ src/client/views.js      pure view rendering
   └─ src/client/controller.js events, API calls, camera/OCR lifecycle

src/backend/api.js              HTTP composition and route order
├─ auth.js                      sessions, CSRF, roles, public users
├─ http.js                      parsing, responses, static files
├─ validation.js                request validation
├─ records.js                   record queries and serializers
└─ routes/                      system, auth, patient, access, doctor

styles.css                      stable stylesheet entrypoint
└─ styles/*.css                 ordered tokens, base, layout, components, views, roles, utilities, responsive
```

Keep these boundaries strict: views render; controllers coordinate effects; state owns browser persistence; route modules own HTTP behavior; domain modules own medication rules. Preserve `data-action`, `data-form`, API contracts, and `medihuman.local-workspace.v3` when changing internals.

## Behavior

- Lists accept one medicine per line; commas are also accepted.
- Matching is exact after trimming, collapsing repeated spaces, and ignoring letter case. Strength and formulation differences remain different medicines.
- Duplicate entries are counted, so a repeated prescription item can be identified as partially missing.
- Profile and medicine data save automatically in this browser's local storage. Use **Clear local data** to remove it.
- Backend API stores account, patient, medicine, prescription, and reconciliation records in `DATA_FILE` (default `.data/medihuman.json`, outside the static asset URL space). State-changing API requests require the CSRF token from `GET /api/csrf`.
- Auth uses scrypt password hashes and short-lived HttpOnly SameSite session cookies. Production mode (`NODE_ENV=production`) adds the Secure cookie attribute.
- Google sign-in uses a short-lived, one-time server-side OAuth state bound to an HttpOnly SameSite=Lax cookie, then creates or links patient accounts from verified Google identity claims. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`; provider tokens are used in memory only.
- Camera images stay in the browser capture flow; OCR is best-effort and every result opens an editable review step.
- OCR loads pinned Tesseract.js `5.1.1` from jsDelivr at runtime. If CDN/network loading fails, the adapter returns an explicit manual-entry fallback; OCR never blocks prescription review.
- The composition screen uses a small, transparent reference/rule set for common medicines and profile context. Unknown medicines, supplements, interactions, dose decisions, and handwriting remain clinician/pharmacist review items.
- Patient and doctor accounts use separate roles. Doctors request access by opaque patient ID; patients approve, reject, or revoke access before profile, medicine, prescription, or reconciliation records are visible.
- Record summaries default to transparent rule-based findings. An approved OpenAI-compatible provider can be enabled server-side with `MEDIHUMAN_SUMMARY_URL`, `MEDIHUMAN_SUMMARY_API_KEY`, and `MEDIHUMAN_SUMMARY_MODEL`; keys never reach the browser. Provider output remains an AI-assisted draft requiring clinician verification and falls back to rule-based output on timeout or provider failure.
- Safety and lifestyle content is general information, not a diagnosis or a replacement for clinician or pharmacist advice.

## API surface

- `GET /api/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- `GET /api/auth/google`, `GET /api/auth/google/callback` (enabled only when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are configured)
- `GET /api/patient/access-requests`, `POST /api/patient/access-requests/:id/approve`, `POST /api/patient/access-requests/:id/revoke`, `PUT /api/patient/access-requests/:id`
- `GET|POST /api/doctor/access-requests`, `POST /api/doctor/access-requests/:patientId`
- `GET /api/doctor/patients/:patientId[/profile|/medicines|/prescriptions|/reconciliations|/summary]`
- `GET /api/patient/summary` and `GET /api/summary`
- `GET|PUT /api/patient/profile`
- `GET|PUT /api/patient/medicines`
- `GET|POST /api/patient/records`, `GET|PUT|DELETE /api/patient/records/:id`
- `POST /api/patient/records/upload` (multipart/form-data, requires `BLOB_READ_WRITE_TOKEN`)
- `GET /api/doctor/patients/:patientId/records`, `GET /api/doctor/patients/:patientId/records/:id`
- `GET|POST /api/prescriptions`, `GET|PUT|DELETE /api/prescriptions/:id`
- `GET|POST /api/reconciliations`, `GET /api/reconciliations/:id`
- `GET /api/account/export` (`?format=csv` for a spreadsheet-friendly export)

Send JSON with `Content-Type: application/json`. Send `X-CSRF-Token` matching the `mh_csrf` cookie for every state-changing request. `POST /api/patient/records/upload` instead sends `multipart/form-data` with a `file` part.

### Generic medical records (Phase 2)

`POST /api/patient/records` requires `type`, `title` and a valid `date` (`YYYY-MM-DD`). Supported types: `prescription`, `lab_report`, `imaging`, `clinical_note`, `discharge_summary`, `vaccination`, `other`.

```json
{
  "type": "lab_report",
  "title": "Annual blood panel",
  "date": "2026-10-20",
  "description": "Document for clinician review",
  "tags": ["annual"],
  "source": "lab"
}
```

Optional fields: `description` (up to 5,000 characters), `tags` (up to 100 nonempty strings), `source` (`self`, `clinic`, `lab`; defaults to `self`), `fileRef` (absolute HTTPS URL, at most 2,048 characters, no credentials), `mimeType`, `sizeBytes` (integer 0–4,500,000). Title is limited to 200 characters. Identity, ownership, timestamps and structured `data` are server-owned; unknown fields are rejected. File metadata is a reference only: this API does not fetch URLs or upload, validate or serve document bytes. Never assume a public URL becomes private merely by recording it here.

Responses use `{ "record": ... }` for create/read/update and `{ "records": [...], "total": n, "limit": n, "offset": n }` for lists. `PUT` accepts a partial update and preserves omitted metadata. `DELETE` returns `{ "ok": true }`. Lists are newest clinical date first, then creation time, with stable ID tie-breaking. Both patient and doctor lists accept `?type=lab_report`, `?q=search`, `?from=YYYY-MM-DD`, `?to=YYYY-MM-DD`, `?limit=1..100` and `?offset=n`; invalid, empty or repeated type filters return 400, and `limit` outside 1–100 or a negative `offset` return 400.

### File uploads

`POST /api/patient/records/upload` accepts `multipart/form-data` with a `file` part plus optional `type`, `title`, `date`, `description`, `tags`, and `source` fields. Uploads are limited to 4 MB and to PDF, JPEG, PNG, WebP, HEIC, and plain text. The server forwards the bytes to Vercel Blob and stores the returned HTTPS URL as the record's `fileRef`. Set `BLOB_READ_WRITE_TOKEN` to enable uploads; without it the route returns `503 STORAGE_UNAVAILABLE` rather than silently dropping the file. The token stays server-side — the browser never receives it.

Patients can access only their own records. Verified doctors require active patient approval for list/detail access, including file references. Missing or another patient's record returns 404. Creates, updates and deletes generate audit events and notify approved doctors without including document text. Account export includes `records.medicalRecords`; account deletion removes these records too. Summaries expose `sourceCounts.records` and `recordCountsByType` without double-counting the legacy prescription projection.

Existing `/api/prescriptions` endpoints retain their request/response contract but query canonical records with `type=prescription`. Structured medication fields live inside the record's `data`; IDs survive migration. Edits and deletions synchronize both collections. The SQL migration `supabase/migrations/20261021000002_create_medical_records.sql` must be applied before deploying this backend to Supabase. It backfills prescription dates from creation time and retains original payloads.

Local stores and imported backups normalize prescriptions automatically. For an explicit, repeatable conversion after taking a private backup:

```sh
DATA_FILE=.data/medihuman.json npm run migrate:records
# Or, after applying schema and exporting server-only Supabase variables:
STORE_BACKEND=supabase npm run migrate:records
```

The JSON command requires an existing explicit `DATA_FILE` and rewrites it with private permissions. Re-running is idempotent; existing canonical records win. Legacy prescriptions without a valid creation date retain an empty date rather than inventing one. Pause writers during migration/restore. No production migration is performed by `npm test`.

## Checks

`npm test` is the single offline check command. It covers comparison logic, the limited composition/risk rules, API authentication, password storage, cookie/CSRF enforcement, validation errors, patient data, generic record CRUD, patient isolation, doctor approval/revocation, prescription compatibility, summaries, JSON migration and mocked Supabase RPC round-trips. `npm run build` verifies the static deployment output. No standalone lint/typecheck command is configured.

Optional real PostgreSQL check, with a running local Supabase stack and Docker:

```sh
POSTGRES_CONTAINER=supabase_db_medihuman npm run check:records-db
```

This creates and drops only a uniquely named disposable database in the selected container. It checks prescription backfill, repeatability, RLS/grants, service-role RPC writes and transaction rollback using synthetic fixtures; it never resets or migrates the existing app database. `supabase db lint --local` separately inspects the installed local schema, which may lag checked-in migrations.

Before production deployment, review HTTPS termination, secret management, email verification, password reset, MFA, distributed rate limiting, durable database migrations/backups, audit logging, monitoring, privacy/legal review, and an authoritative clinical interaction data source.

Operational readiness procedures live in [`OPERATIONS.md`](./OPERATIONS.md). They cover monitoring, backup/restore drills, incident response, and privacy/legal gates.
