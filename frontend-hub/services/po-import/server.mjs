/// PO import ingest — the pipeline behind "New PO from files" in the hub.
///
/// A buyer uploads ANY number of documents — Excel sheets, PDFs, photographs
/// of a faxed order — and this service turns them into PO DRAFTS. It never
/// creates a purchase order: the hub's review summary owns that decision, and
/// the only route to the real order book runs through the button somebody
/// presses there.
///
/// ## Who decides what
///
/// **Jev (TypeSafe AI, `typesafe-ai/jev` through Vercel AI Gateway) is the
/// decision maker at every fork in this pipeline:**
///
///  1. *Does this PDF page need OCR?* — the doc-router question. Pages with a
///     usable text layer are read locally, for free; pages with no text, or
///     with a suspicious one, are judged by Jev and only the condemned pages
///     go to the OCR provider. A page with no text at all needs no model's
///     opinion — there is no evidence to judge, so OCR is deterministic.
///  2. *Is this extracted value usable as-is?* — one boolean per extracted
///     field, answered against the document's own evidence. Anything below the
///     confidence threshold becomes a wizard QUESTION on the draft, not a
///     silent fact.
///  3. *Did the buyer's answer resolve the question?* — asked in `/v1/validate`
///     after the wizard closes. A guess the model is still unsure about keeps
///     its question open.
///
/// **Parsing itself is OpenParser first** (`POST /extract` — OCR plus field
/// extraction into a JSON schema, `POST /parse` when only text is wanted).
/// Without an OpenParser key the service degrades honestly: text-layer PDFs
/// are read locally with pdfjs, scanned documents go to a local `litparse`
/// binary (Tesseract OCR) when `LITEPARSE_BIN` names one, and whatever text
/// exists is mined by deterministic heuristics. Degraded runs still work —
/// they just mark more fields low-confidence, which means more wizard
/// questions, which is the honest outcome.
///
/// Jev is reachable ONLY through the AI SDK (`experimental_evaluate`) — the
/// gateway's evaluation API is not an OpenAI-compatible endpoint — which is
/// why this pipeline is Node and not the Rust cloud. The key never reaches the
/// browser; the hub talks to this service over a same-origin proxy, exactly as
/// it does to the cloud and the DC edge.
///
/// ## Shape
///
/// Stateless. `POST /v1/ingest` answers with per-file reports and PO drafts;
/// `POST /v1/validate` merges wizard answers into one draft and re-judges it.
/// The client holds the drafts. Nothing here writes to the cloud.
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { experimental_evaluate } from "ai"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import * as XLSX from "xlsx"

// ---------------------------------------------------------------------------
// Configuration

const PORT = Number(process.env.PORT ?? 8094)
const GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY ?? ""
const OPENPARSER_KEY = process.env.OPENPARSER_API_KEY ?? ""
const OPENPARSER_BASE =
  process.env.OPENPARSER_BASE_URL ?? "https://api.openparser.dev"
/// OpenParser names its OCR and LLM models on every call. The defaults are
/// their current suggestions; both are overridable without a code change.
const OCR_MODEL = process.env.OPENPARSER_OCR_MODEL ?? "paddleocr-vl-1.6"
const LLM_MODEL = process.env.OPENPARSER_LLM_MODEL ?? "openai/gpt-5.6-terra"
/// A local `litparse` CLI (LiteParse, Tesseract OCR) — the no-vendor fallback
/// for scanned pages when OpenParser is not configured.
const LITEPARSE_BIN = process.env.LITEPARSE_BIN ?? ""

/// Jev answers in probabilities; the thresholds are APPLICATION policy, kept
/// here in one place rather than scattered across the pipeline. Below
/// `USABLE`, an extracted value is not trusted and becomes a question. Below
/// `RESOLVED`, a buyer's answer has not settled the field and its question
/// stays open. Tuned against labelled documents, per the Jev guide's advice —
/// these are starting points, not laws.
const USABLE = 0.7
const RESOLVED = 0.8

/// Page text below this has nothing to judge — no text layer, OCR is certain.
const NO_TEXT_FLOOR = 30
/// Page text above this is plainly readable — no question worth asking.
const SURE_TEXT_CEIL = 400
/// The heuristic line between an unusable and a usable text layer, when Jev
/// is unreachable and the decision falls to a rule.
const HEURISTIC_TEXT_LINE = 200

// ---------------------------------------------------------------------------
// Small parsing helpers

/// "1.250.000", "1250000", "1.250.000,50" → a number of whole rupiah. Money on
/// the wire of this app is minor units, and IDR's minor unit is the rupiah
/// itself — so the printed figure IS the minor figure, separators stripped.
///
/// The separator rules, because print disagrees with itself: when BOTH a dot
/// and a comma appear, the LAST one is the decimal mark and the other is the
/// thousands grouping. When only one kind appears, a final group of 1–2 digits
/// is a decimal ("19,99") and groups of three are thousands ("340.000" — the
/// way rupiah is almost always printed, with no decimal part at all).
function parseAmountLoose(text) {
  if (text === null || text === undefined) return null
  const raw = String(text)
    .trim()
    .replace(/[^\d.,-]/g, "")
  if (raw === "") return null
  const hasDot = raw.includes(".")
  const hasComma = raw.includes(",")
  if (hasDot && hasComma) {
    const decimal = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : "."
    const thousands = decimal === "," ? "\\." : ","
    const [intPart, ...rest] = raw.split(decimal)
    const digits = intPart.replace(new RegExp(thousands, "g"), "")
    const value = Number.parseFloat(`${digits}.${rest.join("")}`)
    return Number.isFinite(value) ? Math.round(value) : null
  }
  if (hasDot || hasComma) {
    const sep = hasDot ? "." : ","
    // Groups of three separated by the mark, an optional 1–2 digit tail.
    const grouped = new RegExp(
      `^(\\d{1,3}(?:${sep === "." ? "\\." : ","}\\d{3})*)(?:${sep === "." ? "\\." : ","}(\\d{1,2}))?$`
    ).exec(raw)
    if (grouped !== null) {
      const base = grouped[1].split(sep).join("")
      const value =
        grouped[2] !== undefined
          ? Number.parseFloat(`${base}.${grouped[2]}`)
          : Number.parseInt(base, 10)
      return Number.isFinite(value) ? Math.round(value) : null
    }
    const digits = raw.split(sep).join("")
    const value = Number.parseInt(digits, 10)
    return Number.isFinite(value) ? value : null
  }
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : null
}

/// Quantities: whole units, tolerant of "12", "12,5" and "12.5".
function parseQuantityLoose(text) {
  const amount = parseAmountLoose(text)
  return amount === null || amount < 0 ? null : amount
}

const MONTHS_ID = {
  januari: "01",
  februari: "02",
  maret: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  agustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12",
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  jun: "06",
  jul: "07",
  agu: "08",
  agt: "08",
  sep: "09",
  okt: "10",
  nov: "11",
  des: "12",
}

/// The date shapes Indonesian purchase documents print: `2026-09-20`,
/// `20/09/2026`, `20-09-26`, `20 September 2026`. Anything else is not a date.
function parseDateLoose(text) {
  if (text === null || text === undefined) return null
  const raw = String(text).trim()
  if (raw === "") return null
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw)
  if (m !== null) return iso(m[1], m[2], m[3])
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(raw)
  if (m !== null) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    // Day-first, which is how Indonesia writes it.
    return iso(year, m[2], m[1])
  }
  m = /(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/.exec(raw)
  if (m !== null) {
    const month = MONTHS_ID[m[2].toLowerCase()]
    if (month !== undefined) return iso(m[3], month, m[1])
  }
  return null

  function iso(year, month, day) {
    const y = Number.parseInt(year, 10)
    const mo = Number.parseInt(month, 10)
    const d = Number.parseInt(day, 10)
    if (![y, mo, d].every(Number.isFinite)) return null
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  }
}

function normaliseName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(pt|cv|ud|tbk|persero|inc|ltd|llc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// Jev — the decision maker. One wrapper, because every fork in the pipeline
// asks it the same way: state, typed questions, probabilities back. Without a
// gateway key — or when a call fails — the caller's deterministic rule takes
// over, and the run is HONEST about having done so (every caller labels its
// fallback in the per-file report).

const JEV_MODEL = "typesafe-ai/jev"

async function jevEvaluate(state, questions) {
  if (GATEWAY_KEY === "") return null
  try {
    return await experimental_evaluate({
      model: JEV_MODEL,
      state,
      questions,
    })
  } catch (error) {
    console.warn(
      "[jev] evaluation unavailable, using the deterministic rule instead:",
      error?.message ?? error
    )
    return null
  }
}

/// Jev's answers, normalised to `{ value, probability }` per question name.
/// The evaluation API answers each question independently; the shapes below
/// are the three types the guide documents (boolean / choice / score).
function jevAnswers(result, names) {
  const out = {}
  if (result === null) return out
  for (const name of names) {
    const answer = result.answers?.[name]
    if (answer === undefined) continue
    if (answer.type === "boolean") {
      const probability =
        typeof answer.probability === "number" ? answer.probability : null
      out[name] = {
        // AI SDK evaluation answers encode a boolean as P(true), not as a
        // `boolean` property. Keep the probability for threshold decisions
        // and derive the selected value only where a caller needs it (the OCR
        // router does).
        value: probability === null ? null : probability >= 0.5,
        probability,
      }
    } else if (answer.type === "choice") {
      out[name] = {
        value: answer.choice,
        probability:
          answer.probabilities !== undefined
            ? (answer.probabilities[answer.choice] ?? null)
            : null,
      }
    } else if (answer.type === "score") {
      out[name] = {
        value: answer.score,
        probability: answer.confidence ?? null,
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// OpenParser — OCR and schema'd extraction over HTTPS.

/// The JSON shape every purchase document is extracted into. Sent to
/// `/extract` as the request's schema; the same shape is what the service
/// answers with, so the hub's types and this schema move together.
const PO_SCHEMA = {
  type: "object",
  properties: {
    po_number: { type: "string" },
    order_date: { type: "string", description: "ISO date YYYY-MM-DD" },
    expected_arrival: { type: "string", description: "ISO date YYYY-MM-DD" },
    currency: { type: "string", description: "ISO 4217 code, e.g. IDR" },
    supplier_name: {
      type: "string",
      description: "The company the order is placed WITH",
    },
    notes: { type: "string" },
    lines: {
      type: "array",
      description: "Every line item ordered, one object each",
      items: {
        type: "object",
        properties: {
          article_code: {
            type: "string",
            description: "The supplier's own code, when printed",
          },
          article_name: {
            type: "string",
            description: "What is being bought, as printed",
          },
          quantity: { type: "number" },
          unit: {
            type: "string",
            description: "pcs, box, koli, kg — as printed",
          },
          unit_price: {
            type: "number",
            description: "Price per unit, in whole currency units, as printed",
          },
          promised_date: {
            type: "string",
            description: "ISO date the supplier promises delivery",
          },
        },
        required: ["article_name", "quantity", "unit_price"],
        additionalProperties: false,
      },
    },
  },
  required: ["supplier_name", "lines"],
  additionalProperties: false,
}

async function openparserApi(path, form) {
  const response = await fetch(`${OPENPARSER_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENPARSER_KEY}`,
      // A fresh key per request: a retried UPLOAD is a different upload.
      "Idempotency-Key": randomUUID(),
    },
    body: form,
  })
  if (response.status === 202) return pollOpenParserJob(response)
  if (!response.ok) {
    throw new Error(`openparser ${path} answered ${response.status}`)
  }
  return response.json()
}

/// Durable jobs: accepted work continues without the client. Poll politely
/// and give up after a minute rather than hanging a buyer's upload.
async function pollOpenParserJob(accepted) {
  const body = await accepted.json()
  const jobId = body.job_id ?? body.id
  if (jobId === undefined)
    throw new Error("openparser accepted a job but named no id")
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const poll = await fetch(`${OPENPARSER_BASE}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${OPENPARSER_KEY}` },
    })
    if (!poll.ok) continue
    const job = await poll.json()
    if (job.status === "completed" || job.state === "completed") {
      return job.result ?? job.output ?? job
    }
    if (job.status === "failed" || job.state === "failed") {
      throw new Error(job.error ?? "openparser job failed")
    }
  }
  throw new Error("openparser job did not finish in 60s")
}

function openparserFileForm(buffer, filename, mime, request) {
  const form = new FormData()
  // Node's FormData only accepts a filename/options argument when the value is
  // a Blob. Passing an options object alongside a string throws before the
  // request reaches OpenParser, which made every keyed OCR run fail locally.
  form.append(
    "request",
    new Blob([JSON.stringify(request)], { type: "application/json" }),
    "request.json"
  )
  form.append("file", new Blob([buffer], { type: mime }), filename)
  return form
}

/// Schema'd extraction: OCR plus field extraction in one call.
async function openparserExtract(buffer, filename, mime) {
  const body = await openparserApi(
    "/extract",
    openparserFileForm(buffer, filename, mime, {
      ocr_model: OCR_MODEL,
      llm_model: LLM_MODEL,
      schema: PO_SCHEMA,
    })
  )
  // The payload's envelope has moved before; take the first object that
  // actually carries the schema's own keys.
  for (const candidate of [body.data, body.fields, body.result, body]) {
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      "lines" in candidate
    ) {
      return candidate
    }
  }
  throw new Error("openparser /extract answered without the schema's fields")
}

// ---------------------------------------------------------------------------
// LiteParse + Tesseract — the local OCR fallback, when no OpenParser key is
// configured. Best-effort: the CLI is asked for JSON and its plain output is
// accepted when it prints that instead.

async function liteparseText(buffer, filename, mime, ocr) {
  if (LITEPARSE_BIN === "") return null
  const dir = await mkdtemp(join(tmpdir(), "po-import-"))
  const suffix = filename.includes(".")
    ? filename.slice(filename.lastIndexOf("."))
    : ""
  const path = join(dir, `doc${suffix}`)
  try {
    await writeFile(path, buffer)
    const args = [path]
    if (ocr) {
      args.push(
        "--ocr-language",
        process.env.LITEPARSE_OCR_LANGUAGE ?? "ind+eng"
      )
    } else {
      args.push("--no-ocr")
    }
    const child = spawn(LITEPARSE_BIN, args, { timeout: 120_000 })
    let stdout = ""
    for await (const chunk of child.stdout) stdout += chunk
    const code = await new Promise((resolve) => child.on("close", resolve))
    if (code !== 0) return null
    const trimmed = stdout.trim()
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed)
        return typeof parsed.text === "string" ? parsed.text : stdout
      } catch {
        return stdout
      }
    }
    return trimmed === "" ? null : stdout
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// PDF text layers — read locally with pdfjs, judged per page by Jev.

async function pdfPageTexts(buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise
  const pages = []
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number)
    const content = await page.getTextContent()
    // Reconstruct PRINTED LINES, not the op stream: group text runs by their
    // baseline (transform's y), order each line by x, order lines top-down.
    // A parser that reads word-salad cannot tell a table row from a header.
    const rows = new Map()
    for (const item of content.items) {
      if (typeof item.str !== "string" || item.str.trim() === "") continue
      const y = Math.round(item.transform[5])
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push({ x: item.transform[4], str: item.str })
    }
    const text = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter((line) => line !== "")
      .join("\n")
    pages.push({ page: number, text, chars: text.length })
  }
  return pages
}

/// The doc-router fork, in its original spirit: pages with nothing on them go
/// to OCR without asking (there is no evidence to judge), pages with plainly
/// readable text stay local, and the ambiguous middle is Jev's question.
async function decideOcrPages(fileName, pages) {
  const decided = pages.map((p) => ({ ...p, needsOcr: null }))
  for (const page of decided) {
    if (page.chars < NO_TEXT_FLOOR) page.needsOcr = true
    else if (page.chars >= SURE_TEXT_CEIL) page.needsOcr = false
  }
  const ambiguous = decided.filter((p) => p.needsOcr === null)
  if (ambiguous.length > 0) {
    const names = ambiguous.map((p) => `page_${p.page}_needs_ocr`)
    const questions = Object.fromEntries(
      names.map((name, index) => [
        name,
        {
          type: "boolean",
          instructions: `Does page ${ambiguous[index].page} of this document need OCR, judging from its extracted text? A thin, garbled or watermark-only text layer means yes; a clean readable one means no.`,
        },
      ])
    )
    const result = await jevEvaluate(
      {
        document: fileName,
        pages: ambiguous.map((p) => ({
          page: p.page,
          characters: p.chars,
          sample: p.text.slice(0, 400),
        })),
      },
      questions
    )
    const answers = jevAnswers(result, names)
    for (const page of ambiguous) {
      const answer = answers[`page_${page.page}_needs_ocr`]
      if (answer === undefined) page.needsOcr = page.chars < HEURISTIC_TEXT_LINE
      else page.needsOcr = answer.value
    }
  }
  return decided
}

// ---------------------------------------------------------------------------
// Excel — read locally, no OCR, no model. A spreadsheet's cells are already
// data; the only judgement here is which column is which, and the header
// vocabulary below is deliberately wide (Indonesian and English both) because
// suppliers name their columns fifteen different ways.

const COLUMN_ALIASES = {
  article_code: [
    "kode",
    "kode barang",
    "kode artikel",
    "sku",
    "code",
    "item code",
    "article code",
  ],
  article_name: [
    "nama",
    "nama barang",
    "nama artikel",
    "nama item",
    "item",
    "item name",
    "article name",
    "description",
    "deskripsi",
    "barang",
  ],
  quantity: ["qty", "quantity", "jumlah", "banyak", "vol"],
  unit: ["satuan", "unit", "uom", "unit ukuran"],
  unit_price: [
    "harga",
    "harga satuan",
    "harga unit",
    "price",
    "unit price",
    "harga\/unit",
    "harga sat",
  ],
  promised_date: [
    "tanggal datang",
    "tgl datang",
    "delivery date",
    "promised",
    "jatuh tempo kirim",
    "estimasi datang",
  ],
}

function columnMap(headers) {
  const map = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let index = 0; index < headers.length; index++) {
      const header = normaliseName(headers[index])
      if (header === "") continue
      if (
        aliases.some(
          (alias) =>
            header === normaliseName(alias) ||
            header.includes(normaliseName(alias))
        )
      ) {
        if (map[field] === undefined) map[field] = index
      }
    }
  }
  return map
}

/// One workbook → one draft per sheet that carries item-like rows. Header
/// facts (supplier, dates) are read from cells ABOVE the table and from a
/// key/value block, both common shapes in Indonesian purchase sheets.
function excelFileToDrafts(fileName, buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const drafts = []
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
    })
    if (rows.length === 0) continue

    const headerRow = rows.findIndex(
      (row) =>
        row !== null &&
        row !== undefined &&
        Object.keys(columnMap(row)).length >= 2
    )
    if (headerRow === -1) continue
    const map = columnMap(rows[headerRow])
    const body = rows.slice(headerRow + 1).filter((row) => {
      const name = map.article_name !== undefined ? row[map.article_name] : null
      const qty = map.quantity !== undefined ? row[map.quantity] : null
      const price = map.unit_price !== undefined ? row[map.unit_price] : null
      return (
        String(name ?? "").trim() !== "" && (qty !== null || price !== null)
      )
    })
    if (body.length === 0) continue

    // Facts printed above the table: scan for labelled cells.
    let supplierName = null
    let poNumber = null
    let orderDate = null
    let expectedArrival = null
    for (const row of rows.slice(0, headerRow)) {
      if (row === null || row === undefined) continue
      for (let c = 0; c < row.length - 1; c++) {
        const label = normaliseName(row[c])
        const value = row[c + 1]
        if (label === "" || value === null || value === undefined) continue
        if (
          supplierName === null &&
          (label.includes("supplier") || label.includes("vendor"))
        )
          supplierName = String(value)
        if (
          poNumber === null &&
          (label.includes("no po") ||
            label.includes("po number") ||
            label.includes("nomor po"))
        )
          poNumber = String(value)
        if (
          orderDate === null &&
          (label.includes("tanggal") || label.includes("date"))
        )
          orderDate = parseDateLoose(value)
        if (
          expectedArrival === null &&
          (label.includes("datang") ||
            label.includes("arrival") ||
            label.includes("deliver"))
        )
          expectedArrival = parseDateLoose(value)
      }
    }

    drafts.push({
      draft_id: `d-${randomUUID().slice(0, 8)}`,
      source_files: [fileName],
      po_number: poNumber,
      supplier_name: supplierName,
      supplier_id: null,
      destination_site_id: null,
      currency: "IDR",
      order_date: orderDate,
      expected_arrival: expectedArrival,
      notes: null,
      lines: body.map((row) => ({
        line_id: `l-${randomUUID().slice(0, 8)}`,
        article_code:
          map.article_code !== undefined
            ? stringOrNull(row[map.article_code])
            : null,
        article_name: stringOrNull(row[map.article_name]),
        quantity:
          map.quantity !== undefined
            ? parseQuantityLoose(row[map.quantity])
            : null,
        unit: map.unit !== undefined ? stringOrNull(row[map.unit]) : null,
        unit_price_minor:
          map.unit_price !== undefined
            ? parseAmountLoose(row[map.unit_price])
            : null,
        promised_date:
          map.promised_date !== undefined
            ? parseDateLoose(row[map.promised_date])
            : null,
      })),
      questions: [],
      confidence: {},
      /// The spreadsheet path is deterministic — the header mapping either
      /// matched or did not. Stated on the draft so the review summary can
      /// show where each figure came from.
      parser: "excel",
      parser_note: `Sheet "${sheetName}": ${body.length} baris item dibaca langsung dari Excel.`,
    })
  }
  return drafts
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === "" ? null : text
}

// ---------------------------------------------------------------------------
// Heuristic text extraction — the local path, when the document's text came
// from a text layer (or liteparse) and no OpenParser key is configured. It is
// honest narrow: it finds the shapes Indonesian purchase documents usually
// print, and it would rather leave a field null than invent one — every null
// becomes a wizard question on the draft.

function heuristicExtract(fileName, text) {
  // Split on PRINTED lines only. The old rule also cut on runs of 3+ spaces,
  // which served word-salad input but shredded well-formed tables — "1  KLS-11
  // Kain Katon Prima  120  48.500" became three fragments no regex could
  // reunite. pdfjs now hands back real lines, liteparse prints real lines, and
  // a single space-separated mega-line is the fallback case, detected, not
  // assumed.
  const lines = (() => {
    const byNewline = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l !== "")
    if (
      byNewline.length === 1 &&
      byNewline[0].length > 200 &&
      /\d/.test(byNewline[0])
    ) {
      return byNewline[0]
        .split(/\s{3,}/)
        .map((l) => l.trim())
        .filter((l) => l !== "")
    }
    return byNewline
  })()
  let supplierName = null
  let poNumber = null
  let orderDate = null
  let expectedArrival = null
  let currency = null
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (
      supplierName === null &&
      /\b(supplier|vendor|pemasok|kepada|untuk)\b/.test(lower)
    ) {
      const after =
        line.split(/[:]/)[1] ??
        line.replace(/^.*?(supplier|vendor|pemasok|kepada|untuk)\s*/i, "")
      supplierName = stringOrNull(after)
    }
    if (poNumber === null) {
      const m =
        /\b(?:nomor\s*po|no\.?\s*po\.?|po\s*no\.?|purchase\s*order)\b\s*[:#]?\s*(.+)$/i.exec(
          line
        )
      if (m !== null) {
        // The tail after the label may itself carry "No." again ("Purchase
        // Order  No. PO-2026/09/118") — strip it, then the first token that
        // actually contains a digit is the number. A token without a digit
        // is another label, not a document number. The word boundary sits
        // BEFORE the optional dot: after "no." the position between "." and
        // the space is not a boundary, and the label would survive the strip.
        const tail = m[1].replace(/^(?:no|nomor)\b\.?\s*/i, "").trim()
        const token = /^[A-Za-z0-9][A-Za-z0-9./-]*/.exec(tail)
        if (token !== null && /\d/.test(token[0])) poNumber = token[0]
      }
    }
    if (
      orderDate === null &&
      /\b(tanggal|date)\b/.test(lower) &&
      !/datang|arrival|deliver/.test(lower)
    ) {
      orderDate = parseDateLoose(line.replace(/.*?\b(tanggal|date)\b/i, ""))
    }
    if (
      expectedArrival === null &&
      /datang|arrival|deliver|kirim/.test(lower)
    ) {
      expectedArrival = parseDateLoose(line)
    }
    if (currency === null && /\b(usd|sgd)\b/.test(lower))
      currency = /usd/.test(lower) ? "USD" : "SGD"
  }
  // A supplier's letterhead is usually the first substantial line.
  if (supplierName === null)
    supplierName = lines.find((l) => l.length > 3) ?? null
  if (currency === null) currency = "IDR"

  // Item rows: "Kemeja Flanel L-3  24  185.000" and friends. Three numbers
  // would be a grid; the LAST number on a line is treated as the price, the
  // one before it as the quantity.
  const linesOut = []
  for (const line of lines) {
    const m =
      /^(.+?)\s+(\d{1,6}(?:[.,]\d{1,3})?)\s+(?:rp\.?\s*)?([\d.,]{3,})\s*$/i.exec(
        line
      )
    if (m === null) continue
    let name = m[1].trim()
    if (name.length < 2 || /^\d+$/.test(name)) continue
    if (/subtotal|total|ppn|discount|diskon|grand/i.test(name)) continue
    // The row's leading NUMBER ("1  KLS-11  …") is a row index, not the
    // article's name, and the first token after it that looks like a supplier
    // code — digits with letters, hyphenated — is the article's code. Both
    // moves are conservative: "Kain 3L" keeps its name whole because "Kain"
    // carries no digit.
    let code = null
    name = name.replace(/^\d+[).\s-]+/, "")
    const codeToken = /^([A-Za-z0-9-]*\d[A-Za-z0-9-]*)(?:\s+(.*))?$/.exec(name)
    if (
      codeToken !== null &&
      /[A-Za-z]/.test(codeToken[1]) &&
      codeToken[2] !== undefined &&
      codeToken[2].length >= 3
    ) {
      code = codeToken[1]
      name = codeToken[2]
    }
    const quantity = parseQuantityLoose(m[2])
    const price = parseAmountLoose(m[3])
    if (quantity === null || price === null || price === 0) continue
    linesOut.push({
      line_id: `l-${randomUUID().slice(0, 8)}`,
      article_code: code,
      article_name: name === "" ? null : name,
      quantity,
      unit: null,
      // The SCHEMA's shape (`unit_price`, whole currency units) — `draftFrom`
      // maps this same key for every source, so a renamed field here would
      // quietly become `parseAmountLoose(undefined)` = null downstream.
      unit_price: price,
      promised_date: null,
    })
  }

  return {
    po_number: poNumber,
    order_date: orderDate,
    expected_arrival: expectedArrival,
    currency,
    supplier_name: supplierName,
    notes: null,
    lines: linesOut,
  }
}

// ---------------------------------------------------------------------------
// Judging — Jev decides which extracted values the wizard must ask about.

/// The draft's scalar fields that carry an extracted value. One boolean per
/// field, all answered against the same state — which is exactly the shape
/// Jev is for: questions evaluated independently, so a twenty-field document
/// costs one call, not twenty.
function draftFieldsForJudging(draft) {
  const fields = []
  if (draft.po_number !== null)
    fields.push({ id: "po_number", label: "Nomor PO", value: draft.po_number })
  if (draft.supplier_name !== null)
    fields.push({
      id: "supplier_name",
      label: "Nama supplier",
      value: draft.supplier_name,
    })
  if (draft.order_date !== null)
    fields.push({
      id: "order_date",
      label: "Tanggal order",
      value: draft.order_date,
    })
  if (draft.expected_arrival !== null)
    fields.push({
      id: "expected_arrival",
      label: "Perkiraan datang",
      value: draft.expected_arrival,
    })
  if (draft.currency !== null)
    fields.push({ id: "currency", label: "Mata uang", value: draft.currency })
  draft.lines.forEach((line, index) => {
    if (line.article_name !== null)
      fields.push({
        id: `line.${index}.article_name`,
        label: `Baris ${index + 1}: nama barang`,
        value: line.article_name,
      })
    if (line.quantity !== null)
      fields.push({
        id: `line.${index}.quantity`,
        label: `Baris ${index + 1}: jumlah`,
        value: String(line.quantity),
      })
    if (line.unit_price_minor !== null)
      fields.push({
        id: `line.${index}.unit_price`,
        label: `Baris ${index + 1}: harga satuan`,
        value: String(line.unit_price_minor),
      })
  })
  return fields
}

/// The wizard questions a draft still carries, after judging. A missing field
/// is always a question — there is nothing to be confident about. An extracted
/// field is a question only when Jev scored it below `USABLE`, or never
/// scored it (the degraded run), in which case the deterministic rule asks
/// for anything the heuristics produced — because a regex's confidence is a
/// guess pretending to be a fact.
function questionsForDraft(draft, confidence, answered) {
  const questions = []
  /// Trust policy per source. A spreadsheet's cells are exact data, so a
  /// value read from one is trusted without a model's opinion. Anything that
  /// came out of prose — an LLM extraction, a heuristic's regex — is a claim,
  /// and a claim Jev never scored is treated as unsure (the degraded run asks
  /// more questions; that is the honest price of no key). A field the BUYER
  /// answered in the wizard is settled by the act of answering — the value is
  /// theirs now, not the document's.
  const trusted = draft.parser === "excel"
  const settledByBuyer = answered ?? new Set()
  const fieldQuestion = (id, kind, label, options) => {
    const value = fieldValue(draft, id)
    const p = confidence[id]
    const scored = typeof p === "number"
    const supplierNeedsBook =
      id === "supplier_name" && draft.supplier_id === null
    const unsure =
      value === null ||
      value === undefined ||
      supplierNeedsBook ||
      (!settledByBuyer.has(id) && (scored ? p < USABLE : !trusted))
    if (!unsure) return
    questions.push({
      id,
      kind,
      label,
      options: options ?? null,
      prefilled: value === null || value === undefined ? null : String(value),
      confidence: typeof p === "number" ? Math.round(p * 100) / 100 : null,
      hint:
        value === null || value === undefined
          ? "Tidak ditemukan di dokumen sumber."
          : p === undefined
            ? "Hasil pembacaan dokumen — periksa sebelum dipakai."
            : `Keyakinan pembacaan ${Math.round(p * 100)}% — di bawah ambang ${Math.round(USABLE * 100)}%.`,
    })
  }

  fieldQuestion(
    "supplier_name",
    "choice",
    "Supplier mana order ini untuk?",
    "supplier"
  )
  fieldQuestion(
    "destination_site_id",
    "choice",
    "Barangnya dikirim ke mana?",
    "destination"
  )
  if (draft.po_number === null) {
    fieldQuestion(
      "po_number",
      "text",
      "Nomor PO (kosongkan untuk nomor otomatis)",
      null
    )
  } else {
    fieldQuestion("po_number", "text", "Nomor PO", null)
  }
  fieldQuestion(
    "expected_arrival",
    "date",
    "Kapan supplier menjanjikan datang?",
    null
  )
  for (const [index, line] of draft.lines.entries()) {
    fieldQuestion(
      `line.${index}.article_name`,
      "text",
      `Baris ${index + 1}: nama barang`,
      null
    )
    fieldQuestion(
      `line.${index}.quantity`,
      "number",
      `Baris ${index + 1}: jumlah`,
      null
    )
    fieldQuestion(
      `line.${index}.unit_price`,
      "number",
      `Baris ${index + 1}: harga satuan (rupiah)`,
      null
    )
  }
  return questions
}

function fieldValue(draft, id) {
  if (id === "po_number") return draft.po_number
  if (id === "supplier_name") return draft.supplier_name
  if (id === "destination_site_id") return draft.destination_site_id
  if (id === "expected_arrival") return draft.expected_arrival
  const lineMatch = /^line\.(\d+)\.(\w+)$/.exec(id)
  if (lineMatch !== null) {
    const line = draft.lines[Number.parseInt(lineMatch[1], 10)]
    if (line === undefined) return null
    if (lineMatch[2] === "unit_price") return line.unit_price_minor
    return line[lineMatch[2]]
  }
  return null
}

async function judgeDraft(draft) {
  const fields = draftFieldsForJudging(draft)
  if (fields.length > 0) {
    const names = fields.map((f) => `usable_${f.id.replace(/\./g, "_")}`)
    const questions = Object.fromEntries(
      names.map((name, index) => [
        name,
        {
          type: "boolean",
          instructions: `Is this value for "${fields[index].label}" usable as-is for a purchase order, given the document evidence? Yes only if it is complete and unambiguous; yes even if merely formatted differently.`,
        },
      ])
    )
    const result = await jevEvaluate(
      {
        document: draft.source_files.join(", "),
        parser: draft.parser,
        fields: fields.map((f) => ({ field: f.label, value: f.value })),
        line_count: draft.lines.length,
      },
      questions
    )
    if (result !== null) {
      const answers = jevAnswers(result, names)
      fields.forEach((field, index) => {
        const answer = answers[names[index]]
        if (answer !== undefined && answer.probability !== null) {
          draft.confidence[field.id] = answer.probability
        }
      })
    }
  }
  draft.questions = questionsForDraft(draft, draft.confidence)
  return draft
}

// ---------------------------------------------------------------------------
// One uploaded document → one or more raw drafts.

async function processFile(file) {
  const report = {
    file_name: file.name,
    status: "parsed",
    parser: "heuristic",
    pages_total: null,
    pages_ocr: null,
    note: null,
    error: null,
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const lower = file.name.toLowerCase()
  try {
    // -- Excel: read, never OCR. --
    if (/\.(xlsx|xls|csv)$/.test(lower)) {
      const drafts = excelFileToDrafts(file.name, buffer)
      if (drafts.length === 0) {
        report.status = "failed"
        report.error = "Tidak ada baris item yang dikenali di workbook ini."
        return { report, drafts: [] }
      }
      report.parser = "excel"
      report.note = `${drafts.length} sheet dibaca langsung (tanpa OCR).`
      return { report, drafts }
    }

    // -- PDF: text layer first, Jev decides per page, OCR only if condemned. --
    if (lower.endsWith(".pdf")) {
      const pages = await decideOcrPages(file.name, await pdfPageTexts(buffer))
      report.pages_total = pages.length
      report.pages_ocr = pages.filter((p) => p.needsOcr).length
      const anyOcr = report.pages_ocr > 0
      if (!anyOcr) {
        // Every page was read locally. No OCR vendor is paid.
        report.parser = "pdf-text"
        report.note = `${pages.length} halaman punya text layer utuh${GATEWAY_KEY ? " (Jev setuju)" : ""} — dibaca lokal, tanpa OCR.`
        const extracted = heuristicExtract(
          file.name,
          pages.map((p) => p.text).join("\n")
        )
        return {
          report,
          drafts: singleDraftOrFailure(
            report,
            file.name,
            extracted,
            "pdf-text",
            report.note
          ),
        }
      }
      const ocrNote = `${report.pages_ocr} dari ${pages.length} halaman perlu OCR${GATEWAY_KEY ? " — diputuskan Jev" : " (ambang teks lokal)"}.`
      if (OPENPARSER_KEY !== "") {
        const extracted = await openparserExtract(
          buffer,
          file.name,
          "application/pdf"
        )
        report.parser = "pdf-ocr"
        report.note = `${ocrNote} Diekstrak OpenParser (${OCR_MODEL}).`
        return {
          report,
          drafts: singleDraftOrFailure(
            report,
            file.name,
            extracted,
            "pdf-ocr",
            report.note
          ),
        }
      }
      const text = await liteparseText(
        buffer,
        file.name,
        "application/pdf",
        true
      )
      if (text !== null) {
        report.parser = "pdf-ocr"
        report.note = `${ocrNote} OCR lokal LiteParse/Tesseract.`
        const extracted = heuristicExtract(file.name, text)
        return {
          report,
          drafts: singleDraftOrFailure(
            report,
            file.name,
            extracted,
            "pdf-ocr",
            report.note
          ),
        }
      }
      report.status = "failed"
      report.error =
        "Dokumen butuh OCR tapi tidak ada cara: set OPENPARSER_API_KEY atau LITEPARSE_BIN."
      return { report, drafts: [] }
    }

    // -- Images: no text layer exists, so OCR is the only road. --
    if (/\.(png|jpe?g|webp|heic)$/.test(lower)) {
      if (OPENPARSER_KEY !== "") {
        const extracted = await openparserExtract(
          buffer,
          file.name,
          file.type || "image/jpeg"
        )
        report.parser = "image-ocr"
        report.note = `Foto — OCR OpenParser (${OCR_MODEL}), tanpa pertanyaan per halaman.`
        return {
          report,
          drafts: singleDraftOrFailure(
            report,
            file.name,
            extracted,
            "image-ocr",
            report.note
          ),
        }
      }
      const text = await liteparseText(
        buffer,
        file.name,
        file.type || "image/jpeg",
        true
      )
      if (text !== null) {
        report.parser = "image-ocr"
        report.note = "Foto — OCR lokal LiteParse/Tesseract."
        return {
          report,
          drafts: singleDraftOrFailure(
            report,
            file.name,
            heuristicExtract(file.name, text),
            "image-ocr",
            report.note
          ),
        }
      }
      report.status = "failed"
      report.error =
        "Foto perlu OCR: set OPENPARSER_API_KEY atau LITEPARSE_BIN terlebih dahulu."
      return { report, drafts: [] }
    }

    report.status = "skipped"
    report.error =
      "Tipe file tidak dikenal — kirim xlsx/xls/csv, pdf, atau foto."
    return { report, drafts: [] }
  } catch (error) {
    report.status = "failed"
    report.error = error?.message ?? "gagal memproses dokumen"
    return { report, drafts: [] }
  }
}

function draftFrom(fileName, extracted, parser, parserNote) {
  return {
    draft_id: `d-${randomUUID().slice(0, 8)}`,
    source_files: [fileName],
    po_number: stringOrNull(extracted.po_number),
    supplier_name: stringOrNull(extracted.supplier_name),
    supplier_id: null,
    destination_site_id: null,
    currency: stringOrNull(extracted.currency) ?? "IDR",
    order_date: parseDateLoose(extracted.order_date),
    expected_arrival: parseDateLoose(extracted.expected_arrival),
    notes: stringOrNull(extracted.notes),
    lines: (extracted.lines ?? []).map((line) => ({
      line_id: `l-${randomUUID().slice(0, 8)}`,
      article_code: stringOrNull(line.article_code),
      article_name: stringOrNull(line.article_name),
      quantity:
        typeof line.quantity === "number"
          ? Math.max(0, Math.round(line.quantity))
          : parseQuantityLoose(line.quantity),
      unit: stringOrNull(line.unit),
      unit_price_minor:
        typeof line.unit_price === "number"
          ? Math.round(line.unit_price)
          : parseAmountLoose(line.unit_price),
      promised_date: parseDateLoose(line.promised_date),
    })),
    questions: [],
    confidence: {},
    parser,
    parser_note: parserNote,
  }
}

function singleDraftOrFailure(report, fileName, extracted, parser, parserNote) {
  const draft = draftFrom(fileName, extracted, parser, parserNote)
  if (draft.lines.length === 0) {
    report.status = "failed"
    report.error = "Tidak ada baris item yang dikenali di dokumen ini."
    return []
  }
  return [draft]
}

// ---------------------------------------------------------------------------
// Grouping — several files are one PO when they name the same supplier and
// the same PO number. A photograph of page two joins the PDF of page one.
// The merge is deterministic on purpose: which lines belong together is a
// bookkeeping fact, not a judgement call.

function groupDrafts(drafts) {
  const groups = new Map()
  for (const draft of drafts) {
    const supplierKey = normaliseName(draft.supplier_name)
    const poKey = String(draft.po_number ?? "").trim()
    // Missing identity is not evidence that two documents are the same PO.
    // Keep such drafts separate until the wizard has enough information to
    // identify them; otherwise unrelated uploads collapse into one order.
    const key =
      supplierKey === "" || poKey === ""
        ? draft.draft_id
        : `${supplierKey}|${poKey}`
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { ...draft, lines: [...draft.lines] })
      continue
    }
    existing.source_files = [
      ...new Set([...existing.source_files, ...draft.source_files]),
    ]
    existing.po_number ??= draft.po_number
    existing.supplier_name ??= draft.supplier_name
    existing.supplier_id ??= draft.supplier_id
    existing.destination_site_id ??= draft.destination_site_id
    existing.order_date ??= draft.order_date
    existing.expected_arrival ??= draft.expected_arrival
    existing.notes ??= draft.notes
    if (existing.currency === "IDR" && draft.currency !== "IDR") {
      existing.currency = draft.currency
    }
    existing.lines.push(...draft.lines)
  }
  return [...groups.values()]
}

// ---------------------------------------------------------------------------
// HTTP

const app = new Hono()

app.get("/healthz", (c) =>
  c.json({
    gateway: GATEWAY_KEY !== "",
    openparser: OPENPARSER_KEY !== "",
    liteparse: LITEPARSE_BIN !== "",
  })
)

app.post("/v1/ingest", async (c) => {
  const body = await c.req.parseBody({ all: true })
  // Repeated part names arrive as ARRAYS of files — flatten before testing,
  // or a browser's multi-file upload reads as "no files".
  const values = Object.values(body).flatMap((v) =>
    Array.isArray(v) ? v : [v]
  )
  const entries = values.filter((v) => v instanceof File)
  if (entries.length === 0) {
    return c.json({ error: "Tidak ada file yang dikirim." }, 400)
  }
  const reports = []
  const drafts = []
  for (const file of entries) {
    const { report, drafts: fileDrafts } = await processFile(file)
    reports.push(report)
    drafts.push(...fileDrafts)
  }
  const grouped = groupDrafts(drafts)
  return c.json({
    reports,
    // Judge after grouping so line indexes, confidence, and questions cover
    // the complete merged document rather than only its first file.
    drafts: await Promise.all(grouped.map(judgeDraft)),
  })
})

app.post("/v1/validate", async (c) => {
  const { draft, answers } = await c.req.json()
  if (draft === undefined || answers === undefined) {
    return c.json({ error: "Kirim draft dan answers." }, 400)
  }
  return c.json({ draft: await applyAnswers(draft, answers ?? {}) })
})

/// Merge the wizard's answers into one draft, then re-judge what changed.
///
/// Deterministic first: a typed number is a number, a picked option is the
/// record it names. Then Jev, for the fields that had an EXTRACTED value —
/// an answer can confirm it, contradict it, or fail to settle it, and only
/// the settled ones lose their question.
async function applyAnswers(draft, answers) {
  const extracted = {}
  for (const [id, raw] of Object.entries(answers)) {
    const value = raw?.value ?? raw
    const label = raw?.label ?? null
    if (value === null || value === undefined || String(value).trim() === "")
      continue
    if (id === "po_number") draft.po_number = String(value).trim()
    else if (id === "supplier_name") {
      draft.supplier_name = label ?? String(value)
      // A label is only sent when the buyer picked a real supplier-book
      // option. Free text is useful as a hint, but it is not a supplier id and
      // must not make the draft look creatable.
      draft.supplier_id =
        typeof label === "string" && label.trim() !== ""
          ? String(value).trim()
          : null
    } else if (id === "destination_site_id")
      draft.destination_site_id = String(value)
    else if (id === "expected_arrival") {
      const day = parseDateLoose(value)
      if (day !== null) draft.expected_arrival = day
    } else {
      const lineMatch = /^line\.(\d+)\.(\w+)$/.exec(id)
      if (lineMatch !== null) {
        const line = draft.lines[Number.parseInt(lineMatch[1], 10)]
        const field = lineMatch[2]
        if (line !== undefined) {
          if (field === "quantity") {
            const qty = parseQuantityLoose(value)
            if (qty !== null && qty > 0) line.quantity = qty
          } else if (field === "unit_price") {
            const price = parseAmountLoose(value)
            if (price !== null && price > 0) line.unit_price_minor = price
          } else if (field === "article_name") {
            line.article_name = String(value).trim()
          } else if (field in line) {
            line[field] = stringOrNull(value)
          }
        }
      }
    }
    extracted[id] = { value: String(value), label }
  }

  // Jev re-judges the answered fields that came FROM a document. A field that
  // was simply missing is settled by the act of being answered.
  const toJudge = Object.keys(extracted).filter(
    (id) => draft.confidence[id] !== undefined
  )
  if (GATEWAY_KEY !== "" && toJudge.length > 0) {
    const names = toJudge.map((id) => `resolved_${id.replace(/\./g, "_")}`)
    const result = await jevEvaluate(
      {
        draft_id: draft.draft_id,
        fields: toJudge.map((id) => ({
          field: id,
          extracted_value: fieldValue(draft, id),
          extraction_confidence: draft.confidence[id] ?? null,
          buyer_answer: extracted[id].value,
        })),
      },
      Object.fromEntries(
        names.map((name, index) => [
          name,
          {
            type: "boolean",
            instructions:
              "Has the buyer's answer settled this field, given the extracted value and its confidence? Settled means the answer is complete and contradicts nothing important.",
          },
        ])
      )
    )
    if (result !== null) {
      const answersJev = jevAnswers(result, names)
      toJudge.forEach((id, index) => {
        const answer = answersJev[names[index]]
        if (
          answer !== undefined &&
          answer.probability !== null &&
          answer.probability < RESOLVED
        ) {
          // Not settled: keep it open by giving it back its question.
          delete extracted[id]
        } else if (answer !== undefined) {
          draft.confidence[id] = answer.probability
        }
      })
    }
  }

  draft.questions = questionsForDraft(
    draft,
    draft.confidence,
    new Set(Object.keys(extracted))
  )
  return draft
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`po-import service on :${info.port}`)
  console.log(
    `  jev (AI Gateway): ${GATEWAY_KEY !== "" ? "on" : "OFF — rules only"} · openparser: ${OPENPARSER_KEY !== "" ? "on" : "off"} · liteparse: ${LITEPARSE_BIN !== "" ? "on" : "off"}`
  )
})
