Spec: https://docs.google.com/document/d/1mLfF6RxlwLx0MTRgsLQ1iYl7QZGhnlydXBFbbNmUEdc/edit

## Terms

- Source: account we're migrating *from*
- Target: account we're migrating *to*

# The process

## Prep (UI)

- [x] Obtain access keys to both accounts
  - [x] Support SSO
- [x] Obtain C-S endpoints for both servers automagically

## Rooms

- [x] Scrape rooms the *source* is joined too
- [x] Collect join rules (public, invite etc)
- [x] Collect notification settings

### Failure points

- [x] Room is private, but *source* cannot send invites
- [x] Room is restricted and we cannot join any of the required rooms
- [x] Room has `m.room.history_visibility` that will make use lose old messages
- [ ] Room is not federated (`m.room.create`->`content`->`m.federate` == false)
- [x] Existing PL is not possible to obtain for the new account
- [ ] Secure backup is not enabled, cannot migrate room keys etc

## Profile

- [x] Collect display name and avatar
- [x] Collect push rules
- Collect account data
  - [x] `m.direct`
  - [x] `m.ignored_user_list`
  - [ ] Everything secure backup

## Pre-migration (UI)

- [x] Select which rooms to migrate
  - [ ] (by last activity, space membership maybe?)
- [ ] Trim encryption room keys to the rooms we'll be migrating
  
## Migration itself

- [x] Join public rooms
- [x] Have *source* invite *target* to invite-only rooms
- [x] Have *target* accept invites (only from the source account!)
- [x] Join restricted rooms, topo-sorted for optimal join order
- [x] Migrate account data
- [x] Migrate push rules
- [x] Optionally migrate username and avatar
- [ ] Migrate (merge?) secure backup contents

## Post-migration

All optional

- [ ] Have *source* demote itself in old rooms
- [x] Have *source* leave successfully migrated rooms
- [x] Have *source* change the displayname to advertise the new MXID
- [x] Add a push rule for the old MXID, so that we get notified of replies/mentions of the *source*
