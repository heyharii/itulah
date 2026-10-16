/* What the warehouse can count, and what the order does about it.

   The arithmetic is the Review Count's own (frontend-hub/src/screens/
   procurement/count-review.tsx:306-324), so no figure on screen is typed by
   hand:

     correct = counted − not as ordered
     gap     = correct − still owed

   gap < 0  → the buyer keeps the rest open (Partial Receive) or closes it short
   gap > 0  → the extra goes back to the supplier, always
   wrong    → goes back too, with any extra on the same line
   all lines exact and nothing wrong → received by itself, no review at all */

export interface Line {
  readonly article: string
  readonly kind: string
  readonly owed: number
  readonly counted: number
  readonly wrong: number
}

export const correct = (line: Line) => line.counted - line.wrong
export const gap = (line: Line) => correct(line) - line.owed

export type Decision = "auto" | "partial" | "close" | "submit" | "recount"

export interface Scenario {
  readonly id: string
  /** The branch's name on the map. */
  readonly name: string
  /** The PO number this branch is filmed on. */
  readonly po: string
  readonly lines: readonly Line[]
  readonly decision: Decision
}

const kemeja = { article: "Kemeja Oxford Lengan Panjang", kind: "Pria · Kemeja" }
const kaos = { article: "Kaos Basic Katun Combed", kind: "Pria · Kaos" }
const chino = { article: "Celana Chino Slim Fit", kind: "Pria · Celana" }

export const SCENARIOS = {
  match: {
    id: "match",
    name: "Pas",
    po: "PO-081026-001",
    lines: [{ ...kemeja, owed: 600, counted: 600, wrong: 0 }],
    decision: "auto",
  },
  shortKeep: {
    id: "shortKeep",
    name: "Kurang · Partial Receive",
    po: "PO-081026-002",
    lines: [{ ...kemeja, owed: 600, counted: 580, wrong: 0 }],
    decision: "partial",
  },
  shortClose: {
    id: "shortClose",
    name: "Kurang · Close Short",
    po: "PO-081026-003",
    lines: [{ ...kemeja, owed: 600, counted: 580, wrong: 0 }],
    decision: "close",
  },
  over: {
    id: "over",
    name: "Lebih",
    po: "PO-081026-004",
    lines: [{ ...kemeja, owed: 600, counted: 620, wrong: 0 }],
    decision: "submit",
  },
  wrong: {
    id: "wrong",
    name: "Tidak sesuai",
    po: "PO-081026-005",
    lines: [{ ...kemeja, owed: 600, counted: 600, wrong: 15 }],
    decision: "partial",
  },
  mixed: {
    id: "mixed",
    name: "Lebih + tidak sesuai",
    po: "PO-081026-006",
    /* Not as Ordered is one figure for the whole delivery — nobody knows
       which article those pieces are. The node keeps it on the first counted
       line (receiving.tsx:700), so it sits on Kemeja here; on screen it is
       only ever the total. */
    lines: [
      { ...kemeja, owed: 240, counted: 260, wrong: 20 },
      { ...kaos, owed: 240, counted: 250, wrong: 0 },
      { ...chino, owed: 120, counted: 120, wrong: 0 },
    ],
    decision: "submit",
  },
  recount: {
    id: "recount",
    name: "Recount",
    po: "PO-081026-007",
    lines: [{ ...kemeja, owed: 600, counted: 560, wrong: 0 }],
    decision: "recount",
  },
} as const satisfies Record<string, Scenario>

export type ScenarioId = keyof typeof SCENARIOS

/** The order the branches are walked in, top to bottom on the map. */
export const BRANCHES: readonly ScenarioId[] = [
  "match",
  "shortKeep",
  "shortClose",
  "over",
  "wrong",
  "mixed",
  "recount",
]

/** The Review Count's own summary of a count. */
export function summary(lines: readonly Line[]) {
  const shortQty = lines.reduce((sum, l) => sum + Math.max(-gap(l), 0), 0)
  const wrongRows = lines.filter((l) => l.wrong > 0)
  const cleanOvers = lines.filter((l) => gap(l) > 0 && l.wrong === 0)
  const overQty = lines.reduce((sum, l) => sum + Math.max(gap(l), 0), 0)
  const wrongQty = wrongRows.reduce((sum, l) => sum + l.wrong, 0)
  const exact = lines.every((l) => gap(l) === 0 && l.wrong === 0)
  return {
    shortQty,
    overQty,
    wrongQty,
    exact,
    hasShort: shortQty > 0,
    /** What goes back to the supplier: the wrong pieces and every extra. */
    returnQty: wrongQty + overQty,
    /** The line under the table, worded as count-review.tsx:982-1007 words it. */
    returnLine:
      wrongRows.length > 0 && cleanOvers.length > 0
        ? {
            bold: `${wrongQty + overQty} pcs`,
            rest: " will be returned to the supplier",
            mute: ` · ${wrongQty} not as ordered, ${overQty} extra`,
          }
        : wrongRows.length > 0
          ? {
              bold: `${wrongQty + overQty} pcs`,
              rest: " not as ordered will be returned to the supplier",
              mute: "",
            }
          : cleanOvers.length > 0
            ? {
                bold: `${overQty} pcs`,
                rest: " extra will be returned to the supplier",
                mute: "",
              }
            : null,
  }
}
