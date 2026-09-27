/// `crypto.randomUUID` exists only in a secure context — https, or localhost.
/// The hub opened from a phone on the office wifi (`http://192.168.x.x`) is
/// neither, and every form that mints an idempotency key threw on its first
/// render: "crypto.randomUUID is not a function". `getRandomValues` has no
/// such gate, so the missing function is built from it — a v4 UUID, the same
/// shape the native one returns. Production is served over https and never
/// reaches the fallback.
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join(
        ""
      )}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}` as `${string}-${string}-${string}-${string}-${string}`
  }
}
