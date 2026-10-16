#!/bin/sh
#
# The status screen of a locked store server (install-store.sh --lock).
#
# A locked box has no login on its console, so this is all anyone standing
# next to it sees: which shop it is, whether it is Ready or Offline, how fresh
# its data is, and the address the shop's tills and tablets open - with a QR
# code of that address when `qrencode` is installed.
#
# Run by central-status.service on tty1. It only READS the node on loopback
# (http://127.0.0.1:8082) and holds no secret. POSIX sh: no bashisms, no jq.

BASE="${CENTRAL_NODE_URL:-http://127.0.0.1:8082}"
EVERY="${CENTRAL_STATUS_EVERY:-5}"

# A silent keyboard: nothing typed here is echoed or acted on.
stty -echo -icanon 2>/dev/null || true
printf '\033[?25l'
trap 'printf "\033[?25h"' EXIT

fetch() {
    if command -v curl >/dev/null 2>&1; then
        curl -s --max-time 4 "$BASE$1" 2>/dev/null
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- -T 4 "$BASE$1" 2>/dev/null
    fi
}

# field NAME JSON -> the string value of the first "NAME":"value", or nothing.
field() {
    printf '%s' "$2" | grep -o "\"$1\" *: *\"[^\"]*\"" | head -n 1 | sed 's/^[^:]*: *"\(.*\)"$/\1/'
}

# The node advertises itself as {node id}.local with the id cut down to a DNS
# label (edge/discovery.rs host_label): lowercase letters, digits and hyphens.
host_label() {
    label=$(printf '%s' "$1" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9]/-/g; s/^-*//; s/-*$//' | cut -c1-63)
    printf '%s' "${label:-itulah-store}"
}

local_time() {
    [ -n "$1" ] || return 0
    date -d "$1" '+%d %b %Y %H:%M' 2>/dev/null || printf '%s' "$1"
}

green='\033[1;32m'
amber='\033[1;33m'
red='\033[1;31m'
dim='\033[2m'
off='\033[0m'

last_url=""
qr=""

while :; do
    identity=$(fetch /api/v1/node/identity)
    console=$(fetch /console/status)

    name=""
    url=""
    if [ -n "$identity" ]; then
        code=$(field site_code "$identity")
        site=$(field site_name "$identity")
        name="${code}${code:+${site:+ - }}${site}"
        [ -n "$name" ] || name=$(field site_id "$identity")
        origin=$(field origin_id "$identity")
        [ -n "$origin" ] && url="http://$(host_label "$origin").local:8082"
    fi

    state="Starting"
    colour=$amber
    detail="The server is starting up."
    if [ -n "$console" ]; then
        # The assessment object, whichever order the keys came in.
        assess=$(printf '%s' "$console" | sed 's/.*"assessment" *: *//')
        status_code=$(field code "$assess")
        tone=$(field tone "$assess")
        headline=$(field headline "$assess")
        case "$status_code" in
            OFFLINE)
                state="Offline"; colour=$amber
                detail="Tills keep selling. Sales are sent when the internet is back." ;;
            NOT_CONNECTED)
                state="Connecting"; colour=$amber
                detail="Getting data from Central." ;;
            *)
                case "$tone" in
                    OK) state="Ready"; colour=$green; detail="" ;;
                    BAD) state="Needs attention"; colour=$red; detail="$headline" ;;
                    *) state="Ready"; colour=$amber; detail="$headline" ;;
                esac ;;
        esac
    elif [ -z "$identity" ]; then
        if [ -n "$(fetch /setup/state)" ]; then
            state="Connecting"; colour=$amber
            detail="Waiting for Central to confirm this server."
        else
            state="Not answering"; colour=$red
            detail="The store server is not running. It restarts by itself."
        fi
    fi

    fresh=$(field newest_acked_at "$console")
    [ -n "$fresh" ] || fresh=$(field last_success_at "$console")

    ip=$(hostname -I 2>/dev/null | awk '{print $1}')

    if [ -n "$url" ] && [ "$url" != "$last_url" ]; then
        last_url=$url
        qr=""
        if command -v qrencode >/dev/null 2>&1; then
            qr=$(qrencode -t ANSIUTF8 -m 1 "$url" 2>/dev/null)
        fi
    fi

    # Compose the whole screen first and print it at once, so it never flickers.
    {
        printf '\033[H\033[2J'
        printf '\n  Central store server\n\n'
        printf '  %s\n' "${name:-This server}"
        printf '  %b%s%b\n' "$colour" "$state" "$off"
        [ -n "$detail" ] && printf '  %b%s%b\n' "$dim" "$detail" "$off"
        printf '\n'
        [ -n "$fresh" ] && printf '  Data up to  %s\n' "$(local_time "$fresh")"
        if [ -n "$url" ]; then
            printf '  Store app   %s\n' "$url"
            [ -n "$ip" ] && printf '              http://%s:8082\n' "$ip"
        elif [ -n "$ip" ]; then
            printf '  Store app   http://%s:8082\n' "$ip"
        fi
        if [ -n "$qr" ]; then
            printf '\n'
            printf '%s\n' "$qr" | sed 's/^/  /'
        fi
    }
    sleep "$EVERY"
done
