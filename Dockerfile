# syntax=docker/dockerfile:1.7

# One image contains all three server binaries. APP_BIN selects the role at
# runtime, so the same build artifact can be promoted across environments.
FROM rust:1.88-bookworm AS builder

WORKDIR /app

# Keep dependency compilation cacheable when application source changes.
COPY backend/Cargo.toml backend/Cargo.lock ./backend/
COPY backend/crates ./backend/crates
RUN mkdir -p backend/src backend/migrations/postgres backend/migrations/sqlite
RUN cargo fetch --locked --manifest-path backend/Cargo.toml

COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
RUN cargo build --locked --manifest-path backend/Cargo.toml --release --workspace --bins

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/backend/target/release/cloud /usr/local/bin/cloud
COPY --from=builder /app/backend/target/release/dc /usr/local/bin/dc
COPY --from=builder /app/backend/target/release/store /usr/local/bin/store
COPY frontend ./frontend
COPY deploy/render/entrypoint.sh /usr/local/bin/itulah-entrypoint

RUN chmod 0755 /usr/local/bin/itulah-entrypoint \
    && useradd --system --uid 10001 --create-home --home-dir /nonexistent --shell /usr/sbin/nologin itulah

ENV APP_BIN=cloud \
    FRONTEND_DIR=/app/frontend \
    INVENTORY_AUTH_MODE=required \
    INVENTORY_AUTH_COOKIE_SECURE=true \
    RUST_LOG=inventory_backend=info,tower_http=info

# Render supplies PORT. The binaries translate it to 0.0.0.0:$PORT unless an
# explicit BIND_ADDR is supplied for a private edge installation.
EXPOSE 10000
USER 10001
ENTRYPOINT ["/usr/local/bin/itulah-entrypoint"]
