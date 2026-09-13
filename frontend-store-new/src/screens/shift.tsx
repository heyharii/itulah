import { useState } from "react"
import { Banknote, Printer, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue, TotalsLadder } from "@/components/ui/rows"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Banner, LoadingState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import {
  readPrinter,
  terminalId,
  useActiveShift,
  useCashMovement,
  useCloseShift,
  useOpenShift,
  writePrinter,
  type PrinterSetting,
} from "@/lib/till"
import type { ShiftReport, Supervisor } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The drawer.
///
/// Three things happen here and nothing else: a shift opens with a float, cash
/// moves for a reason that is not a sale, and a shift closes against what the
/// cashier counted.
///
/// **The close is blind.** The expected figure is not on this screen until the
/// declaration has been sent. A cashier shown what the drawer *should* hold
/// counts toward it, and then the count means nothing.
export function Shift() {
  const shift = useActiveShift()

  if (shift.isPending)
    return <LoadingState>Reading this till's day…</LoadingState>

  return shift.data == null ? (
    <OpenShift />
  ) : (
    <RunningShift report={shift.data} />
  )
}

/// Rupiah in, as digits. A field that accepted "Rp 500.000" and one that
/// accepted "500000" would be two parsers, and the one nobody tested is the one
/// a cashier uses.
function minorFrom(text: string): number | null {
  const digits = text.replace(/\D/g, "")
  if (digits === "") return null
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : null
}

function OpenShift() {
  const open = useOpenShift()
  const [float, setFloat] = useState("")
  const amount = minorFrom(float)

  return (
    <>
      <Screen foot="none">
        <Section title="Open the drawer">
          <Card className="p-4">
            <p className="mb-4 text-meta text-body">
              Count the float into the drawer first, then type what is in it.
              Everything this till takes from now until close is counted against
              that number.
            </p>
            <Field
              label="Opening float"
              hint={`This terminal is ${terminalId()}.`}
            >
              <Input
                inputMode="numeric"
                autoFocus
                value={float}
                placeholder="500000"
                onChange={(event) => setFloat(event.target.value)}
              />
            </Field>
            {amount !== null && (
              <p className="mt-2.5 text-meta text-mute tabular-nums">
                {money(amount, "IDR")}
              </p>
            )}
          </Card>
          {open.error !== null && (
            <Banner tone="bad" className="mt-3">
              {open.error.message}
            </Banner>
          )}
        </Section>
      </Screen>
      <ActionBar>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={amount === null || open.isPending}
          onClick={() => {
            if (amount === null) return
            open.mutate({ floatMinor: amount })
          }}
        >
          {open.isPending ? "Opening…" : "Open shift"}
        </Button>
      </ActionBar>
    </>
  )
}

function RunningShift({ report }: { report: ShiftReport }) {
  const go = useGo()
  const [pane, setPane] = useState<"report" | "cash" | "close" | "printer">(
    "report",
  )

  return (
    <>
      <Screen foot="none">
        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ["report", "Today"],
              ["cash", "Cash in / out"],
              ["close", "Close"],
              ["printer", "Printer"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              variant={pane === key ? "primary" : "ghost"}
              onClick={() => setPane(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        {pane === "report" && <ZReport report={report} />}
        {pane === "cash" && <CashPane report={report} />}
        {pane === "close" && (
          <ClosePane report={report} onDone={() => go("/sell")} />
        )}
        {pane === "printer" && <PrinterPane />}
      </Screen>
    </>
  )
}

/// What this shift has taken. Cash and non-cash are separated because only cash
/// is in the drawer — a report that added a card sale to the expected float
/// would report a shortage every single evening.
function ZReport({ report }: { report: ShiftReport }) {
  return (
    <>
      <Section
        title="This shift"
        action={
          <Pill tone={report.status === "OPEN" ? "info" : "ok"}>
            {report.status === "OPEN" ? "Open" : "Closed"}
          </Pill>
        }
      >
        <Card className="px-4 py-1">
          <KeyValue term="Terminal">{report.terminal_id}</KeyValue>
          <KeyValue term="Opened by">{report.opened_by}</KeyValue>
          <KeyValue term="Opened">{moment(report.opened_at)}</KeyValue>
          {report.closed_at !== null && (
            <KeyValue term="Closed">{moment(report.closed_at)}</KeyValue>
          )}
        </Card>
      </Section>

      <Section title="Taken">
        <Card className="px-4 py-3">
          <TotalsLadder
            rows={[
              {
                label: `Sales (${report.sale_count})`,
                value: money(report.sales_total_minor, "IDR"),
              },
              { label: "Cash", value: money(report.cash_sales_minor, "IDR") },
              {
                label: "Card, QRIS, other",
                value: money(report.non_cash_minor, "IDR"),
              },
              ...(report.voided_count > 0
                ? [
                    {
                      label: `Voided (${report.voided_count})`,
                      value: money(report.voided_total_minor, "IDR"),
                      tone: "bad" as const,
                    },
                  ]
                : []),
            ]}
            total={{
              label: "Net sales",
              value: money(report.sales_total_minor, "IDR"),
            }}
          />
        </Card>
      </Section>

      <Section title="The drawer">
        <Card className="px-4 py-3">
          <TotalsLadder
            rows={[
              {
                label: "Float and cash moved",
                value: money(report.cash_movements_minor, "IDR"),
              },
              {
                label: "Cash taken",
                value: money(report.cash_sales_minor, "IDR"),
              },
              {
                label: "Change given",
                value: `−${money(report.change_given_minor, "IDR")}`,
                tone: "bad",
              },
              ...(report.cash_refunds_minor > 0
                ? [
                    {
                      label: "Cash refunded",
                      value: `−${money(report.cash_refunds_minor, "IDR")}`,
                      tone: "bad" as const,
                    },
                  ]
                : []),
            ]}
            total={{
              label: "Should be in the drawer",
              value: money(report.expected_cash_minor, "IDR"),
            }}
          />
        </Card>
        {report.declared_cash_minor !== null && (
          <Card className="mt-2.5 px-4 py-1">
            <KeyValue term="Counted">
              {money(report.declared_cash_minor, "IDR")}
            </KeyValue>
            <KeyValue
              term="Difference"
              tone={
                report.variance_minor === null || report.variance_minor === 0
                  ? "normal"
                  : report.variance_minor < 0
                    ? "bad"
                    : "ok"
              }
            >
              {report.variance_minor === null
                ? "—"
                : money(report.variance_minor, "IDR")}
            </KeyValue>
          </Card>
        )}
      </Section>

      {report.movements.length > 0 && (
        <Section title="Cash in and out">
          <Card className="px-4 py-1">
            {report.movements.map((movement) => (
              <KeyValue
                key={movement.id}
                term={
                  <span>
                    {MOVEMENT_WORD[movement.kind] ?? movement.kind}
                    <span className="ml-1.5 text-mute">{movement.reason}</span>
                  </span>
                }
                tone={movement.amount_minor < 0 ? "bad" : "normal"}
              >
                {money(movement.amount_minor, "IDR")}
              </KeyValue>
            ))}
          </Card>
        </Section>
      )}
    </>
  )
}

const MOVEMENT_WORD: Readonly<Record<string, string>> = {
  OPENING_FLOAT: "Float",
  DROP: "To the safe",
  PAYOUT: "Paid out",
  PICKUP: "Added",
  CORRECTION: "Correction",
}

/// Cash that moved for a reason other than a sale.
///
/// A payout and a correction both take money out on somebody's say-so, so both
/// need a supervisor. A safe drop does not: the money is still in the shop.
function CashPane({ report }: { report: ShiftReport }) {
  const record = useCashMovement(report.shift_id)
  const [kind, setKind] = useState<"DROP" | "PAYOUT" | "PICKUP" | "CORRECTION">(
    "DROP",
  )
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const minor = minorFrom(amount)
  const needsSupervisor = kind === "PAYOUT" || kind === "CORRECTION"
  const ready =
    minor !== null &&
    minor > 0 &&
    reason.trim() !== "" &&
    (!needsSupervisor || (username.trim() !== "" && password !== ""))

  return (
    <Section title="Cash in or out">
      <Card className="flex flex-col gap-4 p-4">
        <Field label="What happened">
          <Select
            value={kind}
            onChange={(next) => setKind(next as typeof kind)}
          >
            <option value="DROP">Sent to the safe</option>
            <option value="PICKUP">Added to the drawer</option>
            <option value="PAYOUT">Paid out</option>
            <option value="CORRECTION">Correction</option>
          </Select>
        </Field>
        <Field
          label="How much"
          hint={minor === null ? undefined : money(minor, "IDR")}
        >
          <Input
            inputMode="numeric"
            value={amount}
            placeholder="200000"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Why">
          <Input
            value={reason}
            placeholder="Setor ke brankas"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        {needsSupervisor && (
          <>
            <p className="text-meta text-body">
              Money leaving the drawer needs a supervisor. They sign here — the
              cashier stays signed in.
            </p>
            <Field label="Supervisor">
              <Input
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field label="Their password">
              <Input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </>
        )}

        {record.error !== null && (
          <Banner tone="bad">{record.error.message}</Banner>
        )}

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready || record.isPending}
          onClick={() => {
            if (minor === null) return
            const supervisor: Supervisor | null = needsSupervisor
              ? { username: username.trim(), password }
              : null
            record.mutate(
              { kind, amountMinor: minor, reason: reason.trim(), supervisor },
              {
                onSuccess: () => {
                  setAmount("")
                  setReason("")
                  setPassword("")
                },
              },
            )
          }}
        >
          <Banknote />
          {record.isPending ? "Recording…" : "Record it"}
        </Button>
      </Card>
    </Section>
  )
}

/// The blind close.
///
/// Nothing on this pane says what the drawer should hold. The expected figure
/// and the difference arrive in the answer, after the count has been committed.
function ClosePane({
  report,
  onDone,
}: {
  report: ShiftReport
  onDone: () => void
}) {
  const close = useCloseShift(report.shift_id)
  const [counted, setCounted] = useState("")
  const [note, setNote] = useState("")
  const minor = minorFrom(counted)
  const settled = close.data ?? null

  if (settled !== null) {
    return (
      <Section title="Closed">
        <Card className="px-4 py-3">
          <TotalsLadder
            rows={[
              {
                label: "You counted",
                value: money(settled.declared_cash_minor ?? 0, "IDR"),
              },
              {
                label: "Expected",
                value: money(settled.expected_cash_minor, "IDR"),
              },
            ]}
            total={{
              label:
                (settled.variance_minor ?? 0) === 0
                  ? "It balances"
                  : (settled.variance_minor ?? 0) < 0
                    ? "Short by"
                    : "Over by",
              value: money(Math.abs(settled.variance_minor ?? 0), "IDR"),
            }}
          />
        </Card>
        <Button
          variant="primary"
          size="lg"
          block
          className="mt-4"
          onClick={onDone}
        >
          Back to the counter
        </Button>
      </Section>
    )
  }

  return (
    <Section title="Close the drawer">
      <Card className="flex flex-col gap-4 p-4">
        <p className="text-meta text-body">
          Count the drawer and type the total. What it should hold is not shown
          until you have — a figure to count toward is not a count.
        </p>
        <Field
          label="What is in the drawer"
          hint={minor === null ? undefined : money(minor, "IDR")}
        >
          <Input
            inputMode="numeric"
            autoFocus
            value={counted}
            placeholder="1250000"
            onChange={(event) => setCounted(event.target.value)}
          />
        </Field>
        <Field label="Anything to note" hint="Optional.">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {close.error !== null && (
          <Banner tone="bad">{close.error.message}</Banner>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          disabled={minor === null || close.isPending}
          onClick={() => {
            if (minor === null) return
            close.mutate({ declaredMinor: minor, note })
          }}
        >
          <Wallet />
          {close.isPending ? "Closing…" : "Close shift"}
        </Button>
      </Card>
    </Section>
  )
}

/// Where this counter's receipt printer is.
///
/// Held per browser rather than per node, for the same reason a label print
/// session holds its printer: two counters in one shop have two printers, and a
/// receipt that came out in the other room is a receipt nobody hands over.
function PrinterPane() {
  const held = readPrinter()
  const [host, setHost] = useState(held?.host ?? "")
  const [port, setPort] = useState(String(held?.port ?? 9100))
  const [paper, setPaper] = useState<PrinterSetting["paper"]>(
    held?.paper ?? "NARROW",
  )
  const [drawer, setDrawer] = useState<PrinterSetting["drawer"]>(
    held?.drawer ?? "NONE",
  )
  const [saved, setSaved] = useState(false)

  return (
    <Section title="Receipt printer">
      <Card className="flex flex-col gap-4 p-4">
        <p className="text-meta text-body">
          The node prints, not this browser — so the address is the printer's on
          the shop's own network. The cash drawer opens through the printer's
          RJ11 socket, on the same command as the receipt.
        </p>
        <Field label="Address" hint="An IP or a hostname on this shop's LAN.">
          <Input
            value={host}
            placeholder="192.168.1.50"
            onChange={(event) => {
              setHost(event.target.value)
              setSaved(false)
            }}
          />
        </Field>
        <Field label="Port">
          <Input
            inputMode="numeric"
            value={port}
            onChange={(event) => {
              setPort(event.target.value)
              setSaved(false)
            }}
          />
        </Field>
        <Field label="Paper">
          <Select
            value={paper}
            onChange={(next) => {
              setPaper(next as PrinterSetting["paper"])
              setSaved(false)
            }}
          >
            <option value="NARROW">58mm</option>
            <option value="WIDE">80mm</option>
          </Select>
        </Field>
        <Field
          label="Cash drawer"
          hint="Best effort. A drawer that did not open is one somebody opens by hand; the money is counted either way."
        >
          <Select
            value={drawer}
            onChange={(next) => {
              setDrawer(next as PrinterSetting["drawer"])
              setSaved(false)
            }}
          >
            <option value="NONE">There is no drawer</option>
            <option value="MANUAL">Opened by hand</option>
            <option value="PRINTER_PULSE">Opened by the printer</option>
          </Select>
        </Field>
        {saved && <Banner tone="ok">Saved on this till.</Banner>}
        <Button
          variant="primary"
          size="lg"
          block
          disabled={host.trim() === ""}
          onClick={() => {
            writePrinter({
              host: host.trim(),
              port: Number(port) || 9100,
              paper,
              drawer,
            })
            setSaved(true)
          }}
        >
          <Printer />
          Save
        </Button>
      </Card>
    </Section>
  )
}

/// Exported so `screens/index.ts` can name it the way every other screen is
/// named, rather than this file being the one exception.
export { Shift as ShiftScreen }
