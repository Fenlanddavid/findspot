# Permission.tsx Decompose — Stage 0 Characterisation Checklist

Run this checklist manually after EACH refactor stage. All cases must pass
identically before committing the stage. Any behavioural diff = stop and reassess
the seam before proceeding.

---

## A. Create new permission (form path)

- [ ] Tap "+ Add Permission" → blank form opens
- [ ] Fill name, landowner name, insurance number, NCMD number, land use
- [ ] Tap "Pick location" → LocationPickerModal opens, place pin → confirm → lat/lon shown
- [ ] Tap "Draw boundary" → BoundaryPickerModal opens, draw polygon → confirm → boundary preview shown on mini-map
- [ ] Tap Save → permission appears in the permissions list on Home
- [ ] Re-open permission → all saved fields present

## B. Edit existing permission

- [ ] Open a permission → fields are pre-populated
- [ ] Tap Edit → form becomes editable
- [ ] Change name → Save → name updated in list and page title
- [ ] Re-draw boundary → mini-map updates → Save → boundary persists on reload
- [ ] Coverage overlay: after boundary set, coverage result renders on mini-map

## C. Sub-fields

- [ ] Tap "Add Field" (or field button) → FieldModal opens
- [ ] Enter field name, draw field boundary → Save
- [ ] Field appears in the sub-fields carousel on the left column
- [ ] Tap a field chip → field highlighted / selected state updates
- [ ] FieldNotesModal: open notes for a field → save notes → notes persist

## D. Right column — finds and sessions

- [ ] Pending finds list renders (finds without a session)
- [ ] Tap a find in the list → FindModal opens with correct find data
- [ ] Quick-add find button (if present) → FindModal opens in create mode
- [ ] Sessions list renders with correct dates and find counts
- [ ] Tap a session → navigates to Session page (or opens inline)
- [ ] "Assign to session" callback works from a pending find

## E. Club-day / shared permission

- [ ] Open a permission linked to a club day → banner renders in left column
- [ ] Organiser-only buttons (Share, Manage) visible when user is organiser
- [ ] Non-organiser view: organiser buttons absent
- [ ] "Send to organiser" button visible on session card when applicable

## F. Landowner report

- [ ] Tap "Landowner report" button → PermissionReportModal opens
- [ ] Report generates with permission name, finds, map thumbnail
- [ ] PDF share / export works without error

## G. AgreementModal

- [ ] Tap "View agreement" → AgreementModal opens
- [ ] PDF renders inside modal
- [ ] Close returns to permission page without state loss

## H. BoundaryPickerModal / LocationPickerModal edge cases

- [ ] Open modal, cancel without picking → no state change
- [ ] Pick location on map → pin appears at correct coordinates
- [ ] Vertex drag on boundary works (regression from Apr 2026 fix)

## I. Coach tips

- [ ] First-time user: relevant CoachTip appears on permission page
- [ ] Dismissing tip → does not reappear on reload

## J. Delete permission

- [ ] Tap delete → ConfirmModal appears with permission name
- [ ] Confirm → permission removed from list, navigates away
- [ ] Cancel → permission unchanged

---

*Last verified against: [STAGE — fill in stage number and date]*

● Stage 3 complete. Here's the summary:

  src/hooks/usePermissionForm.ts (new, 169 lines)
  - 30 form field states lifted out of Permission.tsx (all the DB-backed permission fields)
  - DB load effect moved in: loads settings + existing permission record, handles searchParams prefill for new
  permissions
  - loading state lives here; returned to shell
  - Shell passes setError so load failures surface through the existing unified error banner
  - Returns a typed PermissionFormState interface; shell destructures it so all variable names are unchanged

  Permission.tsx shell is now 1,590 lines (down from 3,132 original / 1,673 after Stage 2).

  Also removed: landUse, cropType, isStubble — declared but never read, never passed to PermissionFieldsColumn,
  dead state.

  One fix: Two setLandownerPhone(prev => prev || ...) functional-update callsites replaced with direct values using
   the now-in-scope destructured state — same semantics, compatible with the typed setter interface.

  Ready for Stage 0 checklist smoke run.

✻ Crunched for 6m 19s

❯ Stage 0 checklist rerun is complete against the usePermissionForm extraction.                                    
                                                                                                                   
  Result: no new regressions found. The result profile is unchanged from before:                                   
                                                                                                                   
  - Targeted checklist: 8 passed / 5 failed / 3 info                                                               
  - Dev server was stopped afterward.                                                                              
                                                                                                                   
  Passed Core Flows                                                                                                
                                                                                                                   
  - Create permission, load settings/prefill, save, Home list, reopen.                                             
  - Edit existing permission: fields pre-populate, rename saves, boundary persists on reload.                      
  - Location picker cancel/confirm.                                                                                
  - Boundary picker cancel/save and vertex-drag path.                                                              
  - Add sub-field, draw boundary, select/highlight, save notes.                                                    
  - Field-level Show Gaps coverage after sub-field exists.                                                         
  - Club-day organiser/member UI scoping.                                                                          
  - Delete cancel/confirm.                                                                                         
                                                                                                                   
  Unchanged Known Gaps                                                                                             
                                                                                                                   
  - Insurance/NCMD still not in permission form; lives in Settings > Profile.                                      
  - Permission-level coverage still absent when only the permission boundary exists.                               
  - Pending finds still navigate to /find?quickId=..., not FindModal.                                              
  - No View agreement button; current entrypoint is Generate Agreement.                                            
  - Agreement PDF generation still did not emit a download in the automated signed-modal run.                      
                                                                                                                   
  So from a Stage 0 regression perspective, the form-hook extraction looks clean.                                  
                                                                                                                   

● Stage 3 QA is clean. The three planned decompose stages are all verified:

  ┌───────┬─────────────────────────────────────────────────────┬──────────────────────┐
  │ Stage │                     What moved                      │ Shell before → after │
  ├───────┼─────────────────────────────────────────────────────┼──────────────────────┤
  │ 1     │ Right Column → PermissionActivityColumn.tsx         │ 3,132 → 2,838        │
  ├───────┼─────────────────────────────────────────────────────┼──────────────────────┤
  │ 2     │ Left Column → PermissionFieldsColumn.tsx            │ 2,838 → 1,673        │
  ├───────┼─────────────────────────────────────────────────────┼──────────────────────┤
  │ 3     │ 30 form states + load effect → usePermissionForm.ts │ 1,673 → 1,590        │
  └───────┴─────────────────────────────────────────────────────┴──────────────────────┘

  The shell is now 1,590 lines — roughly half the original. It contains: the outer page skeleton, action handlers
  (handleSave, handleDelete, doGPS, uploadExistingAgreement, etc.), UI-only state (editing mode, modals
  open/closed, attendee field picker), and the modal invocations.

  Let me update the session memory:

  Read 1 file, recalled 1 memory, wrote 2 memories (ctrl+o to expand)

● All three stages are done and verified. The decompose is complete for now — what's left in the 1,590-line shell
  is the action handlers, outer layout, and modal wiring, which are naturally cohesive and don't have an obvious
  next seam. What would you like to work on next?

