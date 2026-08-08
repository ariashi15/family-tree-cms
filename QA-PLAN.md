# Edit Members QA Plan — Second Pass Regression

Use this checklist for a full second QA pass after the recent editing, confirmation-dialog, dynasty-cascade, and error-message changes.

## Recommended Setup

Start from a clean known dataset:

- Alice Wong, Member Big = null, Dynasty = Fire, Dynasty Head = Yes
- Ben Carter, Member Big = Alice Wong, Dynasty = Fire, Dynasty Head = No
- Clara Diaz, Member Big = Alice Wong, Dynasty = Earth, Dynasty Head = No
- David Kim, Member Big = null, Dynasty = Water, Dynasty Head = No
- Eva Stone, Member Big = Ben Carter, Dynasty = Fire, Dynasty Head = No
- Fiona Reed, Member Big = Eva Stone, Dynasty = Fire, Dynasty Head = No

This setup gives coverage for:

- [ ] search
- [ ] sorting
- [ ] add-member flow
- [ ] edit popup flow
- [ ] confirm-dialog flow
- [ ] rename cascades
- [ ] delete cascades
- [ ] whole-family-tree dynasty cascades
- [ ] branch dynasty inheritance when Big changes
- [ ] missing-Big auto-create behavior

## 1. Page Load And Table UI

Verify:

- [x] members load successfully
- [x] rows are sorted alphabetically by first name
- [x] search bar appears above the table
- [x] add form appears above the table
- [x] Edit and Delete buttons appear in each row
- [x] rows are read-only by default
- [x] Dynasty badges show Fire, Water, Earth, Wind with the correct colors
- [x] Dynasty Head badges show Yes and No with the correct colors
- [x] Member Name text appears visually darker than Member Big text

## 2. Search

Test:

- [x] search for Alice and confirm Alice’s row appears
- [x] search for Ben and confirm Ben’s row appears
- [x] search for Alice Wong and confirm rows with Member Big = Alice Wong also appear
- [x] search for Ben Carter and confirm Eva Stone also appears
- [x] search for something nonexistent and confirm the empty-state message appears
- [x] clear search and confirm the full list returns

## 3. Add Member: Happy Paths

Add:

- Member Name = Grace Park
- Member Big = David Kim
- Dynasty = Wind
- Dynasty Head = No

Verify:

- [x] add succeeds
- [x] success behavior is correct
- [x] page refreshes automatically
- [x] Grace appears in alphabetical order
- [x] search finds Grace
- [x] search for David Kim also finds Grace

Also test:

- [x] adding a member with Member Big = null

## 4. Add Member: Validation Placement

Test from the Add New Member form:

- [x] blank Member Name shows "Member name is required." only under the add form
- [x] duplicate Member Name shows only under the add form
- [x] duplicate Member Name with different case shows only under the add form
- [x] Member Big same as Member Name shows only under the add form
- [x] none of these messages surface below the editing rules callout

## 5. Add Member: Missing Mentor Automation

Add:

- Member Name = Hazel Brooks
- Member Big = Ian Cole, where Ian does not yet exist
- Dynasty = Earth
- Dynasty Head = No

Verify:

- [x] confirmation popup appears instead of a hard error
- [x] first section reviews Hazel’s row
- [x] popup says Ian does not exist and a new row for Ian will also be created
- [x] popup shows a full bullet list for the additional Ian row
- [x] additional Ian row shows:
  - [x] Member Name
  - [x] Big = null
  - [x] Dynasty = Earth
  - [x] Dynasty Head = No
- [x] after confirming, Hazel is created
- [x] after confirming, Ian is created
- [x] Ian inherits Hazel’s dynasty
- [x] page refreshes automatically

Also test:

- [x] canceling the popup creates no rows

## 6. Edit Popup Basics

Open Edit on Alice Wong.

Verify:

- [x] popup title says `Edit Alice Wong`
- [x] popup fields are prefilled correctly
- [x] popup uses local inline errors, not page-level errors
- [x] clicking Review changes opens the confirmation step
- [x] clicking Confirm closes the popup immediately

## 7. Edit Validation Before Review

From the edit popup, verify these are blocked before the review dialog opens:

- [x] blank Member Name
- [x] changing Member Name to another existing member’s name
- [x] changing Member Name to a case-variant of another existing name
- [x] changing Member Big to same as Member Name

Also verify:

- [x] each error stays inside the popup
- [x] none of these errors surface below the editing rules callout

## 8. Edit Member: Simple Non-Cascading Changes

Change only one field at a time:

- [x] Dynasty Head
- [x] Member Big to another existing member

For each, verify:

- [x] review popup opens
- [x] popup names the correct member in the first line
- [x] popup shows only the relevant changed fields
- [x] save succeeds
- [x] page refreshes automatically
- [x] data persists after refresh

## 9. Edit Member: Rename Without Cascades

Rename:

- David Kim -> Daniel Kim

Verify:

- [x] review popup shows `Member Name: David Kim -> Daniel Kim`
- [x] no rename cascade message appears if nobody points to David
- [x] save succeeds
- [x] page refreshes
- [x] search works for Daniel Kim
- [x] search no longer works for David Kim

## 10. Edit Member: Rename With Cascades

Rename:

- Alice Wong -> Alicia Wong

Verify:

- [x] review popup shows the direct name change
- [x] popup explains the cascading Big updates
- [x] after confirming, Alice becomes Alicia
- [x] Ben’s Member Big becomes Alicia Wong
- [x] Clara’s Member Big becomes Alicia Wong
- [x] page refreshes automatically

## 11. Edit Member: Dynasty Change Across Whole Family Tree

Change:

- Alice Wong: Fire -> Water

Verify:

- [ ] review popup shows `Dynasty: Fire -> Water`
- [ ] popup says all members of the same family must remain in the same dynasty
- [ ] popup shows one relatives section listing connected family members
- [ ] after confirming, Alice becomes Water
- [ ] Ben becomes Water
- [ ] Clara becomes Water
- [ ] Eva becomes Water
- [ ] Fiona becomes Water
- [ ] page refreshes automatically

## 12. Edit Member: Change Big To Existing Member

Change:

- Ben Carter Member Big: Alice Wong -> David Kim

Verify:

- [ ] review popup shows the Big change
- [ ] popup says Ben Carter and all descendants will inherit David Kim’s dynasty
- [ ] popup shows a branch section for Ben’s branch
- [ ] branch section includes Ben and descendants
- [ ] branch section shows the dynasty change bullet
- [ ] after confirming, Ben’s dynasty becomes David Kim’s dynasty
- [ ] Eva’s dynasty also becomes David Kim’s dynasty
- [ ] Fiona’s dynasty also becomes David Kim’s dynasty
- [ ] Clara does not change just because Ben changed big
- [ ] page refreshes automatically

## 13. Edit Member: Change Big To Missing Member

Change:

- Ben Carter Member Big: Alice Wong -> Henry Cole

Verify:

- [ ] review popup shows the Big change
- [ ] popup says Henry Cole does not exist and a new row will be created
- [ ] popup does not say Ben’s branch will inherit Henry Cole’s dynasty
- [ ] popup shows a full bullet list for the new Henry Cole row
- [ ] new Henry Cole row shows:
  - [ ] Member Name = Henry Cole
  - [ ] Big = null
  - [ ] Dynasty = Ben’s current dynasty
  - [ ] Dynasty Head = No
- [ ] after confirming, Henry Cole exists
- [ ] Henry Cole inherits Ben’s dynasty
- [ ] Ben keeps the expected dynasty
- [ ] branch dynasty inheritance does not incorrectly pretend Henry’s dynasty already existed
- [ ] page refreshes automatically

Also test:

- [ ] canceling this popup makes no changes

## 14. Edit Error Placement After Confirm

Use an edit case that fails after confirm, such as a duplicate name attempt.

Verify:

- [ ] the error returns inside the edit popup
- [ ] the error does not appear below the editing rules callout
- [ ] the user remains in the popup flow and can fix the issue

## 15. Delete Member: No Dependents

Delete someone with no mentees.

Verify:

- [ ] delete confirmation popup appears
- [ ] popup names the correct member
- [ ] after confirming, the row is removed
- [ ] page refreshes automatically

Also test:

- [ ] canceling delete makes no change

## 16. Delete Member: With Dependents

Delete a mentor with dependents.

Verify:

- [ ] confirmation explains that dependent rows will have Member Big set to null
- [ ] after confirming, the mentor row is gone
- [ ] affected dependent rows now have Member Big = null
- [ ] page refreshes automatically

## 17. Bulk Upload Regression Check

Verify:

- [ ] successful bulk upload still shows a success popup
- [ ] invalid CSV rows still show red row validation states
- [ ] valid uploaded data appears in Edit Members after switching tabs
- [ ] sort order still works after bulk upload
- [ ] search still works after bulk upload

## 18. Refresh Behavior

After each mutation type, confirm the table reflects server state without manual reload:

- [ ] add
- [ ] edit
- [ ] rename
- [ ] dynasty cascade
- [ ] Big-change dynasty inheritance
- [ ] missing-Big auto-create
- [ ] delete

## 19. Final Regression Pass Criteria

The feature passes this second QA round if:

- [ ] all add/edit/delete actions require confirmation
- [ ] edit validation blocks before review when appropriate
- [ ] add-form errors stay under the add form
- [ ] edit errors stay inside the popup flow
- [ ] no user-correctable edit/add errors surface below the editing rules callout
- [ ] rename cascades still work
- [ ] delete cascades still work
- [ ] dynasty changes cascade across the full connected family tree
- [ ] Big changes correctly reassign dynasty for the edited member’s branch when the new Big exists
- [ ] missing Big auto-create behavior is accurate in both data behavior and confirmation copy
- [ ] search still works on both Member Name and Member Big
- [ ] list refreshes after every mutation
