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

- [ ] Room is private, but *source* cannot send invites
- [x] Room has `m.room.history_visibility` that will make use lose old messages
- [ ] Room is not federated (`m.room.create`->`content`->`m.federate` == false)

## Profile

- [x] Collect display name and avatar
- [ ] Collect push rules
- [x] Collect all (?), but especially `m.direct` account data
  - only `m.direct` for now

## Pre-migration (UI)

1. Select which rooms to migrate (by last activity, space membership maybe?)
  
## Migration itself

TBD

## Post-migration

All optional

1. Have *source* leave successfully migrated rooms
1. Have *source* change the displayname to advertise the new MXID
1. Add a push rule for the old MXID, so that we get notified of replies/mentions of the *source*
