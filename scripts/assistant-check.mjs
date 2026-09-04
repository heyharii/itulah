#!/usr/bin/env node
/**
 * Does the assistant still give the right answer?
 *
 * A model is not a function: the same question asked twice can be answered two
 * ways, and a prompt change made for one question moves every other one a
 * little. Nothing in a type checker or a unit test notices that. This does.
 *
 * How it works, and why it is shaped this way:
 *
 *  - **The truth is computed here, in SQL, not read from a fixture.** A
 *    recorded expectation goes stale the moment the seed changes, and the
 *    failure then looks like the assistant being wrong. Every case carries the
 *    query that answers it, run against the same node the assistant reads.
 *
 *  - **A case may also carry the classic mistake.** `wrong` is the query
 *    somebody writes when they forget the rule — the sum without the COMPLETED
 *    filter, the day taken from the UTC calendar rather than the shop's. If
 *    that figure turns up in the answer, the case fails even though a number
 *    was produced. This is the half that catches silently wrong answers, which
 *    are the only kind worth building a harness for.
 *
 *  - **A case that cannot discriminate says so.** When `wrong` and `truth`
 *    compute the same figure on this node's data, the case is reported as
 *    BLIND rather than PASS. That is not a technicality: a suite that is green
 *    on a seed with no voided sales and no sales near midnight is a suite
 *    telling you it checked something it did not check.
 *
 * Usage:
 *   node scripts/assistant-check.mjs --db itulah_assistant_demo --api http://127.0.0.1:8098
 *
 * Exits non-zero if any case fails. BLIND cases do not fail the run; they are
 * printed, because the repair for them is better seed data, not a code change.
 */
import { execFileSync } from "node:child_process"

const options = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((pair) => pair.trim().split(/\s+/, 2))
)
const DB = options.db ?? "itulah_assistant_demo"
const API = (options.api ?? "http://127.0.0.1:8098").replace(/\/$/, "")
const ONLY = options.only

/**
 * One thing somebody would ask, and how to know whether the answer was right.
 *
 * `truth` and `wrong` are SQL returning exactly one number. `mention` is text
 * that must appear literally — a shop code, a SKU — for answers whose
 * correctness is not only a figure.
 *
 * `accept` overrides how the figure is looked for. It exists because the first
 * run of this suite failed a case the assistant got right: asked how many
 * suppliers there are, it answered "tabel supplier kosong: tidak ada satu pun
 * supplier terdaftar", which is the correct answer and contains no digit. A
 * check that demands the character `0` is measuring the wording rather than
 * the answer, and a suite that cries wolf on right answers is a suite people
 * stop running.
 */
const CASES = [
  {
    name: "takings for a month",
    ask: "berapa total omzet bulan Agustus 2026?",
    truth: `SELECT sum(total_minor) FROM sale WHERE status = 'COMPLETED'
              AND ((completed_at AT TIME ZONE 'UTC') + make_interval(mins => 420))::date
                  BETWEEN '2026-08-01' AND '2026-08-31'`,
    // The sum that forgets voids. Identical here only because this seed has
    // none — which is exactly what BLIND is for.
    wrong: `SELECT sum(total_minor) FROM sale
              WHERE ((completed_at AT TIME ZONE 'UTC') + make_interval(mins => 420))::date
                    BETWEEN '2026-08-01' AND '2026-08-31'`,
  },
  {
    name: "one day's receipts, on the shop's clock",
    ask: "ada berapa struk pada tanggal 31 Agustus 2026?",
    truth: `SELECT count(*) FROM sale WHERE status = 'COMPLETED'
              AND ((completed_at AT TIME ZONE 'UTC') + make_interval(mins => 420))::date
                  = date '2026-08-31'`,
    // The same day read off the UTC calendar: the evening's trade lands in
    // tomorrow.
    wrong: `SELECT count(*) FROM sale WHERE status = 'COMPLETED'
              AND (completed_at AT TIME ZONE 'UTC')::date = date '2026-08-31'`,
  },
  {
    name: "the best-selling SKU, through the joins",
    ask: "SKU apa yang paling banyak terjual, dan berapa unit?",
    truth: `SELECT sum(l.quantity) FROM sale_line l JOIN sale s ON s.id = l.sale_id
              WHERE s.status = 'COMPLETED'
              GROUP BY l.sku_id ORDER BY 1 DESC LIMIT 1`,
    mention: `SELECT k.sku_code FROM sale_line l
                JOIN sale s ON s.id = l.sale_id JOIN sku k ON k.id = l.sku_id
               WHERE s.status = 'COMPLETED'
               GROUP BY k.sku_code ORDER BY sum(l.quantity) DESC LIMIT 1`,
  },
  {
    name: "units by colour",
    ask: "berapa unit terjual untuk warna Black?",
    truth: `SELECT sum(l.quantity) FROM sale_line l
              JOIN sale s ON s.id = l.sale_id JOIN sku k ON k.id = l.sku_id
             WHERE s.status = 'COMPLETED' AND k.color = 'Black'`,
  },
  {
    name: "how many shops traded",
    ask: "berapa toko yang membukukan penjualan di bulan Agustus 2026?",
    truth: `SELECT count(DISTINCT site_id) FROM sale WHERE status = 'COMPLETED'
              AND ((completed_at AT TIME ZONE 'UTC') + make_interval(mins => 420))::date
                  BETWEEN '2026-08-01' AND '2026-08-31'`,
  },
  {
    name: "an empty table is empty, not unknown",
    ask: "ada berapa supplier terdaftar?",
    truth: `SELECT count(*) FROM supplier`,
    // Nothing is said as a word far more often than as a digit, in either
    // language. What this case is really testing is that emptiness is reported
    // rather than filled in with a plausible number — so anything that claims
    // a count passes, and anything that names suppliers does not.
    accept: (answer) =>
      /\b0\b|kosong|tidak ada|belum ada|\bnol\b|\bnone\b|\bno suppliers?\b/i.test(
        answer
      ),
  },
]

function sql(query) {
  const out = execFileSync("psql", ["-qtA", "-d", DB, "-c", query], {
    encoding: "utf8",
  }).trim()
  // An aggregate over no rows is null, and null here means zero — the question
  // "how many" always has a number for an answer.
  return out === "" ? "0" : out.split("\n")[0]
}

/**
 * Ask, and collect the words and the tools behind them.
 *
 * The chat it opens is put away again by the caller. A harness that leaves six
 * conversations in the sidebar on every run is a harness somebody stops
 * running — and it would be polluting the very list it is meant to be checking
 * the health of.
 */
async function ask(question) {
  const response = await fetch(`${API}/api/v1/assistant/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, page: "/assistant" }),
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`)
  }
  const text = await response.text()
  let answer = ""
  let conversation = null
  const tools = []
  let event = null
  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim()
    else if (line.startsWith("data: ")) {
      let payload
      try {
        payload = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (event === "conversation") conversation = payload.id ?? null
      if (event === "text") answer += payload.text ?? ""
      if (event === "tool") tools.push(payload.name)
      if (event === "error") answer += `\n[error] ${payload.message}`
    }
  }
  return { answer, tools, conversation }
}

/** Put a chat away. Best effort: a failure here is not a failed case. */
async function discard(id) {
  if (!id) return
  try {
    await fetch(`${API}/api/v1/assistant/conversations/${id}`, {
      method: "DELETE",
    })
  } catch {
    // The node may have gone; the run has its answer either way.
  }
}

/**
 * Every number in the answer, as bare digits.
 *
 * `Rp 1.753.650.000`, `1.753.650.000` and `1753650000` are the same figure
 * written three ways, and the model writes whichever the sentence calls for.
 * Separators are dropped and each run of digits is kept whole, so a match is a
 * match on the figure rather than on a substring of it.
 */
function figuresIn(answer) {
  return new Set(
    (answer.replace(/[., ]/g, "").match(/\d+/g) ?? []).map(String)
  )
}

const results = []
for (const testCase of CASES) {
  if (ONLY && !testCase.name.includes(ONLY)) continue
  const truth = sql(testCase.truth)
  const wrong = testCase.wrong ? sql(testCase.wrong) : null
  const mention = testCase.mention ? sql(testCase.mention) : null

  let outcome
  try {
    const { answer, tools, conversation } = await ask(testCase.ask)
    await discard(conversation)
    const figures = figuresIn(answer)
    const saidTruth = testCase.accept
      ? testCase.accept(answer, truth)
      : figures.has(String(truth))
    const saidWrong = wrong !== null && wrong !== truth && figures.has(String(wrong))
    const saidMention = mention === null || answer.includes(mention)
    const blind = wrong !== null && wrong === truth

    outcome = {
      name: testCase.name,
      status: saidTruth && !saidWrong && saidMention ? (blind ? "BLIND" : "PASS") : "FAIL",
      truth,
      wrong,
      mention,
      tools: tools.join(" · "),
      answer: answer.replace(/\s+/g, " ").slice(0, 160),
      why: !saidTruth
        ? `answer does not give the figure ${truth}`
        : saidWrong
          ? `answer states ${wrong}, which is the figure you get without the rule`
          : !saidMention
            ? `answer never names ${mention}`
            : blind
              ? `this node's data cannot tell the right figure from the wrong one`
              : "",
    }
  } catch (error) {
    outcome = {
      name: testCase.name,
      status: "FAIL",
      truth,
      wrong,
      tools: "",
      answer: "",
      why: String(error.message ?? error),
    }
  }
  results.push(outcome)
  const mark = { PASS: "✓", BLIND: "•", FAIL: "✗" }[outcome.status]
  process.stdout.write(
    `${mark} ${outcome.status.padEnd(5)} ${outcome.name}\n` +
      `        truth ${outcome.truth}${outcome.tools ? `  ·  ${outcome.tools}` : ""}\n` +
      (outcome.why ? `        ${outcome.why}\n` : "") +
      (outcome.answer ? `        “${outcome.answer}”\n` : "")
  )
}

const failed = results.filter((one) => one.status === "FAIL")
const blind = results.filter((one) => one.status === "BLIND")
process.stdout.write(
  `\n${results.length - failed.length - blind.length} passed · ` +
    `${blind.length} blind · ${failed.length} failed\n`
)
if (blind.length > 0) {
  process.stdout.write(
    "Blind cases are not green. They are questions this node's data cannot\n" +
      "answer wrongly, so the check proved nothing — seed a void, or a sale\n" +
      "either side of midnight, and run it again.\n"
  )
}
process.exit(failed.length > 0 ? 1 : 0)
