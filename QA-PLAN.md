# Edit Members QA Plan

Use this checklist to manually test the Edit Members page and its related behaviors.

## Setup

Start with a small known dataset in the database:

- Alice Wong, Member Big = null, Dynasty = Fire, Dynasty Head = Yes
- Ben Carter, Member Big = Alice Wong, Dynasty = Fire, Dynasty Head = No
- Clara Diaz, Member Big = Alice Wong, Dynasty = Earth, Dynasty Head = No
- David Kim, Member Big = null, Dynasty = Water, Dynasty Head = No

This gives coverage for:

- [ ] members with no mentor
- [ ] multiple people sharing one mentor
- [ ] rename cascades
- [ ] delete cascades
- [ ] duplicate checks
- [ ] search by member and mentor

## 1. Page Load And Basic UI

Verify:

- [ ] members load successfully
- [ ] rows are sorted alphabetically by first name
- [ ] search bar appears above the table
- [ ] Dynasty displays as Fire, Water, Earth, Wind
- [ ] Dynasty dropdowns are color-coded correctly
- [ ] Dynasty Head dropdowns are color-coded correctly
- [ ] Member Name field appears visually darker than the other text inputs

## 2. Search

Test:

- [ ] search for Alice and confirm Alice’s row appears
- [ ] search for Ben and confirm Ben’s row appears
- [ ] search for Alice Wong and confirm rows with Member Big = Alice Wong also appear
- [ ] search for a mentor name shared across multiple rows and confirm all matching mentees appear
- [ ] search for something nonexistent and confirm the empty-state message appears
- [ ] clear search and confirm full list returns

## 3. Add Member: Happy Paths

Add:

- Member Name = Eva Stone
- Member Big = David Kim
- Dynasty = Wind
- Dynasty Head = No

Verify:

- [ ] confirmation flow behaves correctly
- [ ] row is created
- [ ] page refreshes automatically
- [ ] new row appears in first-name sort order
- [ ] search can find the new member
- [ ] search by David Kim finds Eva too

- [ ] Also test adding a member with Member Big = null.

## 4. Add Member: Validation

Test:

- [ ] blank Member Name should block add
- [ ] duplicate Member Name should block add
- [ ] duplicate Member Name with different case should block add
- [ ] Member Big same as Member Name should block add
- [ ] only the four valid dynasties are available in the dropdown

## 5. Add Member: Missing Mentor Automation

Add:

- Member Name = Fiona Reed
- Member Big = Greg Hall, where Greg does not yet exist
- Dynasty = Earth

Verify:

- [ ] you get a confirmation popup, not a hard error
- [ ] popup explains that Greg does not exist and a new row for Greg will also be created
- [ ] after confirming, Fiona is created
- [ ] after confirming, Greg is created
- [ ] after confirming, Greg has Member Big = null
- [ ] after confirming, Fiona has Member Big = Greg Hall
- [ ] after confirming, the page refreshes automatically

- [ ] Also test canceling that popup and confirm no rows are created.

## 6. Edit Member: Simple Non-Cascading Changes

Pick a row and change only one field at a time:

- Dynasty
- Dynasty Head
- Member Big from one existing mentor to another existing mentor

For each, verify:

- [ ] confirmation popup appears
- [ ] popup shows only the changed fields
- [ ] save succeeds
- [ ] page refreshes automatically
- [ ] data persists after refresh

Important regression check:

- [ ] changing only Dynasty should not trigger duplicate-name errors

## 7. Edit Member: Rename Without Cascades

Rename a member who is nobody’s mentor:

- David Kim -> Daniel Kim

Verify:

- [ ] confirmation popup shows Member Name: David Kim -> Daniel Kim
- [ ] no cascade sentence appears if nobody references that name
- [ ] save succeeds
- [ ] page refreshes
- [ ] search works for new name, not old one

## 8. Edit Member: Rename With Cascades

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

## 9. Edit Member: Add Missing Mentor Through Edit

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

## 10. Edit Member: Validation

Test:

- [ ] blank Member Name should block save
- [ ] changing Member Name to another existing member’s name should block save
- [ ] changing Member Name to a conflicting case-variant should block save
- [ ] changing Member Big to same as Member Name should block save
- [ ] invalid dynasty should be impossible via dropdown

## 11. Delete Member: No Dependents

Delete someone with no mentees.

Verify:

- [ ] confirmation popup appears
- [ ] it explains the delete
- [ ] after confirming, the row is removed
- [ ] after confirming, the page refreshes automatically

- [ ] Also test canceling and confirm no change happens.

## 12. Delete Member: With Dependents

Delete a mentor with active dependents:

- delete Alicia Wong

Verify:

- [ ] confirmation explains that dependent rows will have Member Big updated to null
- [ ] after confirming, the mentor row is gone
- [ ] after confirming, all affected dependent rows now have Member Big = null
- [ ] after confirming, the page refreshes automatically

## 13. Refresh Behavior

After each of these actions, confirm the table reflects server state immediately without manual reload:

- [ ] add
- [ ] edit
- [ ] rename with cascades
- [ ] edit with missing mentor auto-create
- [ ] delete
- [ ] delete with dependent nulling

## 14. Bulk Upload Interaction With Editor

After using Bulk Upload:

- [ ] confirm success popup appears
- [ ] close popup
- [ ] switch back to Edit Members
- [ ] verify new members exist in table
- [ ] verify sort order still works
- [ ] verify search finds them

## 15. Suggested Edge Cases

Also test:

- [ ] extra spaces around names when editing or adding
- [ ] same name entered with different capitalization
- [ ] very long names
- [ ] adding a member whose auto-created mentor later gets edited
- [ ] deleting an auto-created mentor after people point to them

## Pass Criteria

The feature passes if:

- [ ] all changes require confirmation
- [ ] confirmations accurately describe direct edits
- [ ] automatic follow-on changes are explained in plain language
- [ ] missing mentors are automated instead of hard-blocked
- [ ] renames cascade correctly
- [ ] deletes null out dependent Member Big values
- [ ] list refreshes after every mutation
- [ ] search works on both Member Name and Member Big
