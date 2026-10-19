# MediHuman

MediHuman is a mobile-first progressive web app for organizing prescription capture, patient context, current medicines, reconciliation, clinician questions, and daily support. It is designed to make care conversations clearer; it does not diagnose, prescribe, or replace a pharmacist or clinician.

## Stack

- Plain HTML, CSS, and browser JavaScript
- Node.js 22 built-in HTTP server/API with secure-by-default JSON persistence
- PWA manifest and service worker
- Browser camera capture and best-effort Tesseract.js OCR with mandatory human review
- Node's built-in test runner for medication comparison, safety rules, and API security

## Requirements

- Node.js 22 (see `.nvmrc`)

## Setup and run

```sh
npm test
npm start
```

Open <http://localhost:4173>. Set `PORT` to use another port:

```sh
PORT=8080 npm start
```

Copy `.env.example` for the optional port reference. The server does not read `.env` automatically; export `PORT` in your shell or use a compatible environment loader.

## Docker

```sh
docker build -t medihuman .
docker run --rm -p 4173:4173 medihuman
```

Then open <http://localhost:4173>.

## Supabase persistence

Supabase is an optional server-side persistence backend. The app uses direct Node `fetch` against PostgREST; no Supabase SDK is bundled into the browser. This keeps dependencies and client egress small, and the service-role key never reaches the frontend.

The checked-in migration creates one locked-down `medihuman_state` row plus an atomic revision function. The app fetches only the row revision at request start and downloads the full JSON state only on cold start or when another instance changed it. Writes return no state payload. This keeps Supabase egress low while preserving the existing backend contract.

Apply schema to linked project:

```sh
supabase link --project-ref hagplohwjudzbenftljk
supabase db push
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

Create a private JSON backup before migrations or maintenance. Backup files are written outside Git-tracked paths with mode `0600`:

```sh
STORE_BACKEND=supabase npm run backup:supabase
```

Restore a reviewed backup only as an explicit operation:

```sh
DATA_FILE=.supabase-backups/medihuman-YYYY-MM-DDTHH-MM-SS-sssZ.json \
STORE_BACKEND=supabase SUPABASE_MIGRATE_OVERWRITE=1 npm run migrate:supabase
```

The Supabase revision column plus `medihuman_commit_state` RPC provide optimistic multi-instance locking. Conflicting writes retry twice and never fall back to `/tmp` or local JSON. Vercel now defaults to `STORE_BACKEND=supabase`; set `STORE_BACKEND=json` only for intentional local/preview runs.

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
- `GET|POST /api/prescriptions`, `GET|PUT|DELETE /api/prescriptions/:id`
- `GET|POST /api/reconciliations`, `GET /api/reconciliations/:id`

Send JSON with `Content-Type: application/json`. Send `X-CSRF-Token` matching the `mh_csrf` cookie for every state-changing request.

## Checks

`npm test` covers comparison logic, the limited composition/risk rules, API authentication, password storage, cookie/CSRF enforcement, validation errors, patient data, prescriptions, and reconciliation persistence. Before production deployment, add HTTPS termination, secret management, email verification, password reset, MFA, distributed rate limiting, durable database migrations/backups, audit logging, monitoring, privacy/legal review, and an authoritative clinical interaction data source.
