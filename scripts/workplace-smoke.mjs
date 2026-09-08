#!/usr/bin/env node
/**
 * Does the workplace half of the hub actually work, end to end?
 *
 * Five screens — discussions, chat, files, reports, assistant — sit on one
 * node. A green typecheck says the shapes line up; it says nothing about
 * whether a reply lands, whether a resend lands twice, or whether the figure
 * on a report is the figure in the table. This asks the node.
 *
 * Every write is round-tripped: the thing is created, then read back from a
 * *different* endpoint than the one that made it, because a handler that
 * returns its own argument without storing it passes a naive check.
 *
 * The reports case computes its own truth from the result it was handed rather
 * than comparing against a recorded number, which goes stale the day the seed
 * changes. Answer quality for the assistant is a separate harness —
 * `scripts/assistant-check.mjs` — because a model is not a function.
 *
 * Usage:
 *   node scripts/workplace-smoke.mjs --api http://127.0.0.1:8080 --db inventory_rfid
 *
 * Exits non-zero if any assertion failed.
 *
 * It leaves its writes behind — there is no delete endpoint for a thread, and
 * inventing one for a test would be the tail wagging the dog. Both are labelled
 * "Smoke test"; to sweep them out of a seed:
 *
 *   psql -d inventory_rfid \
 *     -c "DELETE FROM discussion_thread WHERE subject_id LIKE 'SMOKE-%'" \
 *     -c "DELETE FROM chat_message WHERE body LIKE 'Smoke test %'" \
 *     -c "DELETE FROM document WHERE name LIKE 'smoke-%.txt'" \
 *     -c "DELETE FROM stored_file WHERE file_name LIKE 'smoke-%.txt'"
 */
import { createHash, randomUUID } from "node:crypto"

const opt = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((s) => s.trim().split(/\s+/))
    .map(([k, ...v]) => [k, v.join(" ")]),
)
const API = opt.api ?? "http://127.0.0.1:8080"
const DB = opt.db ?? "inventory_rfid"

let failures = 0
/**
 * `detail` is the evidence for a FAILURE and is printed only then. Printing it
 * on a pass reads as a contradiction — "PASS ... no conversations on this
 * node" — and a line nobody can trust is worse than no line.
 */
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

async function api(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`,
    )
  }
  return text ? JSON.parse(text) : null
}

// --- Discussions: open a thread, reply, read both back -----------------------
async function discussions() {
  const before = await api("/api/v1/discussions")
  const subjectsBefore = await api("/api/v1/discussions/subjects")
  const stamp = new Date().toISOString()

  const thread = await api("/api/v1/discussions", {
    method: "POST",
    body: JSON.stringify({
      subject_kind: "purchase_order",
      subject_id: `SMOKE-${stamp}`,
      title: `Smoke test ${stamp}`,
      body: "Opened by scripts/workplace-smoke.mjs. Safe to delete.",
      tags: ["smoke"],
    }),
  })
  check("discussions - a thread opens", !!thread.thread_id, JSON.stringify(thread).slice(0, 200))

  // Read back from the LIST, not from the create response.
  const after = await api("/api/v1/discussions")
  check(
    "discussions - the new thread is in the list",
    after.length === before.length + 1 &&
      after.some((t) => t.thread_id === thread.thread_id),
    `list went ${before.length} -> ${after.length}`,
  )

  const post = await api(`/api/v1/discussions/${thread.thread_id}/posts`, {
    method: "POST",
    body: JSON.stringify({ body: "A reply, so reply_count has something to count." }),
  })
  const posts = await api(`/api/v1/discussions/${thread.thread_id}/posts`)
  check(
    "discussions - a reply lands and is readable",
    posts.length === 2 && posts.some((p) => p.post_id === post.post_id),
    `${posts.length} posts, expected 2 (opening + reply)`,
  )

  const detail = await api(`/api/v1/discussions/${thread.thread_id}`)
  check(
    "discussions - reply_count follows the posts",
    detail.reply_count === 1,
    `reply_count=${detail.reply_count}, expected 1`,
  )

  await api(`/api/v1/discussions/${thread.thread_id}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "resolved" }),
  })
  const reread = await api(`/api/v1/discussions/${thread.thread_id}`)
  check(
    "discussions - status changes and persists",
    reread.status === "resolved",
    `status after re-read = ${reread.status}`,
  )

  const subjectsAfter = await api("/api/v1/discussions/subjects")
  const count = (rows) =>
    rows.find((r) => r.subject_kind === "purchase_order")?.threads ?? 0
  check(
    "discussions - the subject facet recounts",
    count(subjectsAfter) === count(subjectsBefore) + 1,
    `purchase_order ${count(subjectsBefore)} -> ${count(subjectsAfter)}`,
  )
  console.log(`        opened ${thread.thread_id}`)
}

// --- Chat: send, resend the same key, read back ------------------------------
async function chat() {
  const conversations = await api("/api/v1/chat/conversations")
  check("chat - conversations list", conversations.length > 0, "no conversations on this node")
  const room = conversations[0]

  const before = await api(`/api/v1/chat/conversations/${room.conversation_id}/messages`)
  const key = randomUUID()
  const body = `Smoke test ${new Date().toISOString()}`
  const sent = await api(`/api/v1/chat/conversations/${room.conversation_id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, idempotency_key: key, reply_to_seq: null }),
  })
  const resent = await api(`/api/v1/chat/conversations/${room.conversation_id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, idempotency_key: key, reply_to_seq: null }),
  })
  check("chat - a message lands", sent.seq > 0, JSON.stringify(sent).slice(0, 160))
  check(
    "chat - a resend with the same key does not double-post",
    resent.seq === sent.seq,
    `first seq ${sent.seq}, resend seq ${resent.seq}`,
  )

  const after = await api(`/api/v1/chat/conversations/${room.conversation_id}/messages`)
  check(
    "chat - exactly one copy is stored",
    after.length === before.length + 1 &&
      after.filter((m) => m.body === body).length === 1,
    `${before.length} -> ${after.length} messages`,
  )

  const events = await api(`/api/v1/chat/events?after=${Math.max(sent.seq - 1, 0)}`)
  check(
    "chat - the event stream carries it",
    Array.isArray(events) && events.length > 0,
    `events after ${sent.seq - 1}: ${JSON.stringify(events).slice(0, 140)}`,
  )
  console.log(`        room "${room.title ?? room.conversation_id}", seq ${sent.seq}`)
}

// --- Files: the bytes are really there, and they are the right bytes ---------
async function files() {
  const rows = await api("/api/v1/files?limit=200")
  check("files - the drawer lists files", rows.length > 0, "no files on this node")

  const entry = rows[0]
  const path =
    entry.source_kind === "CONVERSATION"
      ? `/api/v1/chat/conversations/${entry.source_id}/attachments/${entry.file.file_id}`
      : `/api/v1/discussions/${entry.source_id}/attachments/${entry.file.file_id}`
  const res = await fetch(`${API}${path}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const digest = createHash("sha256").update(bytes).digest("hex")
  check(
    "files - an attachment downloads with the promised bytes",
    res.ok && bytes.length === entry.file.byte_size && digest === entry.file.sha256,
    `status ${res.status}, ${bytes.length}B vs ${entry.file.byte_size}B, sha ${digest.slice(0, 12)} vs ${String(entry.file.sha256).slice(0, 12)}`,
  )

  const documents = await api("/api/v1/documents")
  const missing = documents.filter((d) => d.available === false)
  const live = documents.find((d) => d.available !== false)
  const content = await fetch(`${API}/api/v1/documents/${live.document_id}/content`)
  const docBytes = Buffer.from(await content.arrayBuffer())
  check(
    "files - a document serves its content",
    content.ok && docBytes.length === live.byte_size,
    `status ${content.status}, ${docBytes.length}B vs ${live.byte_size}B`,
  )

  // The whole way in, on a node with no bucket: POST /files keeps the bytes in
  // the row, and the document is filed against that file_id. `upload-url` is
  // the other way in and answers 404 here, which is why the drawer does not use
  // it in development.
  const payload = Buffer.from(`smoke ${new Date().toISOString()}\n`)
  const name = `smoke-${Date.now()}.txt`
  const stored = await (async () => {
    const res = await fetch(
      `${API}/api/v1/files?name=${encodeURIComponent(name)}&content_type=text/plain`,
      { method: "POST", headers: { "content-type": "text/plain" }, body: payload },
    )
    if (!res.ok) throw new Error(`POST /api/v1/files -> ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json()
  })()
  check(
    "files - an upload is taken in with the bytes it was given",
    stored.byte_size === payload.length &&
      stored.sha256 === createHash("sha256").update(payload).digest("hex"),
    `${stored.byte_size}B vs ${payload.length}B, sha ${String(stored.sha256).slice(0, 12)}`,
  )

  const filed = await api("/api/v1/documents", {
    method: "POST",
    body: JSON.stringify({
      file_id: stored.file_id,
      file_name: name,
      title: "Smoke test upload",
      path_tokens: ["Smoke"],
      content_type: "text/plain",
    }),
  })
  const back = await fetch(`${API}/api/v1/documents/${filed.document_id}/content`)
  const roundTripped = Buffer.from(await back.arrayBuffer())
  check(
    "files - the filed document hands the same bytes back",
    back.ok && roundTripped.equals(payload),
    `status ${back.status}, ${roundTripped.length}B vs ${payload.length}B`,
  )
  check(
    "files - the upload appears in the drawer",
    (await api("/api/v1/documents")).some((d) => d.document_id === filed.document_id),
    "filed document is not in the list",
  )
  console.log(
    `        ${rows.length} files, ${documents.length} documents, ${missing.length} flagged unavailable${missing.length ? `: ${missing.map((d) => d.name).join(", ")}` : ""}`,
  )
}

// --- Reports: every saved report runs, and its totals are its own rows -------
async function reports() {
  const saved = await api("/api/v1/reports/saved")
  check("reports - saved reports load", saved.items.length > 0, "no saved reports")

  let reconciled = 0
  for (const row of saved.items) {
    const result = await api(`/api/v1/reports/saved/${row.report_id}/run`, {
      method: "POST",
      body: JSON.stringify({ filters: [] }),
    })
    check(`reports - "${row.name}" runs`, Array.isArray(result.rows), JSON.stringify(result).slice(0, 160))

    // The one assertion worth making about a count total: it is the column,
    // added up. Money and averages are not additive across buckets, so they
    // are deliberately not asserted here.
    for (const [key, total] of Object.entries(result.totals ?? {})) {
      const column = result.columns.find((c) => c.key === key)
      if (!column || column.format !== "count") continue
      const summed = result.rows.reduce((n, r) => n + (r[key] ?? 0), 0)
      check(
        `reports - "${row.name}" total ${key} = the column added up`,
        summed === total,
        `total ${total}, rows sum to ${summed}`,
      )
      reconciled++
    }
  }
  console.log(`        ${saved.items.length} reports run, ${reconciled} count totals reconciled`)
}

// --- Assistant: the node will answer, and the history is stored --------------
async function assistant() {
  const caps = await api("/api/v1/assistant/capabilities")
  check(
    "assistant - enabled with a model and tools",
    caps.enabled && !!caps.model && caps.tools.length > 0,
    JSON.stringify(caps).slice(0, 160),
  )
  const brief = await api("/api/v1/assistant/brief")
  check("assistant - the morning brief computes", !!brief.as_of, JSON.stringify(brief).slice(0, 160))
  const conversations = await api("/api/v1/assistant/conversations")
  check(
    "assistant - chat history reads",
    Array.isArray(conversations.items),
    JSON.stringify(conversations).slice(0, 160),
  )
  console.log(
    `        model ${caps.model}, ${caps.tools.length} tools, ${conversations.items.length} stored conversations`,
  )
  console.log(
    `        answer quality is a separate harness: node scripts/assistant-check.mjs --db ${DB} --api ${API}`,
  )
}

console.log(`\nWorkplace smoke - ${API} (db ${DB})\n`)
for (const [name, run] of Object.entries({ discussions, chat, files, reports, assistant })) {
  console.log(`-- ${name} ${"-".repeat(58 - name.length)}`)
  try {
    await run()
  } catch (error) {
    check(`${name} - threw`, false, error.message)
  }
}
console.log(failures ? `\n${failures} failed\n` : "\nall green\n")
process.exit(failures ? 1 : 0)
