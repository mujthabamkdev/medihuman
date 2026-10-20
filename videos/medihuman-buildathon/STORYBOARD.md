---
format: 1920x1080
duration: 90s
message: "MediHuman turns medication information into a clearer, privacy-conscious care conversation."
arc: Hook → Problem → Product intro → Demo → Trust → CTA
audience: buildathon judges and healthcare product reviewers
mode: autonomous
music: none
---

## Video direction

- **Palette:** MediHuman's deep green, warm off-white, muted sage surfaces, dark ink text, and restrained warning amber; use brand roles from the app rather than invented neon gradients.
- **Motion grammar:** clean long-tail settles, crisp UI transitions, and voiceover-paced sequential reveals. No bouncy entrances, lazy breathing, or front-loaded slides. Hold resolved UI still so the product remains readable.
- **Rhythm:** quick hook, calm product explanation, three consecutive UI demo beats, then a slower trust/architecture hold before the CTA.
- **Caption keep-out:** keep critical copy and UI callouts in the upper 83% of frame; reserve lower band for captions.
- **Negative list:** no diagnosis claims, clinical validation claims, stock healthcare imagery, patient-identifying data, fake outcome metrics, generic AI-glow backgrounds, or screensaver motion.

## Frame 1 — The scattered story (0-8s)
- act: Hook
- status: animated
- duration: 8s
- poster: 5s
- transition_in: cut
- type: hook
- scene: Medication labels, questions, and pharmacy details appear as separated fragments, then resolve into one clear question.
- voiceover: "Medication information is rarely in one place — and that makes care conversations harder than they need to be."
- blueprint: kinetic-type-beats (Adapt)
- src: compositions/frames/01-scattered-story.html
- asset_candidates: app interface language; medicine, question, and care-team concepts
- narrativeRole: Establish the outcome problem in viewer language before naming the product.

## Frame 2 — A clearer care workspace (8-18s)
- act: Product intro
- status: animated
- duration: 10s
- poster: 14s
- transition_in: crossfade
- type: product_intro
- scene: MediHuman lockup and patient dashboard enter; the workspace summary and profile overview establish one organised surface.
- voiceover: "MediHuman brings those details together, so you can prepare clearer questions for a pharmacist or clinician."
- blueprint: titlecard-reveal (Adapt)
- src: compositions/frames/02-care-workspace.html
- asset_candidates: dashboard hero; workspace summary; profile overview; MediHuman mark
- narrativeRole: Land the message by beat two and introduce the product as the bridge from scattered information to a care conversation.

## Frame 3 — Capture without guessing (18-30s)
- act: Demo
- status: animated
- duration: 12s
- poster: 25s
- transition_in: cut-the-curve
- type: feature_showcase
- scene: Prescription capture surface shows camera/photo/manual options; a browser-processing privacy callout appears as the input path is chosen.
- voiceover: "Start with a prescription photo, or enter the details manually. Images are processed in your browser, and you stay in control of what you record."
- blueprint: device-surface-showcase (Adapt)
- src: compositions/frames/03-capture.html
- asset_candidates: prescription capture view; camera/photo controls; manual details panel; privacy caption
- narrativeRole: Demonstrate low-friction input while proving the privacy-first product posture.

## Frame 4 — Verify every field (30-42s)
- act: Demo
- status: animated
- duration: 12s
- poster: 37s
- transition_in: crossfade
- type: feature_showcase
- scene: Review step presents captured text beside explicit checks for source comparison, strength/formulation, and pharmacist follow-up.
- voiceover: "Before anything is saved, review the capture against the original — including names, strength, and formulation. Uncertainty stays visible instead of becoming a silent assumption."
- blueprint: cursor-ui-demo (Adapt)
- src: compositions/frames/04-verify.html
- asset_candidates: review prescription view; verification checklist; correction controls
- narrativeRole: Show that extraction is assistive, not authoritative, and that the user remains the verifier.

## Frame 5 — Compare what changed (42-55s)
- act: Demo
- status: animated
- duration: 13s
- poster: 49s
- transition_in: cut-the-curve
- type: benefit_highlight
- scene: Prescribed and dispensed lists sit in a split view; matched, missing, and unexpected items resolve into a focused result board.
- voiceover: "Then compare prescribed and dispensed lists. MediHuman surfaces what matches and what needs follow-up — without pretending to judge clinical appropriateness."
- blueprint: comparison-split (Adapt)
- src: compositions/frames/05-reconcile.html
- asset_candidates: reconciliation view; result board; match and review states
- narrativeRole: Turn a concrete workflow into the main proof of usefulness while preserving the safety boundary.

## Frame 6 — Keep the conversation ready (55-67s)
- act: Organise
- status: animated
- duration: 12s
- poster: 62s
- transition_in: crossfade
- type: benefit_highlight
- scene: Dashboard categories assemble: profile, medicines, prescriptions, comparisons, questions, and care access; saved questions remain prominent.
- voiceover: "Your profile, medicines, prescriptions, comparisons, and questions stay organised in one workspace — ready for the next conversation."
- blueprint: grid-card-assemble (Adapt)
- src: compositions/frames/06-organise.html
- asset_candidates: profile overview; record categories; questions list; dashboard summary
- narrativeRole: Show the compounding value of organised context rather than another isolated feature.

## Frame 7 — Access stays patient-controlled (67-79s)
- act: Trust
- status: animated
- duration: 12s
- poster: 74s
- transition_in: crossfade
- type: social_proof
- scene: Private patient ID, pending request, approval/revoke controls, and clinician workspace boundary appear as a controlled handoff.
- voiceover: "If you choose to involve a clinician, access starts with a private patient ID and your approval. You can revoke it when you decide."
- blueprint: device-surface-showcase (Adapt)
- src: compositions/frames/07-access.html
- asset_candidates: clinician access view; private patient ID card; request status controls; doctor workspace
- narrativeRole: Make consent and access control tangible, not merely a claim in the end card.

## Frame 8 — Built for responsible clarity (79-90s)
- act: CTA
- status: animated
- duration: 11s
- poster: 86s
- transition_in: crossfade
- type: cta
- scene: App surfaces compress into a calm MediHuman lockup with three proof labels: organised records, patient-controlled access, and safe conversation boundaries.
- voiceover: "Underneath, the system is built for durable records, protected access, and clear boundaries. MediHuman: organise the information, then bring better questions to care."
- blueprint: logo-assemble-lockup (Adapt)
- src: compositions/frames/08-cta.html
- asset_candidates: MediHuman mark; privacy/access labels; final dashboard surface
- narrativeRole: Close on the buildathon thesis: practical product value backed by responsible implementation.
