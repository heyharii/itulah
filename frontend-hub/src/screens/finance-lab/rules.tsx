import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { PARTIES } from "@/screens/finance-lab/engine/data"
import {
  Cell,
  Row,
  Section,
  Table,
  FILTER_W,
} from "@/screens/finance-lab/parts"
import { useBook } from "@/screens/finance-lab/state"

/// Rules — what fills a bank line in before a person looks at it.
///
/// # What a rule is
///
/// One sentence: *when the bank's description contains this text, suggest that
/// category, and name that counterparty.* Nothing more. It runs when a
/// statement is imported and it fills the row in; it never posts, and the
/// person still presses Post.
///
/// # Why they are on a screen of their own
///
/// Because a rule is the only thing in this module that acts without being
/// asked, and anything that does that has to be visible and removable. A
/// category that appears by itself and cannot be traced to a rule is
/// indistinguishable from a bug, and the person who wrote the rule six months
/// ago is not the person reconciling today.
///
/// The engine's own keyword list is shown alongside and cannot be edited: those
/// are built in, they are conservative, and the honest thing is to say they
/// exist rather than let somebody wonder where "Bank charges" came from.
const CATEGORIES: readonly { role: string; label: string }[] = [
  { role: "BANK_CHARGE", label: "Bank charges" },
  { role: "CARD_FEE", label: "Card fees" },
  { role: "HOUSEKEEPING_EXPENSE", label: "Housekeeping" },
  { role: "RENT_EXPENSE", label: "Rent" },
  { role: "SALARY_EXPENSE", label: "Salaries" },
  { role: "ALLOWANCE_EXPENSE", label: "Outside help" },
  { role: "CARD_RECEIVABLE", label: "Card receivable" },
  { role: "INTEREST_INCOME", label: "Bank interest" },
  { role: "AFFILIATE_GOODS_PAYABLE", label: "Due to head office — goods" },
  { role: "PRINCIPAL_PAYABLE", label: "Due to principal" },
]

const BUILT_IN: readonly [string, string][] = [
  ["BIAYA ADM · ADM · BIAYA BANK", "Bank charges"],
  ["BUNGA", "Bank interest"],
  ["PAJAK BUNGA · PPH", "Tax"],
  ["SETTLE · EDC · DEBIT", "Card settlement"],
  ["TRSF · TRANSFER", "no category — must be chosen"],
]

export function Rules() {
  const b = useBook()
  const mine = b.bankRules()
  const [contains, setContains] = useState("")
  const [role, setRole] = useState("")
  const [party, setParty] = useState("")

  return (
    <PageContent>
      <PageHeader crumb="Accounting & close" title="Schedules & rules" />

      <Section title="New rule">
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="When the description contains"
            required
            className="min-w-[13rem] flex-1"
          >
            <Input
              value={contains}
              onChange={(e) => setContains(e.target.value)}
            />
          </Field>
          <Field label="Categorise as" required className="min-w-[11rem]">
            <Select value={role} onChange={setRole} className={FILTER_W}>
              <option value="">Select category…</option>
              {CATEGORIES.map((c) => (
                <option key={c.role} value={c.role}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From/To" className="min-w-[11rem]">
            <Select value={party} onChange={setParty} className={FILTER_W}>
              <option value="">Leave blank</option>
              {PARTIES.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="primary"
            disabled={!contains.trim() || !role}
            onClick={() => {
              b.addBankRule({
                contains: contains.trim(),
                role,
                label: CATEGORIES.find((c) => c.role === role)?.label ?? role,
                counterparty: party || undefined,
              })
              setContains("")
              setRole("")
              setParty("")
            }}
          >
            Add rule
          </Button>
        </div>
      </Section>

      <Section title={`Your rules — ${mine.length}`}>
        {mine.length === 0 ? (
          <EmptyState>
            No rules yet. Create one from a bank line, or above.
          </EmptyState>
        ) : (
          <Table
            head={[
              "When Description Contains",
              "Categorise as",
              "From/To",
              "Created by",
              "",
            ]}
          >
            {mine.map((r) => (
              <Row key={r.rule_id}>
                <Cell mono>{r.contains}</Cell>
                <Cell>{r.label}</Cell>
                <Cell className="text-body">{r.counterparty ?? "—"}</Cell>
                <Cell className="text-mute">{r.created_by}</Cell>
                <Cell>
                  <button
                    type="button"
                    onClick={() => b.removeBankRule(r.rule_id)}
                    className="font-medium text-accent hover:underline"
                  >
                    Remove
                  </button>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Built in">
        <Table head={["When Description Contains", "Suggests", ""]}>
          {BUILT_IN.map(([k, v]) => (
            <Row key={k}>
              <Cell mono>{k}</Cell>
              <Cell>{v}</Cell>
              <Cell>
                <Pill tone="neutral">built in</Pill>
              </Cell>
            </Row>
          ))}
        </Table>
      </Section>
    </PageContent>
  )
}
