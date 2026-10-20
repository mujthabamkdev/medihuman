# MediHuman fix todo list

Scan of repo against README requirements, full-flow CRUD, and UI/UX.
Tests: 69/69 pass (client rendering, clinical/medication logic, server API, Supabase auth/store, rate limit, deployment). Build: OK.

## Status
- P0 (data loss/correctness/config): ALL DONE
- P1 (CRUD flow): ALL DONE — per-item medicine DELETE added; create/update via whole-list PUT (saveMedicines); server exposes POST/PUT/DELETE per medicine item
- P2 (polish/a11y): DONE — New scan badge clears after first capture; exit-dialog focuses primary button; medicines list search/filter; contrast-safe .notice-error added
- P3 (ops): health-check store connectivity DONE; maxDuration/backups are monitoring items

---

## How to read
- P0: data loss, correctness, security — fix before release
- P1: incomplete/broken CRUD flow or inconsistent UX
- P2: cleanup, polish, accessibility
- P3: ops, monitoring, deployment

Each item: [ID] location — problem → fix → verify.

---

## P0 — data loss / correctness / config

[P0-1] src/client/controller.js — persistPrescriptionReview — OCR review save fails silently
- Loops api.savePrescription per line; catch { break; } swallows failures. User navigates to reconcile believing review saved. No saveStatus feedback for prescriptions (unlike profile/medicines/reconciliation).
→ Collect per-line errors; surface at least one failure via saveStatus/notice; do not silently break.
→ Verify: stop server mid review-save → error shown; success path still saves prescriptions.

[P0-2] src/client/state.js — saveLocal — ocrText dropped from persistence
- saveLocal copies prescriptionText/dispensedText but not ocrText (or scanSource). OCR text lost on reload.
→ Add ocrText and scanSource to the local copy.
→ Verify: OCR capture → reload page → review screen still shows captured text.

[P0-3] .env.example — documents unused legacy Supabase vars
- Lists SUPABASE_STATE_TABLE=medihuman_state and SUPABASE_STATE_RPC=medihuman_commit_state.
- Code hardcodes 11 normalized table names; RPC is medihuman_commit_normalized_state (env SUPABASE_NORMALIZED_STATE_RPC). Latest migration drops medihuman_state / medihuman_commit_state.
→ Remove or correct the two commented lines; align with README names.
→ Verify: no reference to medihuman_state/medihuman_commit_state outside the migration drop block.

---

## P1 — CRUD flow completeness

[P1-1] src/backend/routes/patient.js + src/client/controller.js — per-item medicine CRUD DONE
- Server: POST /api/patient/medicines (create one), GET|PUT|DELETE /api/patient/medicines/:id (single item)
- Client: remove-medicine calls DELETE API (confirm first); add/update persist via saveMedicines whole-list PUT
→ Verify: add medicine → save → appears; edit field → save → persists; remove → DELETE → gone; empty-name add dropped on save

[P1-2] src/backend/routes/doctor.js — no doctor profile self-update
- doctorProfile (specialty, registrationId, organization) set at registration only; no PUT to update after signup. Verification status set by admin key only.
→ Add PUT /api/doctor/profile (doctor role, allowedKeys, audit event).
→ Verify: doctor updates own profile; patient/403 rejected.

[P1-3] src/client/controller.js — destructive actions without confirmation
- delete-prescription, delete-reconciliation, delete-indication, remove-medicine, remove-question have no confirm dialog (clear-data and delete-account do).
→ Add window.confirm on delete/remove actions following existing pattern.
→ Verify: each destructive button prompts before removing.

[P1-4] src/client/controller.js — inconsistent error surfacing
- requestPatient / updateCareRequest / submitIndication use alert(); save-profile/medicines/reconciliation use inline saveStatus notices.
→ Route all errors through inline notice/saveStatus; remove alert() usage.
→ Verify: no alert() remains in controller.

[P1-5] src/client/api-client.js + views.js — Google button shown when unconfigured
- googleAuthUrl() always returns a link; unconfigured → 404 GOOGLE_AUTH_UNAVAILABLE. Client has no config flag.
→ Expose googleConfigured on /api/me or /api/health; hide/disable Google button when false.
→ Verify: Google sign-in button absent when GOOGLE_CLIENT_ID unset.

[P1-6] src/client/controller.js — no loading/disabled state on mutation buttons
- save-medicines / save-profile / save-review set saveStatus 'Saving…' but buttons stay clickable → double-submit risk.
→ Disable submit buttons while async save in flight; re-enable on render.
→ Verify: rapid double-click saves once.

[P1-7] src/backend/store.js — Supabase commit failure surfaces as 500 with no client retry guidance
- Route handlers await transact; failure → 500. Client shows generic 'Could not complete request'.
→ Keep 500 but add client-facing retryable hint for Supabase RPC failures (non-PHI).
→ Verify: simulated RPC failure → actionable client message, retry restores state.

---

## P1 — UX consistency

[P1-8] src/client/views.js renderDoctorDashboard — verification gate via HTML string replace
- .replace() on rendered markup to disable button/change copy; breaks if markup drifts.
→ Data-driven conditional rendering based on doctorProfile.verified.
→ Verify: unverified doctor dashboard shows 'Verification required' and disabled button without string hacks.

[P1-9] src/client/views.js — dead / duplicate code
- renderMedicinesLegacy() never called; localPatientRecords() defined in both views.js and controller.js.
→ Remove renderMedicinesLegacy; keep single localPatientRecords.
→ Verify: no dead functions; tests still pass.

[P1-10] src/client/controller.js readPhoto / captureCamera — inconsistent OCR error handling
- readPhoto clears ocrText on failure; captureCamera may leave stale ocrText. Behavior differs.
→ Normalize: clear ocrText + set cameraError on failure; stay on scan view.
→ Verify: bad OCR frame → scan view, error notice, no stale text.

[P1-11] No unsaved-changes warning
- Leaving scan/review/medicines-edit drops unsaved OCR/field edits.
→ beforeunload prompt when dirty (prescriptionText/dispensedText/medicine edits pending).
→ Verify: reload with unsaved changes shows confirmation.

---

## P2 — polish / accessibility

[P2-1] Focus management for modals
- Local-exit dialog and profile/notification menus rendered but no focus trap or return focus.
→ Add focus trap on modal open; restore focus on close.
→ Verify: keyboard user tabs within dialog; Escape closes.

[P2-2] Lists lack search/filter
- Medicines, prescriptions, reconciliations render fully; MAX_LIST_ITEMS=100 server cap.
→ Add client filter input; server pagination optional later.
→ Verify: filter narrows medicine list.

[P2-3] Permanent 'New' badge on scan nav item
- Badge never clears after first scan.
→ Clear badge after user completes one scan/review cycle.
→ Verify: badge absent after first capture.

[P2-4] Contrast / focus styles
- Token-based stylesheet exists; verify WCAG contrast and visible focus-visible across views.
→ Audit styles/00-tokens + component CSS; add focus-visible where missing.
→ Verify: contrast ratios pass; keyboard focus visible.

---

## P3 — ops / deployment

[P3-1] src/backend/routes/system.js — /api/health — no store connectivity check
- Health returns backend value only; doesn't confirm Supabase RPC reachable.
→ Add store.read() / lightweight ping to health; report backend + store status.
→ Verify: /api/health returns ok with backend; reports store unreachable in supabase mode when DB down.

[P3-2] vercel.json — api/index.js maxDuration 10s
- Supabase commit under advisory lock can approach limit under contention.
→ Monitor p95 commit latency; raise maxDuration if consistently near 10s.
→ Verify: load test commit latency.

[P3-3] No scheduled backup automation
- backup:supabase is manual; OPERATIONS.md requires quarterly restore drills.
→ Add cron/reminder for ops owner; document backup retention.
→ Verify: OPERATIONS.md checklist referenced in deployment runbook.

---

## Verification — tests to add

- [ ] E2E browser test: patient flow register → profile → medicines → scan → review → reconcile → save → history
- [ ] E2E browser test: doctor flow request access → patient approve → doctor view records → add indication → patient notification
- [ ] API contract status-matrix test: every CRUD endpoint returns correct status/shape
- [ ] Supabase store: commit-failure serialization/behavior test (replaces swallowed-error assumptions)
- [ ] Keep existing 69 tests passing
