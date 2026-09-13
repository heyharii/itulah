import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ListFilter, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { financeKeys, listAssets, registerAsset } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import type { AssetRow } from "@itulah/contract"

/// Assets — the things the company owns, as the people who look after them
/// know them.
///
/// # Why GA has its own door onto the same register
///
/// Because the register answers two different questions and they belong to two
/// different people. Finance asks what an asset is WORTH: the cost, the method,
/// the monthly charge, what is left of it. GA asks where the thing IS: which
/// shop, what serial number is on the plate, is it still working, when was it
/// last serviced.
///
/// The tables were built this way from the start — `fixed_asset` carries no
/// monetary column at all and `asset_capitalization` carries the money — so
/// this screen is not a copy of Finance's. It is the half that was never given
/// a door. See migration 0070, and 0212 for the same argument about vendors.
///
/// # There is not one rupiah on this screen, on purpose
///
/// That is what makes it usable by the people who actually hold the things: a
/// shop manager can be asked to walk the floor and check the register without
/// being shown what the company carries its building at.
///
/// # What the client's own register could never answer
///
/// Their `MASTER ASSET` has 1,342 rows and names them "HANGER", "KOMPUTER",
/// "INTERIOR" — one row is a COST, not a thing. It has a `DEPARTEMEN` column
/// filled with "-" on all 1,342. So nothing anywhere says which air
/// conditioner is in which shop, or who holds which laptop. That is what this
/// screen exists to start recording — from the next purchase forward, because
/// it cannot be back-filled from a schedule of costs.
export function Assets() {
  const open = useSheet("asset")
  const [book, setBook] = useState<
    "ALL" | "CAPITALIZE" | "IN_PROGRESS" | "UNASSESSED"
  >("ALL")
  const [site, setSite] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)

  const scope = useMemo(
    () => ({
      q: search.trim() === "" ? undefined : search.trim(),
      // Asked as a DECISION rather than as the asset's status, because the
      // decision is the half of the register that is actually maintained:
      // nothing in this system has ever written `IN_SERVICE` onto an asset,
      // and a tab filtering on a status nobody sets is a tab that is always
      // empty. What Finance decided is written on every assessment.
      decision: book === "ALL" ? undefined : book,
      site: site ?? undefined,
      limit: 200,
    }),
    [search, book, site]
  )

  const register = useQuery({
    queryKey: ["ga", "assets", book, site, search],
    queryFn: ({ signal }) => listAssets(scope, signal),
  })

  const sites = register.data?.facets.sites ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Assets"
        sub="What the company owns and where it is. What it is worth is Finance's screen."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Number, name or serial"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Register one
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented
          options={[
            { value: "ALL" as const, label: "All" },
            { value: "CAPITALIZE" as const, label: "In service" },
            // The client's Contract In Progress: a cost being spent on
            // something not built yet. Half their register by count, and not a
            // thing anybody can go and look at — so it is a tab rather than
            // rows mixed in with the air conditioners.
            { value: "IN_PROGRESS" as const, label: "Being built" },
            // The open control gap, and the one tab GA can act on: a thing
            // that arrived and that Finance has not yet decided anything
            // about.
            { value: "UNASSESSED" as const, label: "Not assessed" },
          ]}
          value={book}
          onChange={setBook}
        />
        <ChoiceMenu
          heading="Where"
          icon={ListFilter}
          value={site}
          options={[
            { value: null, label: "Everywhere" },
            ...sites.map((one) => ({
              value: one.value,
              label: one.label ?? one.value,
            })),
          ]}
          onChange={setSite}
        />
        <Toolbar.Spacer />
        {register.data !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(register.data.total)}</b>{" "}
            {register.data.total === 1 ? "asset" : "assets"}
          </span>
        )}
      </Toolbar>

      {queryState(register, {
        loading: "Opening the register…",
        render: (page) =>
          page.rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Register the first one
                  </Button>
                }
              >
                Nothing is on the register here yet. An asset is registered when
                it arrives — the air conditioner, the laptop, the motorcycle —
                and Finance decides afterwards what it is worth.
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="grid h-10 grid-cols-[8rem_minmax(0,1fr)_10rem_7rem_8rem_6rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
                <span>Number</span>
                <span>Asset</span>
                <span>Kind</span>
                <span>Where</span>
                <span>Serial</span>
                <span>Since</span>
              </div>
              {page.rows.map((row) => (
                <AssetLine
                  key={row.asset_id}
                  asset={row}
                  onOpen={() => open.open(row.asset_id)}
                />
              ))}
            </Card>
          ),
      })}

      <RegisterSheet open={adding} onClose={() => setAdding(false)} />
    </PageContent>
  )
}

function AssetLine({ asset, onOpen }: { asset: AssetRow; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="grid cursor-pointer grid-cols-[8rem_minmax(0,1fr)_10rem_7rem_8rem_6rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <span className="truncate font-mono text-id text-body">
        {asset.asset_number}
      </span>
      <div className="min-w-0">
        <div className="truncate text-cell font-medium text-ink">
          {asset.name}
          {asset.quantity > 1 && (
            <span className="ml-1.5 text-pill text-mute">
              ×{count(asset.quantity)}
            </span>
          )}
        </div>
        {/* Not assessed is not a problem GA can fix, but it IS something GA
            should be able to see: it means Finance has not decided what this
            thing is worth, and nothing is being charged for it. */}
        {asset.decision === null && (
          <div className="mt-0.5 text-pill text-warn-fg">
            Finance has not assessed this yet
          </div>
        )}
      </div>
      <span className="truncate text-meta text-body">
        {asset.category_name}
      </span>
      <span className="truncate text-meta text-body">{asset.site_id}</span>
      <span
        className={cn(
          "truncate font-mono text-id",
          asset.serial_number === null ? "text-mute italic" : "text-body"
        )}
      >
        {asset.serial_number ?? "none"}
      </span>
      <span className="text-pill text-mute tabular-nums">
        {day(asset.acquired_on)}
      </span>
    </div>
  )
}

/// Registering one. Identity only — no money, because none is known yet and
/// because it is not this screen's business.
function RegisterSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  // The kinds and the places, read off the register itself rather than from a
  // list of our own: the categories ARE the client's account families, and the
  // sites are the ones that already hold something.
  const shape = useQuery({
    queryKey: financeKeys.assets(false, null),
    queryFn: ({ signal }) => listAssets({ limit: 1 }, signal),
    enabled: open,
  })

  const save = useMutation({
    mutationFn: () =>
      registerAsset({
        asset_number: form.asset_number?.trim() ?? "",
        name: form.name?.trim() ?? "",
        category_code: form.category_code ?? "",
        site_id: form.site_id ?? "",
        acquired_on: form.acquired_on ?? "",
        serial_number: blank(form.serial_number),
        // Brand and model go in the note, because that is where the register
        // has room for them: `fixed_asset` has the columns, and registration
        // does not take them yet. One line of prose beats a field nobody can
        // send.
        notes: blank(
          [form.brand, form.model, form.notes]
            .map((one) => (one ?? "").trim())
            .filter((one) => one !== "")
            .join(" · ")
        ),
        quantity: form.quantity === undefined ? 1 : Number(form.quantity),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ga", "assets"] })
      setForm({})
      onClose()
    },
  })

  const ready =
    (form.asset_number ?? "").trim() !== "" &&
    (form.name ?? "").trim() !== "" &&
    (form.category_code ?? "") !== "" &&
    (form.site_id ?? "") !== "" &&
    (form.acquired_on ?? "") !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Register an asset"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            Finance decides what it is worth, afterwards.
          </span>
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Registering…" : "Register"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Number" hint="The label that goes on the thing.">
            <Input
              value={form.asset_number ?? ""}
              onChange={(event) => set("asset_number", event.target.value)}
              placeholder="AST-000124"
            />
          </Field>
          <Field label="Acquired on">
            <Input
              type="date"
              value={form.acquired_on ?? ""}
              onChange={(event) => set("acquired_on", event.target.value)}
            />
          </Field>
        </div>

        <Field label="What it is">
          <Input
            value={form.name ?? ""}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Air conditioner 1.5 PK, kasir"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Kind"
            hint="The client's own account family — there is no second list."
          >
            <Select
              value={form.category_code ?? ""}
              onChange={(next) => set("category_code", next)}
              aria-label="Kind"
            >
              <option value="">Choose…</option>
              {(shape.data?.facets.categories ?? []).map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label ?? one.value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Where">
            <Select
              value={form.site_id ?? ""}
              onChange={(next) => set("site_id", next)}
              aria-label="Where"
            >
              <option value="">Choose…</option>
              {(shape.data?.facets.sites ?? []).map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label ?? one.value}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Brand">
            <Input
              value={form.brand ?? ""}
              onChange={(event) => set("brand", event.target.value)}
            />
          </Field>
          <Field label="Model">
            <Input
              value={form.model ?? ""}
              onChange={(event) => set("model", event.target.value)}
            />
          </Field>
          <Field
            label="Serial"
            hint="What is on the plate. The one thing that identifies this unit and not its twin."
          >
            <Input
              value={form.serial_number ?? ""}
              onChange={(event) => set("serial_number", event.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes">
          <Input
            value={form.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}
