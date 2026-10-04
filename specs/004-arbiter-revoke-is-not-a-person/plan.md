# Spec 004 — Plan

- [x] 1. `onRevoked` change, tests.

## Test plan

| Scenario                                     | Expected          |
| -------------------------------------------- | ----------------- |
| `manual-override` revoke alone               | no hold           |
| Revoke then a person's ON on an owned charge | held, no OFF sent |
| Revoke then a person's OFF                   | no hold           |
