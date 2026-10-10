import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { financeKeys, listExpenseCategories } from "@/lib/queries/finance"
import {
  claimsKeys,
  defineClaimType,
  listClaimTypes,
  retireClaimType,
  type ClaimTypeRow,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"

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

  const types = useQuery({
    queryKey: claimsKeys.types(),
    queryFn: ({ signal }) => listClaimTypes(signal),
  })
  const kinds = types.data ?? []
  const open = kinds.find((one) => one.code === openCode) ?? null

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

      <Card className="overflow-hidden px-4 py-2">
        {queryState(types, {
          loading: "Reading the claim types…",
          render: () =>
            kinds.length === 0 ? (
              <EmptyState>
                No kinds of expense are defined, so nothing can be filed. Use
                New type to add the first.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Code",
                  "Name",
                  { label: "Added", align: "left" },
                  { label: "State", align: "left" },
                ]}
              >
                {kinds.map((kind) => (
                  <MiniRow key={kind.code}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => setOpenCode(kind.code)}
                        className="text-left font-mono text-id text-body hover:underline"
                      >
                        {kind.code}
                      </button>
                    </MiniCell>
                    <MiniCell>
                      <span className="text-ink">{kind.name}</span>
                    </MiniCell>
                    <MiniCell>{day(kind.created_at)}</MiniCell>
                    <MiniCell>
                      {kind.retired_at !== null ? (
                        <Pill tone="neutral">
                          Cancelled {day(kind.retired_at)}
                        </Pill>
                      ) : (
                        <Pill tone="ok">In use</Pill>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      {creating && <NewTypeSheet onClose={() => setCreating(false)} />}
      {open !== null && (
        <TypeSheet
          kind={open}
          canWrite={canWrite}
          onClose={() => setOpenCode(null)}
        />
      )}
    </PageContent>
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
          <Button variant="quiet" onClick={onClose}>
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
          <p className="text-[0.875rem] text-body">
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
