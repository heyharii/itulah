DATABASE_URL ?= postgresql:///inventory_edge_dev

.PHONY: db migrate run check test test-unit test-integration rfid-demo

db:
	docker compose up -d postgres

migrate:
	cd backend && DATABASE_URL=$(DATABASE_URL) cargo run --bin migrate

run:
	cd backend && DATABASE_URL=$(DATABASE_URL) cargo run --bin inventory-edge

check:
	cd backend && cargo fmt --all --check && cargo clippy --all-targets --all-features -- -D warnings

test: test-unit test-integration

test-unit:
	cd backend && cargo test --lib

test-integration:
	cd backend && DATABASE_URL=postgresql:///postgres cargo test --test inventory_integration -- --nocapture

rfid-demo:
	python3 scripts/rfid_simulator.py --retry
