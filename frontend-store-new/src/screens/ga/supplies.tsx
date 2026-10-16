import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { Field, Input, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import { SheetSection } from "@/components/ui/people-sheet"
import { Pill, Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  gaKeys,
  recordGaSupply,
  useGaSupplies,
  useGaSupplyCategories,
} from "@/lib/queries/ga"
import { useIdentity } from "@/lib/session"
import {
  dateLead,
  day,
  daysUntil,
  SUPPLY_FLOW,
  supplyCategoryWords,
  supplyIsOpen,
  supplyStageTone,
  supplyStageWords,
  today,
} from "@/screens/ga/format"
import {
  ChoiceTiles,
  Facts,
  GaScreen,
  ListBar,
  Question,
  StageLadder,
  Submit,
  type GaContext,
} from "@/screens/ga/parts"
import { describeGa, gaState } from "@/screens/ga/state"
import { personByLogin } from "@/screens/hr/words"
import type { GaSupplyRequestRow } from "@itulah/contract"

/// What this shop has asked head office for — stationery, cleaning things,
/// shop and office supplies, electrical bits, tools — and where each ask has
/// got to.
///
/// The shop asks; GA approves, orders, and the thing arrives. Finance bills it
/// last, which is why BILLED is on the ladder but the shop's part is over at
/// RECEIVED. The category list is the server's (`/ga/supply-categories`), the
/// same seven the request is validated against — customer bags and the like
/// are somebody else's and are not in it.
///
/// A card's one figure is the day it is needed by; a request with no date
/// shows a dash. No money: what it costs is GA's quote and Finance's bill.
export function Supplies() {
  const [composing, setComposing] = useState(false)
  const [filed, setFiled] = useState(false)
  const start = () => {
    setFiled(false)
    setComposing(true)
  }
  return (
    <GaScreen primary={{ label: "New supply request", onClick: start }}>
      {({ site, team }) => (
        <>
          {filed && (
            <Banner
              tone="ok"
              className="mb-4"
              onDismiss={() => setFiled(false)}
            >
              Sent to head office.
            </Banner>
          )}
          <SupplyList site={site} team={team} onNew={start} />
          <SupplyComposer
            open={composing}
            onClose={() => setComposing(false)}
            site={site}
            onFiled={() => setFiled(true)}
          />
        </>
      )}
    </GaScreen>
  )
}

type Phase = "OPEN" | "DONE" | "ALL"
type Order = "needed" | "item"

const ORDERS: readonly { readonly value: Order; readonly label: string }[] = [
  { value: "needed", label: "Needed by" },
  { value: "item", label: "Item" },
]

function SupplyList({
  site,
  team,
  onNew,
}: {
  site: string
  team: GaContext["team"]
  onNew: () => void
}) {
  const supplies = useGaSupplies(site)
  const [phase, setPhase] = useState<Phase>("OPEN")
  const [typed, setTyped] = useState("")
  const [order, setOrder] = useState<Order>("needed")
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const needle = typed.trim().toLowerCase()
  const all = supplies.data
  const figure = (pick: (row: GaSupplyRequestRow) => boolean) =>
    all === undefined ? "—" : count(all.filter(pick).length)

  return (
    <>
      <KpiStrip>
        <Kpi
          label="On the way"
          value={figure((row) => supplyIsOpen(row.status))}
        />
        <Kpi
          label="Waiting for approval"
          value={figure((row) => row.status === "REQUESTED")}
        />
        <Kpi
          label="Ordered"
          value={figure((row) => row.status === "ORDERED")}
        />
        <Kpi
          label="Needed within 7 days"
          value={figure(
            (row) =>
              supplyIsOpen(row.status) &&
              row.needed_by !== null &&
              daysUntil(row.needed_by) <= 7,
          )}
        />
      </KpiStrip>

      {gaState(supplies, {
        loading: "Reading the supply requests…",
        render: (rows) => {
          if (rows.length === 0) {
            return (
              <EmptyState
                action={
                  <Button variant="primary" onClick={onNew}>
                    New supply request
                  </Button>
                }
              >
                No supply requests yet.
              </EmptyState>
            )
          }
          const open = rows.filter((row) => supplyIsOpen(row.status))
          const done = rows.filter((row) => !supplyIsOpen(row.status))
          const pool = phase === "OPEN" ? open : phase === "DONE" ? done : rows
          const shown = pool
            .filter(
              (row) =>
                needle === "" ||
                [
                  row.item,
                  row.quantity,
                  supplyCategoryWords(row.category_code, row.category_name),
                ].some((field) => field?.toLowerCase().includes(needle)),
            )
            // Soonest needed first; a request with no date goes last.
            .sort((a, b) =>
              order === "item"
                ? a.item.localeCompare(b.item)
                : (a.needed_by ?? "9999").localeCompare(b.needed_by ?? "9999"),
            )
          return (
            <>
              <ListBar
                search={{
                  value: typed,
                  onChange: setTyped,
                  label: "Search supply requests",
                }}
                status={{
                  title: "Show",
                  value: phase,
                  onChange: (next) => setPhase(next as Phase),
                  options: [
                    { value: "OPEN", label: "On the way", count: open.length },
                    { value: "DONE", label: "Done", count: done.length },
                    { value: "ALL", label: "All", count: rows.length },
                  ],
                }}
                sort={{
                  value: order,
                  options: ORDERS,
                  onChange: (next) => setOrder(next as Order),
                }}
              />
              {shown.length === 0 ? (
                <EmptyState
                  action={
                    needle !== "" || phase !== "ALL" ? (
                      <Button
                        onClick={() => {
                          setTyped("")
                          setPhase("ALL")
                        }}
                      >
                        Show all requests
                      </Button>
                    ) : undefined
                  }
                >
                  {needle !== ""
                    ? `No match for “${typed.trim()}”.`
                    : phase === "OPEN"
                      ? "Nothing on the way."
                      : "Nothing closed yet."}
                </EmptyState>
              ) : (
                <CardList grid>
                  {shown.map((row) => (
                    <SupplyCard
                      key={row.request_id}
                      row={row}
                      onOpen={() => {
                        setOpenId(row.request_id)
                        setShowing(true)
                      }}
                    />
                  ))}
                </CardList>
              )}
            </>
          )
        },
      })}

      <SupplySheet
        request={
          supplies.data?.find((row) => row.request_id === openId) ?? null
        }
        team={team}
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

/// One request as the uniform lead-figure card: the thing and its category, the
/// day it is needed by as the one figure, and where it has got to.
function SupplyCard({
  row,
  onOpen,
}: {
  row: GaSupplyRequestRow
  onOpen: () => void
}) {
  return (
    <LeadCard
      title={row.item}
      lines={[
        supplyCategoryWords(row.category_code, row.category_name),
        row.quantity,
      ]}
      lead={dateLead(row.needed_by, "needed by")}
      foot={{
        info: (
          <Status tone={supplyStageTone(row.status)}>
            {supplyStageWords(row.status)}
          </Status>
        ),
        action: { label: "Open", onClick: onOpen },
      }}
      onOpen={onOpen}
    />
  )
}

function SupplySheet({
  request,
  team,
  open,
  onClose,
}: {
  request: GaSupplyRequestRow | null
  team: GaContext["team"]
  open: boolean
  onClose: () => void
}) {
  if (request === null) return null
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={request.po_reference ?? undefined}
      title={request.item}
      badge={
        <Pill tone={supplyStageTone(request.status)}>
          {supplyStageWords(request.status)}
        </Pill>
      }
      caption={`Asked by ${personByLogin(team, request.requested_by)}`}
    >
      <SheetSection title="Progress">
        <StageLadder
          flow={SUPPLY_FLOW}
          at={request.status}
          words={supplyStageWords}
          exit="REJECTED"
        />
      </SheetSection>
      {request.status === "REJECTED" && request.rejected_reason !== null && (
        <Banner tone="bad" className="mb-6">
          Rejected: {request.rejected_reason}
        </Banner>
      )}
      <SheetSection title="The request">
        <Facts
          rows={[
            [
              "Category",
              supplyCategoryWords(request.category_code, request.category_name),
            ],
            ["Quantity", request.quantity ?? "—"],
            [
              "Needed by",
              request.needed_by === null
                ? "No date given"
                : day(request.needed_by),
            ],
            [
              "Order number",
              request.po_reference === null
                ? "Not ordered yet"
                : request.po_reference,
            ],
          ]}
        />
      </SheetSection>
    </Sheet>
  )
}

/// Asking for something. Category, the thing, how many, by when — and who is
/// asking, filled with the till's own signed-in name and left editable,
/// because the person at the counter is not always the person who needs it.
///
/// No price. What it costs is GA's quote and Finance's bill; a guess typed at
/// the counter would only be a number somebody has to correct.
function SupplyComposer({
  open,
  onClose,
  site,
  onFiled,
}: {
  open: boolean
  onClose: () => void
  site: string
  onFiled: () => void
}) {
  const client = useQueryClient()
  const me = useIdentity()
  const categories = useGaSupplyCategories(open)
  const [category, setCategory] = useState<string | null>(null)
  const [item, setItem] = useState("")
  const [quantity, setQuantity] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [notes, setNotes] = useState("")
  const [askedBy, setAskedBy] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  const who = askedBy ?? me.data?.display_name ?? me.data?.username ?? ""
  const problems = {
    category: category === null ? "Choose a kind." : null,
    item: item.trim() === "" ? "Say what you need." : null,
    who: who.trim() === "" ? "Say who is asking." : null,
  }

  const file = useMutation({
    mutationFn: () =>
      recordGaSupply({
        // Always this shop — the relay forces it too.
        site_id: site,
        requested_by: who.trim(),
        category_code: category ?? "",
        item: item.trim(),
        quantity: quantity.trim() === "" ? null : quantity.trim(),
        needed_by: neededBy === "" ? null : neededBy,
        estimated_cost_minor: null,
        notes: notes.trim() === "" ? null : notes.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all() })
      setCategory(null)
      setItem("")
      setQuantity("")
      setNeededBy("")
      setNotes("")
      setTried(false)
      onFiled()
      onClose()
    },
  })

  const submit = () => {
    setTried(true)
    if (
      problems.category !== null ||
      problems.item !== null ||
      problems.who !== null
    )
      return
    file.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="wide"
      title="New supply request"
      footer={
        <Submit
          label="Create supply request"
          pendingLabel="Creating…"
          pending={file.isPending}
          error={file.error}
          onSubmit={submit}
          onCancel={onClose}
        />
      }
    >
      <SheetSection title="What kind of thing">
        {categories.isPending ? (
          <p className="text-meta text-mute">Reading the categories…</p>
        ) : categories.isError ? (
          <p className="text-meta text-bad">{describeGa(categories.error)}</p>
        ) : (
          <Question
            label="Category"
            required
            problem={tried ? problems.category : null}
          >
            <ChoiceTiles
              label="Category"
              value={category}
              onChange={setCategory}
              options={(categories.data ?? []).map((one) => ({
                value: one.category_code,
                label: supplyCategoryWords(one.category_code, one.name),
              }))}
            />
          </Question>
        )}
      </SheetSection>

      <SheetSection title="What you need">
        <div className="flex flex-col gap-4">
          <Field label="Item" required problem={tried ? problems.item : null}>
            <Input
              value={item}
              onChange={(event) => setItem(event.target.value)}
              placeholder="A4 paper for the office printer"
              invalid={tried && problems.item !== null}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity">
              <Input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="2 rim"
              />
            </Field>
            <Field label="Needed by">
              <Input
                type="date"
                value={neededBy}
                min={today()}
                onChange={(event) => setNeededBy(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <Field
            label="Asked by"
            required
            problem={tried ? problems.who : null}
          >
            <Input
              value={who}
              onChange={(event) => setAskedBy(event.target.value)}
              invalid={tried && problems.who !== null}
            />
          </Field>
        </div>
      </SheetSection>
    </Sheet>
  )
}
