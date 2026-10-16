import type { EmptyArt } from "@/components/ui/empty-art"

/// The picture a sentence asks for. What the list could not show decides
/// first (nothing matching, nothing left to do), then what the list holds.
export function artForSentence(sentence: string): EmptyArt | null {
  const s = sentence.toLowerCase()
  if (/\b(match|matches|found)\b/.test(s)) return "search"
  if (
    /in full|nothing (is )?late|all done|nothing left|up to date|square|healthy|caught up|nothing (outstanding|waiting|needs)|every .* (has|is)/.test(
      s
    )
  )
    return "done"
  if (/\breports?\b/.test(s)) return "chart"
  if (/\b(return|returns|refund|taken back|back over)\b/.test(s)) return "return"
  if (/\b(truck|trip|dispatch|transit|road|delivery note|on the way|shipped)\b/.test(s)) return "truck"
  if (/\b(po|order|orders|purchase|supplier|suppliers|bill)\b/.test(s)) return "orders"
  if (/\b(promotion|campaign|voucher|price|prices|discount|deal|coupon|markdown|pricelist|offer)/.test(s)) return "tag"
  if (/\b(member|members|user|users|account|people|customer|staff|enrolled|employee)/.test(s)) return "people"
  if (/\b(store|stores|shop|till|tills|fleet|server)/.test(s)) return "store"
  if (/\b(sold|sale|sales|report|chart|takings|revenue)/.test(s)) return "chart"
  if (/\b(notification|activity|event|message|alert)/.test(s)) return "bell"
  if (/\b(scheduled|schedule|due|this week|this month|period|window)\b/.test(s)) return "calendar"
  if (/\b(count|counts|stock|carton|koli|movement|pool|piece|pieces|pick|pack|allot|article|item|items|receive|receiving|tag|label)/.test(s)) return "box"
  return null
}

/// The picture a department falls back to, by the screen's path.
export function artForPath(pathname: string): EmptyArt {
  const top = pathname.split("/")[1] ?? ""
  if (top === "procurement") return "orders"
  if (top === "operations" || top === "inventory" || top === "allotment" || top === "merchandise" || top === "master") return "box"
  if (top === "commercial") return "tag"
  if (top === "sales" || top === "executive" || top === "reports") return "chart"
  if (top === "stores") return "store"
  if (top === "members") return "people"
  if (top === "system") return "bell"
  return "empty"
}
