# Edit Members QA Plan

Use this checklist to manually test the Edit Members page and its related behaviors.

## Setup

Start with a small known dataset in the database:

- Alice Wong, Member Big = null, Dynasty = Fire, Dynasty Head = Yes
- Ben Carter, Member Big = Alice Wong, Dynasty = Fire, Dynasty Head = No
- Clara Diaz, Member Big = Alice Wong, Dynasty = Earth, Dynasty Head = No
- David Kim, Member Big = null, Dynasty = Water, Dynasty Head = No

This gives coverage for:

- [x] members with no mentor
- [x] multiple people sharing one mentor
- [x] dynasty cascades across the full family tree
- [x] rename cascades
- [x] delete cascades
- [x] duplicate checks
- [x] search by member and mentor

## 1. Page Load And Basic UI

Verify:

- [x] members load successfully
- [x] rows are sorted alphabetically by first name
- [x] search bar appears above the table
- [x] Dynasty displays as Fire, Water, Earth, Wind
- [x] Dynasty dropdowns are color-coded correctly
- [x] Dynasty Head dropdowns are color-coded correctly
- [x] Member Name field appears visually darker than the other text inputs

## 2. Search

Test:

- [x] search for Alice and confirm Alice’s row appears
- [x] search for Ben and confirm Ben’s row appears
- [x] search for Alice Wong and confirm rows with Member Big = Alice Wong also appear
- [x] search for a mentor name shared across multiple rows and confirm all matching mentees appear
- [x] search for something nonexistent and confirm the empty-state message appears
- [x] clear search and confirm full list returns

## 3. Add Member: Happy Paths

Add:

- Member Name = Eva Stone
- Member Big = David Kim
- Dynasty = Wind
- Dynasty Head = No

Verify:

- [x] confirmation flow behaves correctly
- [x] row is created
- [x] page refreshes automatically
- [x] new row appears in first-name sort order
- [x] search can find the new member
- [x] search by David Kim finds Eva too

- [x] Also test adding a member with Member Big = null.

## 4. Add Member: Validation

Test:

- [x] blank Member Name should block add
- [x] duplicate Member Name should block add
- [x] duplicate Member Name with different case should block add
- [x] Member Big same as Member Name should block add
- [x] only the four valid dynasties are available in the dropdown

## 5. Add Member: Missing Mentor Automation

Add:

- Member Name = Fiona Reed
- Member Big = Greg Hall, where Greg does not yet exist
- Dynasty = Earth

Verify:

- [x] you get a confirmation popup, not a hard error
- [x] popup explains that Greg does not exist and a new row for Greg will also be created
- [x] after confirming, Fiona is created
- [x] after confirming, Greg is created
- [x] after confirming, Greg has Member Big = null
- [x] after confirming, Fiona has Member Big = Greg Hall
- [x] after confirming, the page refreshes automatically

- [x] Also test canceling that popup and confirm no rows are created.

## 6. Edit Member: Simple Non-Cascading Changes

Pick a row and change only one field at a time:

- Dynasty Head
- Member Big from one existing mentor to another existing mentor

For each, verify:

- [x] confirmation popup appears
- [x] popup shows only the changed fields
- [x] save succeeds
- [x] page refreshes automatically
- [x] data persists after refresh

## 7. Edit Member: Dynasty Cascade

Change a member's dynasty:

- Ben Carter: Fire -> Wind

Verify:

- [x] confirmation popup shows Dynasty: Fire -> Wind
- [x] popup explains that all members of the same family must remain in the same dynasty
- [x] popup shows a relatives section for Ben Carter
- [x] save succeeds
- [x] page refreshes automatically
- [x] Ben's dynasty becomes Wind
- [x] Ben's big's dynasty becomes Wind
- [x] Ben's siblings in the same family tree also update to Wind

Also test a deeper family tree. Add this setup first if needed:

- Eva Stone, Member Big = Ben Carter, Dynasty = Fire, Dynasty Head = No
- Fiona Reed, Member Big = Eva Stone, Dynasty = Fire, Dynasty Head = No

Then test:

- Alice Wong: Fire -> Water

Verify:

- [ ] confirmation popup shows Dynasty: Fire -> Water
- [ ] popup explains that all members of the same family must remain in the same dynasty
- [ ] popup shows one relatives section listing all connected family members who will also update
- [ ] after confirming, Alice's dynasty becomes Water
- [ ] after confirming, Ben's dynasty becomes Water
- [ ] after confirming, Clara's dynasty becomes Water
- [ ] after confirming, Eva's dynasty becomes Water
- [ ] after confirming, Fiona's dynasty becomes Water
- [ ] page refreshes automatically

## 8. Edit Member: Rename Without Cascades

Rename a member who is nobody’s mentor:

- David Kim -> Daniel Kim

Verify:

- [ ] confirmation popup shows Member Name: David Kim -> Daniel Kim
- [ ] no cascade sentence appears if nobody references that name
- [ ] save succeeds
- [ ] page refreshes
- [ ] search works for new name, not old one

## 9. Edit Member: Rename With Cascades

Rename a mentor with dependents:

- Alice Wong -> Alicia Wong

Verify:

- [ ] confirmation popup shows Member Name: Alice Wong -> Alicia Wong
- [ ] popup also explains affected rows below the bullets
- [ ] after confirming, Alice is renamed
- [ ] after confirming, Ben’s Member Big becomes Alicia Wong
- [ ] after confirming, Clara’s Member Big becomes Alicia Wong
- [ ] page refreshes automatically
- [ ] search by new mentor name finds dependent rows

## 10. Edit Member: Add Missing Mentor Through Edit

Change an existing row’s Member Big to a nonexistent person:

- Ben Carter Member Big: Alicia Wong -> Henry Cole

Verify:

- [ ] save does not hard fail
- [ ] confirmation explains the field change
- [ ] confirmation explains that Henry does not exist and a new row for Henry will also be created
- [ ] after confirming, Henry row exists
- [ ] after confirming, Henry has Member Big = null
- [ ] after confirming, Ben now points to Henry
- [ ] page refreshes automatically

- [ ] Also test canceling and confirm no rows change.

## 11. Edit Member: Validation

Test:

- [ ] blank Member Name should block save
- [ ] changing Member Name to another existing member’s name should block save
- [ ] changing Member Name to a conflicting case-variant should block save
- [ ] changing Member Big to same as Member Name should block save
- [ ] invalid dynasty should be impossible via dropdown

## 12. Delete Member: No Dependents

Delete someone with no mentees.

Verify:

- [ ] confirmation popup appears
- [ ] it explains the delete
- [ ] after confirming, the row is removed
- [ ] after confirming, the page refreshes automatically

- [ ] Also test canceling and confirm no change happens.

## 13. Delete Member: With Dependents

Delete a mentor with active dependents:

- delete Alicia Wong

Verify:

- [ ] confirmation explains that dependent rows will have Member Big updated to null
- [ ] after confirming, the mentor row is gone
- [ ] after confirming, all affected dependent rows now have Member Big = null
- [ ] after confirming, the page refreshes automatically

## 14. Refresh Behavior

After each of these actions, confirm the table reflects server state immediately without manual reload:

- [ ] add
- [ ] edit
- [ ] edit with dynasty cascades
- [ ] rename with cascades
- [ ] edit with missing mentor auto-create
- [ ] delete
- [ ] delete with dependent nulling

## 15. Bulk Upload Interaction With Editor

After using Bulk Upload:

- [ ] confirm success popup appears
- [ ] close popup
- [ ] switch back to Edit Members
- [ ] verify new members exist in table
- [ ] verify sort order still works
- [ ] verify search finds them

## 16. Suggested Edge Cases

Also test:

- [ ] extra spaces around names when editing or adding
- [ ] same name entered with different capitalization
- [ ] very long names
- [ ] adding a member whose auto-created mentor later gets edited
- [ ] changing a member's dynasty in the middle of a multi-generation family tree
- [ ] changing a member's dynasty when they have both ancestors and descendants in the same connected tree
- [ ] deleting an auto-created mentor after people point to them

## Pass Criteria

The feature passes if:

- [ ] all changes require confirmation
- [ ] confirmations accurately describe direct edits
- [ ] automatic follow-on changes are explained in plain language
- [ ] dynasty changes cascade correctly across the full connected family tree
- [ ] missing mentors are automated instead of hard-blocked
- [ ] renames cascade correctly
- [ ] deletes null out dependent Member Big values
- [ ] list refreshes after every mutation
- [ ] search works on both Member Name and Member Big
