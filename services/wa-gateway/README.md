# wa-gateway

A small HTTP service that sends WhatsApp messages through WhatsApp Web, driven by a headless Chromium (`whatsapp-web.js`). Head office calls it to send one-time codes (member registration, point redemption at the POS). It is a stand-in until the company has the official WhatsApp Business API.

**Risk:** this is unofficial WhatsApp Web automation, and WhatsApp can restrict or ban the number. Use a dedicated company number, keep the volume low, and switch to the official API later.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `WA_GATEWAY_KEY` | none, required | Shared secret for the `x-gateway-key` header. At least 24 characters, or the service refuses to start. |
| `PORT` | `3100` | HTTP port. |
| `WA_DATA_DIR` | `/data` | Where the WhatsApp session (and the WhatsApp Web page cache) is kept. Mount a volume here. |
| `CHROME_PATH` | `/usr/bin/chromium` | Chromium executable. |

## API

Every route needs the header `x-gateway-key: <WA_GATEWAY_KEY>`; without it the answer is `401 {"error":"unauthorized"}`. Bodies and answers are JSON.

### `GET /status`

```json
{
  "state": "STARTING | QR | CONNECTED | DISCONNECTED",
  "qr": "raw QR string, only while state is QR, else null",
  "number": "6281234567890 (the paired phone) or null",
  "name": "the WhatsApp profile name or null",
  "since": "ISO time of the last state change",
  "last_error": "last error text or null"
}
```

### `POST /send`

```json
{ "to": "081234567890", "text": "Your code is 123456" }
```

`to` is cleaned to digits, a leading `0` becomes `62`, a leading `+` is dropped; the result must be 10-15 digits starting with `62`. `text` is 1-1000 characters.

| Status | Body | When |
| --- | --- | --- |
| 200 | `{ "id": "<message id>", "to": "6281234567890" }` | sent |
| 400 | `{ "error": "invalid_json" \| "invalid_number" \| "invalid_text" \| "text_too_long" }` | bad request |
| 401 | `{ "error": "unauthorized" }` | missing or wrong key |
| 413 | `{ "error": "payload_too_large" }` | body over 16 KB |
| 422 | `{ "error": "not_on_whatsapp" }` | the number has no WhatsApp account |
| 429 | `{ "error": "rate_limited", "retry_after": <seconds> }` | more than 30 sends in a minute (all callers together) |
| 502 | `{ "error": "send_failed" }` | WhatsApp Web failed to send |
| 503 | `{ "error": "not_connected", "state": "<state>" }` | not paired or reconnecting |
| 504 | `{ "error": "send_timeout" }` | no answer in 30 s; the message may or may not have gone |

### `POST /logout`

Logs WhatsApp Web out, deletes the saved session and starts again, so a new QR appears in `/status` within a few seconds. Answers `{ "ok": true }`. Also works to reset a stuck session.

## Run in Docker

```sh
docker build -t wa-gateway services/wa-gateway

docker run -d --name wa-gateway --restart unless-stopped \
  -e WA_GATEWAY_KEY="$(openssl rand -hex 24)" \
  -v wa-gateway-data:/data \
  -p 3100:3100 \
  wa-gateway
```

Keep the volume: it holds the pairing, so a restart or a new image does not ask for the QR again. Run one instance only (two containers cannot share one session). With a bind mount instead of a named volume, the directory must be writable by uid 1000. The container runs as the non-root `node` user and starts Chromium with `--no-sandbox`; do not expose port 3100 to the internet, only to the head-office backend.

Without Docker: Node 22, `PUPPETEER_SKIP_DOWNLOAD=true npm install`, a system Chromium, then `WA_GATEWAY_KEY=... WA_DATA_DIR=./data CHROME_PATH=/path/to/chromium npm start`.

## Pair the number

1. Start the service. After a few seconds `/status` shows `state: "QR"` with a `qr` string.
2. Scan it from the company phone: WhatsApp > Linked devices > Link a device. The QR changes about every 20 seconds, so Central > System > WhatsApp keeps polling `/status`.
3. When `state` becomes `CONNECTED`, `number` is the paired phone.

Without Central, print the QR in a terminal:

```sh
curl -s -H "x-gateway-key: $WA_GATEWAY_KEY" http://localhost:3100/status | jq -r .qr | npx qrcode-terminal
```

If the phone unlinks the device, or `POST /logout` is called, the session is deleted and a new QR appears. After any other disconnect the service reconnects by itself after 5 seconds using the saved session.

## Logs

One line per event on stdout: state changes, sends (number masked like `6281****7890`) and errors. Message text and the QR string are never logged.
