#!/usr/bin/env bash
#
# Build the release APK and put it on a handheld the way the floor runs it.
#
#   handheld/tools/install-release.sh                   one handheld attached
#   handheld/tools/install-release.sh --serial SERIAL   several: name one (adb devices)
#   handheld/tools/install-release.sh --no-build        install the APK already built
#
# Why release, always: a debug build is debuggable, and a debuggable app runs
# Compose with its debugging machinery switched on — about twice as slow on a
# C5 (TESTING.md: the same screen at 42 ms in debug, 27 ms in release). A debug
# build is for the bench. Never judge speed on one.
#
# In order:
#   1. ./gradlew assembleRelease, with JDK 17 and the Homebrew Android SDK.
#   2. adb install -r — a replace, so Setelan, the device key and the evidence
#      outbox all survive. This script never uninstalls: when the installed
#      copy is signed with another key it stops and says so instead, because an
#      uninstall deletes exactly the things -r exists to keep.
#   3. adb shell cmd package compile -m speed -f — ART compiles the whole app
#      ahead of time now, instead of interpreting and JIT-compiling it for its
#      first days on the floor.
#   4. Prints whether the installed package is debuggable. It must say no.
#
# Installing restarts the app: finish (or keep) any sweep in progress first.
#
# Overrides: PINDAI_JAVA_HOME (default /opt/homebrew/opt/openjdk@17) and
# ANDROID_HOME (default /opt/homebrew/share/android-commandlinetools).
#
# Written for the bash 3.2 macOS ships as well as a newer one.

set -euo pipefail

PACKAGE="id.itulah.pindai"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDHELD="$(cd "$HERE/.." && pwd)"
APK="$HANDHELD/app/build/outputs/apk/release/app-release.apk"
APK_SHOWN="${APK#"$HANDHELD"/}"

export JAVA_HOME="${PINDAI_JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
ADB="$ANDROID_HOME/platform-tools/adb"

die() {
    echo "install-release: $*" >&2
    exit 1
}

usage() {
    cat <<EOF
usage: $(basename "$0") [--serial SERIAL] [--no-build]

  --serial SERIAL   the device to install on; required when more than one
                    device is attached (see: adb devices)
  --no-build        skip assembleRelease and install the APK already at
                    $APK_SHOWN

Builds the release APK, installs it with adb install -r (app settings kept),
compiles it ahead of time with cmd package compile -m speed -f, and prints
whether the installed package is debuggable.
EOF
}

serial=""
build=1
while [ $# -gt 0 ]; do
    case "$1" in
        --serial|-s)
            [ $# -ge 2 ] || die "--serial needs a value (see: $ADB devices)"
            serial="$2"
            shift 2
            ;;
        --serial=*)
            serial="${1#--serial=}"
            shift
            ;;
        --no-build)
            build=0
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown argument: $1 (try --help)"
            ;;
    esac
done

[ -x "$ADB" ] || die "adb not found at $ADB (set ANDROID_HOME)"

# --- which device ------------------------------------------------------------
#
# Decided BEFORE a two-minute build, not after it. Every attached device counts,
# whatever its state — "device", "unauthorized", "offline" — because installing
# onto the wrong handheld is the mistake this check exists for, and a wireless
# device can be listed twice (its mDNS name and its ip:port).
attached="$("$ADB" devices | awk -F'\t' 'NF == 2 && $1 != "" { print $1 "\t" $2 }')"
count="$(printf '%s\n' "$attached" | awk 'NF > 0 { n++ } END { print n + 0 }')"

if [ -z "$serial" ]; then
    if [ "$count" -eq 0 ]; then
        die "no device attached. Connect the handheld (TESTING.md, Connect) and run again."
    fi
    if [ "$count" -gt 1 ]; then
        echo "More than one device is attached:" >&2
        printf '%s\n' "$attached" | sed 's/^/  /' >&2
        die "refusing to guess. Name one: $(basename "$0") --serial SERIAL"
    fi
    serial="$(printf '%s\n' "$attached" | awk -F'\t' 'NF > 0 { print $1 }')"
fi

state="$(printf '%s\n' "$attached" \
    | awk -F'\t' -v s="$serial" '$1 == s && !seen { print $2; seen = 1 }')"
[ -n "$state" ] || die "$serial is not attached (adb devices does not list it)"
[ "$state" = "device" ] ||
    die "$serial is '$state', not ready. Unlock it and accept the debugging prompt (TESTING.md)."

adb_s() {
    "$ADB" -s "$serial" "$@"
}

model="$(adb_s shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)"
echo "== device: $serial${model:+ ($model)}"

# --- build -------------------------------------------------------------------
if [ "$build" -eq 1 ]; then
    [ -d "$JAVA_HOME" ] || die "no JDK at $JAVA_HOME (set PINDAI_JAVA_HOME)"
    [ -d "$ANDROID_HOME" ] || die "no Android SDK at $ANDROID_HOME (set ANDROID_HOME)"
    echo "== building the release APK (assembleRelease)"
    (cd "$HANDHELD" && ./gradlew assembleRelease)
fi
[ -f "$APK" ] || die "no APK at $APK — build it first, or drop --no-build"

# --- install -----------------------------------------------------------------
echo "== installing $APK_SHOWN on $serial"
echo "   adb install -r: the app's settings are kept; the app restarts"
set +e
install_out="$(adb_s install -r "$APK" 2>&1)"
install_status=$?
set -e
printf '%s\n' "$install_out"
if [ "$install_status" -ne 0 ] || [[ "$install_out" != *Success* ]]; then
    case "$install_out" in
        *INSTALL_FAILED_UPDATE_INCOMPATIBLE*)
            echo >&2
            echo "The copy on the handheld is signed with a different key." >&2
            echo "NOT uninstalling it: that would delete its settings, its device key" >&2
            echo "and any evidence still waiting in its outbox. Install a build signed" >&2
            echo "with the same key, or remove the old copy by hand once nothing on it" >&2
            echo "matters any more." >&2
            ;;
        *INSTALL_FAILED_VERSION_DOWNGRADE*)
            echo >&2
            echo "The handheld has a newer versionCode installed than this APK carries." >&2
            ;;
    esac
    die "install failed; nothing was changed on $serial"
fi

# --- compile ahead of time ---------------------------------------------------
echo "== compiling ahead of time (cmd package compile -m speed -f)"
compile_out="$(adb_s shell cmd package compile -m speed -f "$PACKAGE" 2>&1 | tr -d '\r' || true)"
printf '%s\n' "$compile_out"
compiled=0
[[ "$compile_out" != *Success* ]] || compiled=1

# What ART now holds for it, where this Android version prints it. For the
# eye only: the exit status does not depend on it.
art="$(adb_s shell dumpsys package dexopt 2>/dev/null | tr -d '\r' | awk -v p="$PACKAGE" '
    { line = $0; gsub(/^[ \t\[]+|[ \t\]]+$/, "", line) }
    line == p { inside = 1; next }
    inside && /^[ \t]*\[/ { inside = 0 }
    inside && /status=/ { sub(/^[ \t]+/, ""); print; inside = 0 }
' || true)"

# --- debuggable? -------------------------------------------------------------
flags="$(adb_s shell dumpsys package "$PACKAGE" 2>/dev/null | tr -d '\r' \
    | awk '/^[ \t]+(pkgFlags|flags)=\[/' || true)"
debuggable="unknown"
if [ -n "$flags" ]; then
    if [[ "$flags" == *DEBUGGABLE* ]]; then
        debuggable="YES"
    else
        debuggable="no"
    fi
fi

echo
echo "installed:  $PACKAGE on $serial"
if [ "$compiled" -eq 1 ]; then
    echo "compiled:   speed, ahead of time"
else
    echo "compiled:   NOT confirmed (see the output above)"
fi
[ -z "$art" ] || echo "ART:        $(printf '%s\n' "$art" | sed -n 1p)"
echo "debuggable: $debuggable"

status=0
if [ "$debuggable" = "YES" ]; then
    echo "  A debuggable build runs about twice as slow. Do not time it." >&2
    status=1
elif [ "$debuggable" = "unknown" ]; then
    echo "  dumpsys printed no package flags; check: adb shell dumpsys package $PACKAGE" >&2
    status=1
fi
[ "$compiled" -eq 1 ] || status=1
exit "$status"
