DATABASE_URL ?= postgresql:///inventory_edge_dev

.PHONY: db run run-cloud run-dc run-store check test test-unit test-integration rfid-demo contract contract-check front front-check

db:
	docker compose up -d postgres

run: run-cloud

run-cloud:
	cd backend && DATABASE_URL=$(DATABASE_URL) cargo run --bin cloud

run-dc:
	cd backend && cargo run --bin dc

run-store:
	cd backend && cargo run --bin store

check:
	cd backend && cargo fmt --all --check && cargo clippy --all-targets --all-features -- -D warnings

test: test-unit test-integration

test-unit:
	cd backend && cargo test --lib

test-integration:
	cd backend && DATABASE_URL=postgresql:///postgres cargo test --tests -- --nocapture

rfid-demo:
	python3 scripts/rfid_simulator.py --retry

# ---------------------------------------------------------------------------
# The browser's half
# ---------------------------------------------------------------------------

# Rewrite the TypeScript the browser uses from the Rust structs the server
# actually serialises. Run this after changing anything on the wire.
#
# Two steps, and the second is not optional. ts-rs writes one file per type and
# nothing else; the barrel every app imports from is written by
# `generate-index.mjs`. Leaving that out is worse than forgetting the whole
# target: `src/contract/TaxRule.ts` exists, `contract-check` sees no drift, and
# `import type { TaxRule } from "@itulah/contract"` still fails — a type the
# server has been sending for a week that no browser can name. That is exactly
# what happened to `TaxRule` and to `MarkdownPolicy`.
contract:
	cd backend && cargo test --features ts --test contract_types
	cd frontend-contract && node generate-index.mjs

# Fail if the committed contract no longer matches the structs.
#
# The whole point of generating these is that nobody hand-edits them into
# agreement. This is what notices when somebody changes a field and forgets —
# the failure names the drift instead of leaving it to a runtime surprise.
#
# The path matters more than it looks. `git status --porcelain` on a directory
# that does not exist prints nothing, which reads here as "no drift" — so a
# stale path does not break this check, it silently disarms it. That is what
# happened when the contract moved out of the old frontend monorepo.
contract-check: contract
	@if [ ! -d frontend-contract/src/contract ]; then \
		echo "frontend-contract/src/contract is missing; 'make contract' writes it."; \
		exit 1; \
	fi
	@if [ -n "$$(git status --porcelain frontend-contract/src)" ]; then \
		echo "The generated contract is stale. Run 'make contract' and commit the result:"; \
		git --no-pager diff --stat frontend-contract/src; \
		exit 1; \
	fi
	@echo "contract is current"

# Build every surface.
#
# Separate builds rather than one, because these are different products: a till
# on a touch screen at arm's length, a warehouse console, head office, a phone
# in an apron pocket, and a phone in a shopper's hand. What they share is
# `frontend-contract` — the wire types generated from Rust and the one browser
# transport — not the interface.
#
# Each is its own static site that rewrites /api/* to its own node (see
# render.yaml), so a browser sees one origin and the SameSite=Strict session
# cookie is actually sent. `frontend-customer` is deployed too, but as a
# preview rather than a shopper-facing product until customer sign-in exists
# (frontend-customer/README.md).
FRONTENDS := frontend-cloud frontend-dc frontend-store frontend-employee frontend-customer

front:
	@for app in $(FRONTENDS); do \
		echo "--- $$app"; \
		( cd $$app && npm install --no-audit --no-fund && npm run build ) || exit 1; \
	done

# `npm run build` is `tsc -b && vite build`, and `tsc -b` is the real gate:
# the root tsconfig is solution-style (only `references`), so a bare
# `tsc --noEmit` against it checks nothing at all and reports success while
# the build is broken. Do not "simplify" this to a typecheck-only target.
front-check: front
	@echo "every surface typechecked and built"
