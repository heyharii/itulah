#!/usr/bin/env bash
#
# seed-pos-store — store-01 made fully testable at the till (owner, 23 Oct
# 2026: "lengkap — yang bisa dites di POS"): every delivery in transit to the
# store received, the stockroom put on the shop floor, the prototype's six
# promotions published to the store (30% off two articles, a Rp 99K fixed
# price, buy 2 get 1, members Rp 25.000 off from Rp 250.000, coupon HEMAT50,
# 1 point per Rp 10.000), and the members and vouchers of
# seed-pos-test-data.sh. Ends with a cheat-sheet read from the store node:
# tags to scan with their price and promotion, baskets that hit the basket
# offers, members, vouchers and logins. All through the apps' own routes, and
# safe to run twice — see seed-pos-store.py.
#
#   scripts/seed-pos-store.sh https://osretail.site      (asks for the admin password)
#   scripts/seed-pos-store.sh https://osretail.site --more 400
#                         first sends ~400 more pieces from the Gudang to the
#                         store (allot → pick → pack → dispatch → receive →
#                         floor); each run adds another 400. MORE=400 works too.
#   scripts/seed-pos-store.sh https://osretail.site --redeem-only
#                         only a fresh F11 Tukar poin code (they live 10 min)
#
# The first three members get 50.000 / 12.000 / 3.000 points (POINTS_TARGETS)
# through a bonus-points sale, and 081211110001 asks to redeem 10.000 of them
# (REDEEM_POINTS): the cheat-sheet prints the code to type at F11.
#
# The store side defaults to the demo's: STORE_API=https://pos.osretail.site,
# STORE_USER=bima (Kepala toko), STORE_PASSWORD=Password01. A Gudang on its
# own server (not INVENTORY_DC_HOSTING=cloud) needs DC_API. A local rig:
#
#   STORE_API=http://127.0.0.1:8482 DC_API=http://127.0.0.1:8481 STORE_USER=maya \
#     DEMO_ADMIN_PASSWORD=… scripts/seed-pos-store.sh http://127.0.0.1:8480 --more 400
set -euo pipefail
api="${CLOUD_API:-https://osretail.site}"
if [[ $# -gt 0 && "$1" != --* ]]; then api="$1"; shift; fi
pw="${DEMO_ADMIN_PASSWORD:-}"
if [[ -z "$pw" ]]; then read -rsp "admin password for $api: " pw; echo; fi
export DEMO_ADMIN_PASSWORD="$pw"
exec python3 "$(cd "$(dirname "$0")" && pwd)/seed-pos-store.py" "$api" "$@"
