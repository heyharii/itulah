import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Flow, Matrix } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { type InterunitMove } from "@/screens/finance-lab/engine/subledgers"
import {
  Amount,
  Cell,
  ChartBand,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  days,
  count,
  FILTER_W,
  NewRecord,
} from "@/screens/finance-lab/parts"

/// Affiliation — the four families, and why there are four.
///
/// # What the client actually keeps
///
///   1021401  Piutang Affiliasi Pembiayaan   cash head office put in
///   1021402  Piutang Affiliasi Barang       stock head office sent
///   1021403  Piutang Principal              the owner's own account
///   2012304  Hutang Lain-lain               the payable leg, per unit
///
/// The fourth is the one the first menu review missed. All 196 of its accounts
/// are named after a unit — HEAD OFFICE, CIKUPA, MUARO BUNGO — which makes it
/// an interunit family and not a general creditor, and filing it under supplier
/// bills would have put fourteen sister companies in a list of vendors.
///
/// # Why there is no Reconcile screen
///
/// There was one, and it could not do its job. A group balance is only proved
/// when both books agree — what head office says C006 owes has to equal what
/// C006 says it owes head office. The client supplied journals for both sides
/// and the "BY HO" files turn out to be byte-identical duplicates of the C006
/// export: same 13,339 lines, same document numbers. A screen showing one book
/// twice, with a column of zero differences, would be read as a clean
/// reconciliation nobody earned. So the finding is stated on the overview and
/// the screen is not offered until there is a second set of books to offer it
/// against.
///
/// # Why cash and goods are not netted
///
/// They settle differently. Cash head office advanced comes back as cash;
/// stock head office sent is discharged by selling it and remitting the
/// takings. A single net "due to HO" would be a number nobody can act on,
/// because half of it is repaid with money and half with trade.
const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

const FAMILY_LABEL: Record<InterunitMove["family"], string> = {
  FINANCING: "funding",
  GOODS: "goods",
  PRINCIPAL: "principal",
  OTHER: "other",
}

const outstandingOf = (m: InterunitMove) => m.amount - m.settled

export function InterunitOverview() {
  const b = useBook()
  const open = b.interunitMoves.filter((m) => outstandingOf(m) > 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Affiliation"
        sub="Fourteen units, four account families, and what has not come back."
      />

      <ChartBand title="How head office and a shop settle up">
        <Flow
          steps={[
            {
              label: "Head office funds",
              value: rp(
                b.interunitMoves
                  .filter(
                    (m) => m.family === "FINANCING" && m.from_unit === "HO"
                  )
                  .reduce((n, m) => n + m.amount, 0)
              ),
              posts: "Dr 1021401 / Cr Bank",
              to: "/finance-lab/affiliation/funding",
            },
            {
              label: "Head office ships",
              value: rp(
                b.interunitMoves
                  .filter((m) => m.family === "GOODS")
                  .reduce((n, m) => n + m.amount, 0)
              ),
              posts: "Dr 1021402 / Cr Persediaan",
              to: "/finance-lab/inventory/in-transit",
            },
            {
              label: "The shop owes",
              value: rp(open.reduce((n, m) => n + outstandingOf(m), 0)),
              posts: "2012301 · 2012302 · 2012303 · 2012304",
              to: "/finance-lab/affiliation/due",
              tone: open.length ? "warn" : "ok",
            },
            {
              label: "Takings remitted",
              value: rp(b.interunitMoves.reduce((n, m) => n + m.settled, 0)),
              posts: "Dr Hutang Afiliasi / Cr Kas",
              to: "/finance-lab/affiliation/settlements",
              tone: "ok",
            },
          ]}
        />
      </ChartBand>

      <Banner tone="warn" className="mb-4">
        <div className="min-w-0">
          None of these balances is proved. A group balance needs both books to
          agree, and the counterparty journals supplied as "BY HO" are
          byte-identical duplicates of the C006 export — same 13,339 lines, same
          document numbers. Every figure below is our side only.
        </div>
      </Banner>

      <Section
        title={`Not settled — ${open.length}`}
        sub="Every movement still open, whichever family it is in."
      >
        {open.length === 0 ? (
          <EmptyState>Every unit is square.</EmptyState>
        ) : (
          <Table
            head={[
              "Reference",
              "From",
              "To",
              "Family",
              "Age",
              ">Outstanding",
              "",
            ]}
          >
            {open.map((m) => (
              <Row key={m.move_id} tone={age(m.on) > 30 ? "warn" : undefined}>
                <Cell mono>{m.reference}</Cell>
                <Cell>{m.from_unit}</Cell>
                <Cell>{m.to_unit}</Cell>
                <Cell>
                  <Pill tone={m.family === "GOODS" ? "info" : "neutral"}>
                    {FAMILY_LABEL[m.family]}
                  </Pill>
                </Cell>
                <Cell className="text-body">{days(age(m.on))}</Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={outstandingOf(m)} />
                </Cell>
                <Cell>
                  <AppLink
                    to={
                      m.family === "FINANCING"
                        ? "/finance-lab/affiliation/funding"
                        : "/finance-lab/affiliation/due"
                    }
                    className="font-medium text-accent hover:underline"
                  >
                    Open
                  </AppLink>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={5}>{count(open.length, "movement")}</Cell>
              <Cell right>
                <Amount
                  minor={open.reduce((n, m) => n + outstandingOf(m), 0)}
                />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>
    </PageContent>
  )
}

/// Funding — cash head office puts into a unit, and takes back.
export function InterunitFunding() {
  const [funding, setFunding] = useState(false)
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const rows = b.interunitMoves.filter((m) => m.family === "FINANCING")
  const out = rows
    .filter((m) => m.from_unit === "HO")
    .reduce((n, m) => n + outstandingOf(m), 0)
  const back = rows
    .filter((m) => m.to_unit === "HO")
    .reduce((n, m) => n + m.settled, 0)
  const chosen = rows.find((m) => m.move_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Affiliation"
        title="Funding"
        sub="Cash head office advanced on 1021401, and the takings that come back."
        actions={
          <Button variant="primary" onClick={() => setFunding(true)}>
            Fund a unit
          </Button>
        }
      />

      <Kpis
        items={[
          {
            label: "Advanced and not repaid",
            value: rp(out),
            sub: `${count(rows.filter((m) => m.from_unit === "HO" && outstandingOf(m) > 0).length, "advance")}`,
          },
          { label: "Remitted to head office", value: rp(back) },
          { label: "Movements", value: String(rows.length), sub: "this month" },
          {
            label: "Oldest open",
            value: days(
              Math.max(
                0,
                ...rows
                  .filter((m) => outstandingOf(m) > 0)
                  .map((m) => age(m.on))
              )
            ),
          },
        ]}
      />

      <Section title={`Cash movements — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No funding this month.</EmptyState>
        ) : (
          <Table
            head={[
              "Reference",
              "Date",
              "From",
              "To",
              ">Amount",
              ">Settled",
              ">Outstanding",
              "Purpose",
            ]}
          >
            {rows.map((m) => (
              <Row
                key={m.move_id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={
                  outstandingOf(m) > 0 && age(m.on) > 30 ? "warn" : undefined
                }
              >
                <Cell mono onClick={() => setOpen(m.move_id)}>
                  {m.reference}
                </Cell>
                <Cell className="whitespace-nowrap">{m.on}</Cell>
                <Cell>{m.from_unit}</Cell>
                <Cell>{m.to_unit}</Cell>
                <Cell right>
                  <Amount minor={m.amount} />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={m.settled} muted />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={outstandingOf(m)} muted />
                </Cell>
                <Cell className="text-body">{m.note ?? "—"}</Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={4}>{count(rows.length, "movement")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, m) => n + m.amount, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, m) => n + m.settled, 0)} />
              </Cell>
              <Cell right>
                <Amount
                  minor={rows.reduce((n, m) => n + outstandingOf(m), 0)}
                />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.reference ?? ""}
        id={chosen?.move_id}
        actions={
          chosen && outstandingOf(chosen) > 0 ? (
            <Button
              variant="primary"
              onClick={() => b.settleInterunit(chosen.move_id)}
            >
              Record repayment
            </Button>
          ) : undefined
        }
      >
        {chosen && <MoveDetail move={chosen} />}
      </Sheet>

      <NewRecord
        open={funding}
        onOpenChange={setFunding}
        title="Fund a unit"
        submitLabel="Send the money"
        fields={[
          {
            name: "to_unit",
            label: "Which unit",
            kind: "select",
            required: true,
            options: [
              { value: "C006", label: "C006" },
              { value: "C004", label: "C004" },
            ],
          },
          {
            name: "funding_type",
            label: "Out of whose money",
            kind: "select",
            required: true,
            options: [
              {
                value: "AFFILIATE_FINANCING",
                label: "Affiliate financing — 1021401",
              },
              {
                value: "PRINCIPAL_REIMBURSEMENT",
                label: "The principal's own — 1021403",
              },
            ],
            hint: "The engine refuses to guess this. Which family it lands in is the whole difference.",
          },
          {
            name: "reference",
            label: "Reference",
            required: true,
            placeholder: "TRSF AC C4 UNIT",
          },
          {
            name: "amount",
            label: "Amount",
            kind: "money",
            required: true,
            placeholder: "25000000",
          },
        ]}
        onSubmit={(v, minor) =>
          b.fundUnit({
            to_unit: v.to_unit,
            amount: minor.amount,
            funding_type: v.funding_type as
              "AFFILIATE_FINANCING" | "PRINCIPAL_REIMBURSEMENT",
            reference: v.reference,
          })
        }
      />
    </PageContent>
  )
}

function MoveDetail({ move }: { move: InterunitMove }) {
  const debit =
    move.family === "GOODS"
      ? "1021402 Piutang Affiliasi Barang"
      : move.family === "PRINCIPAL"
        ? "1021403 Piutang Principal"
        : move.family === "OTHER"
          ? "2012304 Hutang Lain-lain"
          : "1021401 Piutang Affiliasi Pembiayaan"
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="From">{move.from_unit}</Fact>
        <Fact term="To">{move.to_unit}</Fact>
        <Fact term="Family">{FAMILY_LABEL[move.family]}</Fact>
        <Fact term="Date">{move.on}</Fact>
        <Fact term="Amount">{rp(move.amount)}</Fact>
        <Fact term="Settled">{rp(move.settled)}</Fact>
        <Fact term="Outstanding">{rp(outstandingOf(move))}</Fact>
        <Fact term="Age">{days(age(move.on))}</Fact>
      </Facts>
      <div>
        <SubHead>Both sides of it</SubHead>
        <Table head={["Unit", "Account", ">Debit", ">Credit"]}>
          <Row>
            <Cell>{move.from_unit}</Cell>
            <Cell mono className="text-mute">
              {debit}
            </Cell>
            <Cell right>
              <Amount minor={move.amount} />
            </Cell>
            <Cell right>
              <Amount minor={0} muted />
            </Cell>
          </Row>
          <Row>
            <Cell>{move.to_unit}</Cell>
            <Cell mono className="text-mute">
              2012304 Hutang Lain-lain — {move.from_unit}
            </Cell>
            <Cell right>
              <Amount minor={0} muted />
            </Cell>
            <Cell right>
              <Amount minor={move.amount} />
            </Cell>
          </Row>
        </Table>
        <p className="mt-2 text-meta text-mute">
          One event, two books. The receivable in one unit and the payable in
          the other have to be the same number, which is what Reconcile checks.
        </p>
      </div>
    </div>
  )
}

/// Due from / due to — the balance between every pair of units.
export function InterunitDue() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [family, setFamily] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const pairs = [
    ...new Set(
      b.interunitMoves
        .filter((m) => !family || m.family === family)
        .map((m) => `${m.from_unit}→${m.to_unit}`)
    ),
  ]
    .map((key) => {
      const [from, to] = key.split("→")
      const moves = b.interunitMoves.filter(
        (m) =>
          m.from_unit === from &&
          m.to_unit === to &&
          (!family || m.family === family)
      )
      return {
        key,
        from,
        to,
        moves,
        total: moves.reduce((n, m) => n + m.amount, 0),
        outstanding: moves.reduce((n, m) => n + outstandingOf(m), 0),
        families: [...new Set(moves.map((m) => m.family))],
      }
    })
    .filter((p) => p.moves.length > 0)
    .sort((a, b) => b.outstanding - a.outstanding)

  // The matrix reads rows against columns, so it needs every unit that appears
  // on either side — a unit that only owes would otherwise have no column.
  const matrixUnits = [...new Set(pairs.flatMap((p) => [p.from, p.to]))].sort()
  const chosen = pairs.find((p) => p.key === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Affiliation"
        title="Due from / due to"
        sub="One row per pair of units. Cash, goods, principal and other kept apart."
        actions={
          <div className="flex items-center gap-2">
            <Select value={family} onChange={setFamily} className={FILTER_W}>
              <option value="">All families</option>
              <option value="FINANCING">Funding — 1021401</option>
              <option value="GOODS">Goods — 1021402</option>
              <option value="PRINCIPAL">Principal — 1021403</option>
              <option value="OTHER">Other — 2012304</option>
            </Select>
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
          </div>
        }
      />

      <ChartBand
        title="Who owes whom"
        right={`${rp(pairs.reduce((n, p) => n + p.outstanding, 0))} outstanding`}
      >
        <Matrix
          units={matrixUnits}
          value={(row, col) => {
            const p = pairs.find((x) => x.from === row && x.to === col)
            return p ? p.outstanding : undefined
          }}
        />
      </ChartBand>

      <Section title={`Pairs — ${pairs.length}`}>
        <Table
          head={[
            "From",
            "To",
            "Families",
            ">Movements",
            ">Raised",
            ">Settled",
            ">Outstanding",
            "",
          ]}
        >
          {pairs.map((p) => (
            <Row
              key={p.key}
              className="hover:bg-soft-1 cursor-pointer"
              tone={p.outstanding ? "warn" : undefined}
            >
              <Cell onClick={() => setOpen(p.key)}>
                <span className="text-ink">{p.from}</span>
              </Cell>
              <Cell>{p.to}</Cell>
              <Cell>
                <div className="flex flex-wrap gap-1">
                  {p.families.map((f) => (
                    <Pill key={f} tone={f === "GOODS" ? "info" : "neutral"}>
                      {FAMILY_LABEL[f]}
                    </Pill>
                  ))}
                </div>
              </Cell>
              <Cell right>{p.moves.length}</Cell>
              <Cell right>
                <Amount minor={p.total} />
              </Cell>
              <Cell right className="text-body">
                <Amount minor={p.total - p.outstanding} muted />
              </Cell>
              <Cell right className="font-semibold text-ink">
                <Amount minor={p.outstanding} muted />
              </Cell>
              <Cell>
                <button
                  type="button"
                  onClick={() => setOpen(p.key)}
                  className="font-medium text-accent hover:underline"
                >
                  Open
                </button>
              </Cell>
            </Row>
          ))}
          <Row tone="total">
            <Cell colSpan={3}>{count(pairs.length, "pair")}</Cell>
            <Cell right>{pairs.reduce((n, p) => n + p.moves.length, 0)}</Cell>
            <Cell right>
              <Amount minor={pairs.reduce((n, p) => n + p.total, 0)} />
            </Cell>
            <Cell right>
              <Amount
                minor={pairs.reduce((n, p) => n + p.total - p.outstanding, 0)}
              />
            </Cell>
            <Cell right>
              <Amount minor={pairs.reduce((n, p) => n + p.outstanding, 0)} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.key ?? ""}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="From">{chosen.from}</Fact>
              <Fact term="To">{chosen.to}</Fact>
              <Fact term="Movements">{chosen.moves.length}</Fact>
              <Fact term="Raised">{rp(chosen.total)}</Fact>
              <Fact term="Outstanding">{rp(chosen.outstanding)}</Fact>
            </Facts>
            <div>
              <SubHead>Movements</SubHead>
              <Table
                head={[
                  "Reference",
                  "Date",
                  "Family",
                  ">Amount",
                  ">Outstanding",
                ]}
              >
                {chosen.moves.map((m) => (
                  <Row key={m.move_id}>
                    <Cell mono>{m.reference}</Cell>
                    <Cell className="whitespace-nowrap">{m.on}</Cell>
                    <Cell className="text-body">{FAMILY_LABEL[m.family]}</Cell>
                    <Cell right>
                      <Amount minor={m.amount} />
                    </Cell>
                    <Cell right>
                      <Amount minor={outstandingOf(m)} muted />
                    </Cell>
                  </Row>
                ))}
                <Row tone="total">
                  <Cell colSpan={3}>
                    {count(chosen.moves.length, "movement")}
                  </Cell>
                  <Cell right>
                    <Amount minor={chosen.total} />
                  </Cell>
                  <Cell right>
                    <Amount minor={chosen.outstanding} />
                  </Cell>
                </Row>
              </Table>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Saldo Afiliasi"
      >
        <ReportPrint
          title="Saldo Afiliasi"
          period={"Per 2026-08-01"}
          scope={`${family || "Seluruh keluarga akun"}`}
          columns={[
            { label: "Dari", cell: (p) => p.from },
            { label: "Ke", cell: (p) => p.to },
            {
              label: "Keluarga",
              cell: (p) => p.families.map((f) => FAMILY_LABEL[f]).join(", "),
            },
            {
              label: "Mutasi",
              align: "right",
              cell: (p) => String(p.moves.length),
            },
            { label: "Timbul", align: "right", cell: (p) => rp(p.total) },
            {
              label: "Diselesaikan",
              align: "right",
              cell: (p) => rp(p.total - p.outstanding),
            },
            { label: "Sisa", align: "right", cell: (p) => rp(p.outstanding) },
          ]}
          rows={pairs}
          total={[
            `${pairs.length} pasangan`,
            "",
            "",
            String(pairs.reduce((n, p) => n + p.moves.length, 0)),
            rp(pairs.reduce((n, p) => n + p.total, 0)),
            rp(pairs.reduce((n, p) => n + p.total - p.outstanding, 0)),
            rp(pairs.reduce((n, p) => n + p.outstanding, 0)),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Affiliation settlements — clearing a balance rather than raising one.
export function InterunitSettlements() {
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const rows = b.interunitMoves.filter((m) => m.settled > 0)
  const chosen = rows.find((m) => m.move_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Affiliation"
        title="Settlements"
        sub="Balances discharged — by cash back, by remitting takings, or by offset."
        actions={
          <Button
            variant="primary"
            onClick={() => rows[0] && b.settleInterunit(rows[0].move_id)}
          >
            Settle the oldest
          </Button>
        }
      />

      <Kpis
        items={[
          {
            label: "Settled this month",
            value: rp(rows.reduce((n, m) => n + m.settled, 0)),
            sub: `${count(rows.length, "movement")}`,
          },
          {
            label: "By remitting takings",
            value: rp(
              rows
                .filter((m) => m.family === "FINANCING" && m.to_unit === "HO")
                .reduce((n, m) => n + m.settled, 0)
            ),
          },
          {
            label: "By goods sold on",
            value: rp(
              rows
                .filter((m) => m.family === "GOODS")
                .reduce((n, m) => n + m.settled, 0)
            ),
          },
          {
            label: "Still open",
            value: rp(
              b.interunitMoves.reduce((n, m) => n + outstandingOf(m), 0)
            ),
            tone: "down",
          },
        ]}
      />

      <Section title={`Settlements — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>Nothing has been settled this month.</EmptyState>
        ) : (
          <Table
            head={[
              "Reference",
              "Date",
              "From",
              "To",
              "Family",
              ">Raised",
              ">Settled",
              "How",
            ]}
          >
            {rows.map((m) => (
              <Row key={m.move_id} className="hover:bg-soft-1 cursor-pointer">
                <Cell mono onClick={() => setOpen(m.move_id)}>
                  {m.reference}
                </Cell>
                <Cell className="whitespace-nowrap">{m.on}</Cell>
                <Cell>{m.from_unit}</Cell>
                <Cell>{m.to_unit}</Cell>
                <Cell>
                  <Pill tone={m.family === "GOODS" ? "info" : "neutral"}>
                    {FAMILY_LABEL[m.family]}
                  </Pill>
                </Cell>
                <Cell right>
                  <Amount minor={m.amount} />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={m.settled} />
                </Cell>
                <Cell className="text-body">
                  {m.family === "GOODS"
                    ? "Sold on and remitted"
                    : m.to_unit === "HO"
                      ? "Takings banked to HO"
                      : "Cash returned"}
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={5}>{count(rows.length, "settlement")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, m) => n + m.amount, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, m) => n + m.settled, 0)} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.reference ?? ""}
        id={chosen?.move_id}
      >
        {chosen && <MoveDetail move={chosen} />}
      </Sheet>
    </PageContent>
  )
}
