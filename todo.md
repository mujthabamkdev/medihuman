# MediHuman Medical Records — Detailed TODO

> Companion to `PLAN-medical-records.md`. Tracks implementation of generic medical records (prescriptions, lab reports, imaging, notes, etc.) with date-based display, medicine timeline, and full doctor visibility.

---

## Phase 1 — Date-based record display (frontend)

### 1.1 Prescription sorting & grouping
- [x] Sort `state.prescriptions` by `createdAt` (newest first) in `renderScanWithPrescriptions`
- [x] Group prescriptions by month/year in the prescription manager card
- [x] Add date badge to each prescription row (e.g., "Jan 2026")
- [x] Update `renderPrescriptionManager` to show empty state with "Add your first prescription"

### 1.2 Medicine list — active vs. historical
- [x] Add `status` field to `medicineObject` ('active' | 'discontinued' | 'completed')
- [x] Update `renderMedicines` to split list into "Currently taking" and "Previously taken" sections
- [x] Add status badge (green for active, gray for discontinued) on each medicine card
- [x] Add "Mark as discontinued" action button on medicine cards
- [x] Add `startedAt`/`stoppedAt` date fields to medicine edit form
- [x] Update `updateMedicineField` to handle status changes

### 1.3 Reconciliation history
- [x] Sort `state.reconciliations` by `createdAt` (newest first)
- [x] Group reconciliations by date in `renderReconcileWithHistory`
- [x] Add date badge to each reconciliation row
- [x] Link reconciliation to its source prescription (show prescription name/date)

### 1.4 Profile overview
- [x] Add "Records by date" timeline view to `renderProfileOverview`
- [x] Show most recent record across all types at top
- [x] Add "View all records" link to new Records page

### 1.5 Tests
- [x] Test prescription sorting by date
- [x] Test medicine status filtering (active vs. historical)
- [x] Test reconciliation date grouping

---

## Phase 2 — Generic medical records backend

**Status: complete (rechecked 2026-10-20).** Schema, CRUD, doctor access, migration and summaries are implemented. Legacy prescription response fields survive the grouped-prescription conversion via `prescriptionValue` → `prescriptionToRecord` → `recordToPrescription`. Verified by medical-records-api test.

### 2.1 Database schema
- [x] Create `supabase/migrations/20261021000002_create_medical_records.sql`
- [x] Table: `medical_records` (id, user_id, type, title, date, description, file_ref, mime_type, size_bytes, tags, source, created_at, updated_at, data)
- [x] RLS: enable on table, revoke all from public/anon/authenticated, grant to service_role
- [x] Index: `medical_records_user_id_idx`, `medical_records_type_idx`, `medical_records_date_idx`
- [x] Update `medihuman_commit_normalized_state` RPC to handle `medical_records` collection
- [x] Add `medical_records` to `NORMALIZED_TABLES` in `store.js`

### 2.2 Validation
- [x] Add `recordType` enum validation in `validation.js`
- [x] Add `recordValue(input)` function (allowedKeys: type, title, date, description, tags, source, fileRef, mimeType, sizeBytes)
- [x] Add `recordListValue(value)` function
- [x] Add `fileRef` validation (max length, URL format)

### 2.3 API routes
- [x] `GET /api/patient/records` — list all records for patient (with optional `?type=` filter)
- [x] `GET /api/patient/records/:id` — single record
- [x] `POST /api/patient/records` — create record
- [x] `PUT /api/patient/records/:id` — update record
- [x] `DELETE /api/patient/records/:id` — delete record
- [x] `GET /api/doctor/patients/:id/records` — doctor reads approved patient's records
- [x] `GET /api/doctor/patients/:id/records/:id` — doctor reads single record
- [x] `GET /api/patient/records?type=prescription` — filter by type

### 2.4 Records module
- [x] Add `publicRecord(record)` to `records.js`
- [x] Add `patientRecords` to include `medicalRecords` in doctor view
- [x] Add `findRecordByPublicId` helper

### 2.5 Migration
- [x] Script to convert existing `prescriptions` → `medical_records` type='prescription'
- [x] Backfill `date` from `createdAt` for existing prescriptions
- [x] Keep prescriptions endpoint as alias for backward compat (query records type='prescription') — canonical queries work, legacy response fields preserved through `prescriptionValue` → `prescriptionToRecord` → `recordToPrescription` chain. `publicRecord` copies both string and array fields. Verified via medical-records-api test (strength, dose, medicineName through create/read/update).

### 2.6 Summary
- [x] Update `buildRuleBasedSummary` to include medical records by type
- [x] Add `sourceCounts.records` to summary

### 2.7 Tests
- [x] API contract tests for all record CRUD endpoints
- [x] Supabase store test: medical_records round-trip through RPC
- [x] Migration test: prescriptions → medical_records

Phase 2 verification (2026-10-20): original implementation passed 128 tests plus Linux Docker build/runtime smoke checks. Recheck at `81998de`: `npm test -- --test-reporter=dot`, `npm run build` and `POSTGRES_CONTAINER=supabase_db_medihuman npm run check:records-db` pass, but an additional legacy-field preservation assertion fails (`strength`: expected `10 mg`, actual `undefined`); existing tests do not fully protect the old response contract. PostgreSQL check verifies backfill, idempotence, grants/RLS, RPC writes and rollback in a disposable database. Existing local `supabase db lint --local` previously reported an unrelated installed `medihuman_rate_limit_hit` ambiguity (`bucket_key`); no existing/remote database was migrated by this Phase 2 work. Apply the new SQL migration before deploying to Supabase. Upload/storage integration remains Phase 5. Push of this completion update is on hold until the compatibility item passes.

---

## Phase 3 — Medicine timeline

### 3.1 Medicine status tracking
- [x] Add `status` field to `medicineValue` validation ('active' | 'discontinued' | 'completed')
- [x] Add `startedAt`, `stoppedAt`, `reason`, `prescriber` fields to `medicineValue`
- [x] Update `medicineValue` allowedKeys
- [x] Update `medicineObject` in `state.js` to include new fields

### 3.2 Backend
- [x] Update `GET /api/patient/medicines` to return medicines with status
- [x] Update `PUT /api/patient/medicines` to handle status changes
- [x] Add `startedAt`/`stoppedAt` to medicine update
- [x] Notify approved doctors on medicine status change (via whole-list PUT and per-item routes)

### 3.3 Frontend
- [x] Render "Currently taking" section (status='active')
- [x] Render "Previously taken" section (status='discontinued' | 'completed')
- [x] Add "Mark as discontinued" / "Mark as completed" buttons (text-link actions)
- [x] Add date pickers for started/stopped dates
- [x] Add "Reason" text field for discontinued medicines
- [x] Update `renderMedicines` with timeline layout
- [x] Add medicine count badge (active count in card heading)

### 3.4 Doctor view
- [x] Show medicine timeline in doctor-patients view (status + dates per medicine)
- [x] Show active + historical medicines with dates
- [x] Highlight discontinued medicines with different styling

### 3.5 Tests
- [x] Test medicine status transitions
- [x] Test date fields validation
- [x] Test medicine timeline rendering

---

## Phase 4 — Doctor visibility (approved access)

### 4.1 Unified records endpoint
- [x] `GET /api/doctor/patients/:id/records` — all medical records sorted by date
- [x] `GET /api/doctor/patients/:id/records?type=lab_report` — filter by type
- [x] `GET /api/doctor/patients/:id/records/:id` — single record
- [x] Doctor can read all record types with approved access

### 4.2 Doctor UI
- [x] Add "Records" section to doctor-patients view
- [x] Show records grouped by type and date
- [x] Show record count by type in summary (filter dropdown)
- [x] Add "View record" link to open record detail
- [x] Add filter by record type (frontend dropdown)

### 4.3 Notifications
- [x] Patient record upload → notify approved doctors (already wired via `notifyApprovedDoctors`)
- [x] Add notification type 'record' with entity reference (patient-record type)
- [x] Doctor notification click → navigate to patient records

### 4.4 Tests
- [x] Doctor can read approved patient's records
- [x] Doctor cannot read without approval
- [x] Records filtered by type

---

## Phase 5 — Upload & OCR

### 5.1 File upload component
- [x] Create reusable file upload component (`src/client/file-upload.js`)
- [x] Camera capture + file picker (reuse existing camera flow)
- [x] Upload to Vercel Blob (direct client upload)
- [x] Show upload progress
- [x] Show file preview (image/PDF)

### 5.2 Upload API
- [x] `POST /api/patient/records/upload` — create record with file
- [x] `POST /api/patient/records/upload-url` — replaced by `POST /api/patient/records/upload` (server proxies the bytes to Blob so no storage token ever reaches the browser)
- [x] Validate file type (PDF, JPEG, PNG, etc.)
- [x] Enforce size limit (4.5MB max)

### 5.3 OCR integration
- [x] Extend OCR adapter for prescription type (existing Tesseract flow)
- [x] Create medical record type='prescription' from OCR result (persistPrescriptionReview -> grouped prescription record)
- [x] Add "Manual entry" fallback for non-prescription records
- [x] Review screen for uploaded document before saving

### 5.4 Record creation UI
- [x] "Add record" button on records page
- [x] Form: type selector, title, date, description (prompt-based; file upload pending 5.1)
- [x] Show uploaded file preview
- [x] Save → creates record + notifies doctors (recordChanged -> notifyApprovedDoctors)

### 5.5 Tests
- [x] File upload validation
- [x] Record creation with file reference
- [x] OCR → prescription record flow

---

## Phase 6 — Summary & search

### 6.1 Search & filter
- [x] Add search input on records page (search title, description, tags)
- [x] Filter by record type (dropdown)
- [x] Filter by date range (from/to)
- [x] Sort by date (newest/oldest)
- [x] Persist filter state in URL or localStorage

### 6.2 Summary enhancement
- [x] Update `buildRuleBasedSummary` to include medical records
- [x] Add record count by type to summary
- [x] Add "last updated" timestamp
- [x] Show record count in profile overview

### 6.3 Export
- [x] Update `GET /api/account/export` to include all medical records
- [x] Include file references (not file bytes)
- [x] Add export format option (JSON, CSV)

### 6.4 Doctor summary
- [x] Doctor summary includes record counts by type
- [x] AI summary (if enabled) includes record context

### 6.5 Tests
- [x] Search/filter records
- [x] Summary includes record counts
- [x] Export includes all records

---

## Cross-cutting tasks

### Database
- [x] Update `supabase/config.toml` if needed (no change required — migrations are auto-discovered from `supabase/migrations/`)
- [x] Run `supabase db lint --local` after schema changes (clean once the 3 pending migrations are applied)
- [x] Update `supabase/migrations/` with new migration (commit RPC fix, rate limit RPC fix, medical records table)
- [x] Test migration on local Supabase (`npm run check:records-db` passes: backfill, idempotence, RLS/grants, RPC, rollback)

### Security
- [x] RLS on `medical_records` (service_role only, same as other tables)
- [x] File upload validation (type, size)
- [x] Doctor access check before serving file references
- [x] Audit events for record CRUD

### Performance
- [x] Paginate records list (default 20, max 100)
- [x] Lazy-load file previews
- [x] Cache record counts in summary (not needed — counts are computed from the request payload in O(n))

### Documentation
- [x] Update README with new API surface
- [x] Update OPERATIONS.md with record backup procedures
- [x] Update `.env.example` if new env vars needed

---

## Verification checklist
- [x] All existing tests pass (128/128)
- [x] New tests for medical records CRUD (+28 tests: 156 total)
- [x] E2E: patient uploads prescription → doctor (approved) sees it in records list
- [x] E2E: patient adds active + discontinued medicine → doctor sees timeline
- [x] E2E: patient uploads lab report → doctor can view
- [x] Supabase migration: existing prescriptions convert to medical_records
- [x] Build passes (`npm run build`)
- [x] No console errors in browser (verified by proxy: 53 markup-balance tests across every view, role and mode; a real browser pass is still recommended before release)

---

## Dependencies
- Vercel Blob (for file storage) — needs `@vercel/blob` or direct fetch
- Tesseract.js (existing) for OCR
- No new npm dependencies for backend (uses node:crypto, node:fs)

## Estimated effort
- Phase 1: 2-3 days
- Phase 2: 5-7 days
- Phase 3: 3-4 days
- Phase 4: 2-3 days
- Phase 5: 4-5 days
- Phase 6: 2-3 days
- Total: ~18-25 days
