import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState, Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { financeKeys, listExpenseCategories } from "@/lib/queries/finance"
import {
  claimsKeys,
  defineClaimType,
  retireClaimType,
  type ClaimTypeRow,
  claimTypesQuery,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { CardFoot, CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"

const columns: ColumnDef<TableSetup, ClaimTypeRow>[] = [
  {
    accessorKey: "code",
    header: "Code",
    size: 200,
    meta: { mono: true, card: "hide" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 320,
    meta: { card: "hide" },
    cell: ({ row }) => <span className="text-ink">{row.original.name}</span>,
  },
  {
    id: "added",
    accessorFn: (row) => row.created_at,
    header: "Added",
    size: 160,
    meta: { card: "hide" },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    id: "state",
    accessorFn: (row) => row.retired_at ?? "",
    header: "State",
    size: 220,
    meta: { card: "hide" },
    cell: ({ row }) =>
      row.original.retired_at !== null ? (
        <Pill tone="neutral">Cancelled {day(row.original.retired_at)}</Pill>
      ) : (
        <Pill tone="ok">In use</Pill>
      ),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the name
  // over its code, when it was added, and where it stands.
  {
    id: "head",
    accessorFn: (row) => row.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName name={row.original.name} code={row.original.code} />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.created_at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot>Added {day(row.original.created_at)}</CardFoot>
    ),
  },
  {
    id: "tag",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) =>
      row.original.retired_at !== null ? (
        <Pill tone="neutral">Cancelled {day(row.original.retired_at)}</Pill>
      ) : (
        <Pill tone="ok">In use</Pill>
      ),
  },
]

/// Claims & loans › Claim types — the kinds of expense a claim may be filed
/// against. Head office names them; a place picks from them.
///
/// # No edit and no delete
///
/// The leave-types rule again: redefining a kind would change what every
/// claim already filed against it meant, and deleting one would leave those
/// claims pointing at nothing. A kind that should no longer be used is one
/// nobody picks, which is what cancelling it says.
export function ClaimTypesPage() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const [creating, setCreating] = useState(false)
  const [openCode, setOpenCode] = useState<string | null>(null)

  return (
    <PageContent>
      {canWrite && <Fab label="New type" onClick={() => setCreating(true)} />}
      <PageHeader
        crumb="People"
        title="Claim Types"
        sub="The kinds of expense a claim may be filed against. Head office names them; a place picks from them."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New type
            </Button>
          )
        }
      />

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <Suspense
          fallback={<LoadingState>Reading the claim types…</LoadingState>}
        >
          <Kinds
            openCode={openCode}
            onOpen={setOpenCode}
            canWrite={canWrite}
            onClose={() => setOpenCode(null)}
          />
        </Suspense>
      </Card>

      {creating && <NewTypeSheet onClose={() => setCreating(false)} />}
    </PageContent>
  )
}

/// The kinds, as a table, and the sheet one opens. Here and not in the screen
/// so the head paints at once and this waits alone for its answer.
function Kinds({
  openCode,
  onOpen,
  onClose,
  canWrite,
}: {
  openCode: string | null
  onOpen: (code: string) => void
  onClose: () => void
  canWrite: boolean
}) {
  const types = useSuspenseQuery(claimTypesQuery())
  const phone = useLayout() === "phone"
  const kinds = types.data
  const open = kinds.find((one) => one.code === openCode) ?? null
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: kinds,
        columns,
        getRowId: (row: ClaimTypeRow) => row.code,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, foot: phone, tag: phone } },
      }),
      [kinds, phone]
    )
  )
  return (
    <>
      {kinds.length === 0 ? (
        <EmptyState>
          No kinds of expense are defined, so nothing can be filed. Use New type
          to add the first.
        </EmptyState>
      ) : (
        <DataTable<ClaimTypeRow>
          refresh={[types]}
          table={table}
          onRowClick={(row) => onOpen(row.code)}
          isSelected={(row) => row.code === openCode}
          cardsApart
          cardLead
          cardSort={false}
        />
      )}
      {open !== null && (
        <TypeSheet kind={open} canWrite={canWrite} onClose={onClose} />
      )}
    </>
  )
}

/// Defining a kind: a code that never changes, a name, and the Finance
/// expense category its cost lands under.
function NewTypeSheet({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  // Finance's expense categories open to claims. A kind is filed under one,
  // and its account links decide where the cost lands and what is owed.
  const categories = useQuery({
    queryKey: financeKeys.expenseCategories(),
    queryFn: ({ signal }) => listExpenseCategories(signal),
    staleTime: 5 * 60 * 1000,
  })
  const claimCategories = (categories.data ?? []).filter(
    (one) => one.for_claims && one.is_active
  )

  const define = useMutation({
    mutationFn: () => defineClaimType(code.trim(), name.trim(), category),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: claimsKeys.types() })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New claim type"
      footer={
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={define.isPending}
            disabled={
              code.trim() === "" || name.trim() === "" || category === ""
            }
            onClick={() => define.mutate()}
          >
            Define it
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Field label="Code" hint="Upper-cased, and never changes." required>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label="Expense category"
          required
          hint={
            categories.isSuccess && claimCategories.length === 0
              ? "Finance has no expense category open to claims yet — one is needed before a kind can be defined."
              : "Finance's category: it decides which account the cost lands on."
          }
        >
          <Select value={category} onChange={setCategory}>
            <option value="">
              {categories.isPending ? "Loading…" : "Choose…"}
            </option>
            {claimCategories.map((one) => (
              <option key={one.code} value={one.code}>
                {one.name} ({one.code})
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  )
}

/// One kind, and the one thing that can be done to it: cancel it.
function TypeSheet({
  kind,
  canWrite,
  onClose,
}: {
  kind: ClaimTypeRow
  canWrite: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [why, setWhy] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const retire = useMutation({
    mutationFn: () => retireClaimType(kind.code, why.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: claimsKeys.types() })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const live = kind.retired_at === null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={kind.code}
      title={kind.name}
    >
      <Pill tone={live ? "ok" : "neutral"}>
        {live ? "In use" : `Cancelled ${day(kind.retired_at ?? "")}`}
      </Pill>
      <Facts className="mt-3">
        <Fact term="Code">{kind.code}</Fact>
        <Fact term="Added">{day(kind.created_at)}</Fact>
      </Facts>

      {live && canWrite ? (
        <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-4">
          <SubHead>Cancel this kind</SubHead>
          <p className="text-[0.9375rem] text-body">
            Claims already filed keep naming it; nobody can pick it for a new
            claim.
          </p>
          {failed !== null && <Banner tone="bad">{failed}</Banner>}
          <Field
            label="Why"
            hint="Recorded against the cancellation, and required."
            required
          >
            <Input
              value={why}
              onChange={(event) => setWhy(event.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="danger"
              pending={retire.isPending}
              disabled={why.trim() === ""}
              onClick={() => retire.mutate()}
            >
              Cancel it
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}
