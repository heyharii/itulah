import { node } from "@/lib/api"
import type { WhatsAppStatus } from "@itulah/contract"

export type { WhatsAppStatus }

/// Head office's WhatsApp number — the one that sends shoppers their one-time
/// codes (member registration at the till, member-app sign-in, points
/// redemption). System › WhatsApp pairs it, tests it and unlinks it; all three
/// are an Admin's at head office, and the server answers anybody else with 403.
///
/// The gateway is WhatsApp Web driven by a browser on the server, so every
/// answer here is the gateway's own word for itself: `state` is a plain string
/// (`OFF`, `UNREACHABLE`, `STARTING`, `QR`, `CONNECTED`, `DISCONNECTED`) and a
/// value this app has no word for yet is shown as it came.

/// Under `system` so signing out drops it by prefix, like the rest of the
/// module's answers.
export const whatsappKeys = {
  status: () => ["system", "whatsapp"] as const,
}

export function whatsappStatus(signal?: AbortSignal) {
  return node.get<WhatsAppStatus>("/api/v1/system/whatsapp", { signal })
}

/// How soon to ask again. While a pairing is on its way — the QR is on screen
/// and is replaced every few seconds, or the gateway is still starting — it is
/// every 3 s so the code in front of the phone is the live one; at rest it is
/// the hub's usual 10 s.
export function whatsappPollMs(state: string | undefined): number {
  return state === "QR" || state === "STARTING" ? 3_000 : 10_000
}

/// One message to a number the Admin names, to prove the line works end to end.
/// `sent_to` is the number with its middle hidden, ready to show.
export function sendWhatsAppTest(to: string) {
  return node.post<{ id: string; sent_to: string }>(
    "/api/v1/system/whatsapp/test",
    { to }
  )
}

/// Unlink the number so another can be paired; a new QR appears within seconds.
export function unlinkWhatsApp() {
  return node.post<{ ok: boolean }>("/api/v1/system/whatsapp/logout", {})
}
