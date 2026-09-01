DATABASE_URL ?= postgresql:///inventory_edge_dev

.PHONY: db run run-cloud run-dc run-store check test test-unit test-integration rfid-demo contract contract-check skin skin-check front front-check

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
contract:
	cd backend && cargo test --features ts --test contract_types

# Fail if the committed contract no longer matches the structs.
#
# The whole point of generating these is that nobody hand-edits them into
# agreement. This is what notices when somebody changes a field and forgets —
# the failure names the drift instead of leaving it to a runtime surprise.
contract-check: contract
	@if [ -n "$$(git status --porcelain frontend/packages/contract/src)" ]; then \
		echo "The generated contract is stale. Run 'make contract' and commit the result:"; \
		git --no-pager diff --stat frontend/packages/contract/src; \
		exit 1; \
	fi
	@echo "contract is current"

# Build all three consoles. Each binary serves its own:
#
#   cloud  FRONTEND_DIR=frontend/apps/console/dist
#   dc     FRONTEND_DIR=frontend/apps/dc/dist
#   store  FRONTEND_DIR=frontend/apps/pos/dist
#
# Three builds rather than one, because the three are different products: a
# till on a touch screen at arm's length, a warehouse console, and head
# office. What they share is the API client, not the interface.
# The skin is copied, not maintained twice.
#
# `dasbor/retail.css` is where the look is decided and where its enforcer runs.
# The apps use a derived copy for the same reason the browser's types are
# derived from Rust structs: two hand-kept copies of one truth is the drift
# this repository keeps paying for.
skin:
	cp dasbor/retail.css frontend/packages/skin/retail.css
	cd dasbor && node check-retail-css.mjs

skin-check: skin
	@if [ -n "$$(git status --porcelain frontend/packages/skin/retail.css)" ]; then \
		echo "The app skin is stale. Run 'make skin' and commit the result."; \
		exit 1; \
	fi
	@echo "skin is current"

front: skin
	cd frontend && npm install && npm run build

front-check:
	cd frontend && npm run typecheck
