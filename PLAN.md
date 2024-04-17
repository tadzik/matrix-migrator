Spec: https://docs.google.com/document/d/1mLfF6RxlwLx0MTRgsLQ1iYl7QZGhnlydXBFbbNmUEdc/edit

## Terms

- Source: account we're migrating *from*
- Target: account we're migrating *to*

# The process

## Prep (UI)

- [ ] Obtain access keys to both accounts (TBD)
- [ ] Obtain C-S endpoints for both servers automagically

## Rooms

- [x] Scrape rooms the *source* is joined too
- [x] Collect join rules (public, invite etc)
- [ ] Collect notification settings

### Failure points

- [x] Room is private, but *source* cannot send invites
- [x] Room is restricted and we cannot join any of the required rooms
- [x] Room has `m.room.history_visibility` that will make use lose old messages
- [ ] Room is not federated (`m.room.create`->`content`->`m.federate` == false)

## Profile

- [x] Collect display name and avatar
- [x] Collect push rules
- Collect account data
  - [x] `m.direct`
  - [x] `m.ignored_user_list`

## Pre-migration (UI)

1. Select which rooms to migrate (by last activity, space membership maybe?)
  
## Migration itself

TBD

## Post-migration

All optional

1. Have *source* leave successfully migrated rooms
1. Have *source* change the displayname to advertise the new MXID
1. Add a push rule for the old MXID, so that we get notified of replies/mentions of the *source*
