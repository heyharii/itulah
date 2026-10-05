import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  gaKeys,
  recordGaSupply,
  useGaSupplies,
  useGaSupplyCategories,
} from "@/lib/queries/ga"
import { useIdentity } from "@/lib/session"
import {
  day,
  SUPPLY_FLOW,
  supplyCategoryWords,
  supplyIsOpen,
  supplyStageTone,
  supplyStageWords,
  today,
} from "@/screens/ga/format"
import {
  ChoiceTiles,
  Fact,
  Facts,
  GaScreen,
  RowTable,
  SheetBlock,
  StageLadder,
  TextArea,
  Toolbar,
  TwoLine,
  type RowColumn,
} from "@/screens/ga/parts"
import { describeGa, gaState } from "@/screens/ga/state"
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
export function Supplies() {
  const [composing, setComposing] = useState(false)
  const [filed, setFiled] = useState(false)
  return (
    <GaScreen
      actions={
        <Button
          variant="primary"
          onClick={() => {
            setFiled(false)
            setComposing(true)
          }}
        >
          <Plus />
          New request
        </Button>
      }
    >
      {(site) => (
        <>
          {filed && (
            <Banner tone="ok" className="mb-4">
              Sent to head office.
            </Banner>
          )}
          <SupplyList
            site={site}
            onNew={() => {
              setFiled(false)
              setComposing(true)
            }}
          />
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

const columns: readonly RowColumn<GaSupplyRequestRow>[] = [
  {
    id: "item",
    header: "Item",
    className: "max-w-[22rem]",
    cell: (row) => (
      <TwoLine
        top={row.item}
        under={row.quantity === null ? undefined : row.quantity}
      />
    ),
  },
  {
    id: "category",
    header: "Category",
    cell: (row) => supplyCategoryWords(row.category_code, row.category_name),
  },
  {
    id: "by",
    header: "Asked by",
    card: "hide",
    cell: (row) => row.requested_by,
  },
  {
    id: "needed",
    header: "Needed by",
    cell: (row) =>
      row.needed_by === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="tabular-nums">By {day(row.needed_by)}</span>
      ),
  },
  {
    id: "status",
    header: "Status",
    card: "status",
    cell: (row) => (
      <Pill tone={supplyStageTone(row.status)}>
        {supplyStageWords(row.status)}
      </Pill>
    ),
  },
]

function SupplyList({ site, onNew }: { site: string; onNew: () => void }) {
  const supplies = useGaSupplies(site)
  const [phase, setPhase] = useState<Phase>("OPEN")
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)

  return (
    <>
      {gaState(supplies, {
        loading: "Loading…",
        render: (rows) => {
          if (rows.length === 0) {
            return (
              <Card>
                <div className="mx-auto flex max-w-[30em] flex-col items-center gap-4 px-4 py-12 text-center">
                  <p className="text-meta text-body">
                    No requests yet.
                  </p>
                  <Button variant="ghost" onClick={onNew}>
                    <Plus />
                    New request
                  </Button>
                </div>
              </Card>
            )
          }
          const open = rows.filter((row) => supplyIsOpen(row.status))
          const done = rows.filter((row) => !supplyIsOpen(row.status))
          const shown = phase === "OPEN" ? open : phase === "DONE" ? done : rows
          return (
            <>
              <Toolbar>
                <Segmented<Phase>
                  value={phase}
                  onChange={setPhase}
                  className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
                  options={[
                    {
                      value: "OPEN",
                      label: `On the way · ${count(open.length)}`,
                    },
                    { value: "DONE", label: `Done · ${count(done.length)}` },
                    { value: "ALL", label: `All · ${count(rows.length)}` },
                  ]}
                />
              </Toolbar>
              <Card>
                <RowTable
                  rows={shown}
                  columns={columns}
                  rowKey={(row) => row.request_id}
                  onOpen={(row) => {
                    setOpenId(row.request_id)
                    setShowing(true)
                  }}
                  empty={
                    phase === "OPEN"
                      ? "Nothing on the way."
                      : "Nothing closed yet."
                  }
                />
              </Card>
            </>
          )
        },
      })}

      <SupplySheet
        request={
          supplies.data?.find((row) => row.request_id === openId) ?? null
        }
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

function SupplySheet({
  request,
  open,
  onClose,
}: {
  request: GaSupplyRequestRow | null
  open: boolean
  onClose: () => void
}) {
  if (request === null) return null
  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={request.item}
      badge={
        <Pill tone={supplyStageTone(request.status)}>
          {supplyStageWords(request.status)}
        </Pill>
      }
      caption={`Asked by ${request.requested_by}`}
    >
      <SheetBlock title="Where it has got to">
        <StageLadder
          flow={SUPPLY_FLOW}
          at={request.status}
          words={supplyStageWords}
          exit="REJECTED"
        />
      </SheetBlock>
      {request.status === "REJECTED" && request.rejected_reason !== null && (
        <Banner tone="bad" className="mt-4">
          Turned down: {request.rejected_reason}
        </Banner>
      )}
      <SheetBlock title="The request">
        <Facts>
          <Fact term="Category">
            {supplyCategoryWords(request.category_code, request.category_name)}
          </Fact>
          <Fact term="How many">{request.quantity ?? "—"}</Fact>
          <Fact term="Needed by">
            {request.needed_by === null
              ? "No date given"
              : day(request.needed_by)}
          </Fact>
          <Fact term="Order number">
            {request.po_reference === null ? (
              "Not ordered yet"
            ) : (
              <span className="font-mono">{request.po_reference}</span>
            )}
          </Fact>
        </Facts>
      </SheetBlock>
    </RecordSheet>
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
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="wide"
      title="Ask head office for something"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={file.isPending} onClick={submit}>
            {file.isPending ? "Sending…" : "Send the request"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {file.error !== null && (
          <Banner tone="bad">{describeGa(file.error)}</Banner>
        )}

        <SheetBlock title="What kind of thing">
          {categories.isPending ? (
            <p className="text-meta text-mute">Loading…</p>
          ) : categories.isError ? (
            <p className="text-meta text-bad">{describeGa(categories.error)}</p>
          ) : (
            <ChoiceTiles
              label="Category"
              value={category}
              onChange={setCategory}
              options={(categories.data ?? []).map((one) => ({
                value: one.category_code,
                label: supplyCategoryWords(one.category_code, one.name),
              }))}
            />
          )}
          {tried && problems.category !== null && (
            <p className="mt-1.5 text-meta text-bad">{problems.category}</p>
          )}
        </SheetBlock>

        <SheetBlock title="What you need">
          <div className="flex flex-col gap-3">
            <Field label="Item" problem={tried ? problems.item : null}>
              <Input
                value={item}
                onChange={(event) => setItem(event.target.value)}
                placeholder="A4 paper for the office printer"
                invalid={tried && problems.item !== null}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How many" hint="e.g. 2 rim">
                <Input
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="2 rim"
                />
              </Field>
              <Field label="Needed by" hint="Optional.">
                <Input
                  type="date"
                  value={neededBy}
                  min={today()}
                  onChange={(event) => setNeededBy(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Notes" hint="Optional">
              <TextArea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <Field label="Asked by" problem={tried ? problems.who : null}>
              <Input
                value={who}
                onChange={(event) => setAskedBy(event.target.value)}
                invalid={tried && problems.who !== null}
              />
            </Field>
          </div>
        </SheetBlock>
      </div>
    </RecordSheet>
  )
}
