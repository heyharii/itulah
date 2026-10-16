const origin = (process.env.RUST_API_ORIGIN ?? "http://cloud:8080").replace(/\/$/, "")

async function json(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`demo3 seed API ${response.status}: ${JSON.stringify(body).slice(0, 500)}`)
  }
  return body
}

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const password = Buffer.concat(chunks).toString("utf8").trim()
if (!password) throw new Error("password must be provided on stdin")

const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password }),
})
const login = await json(loginResponse)
const cookieParts = loginResponse.headers.getSetCookie().map((value) => value.split(";", 1)[0])
const cookie = cookieParts.join("; ")
const csrf = cookieParts.find((value) => value.startsWith("inventory_csrf="))?.slice("inventory_csrf=".length)
if (!cookie || !csrf) throw new Error("demo3 login did not return the session cookies")

const headers = {
  cookie,
  "x-csrf-token": decodeURIComponent(csrf),
  "content-type": "application/json",
}
const prefix = "D3PERF-"
const current = await json(await fetch(
  `${origin}/api/v1/purchase-orders?q=${encodeURIComponent(prefix)}&sort=updated`,
  { headers: { cookie } }
))
const existing = new Set((current.rows ?? []).map((row) => row.po_number))
let created = 0

for (let index = 1; index <= 36; index++) {
  const poNumber = `${prefix}${String(index).padStart(3, "0")}`
  if (existing.has(poNumber)) continue
  const supplierIndex = ((index - 1) % 4) + 1
  const promised = new Date(Date.now() + ((index % 17) - 4) * 86_400_000).toISOString().slice(0, 10)
  const lines = [1, 2].map((line) => ({
    article_code: `D3-ITEM-${String(index).padStart(3, "0")}-${line}`,
    article_name: `Synthetic apparel ${String(index).padStart(3, "0")}-${line}`,
    image_url: null,
    division_code: line === 1 ? "PRIA" : "WANITA",
    // Use only tags from the shared vocabulary seeded by the backend
    // migrations; demo identifiers belong in PO/article names, not taxonomy.
    tags: [line === 1 ? "KEMEJA" : "CELANA"],
    ordered_quantity: 12 + ((index * line * 7) % 84),
    unit_price_minor: 45_000 + (((index + line) * 3_500) % 75_000),
    promised_date: promised,
  }))
  await json(await fetch(`${origin}/api/v1/purchase-orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      po_number: poNumber,
      supplier_id: `D3-SUP-${String(supplierIndex).padStart(2, "0")}`,
      supplier_name: `Demo3 Synthetic Supplier ${String(supplierIndex).padStart(2, "0")}`,
      destination_site_id: "dc",
      origin_kind: "DIRECT",
      currency: "IDR",
      notes: "Synthetic performance and freshness fixture for isolated demo3.",
      created_by: login.user?.username ?? "admin",
      lines,
    }),
  }))
  created++
}

console.log(JSON.stringify({ created, present: existing.size + created, prefix }))
