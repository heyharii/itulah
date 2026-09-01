# @itulah/contract

Two things the three front ends share, for the same reason: a second copy
would be a second opinion.

- `src/contract/` — **generated**. Written by `make contract` from the Rust
  structs the servers actually serialise (`backend/tests/contract_types.rs`).
  Never edited by hand.
- `src/client/` — **hand-written**. The one place a browser talks to a node:
  transport, errors, and sign-in. Three apps, one set of calls.

`src/index.ts` is generated too, by `generate-index.mjs`, so a type added on
the Rust side cannot be silently missing from the barrel.
