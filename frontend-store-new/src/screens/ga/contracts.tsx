import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { SheetSection } from "@/components/ui/people-sheet"
import { Pill, Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useGaContract, useGaContractTypes, useGaPlace } from "@/lib/queries/ga"
import { readMonth } from "@/lib/queries/hr"
import {
  CONTRACT_GROUPS,
  contractNeedsLook,
  contractTypeWords,
  coverageOf,
  dateLead,
  day,
  groupOf,
  partyOf,
  standingOf,
} from "@/screens/ga/format"
import {
  Facts,
  GaScreen,
  ListBar,
  ListLine,
  type GaContext,
} from "@/screens/ga/parts"
import { gaState } from "@/screens/ga/state"
import { personByLogin } from "@/screens/hr/words"
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
/// halves, so that is what this reads; the company-wide ones say so.
///
/// # What a shop reads off a contract
///
/// Who the other party is (for rent, the landlord), and above all when it
/// ends — "ends in 37 days" is the line that gets a renewal started, and the
/// server decides it from each contract's own reminder window rather than one
/// threshold for all. So a card's one figure is the end date, its foot says
/// where the contract stands, and one that needs somebody's look takes the red
/// foot. The value the paper states is in the sheet when GA recorded one;
/// what has been billed against it is Finance's and is not.
export function Contracts() {
  return (
    <GaScreen>
      {({ site, team }) => <ContractList site={site} team={team} />}
    </GaScreen>
  )
}

type Phase = "CURRENT" | "ALL"
type Order = "ending" | "kind" | "newest"

const ORDERS: readonly { readonly value: Order; readonly label: string }[] = [
  { value: "ending", label: "Ending soonest" },
  { value: "kind", label: "Kind" },
  { value: "newest", label: "Newest" },
]

/// Running, starting, or run out while still on the books — the ones a shop
/// is living under. Drafts and terminated deals are history or not yet real.
function isCurrent(row: GaContractRow): boolean {
  return row.standing !== "DRAFT" && row.standing !== "DIHENTIKAN"
}

function ContractList({
  site,
  team,
}: {
  site: string
  team: GaContext["team"]
}) {
  const place = useGaPlace(site)
  const types = useGaContractTypes(site)
  const [phase, setPhase] = useState<Phase>("CURRENT")
  const [group, setGroup] = useState<string>("ALL")
  const [type, setType] = useState<string>("")
  const [typed, setTyped] = useState("")
  const [order, setOrder] = useState<Order>("ending")
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const needle = typed.trim().toLowerCase()

  const all = useMemo(() => place.data?.contracts ?? [], [place.data])
  const current = all.filter(isCurrent)
  const pool = phase === "CURRENT" ? current : all
  const inGroup = pool.filter(
    (row) => group === "ALL" || row.group_code === group,
  )
  // The types this group actually holds here, in the client's own order.
  const rank = (code: string) =>
    types.data?.find((one) => one.code === code)?.sort_order ?? 999
  const typesHere = [...new Set(inGroup.map((row) => row.contract_type))].sort(
    (a, b) => rank(a) - rank(b),
  )
  const shown = inGroup
    .filter(
      (row) =>
        (type === "" || row.contract_type === type) &&
        (needle === "" ||
          [
            contractTypeWords(row.contract_type, row.contract_type_name),
            row.contract_number,
            partyOf(row),
            row.customer_number,
            row.objek_name,
          ].some((field) => field?.toLowerCase().includes(needle))),
    )
    .sort((a, b) => {
      if (order === "kind")
        return (
          rank(a.contract_type) - rank(b.contract_type) ||
          b.starts_on.localeCompare(a.starts_on)
        )
      if (order === "newest") return b.starts_on.localeCompare(a.starts_on)
      return (
        Number(contractNeedsLook(b)) - Number(contractNeedsLook(a)) ||
        (a.days_to_end ?? 99_999) - (b.days_to_end ?? 99_999) ||
        rank(a.contract_type) - rank(b.contract_type)
      )
    })
  const ending = current.filter(contractNeedsLook)
  const open = all.find((row) => row.contract_id === openId) ?? null

  return (
    <>
      {gaState(place, {
        loading: "Reading the contracts…",
        render: () =>
          all.length === 0 ? (
            <EmptyState>No contracts on record.</EmptyState>
          ) : (
            <>
              <ListBar
                search={{
                  value: typed,
                  onChange: setTyped,
                  label: "Search contracts",
                }}
                status={{
                  title: "Kind",
                  value: group,
                  onChange: (next) => {
                    setGroup(next)
                    setType("")
                  },
                  options: [
                    { value: "ALL", label: "All kinds", count: pool.length },
                    ...CONTRACT_GROUPS.map((one) => ({
                      value: one.value,
                      label: one.label,
                      count: pool.filter((row) => row.group_code === one.value)
                        .length,
                    })).filter((one) => one.count > 0 || one.value === group),
                  ],
                }}
                sort={{
                  value: order,
                  options: ORDERS,
                  onChange: (next) => setOrder(next as Order),
                }}
                views={[
                  {
                    title: "Show",
                    value: phase,
                    onChange: (next) => setPhase(next as Phase),
                    options: [
                      { value: "CURRENT", label: "Current" },
                      { value: "ALL", label: "All" },
                    ],
                  },
                  ...(typesHere.length > 1
                    ? [
                        {
                          title: "Type",
                          value: type,
                          onChange: setType,
                          options: [
                            { value: "", label: "All types" },
                            ...typesHere.map((code) => ({
                              value: code,
                              label: contractTypeWords(
                                code,
                                types.data?.find((one) => one.code === code)
                                  ?.name,
                              ),
                            })),
                          ],
                        },
                      ]
                    : []),
                ]}
              />

              <StatStrip>
                <Stat label="Current" value={count(current.length)} />
                <Stat
                  label="Ending soon"
                  value={count(ending.length)}
                  tone={ending.length > 0 ? "warn" : undefined}
                />
              </StatStrip>

              {shown.length === 0 ? (
                <EmptyState
                  action={
                    needle !== "" || type !== "" || phase === "CURRENT" ? (
                      <Button
                        onClick={() => {
                          setTyped("")
                          setType("")
                          setGroup("ALL")
                          setPhase("ALL")
                        }}
                      >
                        Show all contracts
                      </Button>
                    ) : undefined
                  }
                >
                  {needle !== ""
                    ? `No match for “${typed.trim()}”.`
                    : phase === "CURRENT"
                      ? "None current."
                      : "None of this kind."}
                </EmptyState>
              ) : (
                <CardList grid>
                  {shown.map((row) => (
                    <ContractCard
                      key={row.contract_id}
                      row={row}
                      onOpen={() => {
                        setOpenId(row.contract_id)
                        setShowing(true)
                      }}
                    />
                  ))}
                </CardList>
              )}
            </>
          ),
      })}

      <ContractSheet
        contract={open}
        team={team}
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

/// One contract as the uniform lead-figure card: the kind of deal over the
/// number on the paper, who it is with, the day it ends as the one figure, and
/// where it stands in the foot.
function ContractCard({
  row,
  onOpen,
}: {
  row: GaContractRow
  onOpen: () => void
}) {
  const standing = standingOf(row)
  const party = partyOf(row)
  return (
    <LeadCard
      title={contractTypeWords(row.contract_type, row.contract_type_name)}
      code={row.contract_number ?? undefined}
      lines={[party === "—" ? null : party, coverageOf(row)]}
      lead={
        row.ends_on === null
          ? { figure: "—", caption: "no end date", muted: true }
          : dateLead(row.ends_on, "ends")
      }
      tone={contractNeedsLook(row) ? "alert" : undefined}
      foot={{
        info: <Status tone={standing.tone}>{standing.label}</Status>,
        action: { label: "Open", onClick: onOpen },
      }}
      onOpen={onOpen}
    />
  )
}

/// One contract: the deal, its window, the papers filed against it and — for
/// a utility — the meter's last months. The bills that point at it travel in
/// the same answer and are deliberately not drawn: what was paid is Finance's.
function ContractSheet({
  contract,
  team,
  open,
  onClose,
}: {
  contract: GaContractRow | null
  team: GaContext["team"]
  open: boolean
  onClose: () => void
}) {
  const hub = useGaContract(contract?.contract_id ?? null)
  if (contract === null) return null
  const standing = standingOf(contract)
  const cover = coverageOf(contract)
  const utility = contract.group_code === "LANGGANAN"

  return (
    <Sheet
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
      <Facts
        rows={[
          ["Kind", groupOf(contract.group_code).label],
          ["On the paper", contract.contract_type_name],
          ["With", partyOf(contract)],
          ["Covers", cover ?? "This shop"],
          ["Starts", day(contract.starts_on)],
          ["Ends", contract.ends_on === null ? "No end date" : day(contract.ends_on)],
          ["Reminder", `${count(contract.reminder_days)} days before the end`],
          [
            "Signed",
            contract.is_signed
              ? contract.signed_by === null
                ? "Yes"
                : `Yes, by ${personByLogin(team, contract.signed_by)}`
              : "Not yet",
          ],
          contract.contract_value_minor !== null && [
            "Value on the paper",
            money(contract.contract_value_minor),
          ],
          contract.objek_name !== null && ["Maintains", contract.objek_name],
          contract.customer_number !== null && [
            "Customer number",
            <span key="customer" className="font-mono">
              {contract.customer_number}
            </span>,
          ],
          utility &&
            contract.last_usage !== null && [
              "Last reading",
              `${count(contract.last_usage)} ${contract.last_unit ?? ""}${
                contract.last_usage_period !== null
                  ? ` · ${monthOf(contract.last_usage_period)}`
                  : ""
              }`,
            ],
          contract.notes !== null &&
            contract.notes.trim() !== "" && ["Notes", contract.notes, true],
        ]}
      />

      {gaState(hub, {
        loading: "Reading the papers…",
        render: (answer) => (
          <div className="mt-6">
            <SheetSection title="Papers" aside={answer.documents.length}>
              {answer.documents.length === 0 ? (
                <p className="text-meta text-mute">No papers.</p>
              ) : (
                <ul className="flex flex-col">
                  {answer.documents.map((doc) => (
                    <ListLine
                      key={doc.document_id}
                      top={doc.title ?? doc.name}
                      under={
                        [doc.doc_type, doc.doc_number, doc.issuer]
                          .filter(Boolean)
                          .join(" · ") || doc.name
                      }
                      end={
                        doc.expires_on === null
                          ? "No expiry"
                          : `Until ${day(doc.expires_on)}`
                      }
                    />
                  ))}
                </ul>
              )}
            </SheetSection>
            {answer.meter_readings.length > 0 && (
              <SheetSection title="Meter readings">
                <ul className="flex flex-col">
                  {answer.meter_readings.slice(0, 6).map((reading) => (
                    <ListLine
                      key={reading.reading_id}
                      top={monthOf(reading.period)}
                      end={`${count(reading.usage)} ${reading.unit}`}
                    />
                  ))}
                </ul>
              </SheetSection>
            )}
          </div>
        ),
      })}
    </Sheet>
  )
}

/// A meter month — always its first day on the wire — as "September 2026".
function monthOf(period: string): string {
  return readMonth(period.slice(0, 7))
}
