# MediHuman Medical Records — Detailed TODO

> Companion to `PLAN-medical-records.md`. Tracks implementation of generic medical records (prescriptions, lab reports, imaging, notes, etc.) with date-based display, medicine timeline, and full doctor visibility.

---

## Phase 1 — Date-based record display (frontend)

### 1.1 Prescription sorting & grouping
- [ ] Sort `state.prescriptions` by `createdAt` (newest first) in `renderScanWithPrescriptions`
- [ ] Group prescriptions by month/year in the prescription manager card
- [ ] Add date badge to each prescription row (e.g., "Jan 2026")
- [ ] Update `renderPrescriptionManager` to show empty state with "Add your first prescription"

### 1.2 Medicine list — active vs. historical
- [ ] Add `status` field to `medicineObject` ('active' | 'discontinued' | 'completed')
- [ ] Update `renderMedicines` to split list into "Currently taking" and "Previously taken" sections
- [ ] Add status badge (green for active, gray for discontinued) on each medicine card
- [ ] Add "Mark as discontinued" action button on medicine cards
- [ ] Add `startedAt`/`stoppedAt` date fields to medicine edit form
- [ ] Update `updateMedicineField` to handle status changes

### 1.3 Reconciliation history
- [ ] Sort `state.reconciliations` by `createdAt` (newest first)
- [ ] Group reconciliations by date in `renderReconcileWithHistory`
- [ ] Add date badge to each reconciliation row
- [ ] Link reconciliation to its source prescription (show prescription name/date)

### 1.4 Profile overview
- [ ] Add "Records by date" timeline view to `renderProfileOverview`
- [ ] Show most recent record across all types at top
- [ ] Add "View all records" link to new Records page

### 1.5 Tests
- [ ] Test prescription sorting by date
- [ ] Test medicine status filtering (active vs. historical)
- [ ] Test reconciliation date grouping

---

## Phase 2 — Generic medical records backend

### 2.1 Database schema
- [ ] Create `supabase/migrations/YYYYMMDD_create_medical_records.sql`
- [ ] Table: `medical_records` (id, user_id, type, title, date, description, file_ref, mime_type, size_bytes, tags, source, created_at, updated_at, data)
- [ ] RLS: enable on table, revoke all from public/anon/authenticated, grant to service_role
- [ ] Index: `medical_records_user_id_idx`, `medical_records_type_idx`, `medical_records_date_idx`
- [ ] Update `medihuman_commit_normalized_state` RPC to handle `medical_records` collection
- [ ] Add `medical_records` to `NORMALIZED_TABLES` in `store.js`

### 2.2 Validation
- [ ] Add `recordType` enum validation in `validation.js`
- [ ] Add `recordValue(input)` function (allowedKeys: type, title, date, description, tags, source)
- [ ] Add `recordListValue(value)` function
- [ ] Add `fileRef` validation (max length, URL format)

### 2.3 API routes
- [ ] `GET /api/patient/records` — list all records for patient (with optional `?type=` filter)
- [ ] `GET /api/patient/records/:id` — single record
- [ ] `POST /api/patient/records` — create record
- [ ] `PUT /api/patient/records/:id` — update record
- [ ] `DELETE /api/patient/records/:id` — delete record
- [ ] `GET /api/doctor/patients/:id/records` — doctor reads approved patient's records
- [ ] `GET /api/doctor/patients/:id/records/:id` — doctor reads single record
- [ ] `GET /api/patient/records?type=prescription` — filter by type

### 2.4 Records module
- [ ] Add `publicRecord(record)` to `records.js`
- [ ] Add `patientRecords` to include `medicalRecords` in doctor view
- [ ] Add `findRecordByPublicId` helper

### 2.5 Migration
- [ ] Script to convert existing `prescriptions` → `medical_records` type='prescription'
- [ ] Backfill `date` from `createdAt` for existing prescriptions
- [ ] Keep prescriptions endpoint as alias for backward compat (query records type='prescription')

### 2.6 Summary
- [ ] Update `buildRuleBasedSummary` to include medical records by type
- [ ] Add `sourceCounts.records` to summary

### 2.7 Tests
- [ ] API contract tests for all record CRUD endpoints
- [ ] Supabase store test: medical_records round-trip through RPC
- [ ] Migration test: prescriptions → medical_records

---

## Phase 3 — Medicine timeline

### 3.1 Medicine status tracking
- [ ] Add `status` field to `medicineValue` validation ('active' | 'discontinued' | 'completed')
- [ ] Add `startedAt`, `stoppedAt`, `reason`, `prescriber` fields to `medicineValue`
- [ ] Update `medicineValue` allowedKeys
- [ ] Update `medicineObject` in `state.js` to include new fields

### 3.2 Backend
- [ ] Update `GET /api/patient/medicines` to return medicines with status
- [ ] Update `PUT /api/patient/medicines` to handle status changes
- [ ] Add `startedAt`/`stoppedAt` to medicine update
- [ ] Notify approved doctors on medicine status change

### 3.3 Frontend
- [ ] Render "Currently taking" section (status='active')
- [ ] Render "Previously taken" section (status='discontinued' | 'completed')
- [ ] Add "Mark as discontinued" / "Mark as completed" buttons
- [ ] Add date pickers for started/stopped dates
- [ ] Add "Reason" text field for discontinued medicines
- [ ] Update `renderMedicines` with timeline layout
- [ ] Add medicine count badge (active count)

### 3.4 Doctor view
- [ ] Show medicine timeline in doctor-patients view
- [ ] Show active + historical medicines with dates
- [ ] Highlight discontinued medicines with different styling

### 3.5 Tests
- [ ] Test medicine status transitions
- [ ] Test date fields validation
- [ ] Test medicine timeline rendering

---

## Phase 4 — Doctor visibility (approved access)

### 4.1 Unified records endpoint
- [ ] `GET /api/doctor/patients/:id/records` — all medical records sorted by date
- [ ] `GET /api/doctor/patients/:id/records?type=lab_report` — filter by type
- [ ] `GET /api/doctor/patients/:id/records/:id` — single record
- [ ] Doctor can read all record types with approved access

### 4.2 Doctor UI
- [ ] Add "Records" tab to doctor-patients view
- [ ] Show records grouped by type and date
- [ ] Show record count by type in summary
- [ ] Add "View record" link to open record detail
- [ ] Add filter by record type

### 4.3 Notifications
- [ ] Patient record upload → notify approved doctors (already wired via `notifyApprovedDoctors`)
- [ ] Add notification type 'record' with entity reference
- [ ] Doctor notification click → navigate to patient records

### 4.4 Tests
- [ ] Doctor can read approved patient's records
- [ ] Doctor cannot read without approval
- [ ] Records filtered by type

---

## Phase 5 — Upload & OCR

### 5.1 File upload component
- [ ] Create reusable file upload component (`src/client/file-upload.js`)
- [ ] Camera capture + file picker (reuse existing camera flow)
- [ ] Upload to Vercel Blob (direct client upload)
- [ ] Show upload progress
- [ ] Show file preview (image/PDF)

### 5.2 Upload API
- [ ] `POST /api/patient/records/upload` — create record with file
- [ ] `POST /api/patient/records/upload-url` — get signed upload URL for direct Blob upload
- [ ] Validate file type (PDF, JPEG, PNG, etc.)
- [ ] Enforce size limit (4.5MB max)

### 5.3 OCR integration
- [ ] Extend OCR adapter for prescription type (existing Tesseract flow)
- [ ] Create medical record type='prescription' from OCR result
- [ ] Add "Manual entry" fallback for non-prescription records
- [ ] Review screen for uploaded document before saving

### 5.4 Record creation UI
- [ ] "Add record" button on records page
- [ ] Form: type selector, title, date, description, file upload
- [ ] Show uploaded file preview
- [ ] Save → creates record + notifies doctors

### 5.5 Tests
- [ ] File upload validation
- [ ] Record creation with file reference
- [ ] OCR → prescription record flow

---

## Phase 6 — Summary & search

### 6.1 Search & filter
- [ ] Add search input on records page (search title, description, tags)
- [ ] Filter by record type (dropdown)
- [ ] Filter by date range (from/to)
- [ ] Sort by date (newest/oldest)
- [ ] Persist filter state in URL or localStorage

### 6.2 Summary enhancement
- [ ] Update `buildRuleBasedSummary` to include medical records
- [ ] Add record count by type to summary
- [ ] Add "last updated" timestamp
- [ ] Show record count in profile overview

### 6.3 Export
- [ ] Update `GET /api/account/export` to include all medical records
- [ ] Include file references (not file bytes)
- [ ] Add export format option (JSON, CSV)

### 6.4 Doctor summary
- [ ] Doctor summary includes record counts by type
- [ ] AI summary (if enabled) includes record context

### 6.5 Tests
- [ ] Search/filter records
- [ ] Summary includes record counts
- [ ] Export includes all records

---

## Cross-cutting tasks

### Database
- [ ] Update `supabase/config.toml` if needed
- [ ] Run `supabase db lint --local` after schema changes
- [ ] Update `supabase/migrations/` with new migration
- [ ] Test migration on local Supabase

### Security
- [ ] RLS on `medical_records` (service_role only, same as other tables)
- [ ] File upload validation (type, size)
- [ ] Doctor access check before serving file references
- [ ] Audit events for record CRUD

### Performance
- [ ] Paginate records list (default 20, max 100)
- [ ] Lazy-load file previews
- [ ] Cache record counts in summary

### Documentation
- [ ] Update README with new API surface
- [ ] Update OPERATIONS.md with record backup procedures
- [ ] Update `.env.example` if new env vars needed

---

## Verification checklist
- [ ] All existing 76 tests pass
- [ ] New tests for medical records CRUD (target: +30 tests)
- [ ] E2E: patient uploads prescription → doctor (approved) sees it in records list
- [ ] E2E: patient adds active + discontinued medicine → doctor sees timeline
- [ ] E2E: patient uploads lab report → doctor can view
- [ ] Supabase migration: existing prescriptions convert to medical_records
- [ ] Build passes (`npm run build`)
- [ ] No console errors in browser

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
