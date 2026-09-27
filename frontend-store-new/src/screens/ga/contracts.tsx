import { CalendarClock } from "lucide-react"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count } from "@/lib/format"
import { useGaContract, useGaContractTypes, useGaPlace } from "@/lib/queries/ga"
import {
  CONTRACT_GROUPS,
  contractNeedsLook,
  contractTypeWords,
  coverageOf,
  day,
  groupOf,
  partyOf,
  periodOf,
  standingOf,
} from "@/screens/ga/format"
import {
  ChipRow,
  Fact,
  Facts,
  GaScreen,
  RowTable,
  SheetBlock,
  Toolbar,
  TwoLine,
  type RowColumn,
} from "@/screens/ga/parts"
import { gaState } from "@/screens/ga/state"
import { money } from "@itulah/contract/money"
import type { GaContractRow } from "@itulah/contract"

/// The deals that keep this shop open — its rent, the services that come in
/// (maintenance, cleaning, security), its insurance, its permits and local
/// taxes, and its utility connections. Read-only: GA signs and renews them.
///
/// # Read from the place, not the register
///
/// `/ga/contracts?site=` answers only the contracts that NAME this shop. One
/// property policy, one cleaning crew or one maintenance deal can cover every
/// shop at once (`site_scope` ALL_STORES / ALL_SITES), and a manager asked
/// "are we insured?" needs those too. `/ga/locations/{site}` returns both
/// halves, so that is what this reads; the company-wide ones are tagged.
///
/// # What a shop reads off a contract
///
/// Who the other party is (for rent, the landlord), the window, and above
/// all when it ends — "ends in 37 days" is the line that gets a renewal
/// started, and the server decides it from each contract's own reminder
/// window rather than one threshold for all. The value the paper states is
/// shown when GA recorded one; what has been billed against it is Finance's
/// and is not.
export function Contracts() {
  return (
    <GaScreen sub="Rent, services, insurance, permits and utilities that keep this shop open. Head office signs and renews them.">
      {(site) => <ContractList site={site} />}
    </GaScreen>
  )
}

type Phase = "CURRENT" | "ALL"

/// Running, starting, or run out while still on the books — the ones a shop
/// is living under. Drafts and terminated deals are history or not yet real.
function isCurrent(row: GaContractRow): boolean {
  return row.standing !== "DRAFT" && row.standing !== "DIHENTIKAN"
}

const columns: readonly RowColumn<GaContractRow>[] = [
  {
    id: "contract",
    header: "Contract",
    cell: (row) => (
      <TwoLine
        icon={groupOf(row.group_code).icon}
        top={contractTypeWords(row.contract_type, row.contract_type_name)}
        under={
          row.contract_number ?? (
            <span className="text-faint">No number on the paper</span>
          )
        }
      />
    ),
  },
  {
    id: "party",
    header: "With",
    cell: (row) => {
      const cover = coverageOf(row)
      return (
        <span className="inline-flex max-w-[16rem] items-center gap-1.5">
          <span className="truncate">{partyOf(row)}</span>
          {cover !== null && <Tag tone="accent">{cover}</Tag>}
        </span>
      )
    },
  },
  {
    id: "period",
    header: "Period",
    cell: (row) => <span className="tabular-nums">{periodOf(row)}</span>,
  },
  {
    id: "value",
    header: "Value",
    align: "right",
    cell: (row) =>
      row.contract_value_minor === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="tabular-nums">{money(row.contract_value_minor)}</span>
      ),
  },
  {
    id: "standing",
    header: "Standing",
    card: "status",
    cell: (row) => {
      const standing = standingOf(row)
      return <Pill tone={standing.tone}>{standing.label}</Pill>
    },
  },
]

function ContractList({ site }: { site: string }) {
  const place = useGaPlace(site)
  const types = useGaContractTypes(site)
  const [phase, setPhase] = useState<Phase>("CURRENT")
  const [group, setGroup] = useState<string>("ALL")
  const [type, setType] = useState<string>("")
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)

  const all = useMemo(() => place.data?.contracts ?? [], [place.data])
  const current = all.filter(isCurrent)
  const pool = phase === "CURRENT" ? current : all
  const inGroup = pool.filter(
    (row) => group === "ALL" || row.group_code === group,
  )
  // The types this group actually holds here, in the client's own order.
  const order = (code: string) =>
    types.data?.find((one) => one.code === code)?.sort_order ?? 999
  const typesHere = [...new Set(inGroup.map((row) => row.contract_type))].sort(
    (a, b) => order(a) - order(b),
  )
  const shown = inGroup
    .filter((row) => type === "" || row.contract_type === type)
    .sort(
      (a, b) =>
        Number(contractNeedsLook(b)) - Number(contractNeedsLook(a)) ||
        (a.days_to_end ?? 99_999) - (b.days_to_end ?? 99_999) ||
        order(a.contract_type) - order(b.contract_type),
    )
  const ending = current.filter(contractNeedsLook)
  const open = all.find((row) => row.contract_id === openId) ?? null

  return (
    <>
      {gaState(place, {
        loading: "Reading this shop's contracts…",
        render: () =>
          all.length === 0 ? (
            <Card>
              <p className="mx-auto max-w-[30em] px-4 py-12 text-center text-meta text-body">
                Head office has no contract on record for this shop — no lease,
                no service, no insurance, no permit. If the shop is running
                under one, GA has not entered it yet.
              </p>
            </Card>
          ) : (
            <>
              {ending.length > 0 && (
                <Banner tone="warn" className="mb-4">
                  <CalendarClock className="mr-1.5 inline size-4 align-[-3px]" />
                  {ending.length === 1
                    ? "One contract is inside its reminder window: "
                    : `${count(ending.length)} contracts are inside their reminder window: `}
                  {ending
                    .map(
                      (row) =>
                        `${contractTypeWords(row.contract_type, row.contract_type_name)} — ${standingOf(row).label.toLowerCase()}`,
                    )
                    .join("; ")}
                  . Head office renews them; if the shop has heard nothing, ask.
                </Banner>
              )}

              <Toolbar>
                <ChipRow
                  label="Kind of contract"
                  value={group}
                  onChange={(next) => {
                    setGroup(next)
                    setType("")
                  }}
                  options={[
                    { value: "ALL", label: "All", count: pool.length },
                    ...CONTRACT_GROUPS.map((one) => ({
                      value: one.value,
                      label: one.label,
                      icon: one.icon,
                      count: pool.filter((row) => row.group_code === one.value)
                        .length,
                    })).filter((one) => one.count > 0 || one.value === group),
                  ]}
                />
                <div className="flex items-center gap-2">
                  {typesHere.length > 1 && (
                    <Select
                      value={type}
                      onChange={setType}
                      aria-label="Type"
                      className="md:pointer-fine:h-9 md:pointer-fine:w-56 md:pointer-fine:text-cell"
                    >
                      <option value="">Every type</option>
                      {typesHere.map((code) => (
                        <option key={code} value={code}>
                          {contractTypeWords(
                            code,
                            types.data?.find((one) => one.code === code)?.name,
                          )}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Segmented<Phase>
                    value={phase}
                    onChange={setPhase}
                    className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
                    options={[
                      {
                        value: "CURRENT",
                        label: `Current · ${count(current.length)}`,
                      },
                      { value: "ALL", label: `All · ${count(all.length)}` },
                    ]}
                  />
                </div>
              </Toolbar>

              <Card>
                <RowTable
                  rows={shown}
                  columns={columns}
                  rowKey={(row) => row.contract_id}
                  onOpen={(row) => {
                    setOpenId(row.contract_id)
                    setShowing(true)
                  }}
                  empty={
                    phase === "CURRENT"
                      ? "Nothing current of this kind here. Drafts and terminated contracts are under All."
                      : "No contract of this kind for this shop."
                  }
                />
              </Card>
            </>
          ),
      })}

      <ContractSheet
        contract={open}
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

/// One contract: the deal, its window, the papers filed against it and — for
/// a utility — the meter's last months. The bills that point at it travel in
/// the same answer and are deliberately not drawn: what was paid is Finance's.
function ContractSheet({
  contract,
  open,
  onClose,
}: {
  contract: GaContractRow | null
  open: boolean
  onClose: () => void
}) {
  const hub = useGaContract(contract?.contract_id ?? null)
  if (contract === null) return null
  const standing = standingOf(contract)
  const cover = coverageOf(contract)
  const utility = contract.group_code === "LANGGANAN"

  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={contract.contract_number ?? undefined}
      title={contractTypeWords(
        contract.contract_type,
        contract.contract_type_name,
      )}
      badge={<Pill tone={standing.tone}>{standing.label}</Pill>}
      caption={partyOf(contract)}
    >
      <Facts>
        <Fact term="Kind">{groupOf(contract.group_code).label}</Fact>
        <Fact term="On the paper">{contract.contract_type_name}</Fact>
        <Fact term="With">{partyOf(contract)}</Fact>
        <Fact term="Covers">{cover ?? "This shop"}</Fact>
        <Fact term="Starts">{day(contract.starts_on)}</Fact>
        <Fact term="Ends">
          {contract.ends_on === null ? "No end date" : day(contract.ends_on)}
        </Fact>
        <Fact term="Reminder">
          {count(contract.reminder_days)} days before the end
        </Fact>
        <Fact term="Signed">
          {contract.is_signed
            ? contract.signed_by === null
              ? "Yes"
              : `Yes, by ${contract.signed_by}`
            : "Not yet"}
        </Fact>
        {contract.contract_value_minor !== null && (
          <Fact term="Value on the paper">
            {money(contract.contract_value_minor)}
          </Fact>
        )}
        {contract.objek_name !== null && (
          <Fact term="Maintains">{contract.objek_name}</Fact>
        )}
        {contract.customer_number !== null && (
          <Fact term="Customer number">
            <span className="font-mono">{contract.customer_number}</span>
          </Fact>
        )}
        {utility && contract.last_usage !== null && (
          <Fact term="Last reading">
            {count(contract.last_usage)} {contract.last_unit ?? ""}
            {contract.last_usage_period !== null &&
              ` · ${monthOf(contract.last_usage_period)}`}
          </Fact>
        )}
        {contract.notes !== null && contract.notes.trim() !== "" && (
          <Fact term="Notes" wide>
            {contract.notes}
          </Fact>
        )}
      </Facts>

      {gaState(hub, {
        loading: "Reading its papers…",
        render: (answer) => (
          <>
            <SheetBlock title="Papers">
              {answer.documents.length === 0 ? (
                <p className="text-meta text-mute">
                  No paper filed against it at head office.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {answer.documents.map((doc) => (
                    <li
                      key={doc.document_id}
                      className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-cell font-medium text-ink">
                          {doc.title ?? doc.name}
                        </span>
                        <span className="block truncate text-meta text-mute">
                          {[doc.doc_type, doc.doc_number, doc.issuer]
                            .filter(Boolean)
                            .join(" · ") || doc.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-meta text-body tabular-nums">
                        {doc.expires_on === null
                          ? "No expiry"
                          : `Until ${day(doc.expires_on)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SheetBlock>
            {answer.meter_readings.length > 0 && (
              <SheetBlock title="Meter" aside="the last six months read">
                <ul className="flex flex-col">
                  {answer.meter_readings.slice(0, 6).map((reading) => (
                    <li
                      key={reading.reading_id}
                      className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 last:border-b-0"
                    >
                      <span className="text-cell text-body">
                        {monthOf(reading.period)}
                      </span>
                      <span className="text-cell font-medium text-ink tabular-nums">
                        {count(reading.usage)} {reading.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </SheetBlock>
            )}
          </>
        ),
      })}
    </RecordSheet>
  )
}

const monthFormat = new Intl.DateTimeFormat("id-ID", {
  month: "short",
  year: "numeric",
})

/// A meter month — always its first day on the wire — as "Sep 2026".
function monthOf(period: string): string {
  const parsed = new Date(`${period.slice(0, 10)}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? period : monthFormat.format(parsed)
}
