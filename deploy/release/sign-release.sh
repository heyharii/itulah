#!/usr/bin/env bash
#
# Sign a store server build so shop servers will install it (edge/update.rs).
#
#   ./sign-release.sh keygen                 make release.pem (keep it offline)
#   ./sign-release.sh pubkey                 print the public key to build with:
#                                              ITULAH_RELEASE_PUBLIC_KEY=<hex> cargo build --release --bin store
#   ./sign-release.sh sign <binary> <url>    print the JSON for node.update
#
# The node checks sha256(binary) and an Ed25519 signature over those 32 raw
# digest bytes against the public key compiled into it. A build compiled
# without ITULAH_RELEASE_PUBLIC_KEY accepts no updates at all.

set -euo pipefail
KEY="${RELEASE_KEY:-release.pem}"

case "${1:-}" in
    keygen)
        [[ -e "$KEY" ]] && { echo "$KEY exists; refusing to overwrite a release key" >&2; exit 73; }
        openssl genpkey -algorithm ed25519 -out "$KEY"
        chmod 600 "$KEY"
        echo "Wrote $KEY. Keep it off every machine that builds or serves releases."
        ;;
    pubkey)
        openssl pkey -in "$KEY" -pubout -outform DER | tail -c 32 | xxd -p -c 64
        ;;
    sign)
        binary="${2:?binary}"; url="${3:?url}"
        digest_hex="$(openssl dgst -sha256 -r "$binary" | cut -d' ' -f1)"
        signature_hex="$(openssl dgst -sha256 -binary "$binary" \
            | openssl pkeyutl -sign -inkey "$KEY" -rawin -in /dev/stdin | xxd -p -c 256)"
        version="$("$binary" --version 2>/dev/null | awk '{print $2}' || true)"
        printf '{"action":"node.update","reason":"release %s","version":"%s","url":"%s","sha256":"%s","signature":"%s"}\n' \
            "$version" "$version" "$url" "$digest_hex" "$signature_hex"
        ;;
    *)
        sed -n '2,14p' "$0"; exit 64 ;;
esac
