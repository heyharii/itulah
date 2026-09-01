import { useEffect, useMemo, useState } from "react"
import { getRouteApi } from "@tanstack/react-router"
import { z } from "zod"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import {
  ProductGrid,
  ProductTable,
  STATUS_META,
  StagedGroupHeader,
  StatusDot,
  SupplierCell,
  Tag,
  money,
  productMoney,
  supplierOf,
  updatedLabel,
} from "@/components/sourcing/product-views"
import {
  useAddShortlistEntry,
  useClearShortlist,
  useCreateSourcingItem,
  useRemoveShortlistEntry,
  type SourcingDivision,
  type SourcingItemWriteInput,
  type SourcingTag,
  useSourcingItems,
  useSourcingReference,
  useSourcingShortlist,
} from "@/components/sourcing/api"
import { sourcingListQuery } from "@/components/sourcing/queries"
import type { Product, Supplier } from "@/components/sourcing/catalogue"
import { getErrorMessage } from "@/lib/api"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"
import { cn } from "@/lib/utils"
import type { SourcingSearch } from "@/routes/sourcing"

import { FieldShell, useAppForm, useSheetForm } from "@/shared/form"

type SortKey = SourcingSearch["sort"]

const TAG_HUE: Record<string, string> = {
  womenswear: "#ff58ae",
  menswear: "#0086fc",
  sport: "#00c978",
  divided: "#7b5cfa",
  kidswear: "#ffbb26",
  solid: "#7e7e7d",
  patterned: "#7b5cfa",
  "multi-colour": "#64c6ff",
  "entry-price": "#00c978",
  premium: "#ff3e00",
}

const route = getRouteApi("/sourcing")

/** What the hub accepts for a sourcing candidate — a supplier quote, not a
 *  product SKU, PO, or inventory movement. Built as a schema factory because
 *  one rule (unit cost needs a currency) depends on the loaded catalogue
 *  rather than on another field in the draft. */
function sourcingItemInput(hasCurrency: boolean) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, "Name, supplier, and division are required."),
      supplierId: z
        .string()
        .min(1, "Name, supplier, and division are required."),
      divisionId: z
        .string()
        .min(1, "Name, supplier, and division are required."),
      supplierProductCode: z.string(),
      color: z.string(),
      description: z.string(),
      unitCost: z.string(),
      moq: z
        .number()
        .int("MOQ must be a whole number of at least 1.")
        .min(1, "MOQ must be a whole number of at least 1.")
        .optional(),
      leadTimeDays: z
        .number()
        .int("Lead time must be a whole number of at least 0.")
        .min(0, "Lead time must be a whole number of at least 0.")
        .optional(),
      mediaUrl: z
        .string()
        .trim()
        .min(
          1,
          "Add a reference photo URL; procurement requires evidence on every PO line."
        ),
      tagIds: z
        .array(z.string())
        .min(
          1,
          "Choose at least one active master tag; procurement requires line classification."
        ),
    })
    .superRefine((value, ctx) => {
      if (value.unitCost.trim() && !hasCurrency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unitCost"],
          message: "Internal has not supplied a currency for this quote yet.",
        })
      }
    })
}

type SourceDraft = z.infer<ReturnType<typeof sourcingItemInput>>

const emptySourceDraft = (): SourceDraft => ({
  name: "",
  supplierId: "",
  divisionId: "",
  supplierProductCode: "",
  color: "",
  description: "",
  unitCost: "",
  moq: undefined,
  leadTimeDays: undefined,
  mediaUrl: "",
  tagIds: [],
})

/**
 * The "Add supplier candidate" sheet. Create-only, and never fetches a row —
 * every opening starts from a blank draft — so resetting via TanStack's own
 * `form.reset` inside an effect (mirroring the original hand-rolled reset)
 * never has an async gap to flash a stale value across, and it keeps
 * `SheetShell` mounted continuously so its open/close slide keeps animating.
 */
function SourceSheet({
  open,
  onClose,
  suppliers,
  divisions,
  tags,
  currency,
  onCreate,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  suppliers: Supplier[]
  divisions: SourcingDivision[]
  tags: SourcingTag[]
  currency: string | undefined
  onCreate: (input: SourcingItemWriteInput) => Promise<unknown>
  onCreated: () => void
}) {
  const { busy, error, run } = useSheetForm(() => {
    onCreated()
    onClose()
  })

  const hasCurrency = Boolean(currency)
  const schema = useMemo(() => sourcingItemInput(hasCurrency), [hasCurrency])

  const form = useAppForm({
    defaultValues: emptySourceDraft(),
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const input: SourcingItemWriteInput = {
        supplier_id: value.supplierId,
        division_id: value.divisionId,
        name: value.name.trim(),
        ...(value.supplierProductCode.trim()
          ? { supplier_product_code: value.supplierProductCode.trim() }
          : {}),
        ...(value.color.trim() ? { color: value.color.trim() } : {}),
        ...(value.description.trim()
          ? { description: value.description.trim() }
          : {}),
        // Unit cost is a supplier quote. Use the currency already returned by
        // Internal when one exists; the PO later snapshots it from the item.
        ...(currency ? { currency } : {}),
        ...(value.unitCost.trim() ? { unit_cost: value.unitCost.trim() } : {}),
        ...(value.moq !== undefined ? { moq: value.moq } : {}),
        ...(value.leadTimeDays !== undefined
          ? { lead_time_days: value.leadTimeDays }
          : {}),
        tag_ids: value.tagIds,
        ...(value.mediaUrl.trim() ? { media_url: value.mediaUrl.trim() } : {}),
        status: "active",
      }
      await run(() => onCreate(input))
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      ...emptySourceDraft(),
      supplierId: suppliers[0]?.id ?? "",
      divisionId: divisions[0]?.id ?? "",
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <SheetShell
      open={open}
      eyebrow="Sourcing item"
      title="Add supplier candidate"
      onRequestClose={() => {
        if (!busy) onClose()
      }}
      footer={
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={sheetButton.secondary}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void form.handleSubmit()}
            disabled={busy}
            className={cn(
              sheetButton.primary,
              busy && "pointer-events-none opacity-60"
            )}
          >
            {busy ? "Saving…" : "Save candidate"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-4 px-[18px] pt-4 pb-5"
      >
        <form.FormError message={error} />

        <p className="text-[11.5px] leading-[1.5] text-ink-3">
          A sourcing item is a supplier quote/candidate. It does not create a
          product SKU, PO, or inventory movement.
        </p>

        <form.AppField name="name">
          {(field) => (
            <field.TextField
              label="Candidate name"
              required
              placeholder="e.g. Linen overshirt"
            />
          )}
        </form.AppField>

        <div className="grid grid-cols-2 gap-2.5">
          <form.AppField name="supplierId">
            {(field) => (
              <field.SelectField
                label="Supplier"
                required
                placeholder="Choose supplier…"
                options={suppliers.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            )}
          </form.AppField>
          <form.AppField name="divisionId">
            {(field) => (
              <field.SelectField
                label="Division"
                required
                placeholder="Choose division…"
                options={divisions.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            )}
          </form.AppField>
        </div>

        <form.AppField name="supplierProductCode">
          {(field) => (
            <field.TextField
              label="Supplier product code"
              placeholder="Optional supplier reference"
            />
          )}
        </form.AppField>

        <div className="grid grid-cols-3 gap-2.5">
          {/* Unit cost is a decimal string the hub accepts as-is (a supplier
           * quote in its own currency), not the integer-minor-units contract
           * `MoneyField` speaks — see the conversion report's gap note. */}
          <form.AppField name="unitCost">
            {(field) => (
              <field.TextField label="Unit cost (IDR)" placeholder="0" />
            )}
          </form.AppField>
          <form.AppField name="moq">
            {(field) => (
              <field.NumberField label="MOQ" min={1} placeholder="1" />
            )}
          </form.AppField>
          <form.AppField name="leadTimeDays">
            {(field) => (
              <field.NumberField
                label="Lead time (days)"
                min={0}
                placeholder="0"
              />
            )}
          </form.AppField>
        </div>

        <form.AppField name="color">
          {(field) => (
            <field.TextField
              label="Color / note"
              placeholder="Optional color or material"
            />
          )}
        </form.AppField>

        <form.AppField name="description">
          {(field) => (
            <field.TextAreaField
              label="Description"
              placeholder="What the buyer should remember about this candidate"
            />
          )}
        </form.AppField>

        <form.AppField name="mediaUrl">
          {(field) => (
            <field.TextField
              label="Reference photo URL"
              required
              placeholder="https://…"
            />
          )}
        </form.AppField>

        <form.AppField name="tagIds">
          {(field) => {
            const errors = field.state.meta.isTouched
              ? field.state.meta.errors
                  .map((error) =>
                    typeof error === "string"
                      ? error
                      : error && typeof error === "object" && "message" in error
                        ? String((error as { message: unknown }).message)
                        : null
                  )
                  .filter((message): message is string => Boolean(message))
              : []
            return (
              <FieldShell label="Master tags" required errors={errors}>
                <select
                  multiple
                  value={field.state.value}
                  onChange={(event) =>
                    field.handleChange(
                      Array.from(
                        event.target.selectedOptions,
                        (option) => option.value
                      )
                    )
                  }
                  onBlur={field.handleBlur}
                  className="min-h-[72px] w-full rounded-control bg-field px-2 py-1.5 text-[12px] font-normal text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                >
                  {tags.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {!tags.length && (
                  <span className="mt-1 block text-[11px] text-ember">
                    No active master tags are available.
                  </span>
                )}
              </FieldShell>
            )
          }}
        </form.AppField>
      </form>
    </SheetShell>
  )
}

export function Sourcing() {
  const search = route.useSearch()
  const {
    staged,
    division,
    supplier,
    tag,
    layout,
    sort,
    dir,
    detail: detailId,
  } = search
  const query = route.useSearch({ select: (search) => search.q ?? "" })
  const navigate = route.useNavigate()

  /* Scope, sort and layout are filter changes: they replace rather than stack,
   * so Back leaves the app instead of walking every keystroke. */
  const setScope = (patch: Partial<SourcingSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  /* Each id filter is a set. Toggling the last value off drops the param
   * rather than leaving an empty array behind, so a cleared filter produces
   * the same bare URL — and the same cache key — as never having set it. */
  const toggleId = (
    current: string[] | undefined,
    value: string
  ): string[] | undefined => {
    const list = current ?? []
    const next = list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value]
    return next.length > 0 ? next : undefined
  }

  /* Opening a style, or handing a selection to the PO app, is a real
   * destination and keeps the default pushed navigation. */
  const openDetail = (id: string | null) =>
    void navigate({ search: (prev) => ({ ...prev, detail: id ?? undefined }) })

  /* Handing a selection to Buying is a real destination, so it pushes. The
   * ids travel in the URL; Buying opens its draft composer on arrival. */
  const draftPo = (productIds: string[]) =>
    void navigate({
      to: "/buying",
      search: { section: "orders", expanded: ["orders"], draftFor: productIds },
    })

  /* The request, not a post-fetch narrowing: `q`, the three id filters and the
   * sort all travel to /v1/sourcing, which parses them through
   * `_lib/listparams`. The screen receives the rows it is going to show. */
  const listQuery = useMemo(() => sourcingListQuery(search), [search])
  const itemsResource = useSourcingItems(listQuery)
  const referenceResource = useSourcingReference()
  const shortlistResource = useSourcingShortlist()
  const reference = referenceResource.data
  const productsFromApi = useMemo(
    () => itemsResource.data?.products ?? [],
    [itemsResource.data?.products]
  )
  const suppliersFromApi = useMemo(
    () => reference?.suppliers ?? [],
    [reference?.suppliers]
  )
  const shortlistEntries = useMemo(
    () => shortlistResource.data?.entries ?? [],
    [shortlistResource.data?.entries]
  )
  const shortlistIds = useMemo(
    () => new Set(shortlistEntries.map((entry) => entry.sourcingItemId)),
    [shortlistEntries]
  )
  const shortlistSupported = shortlistResource.data?.supported ?? false
  const [shortlistBusyId, setShortlistBusyId] = useState<string | null>(null)
  const [shortlistActionError, setShortlistActionError] = useState<
    string | null
  >(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([])

  const isShortlisted = (id: string) => shortlistIds.has(id)

  /* The filter menus come from master data, never from the rows on screen.
   * Deriving them from the result would make the current filter hide its own
   * alternatives — pick one division and the other five vanish, with no way
   * back except clearing the scope. */
  const divisions = useMemo(
    () =>
      [...(reference?.divisions ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [reference?.divisions]
  )
  const allTags = useMemo(
    () =>
      [...(reference?.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [reference?.tags]
  )

  /* The URL holds the id; the sheet needs the row, so resolve it from the rows
   * we already loaded rather than parking a copy in state. */
  const detail = useMemo(
    () => productsFromApi.find((product) => product.id === detailId) ?? null,
    [detailId, productsFromApi]
  )
  const sortDir = dir === "desc" ? -1 : 1

  const addEntry = useAddShortlistEntry()
  const removeEntry = useRemoveShortlistEntry()
  const clearShortlist = useClearShortlist()
  const createItem = useCreateSourcingItem()

  useInteractionSounds(soundOn)

  const toast = (message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message }])
    cue("success")
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }

  /* `staged` is the one scope that cannot be a server filter: shortlist
   * membership lives in the sourcing-shortlist resource, not on the sourcing
   * item, so it is applied over the rows the server returned. Correct because
   * `fetchSourcingItems` fetches every page of the filtered result — it
   * narrows a complete set, not a first page.
   *
   * Everything else that used to live here — category, supplier, tag, search
   * and the sort — is now in the request. */
  const products = useMemo(
    () =>
      staged
        ? productsFromApi.filter((product) => shortlistIds.has(product.id))
        : productsFromApi,
    [staged, productsFromApi, shortlistIds]
  )

  const stats = useMemo(() => {
    const priced = products.filter((product) => product.price > 0)
    if (!priced.length) {
      return {
        avg: 0,
        lead: 0,
        suppliers: new Set(products.map((product) => product.supplierId)).size,
        currency:
          itemsResource.data?.currency ||
          products.find((product) => product.currency)?.currency ||
          "USD",
      }
    }
    return {
      avg: priced.reduce((sum, p) => sum + p.price, 0) / priced.length,
      lead: Math.round(
        products
          .filter((product) => product.leadTime > 0)
          .reduce((sum, p) => sum + p.leadTime, 0) /
          Math.max(1, products.filter((product) => product.leadTime > 0).length)
      ),
      suppliers: new Set(products.map((p) => p.supplierId)).size,
      currency:
        itemsResource.data?.currency ||
        products.find((product) => product.currency)?.currency ||
        "USD",
    }
  }, [itemsResource.data?.currency, products])

  /* A PO goes to exactly one supplier, so that is the unit the staged view is
   * read and acted on in. Groups follow the sort above: whichever supplier the
   * first style belongs to leads. */
  const stagedGroups = useMemo(() => {
    if (!staged) return []
    const groups = new Map<string, Product[]>()
    for (const product of products) {
      const existing = groups.get(product.supplierId)
      if (existing) existing.push(product)
      else groups.set(product.supplierId, [product])
    }
    return [...groups.entries()]
  }, [staged, products])

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s)
      const allOn = products.every((p) => next.has(p.id))
      products.forEach((p) => (allOn ? next.delete(p.id) : next.add(p.id)))
      return next
    })

  const toggleShortlist = async (id: string) => {
    if (!shortlistSupported) {
      toast(
        shortlistResource.data?.reason ??
          "Shortlist API tidak tersedia dari backend"
      )
      return
    }

    setShortlistActionError(null)
    setShortlistBusyId(id)
    try {
      if (isShortlisted(id)) {
        await removeEntry.execute(id)
        toast("Removed from shortlist")
      } else {
        const product = productsFromApi.find((item) => item.id === id)
        await addEntry.execute({
          sourcingItemId: id,
          colorwayId: product?.colorways[0]?.id,
        })
        toast("Added to shortlist")
        cue("tick")
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      setShortlistActionError(message)
      toast(`Shortlist update failed: ${message}`)
    } finally {
      setShortlistBusyId(null)
    }
  }

  const clearStaged = async () => {
    if (!shortlistSupported || clearBusy) return
    setShortlistActionError(null)
    setClearBusy(true)
    try {
      await clearShortlist.execute()
      toast("Staged styles cleared")
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      setShortlistActionError(message)
      toast(`Shortlist update failed: ${message}`)
    } finally {
      setClearBusy(false)
    }
  }

  const clearScope = () =>
    setScope({
      staged: false,
      division: undefined,
      supplier: undefined,
      tag: undefined,
      q: undefined,
    })

  const openSourceSheet = () => setSourceSheetOpen(true)

  const scopeCount =
    (division?.length ?? 0) + (supplier?.length ?? 0) + (tag?.length ?? 0)
  const scoped = scopeCount > 0 || Boolean(query.trim())

  /* Names the scope the way it was chosen. A single pick still reads as itself;
   * once a filter is a set, a count is the only label that stays true. */
  const scopeLabel = (() => {
    const parts: string[] = []
    if (division?.length === 1) {
      parts.push(
        divisions.find((d) => d.id === division[0])?.name ?? "1 division"
      )
    } else if (division?.length) parts.push(`${division.length} divisions`)
    if (supplier?.length === 1) {
      parts.push(
        supplierOf(supplier[0], suppliersFromApi)?.name ?? "1 supplier"
      )
    } else if (supplier?.length) parts.push(`${supplier.length} suppliers`)
    if (tag?.length === 1) {
      parts.push(`#${allTags.find((t) => t.id === tag[0])?.name ?? "tag"}`)
    } else if (tag?.length) parts.push(`${tag.length} tags`)
    if (query.trim()) parts.push(`"${query.trim()}"`)
    return parts.join(" · ") || "Search"
  })()

  const navRow =
    "group/nav flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  /* Grid and table take the same handles, and in the staged view each supplier
   * group takes them again — so they are named once. The star doubles as the
   * un-stage control there, which is why staged needs no remove of its own. */
  const viewProps = {
    suppliers: suppliersFromApi,
    selected,
    shortlisted: isShortlisted,
    shortlistEnabled: shortlistSupported,
    shortlistBusyId,
    onToggle: toggle,
    onToggleAll: toggleAll,
    onOpen: (product: Product) => openDetail(product.id),
    onShortlist: toggleShortlist,
  }

  const sortButton = (key: SortKey, label: string) => {
    const on = sort === key
    return (
      <button
        key={key}
        type="button"
        onClick={() =>
          setScope({ sort: key, dir: on && dir === "asc" ? "desc" : "asc" })
        }
        className={cn(
          "inline-flex h-[26px] items-center gap-1 rounded-control px-2 text-xs font-medium transition-colors duration-[120ms]",
          on
            ? "bg-accent-tint text-accent-ink"
            : "text-ink-3 hover:bg-hover hover:text-ink"
        )}
      >
        {label}
        {on && (
          <Icon
            path={paths.arrowUp}
            size={11}
            width={2.4}
            className={cn(sortDir === -1 && "rotate-180")}
          />
        )}
      </button>
    )
  }

  return (
    <AppShell
      label="Sourcing navigation"
      railWidth={240}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-page">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
            <AppHeading app="sourcing" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            <button
              type="button"
              data-sound="page"
              onClick={clearScope}
              className={cn(
                navRow,
                "relative text-ink-2 hover:bg-hover hover:text-ink",
                !scoped && !staged && "font-semibold text-ink",
                !scoped &&
                  !staged &&
                  "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
              )}
            >
              <Icon
                path={paths.grid}
                className={cn(
                  "shrink-0 text-ink-4",
                  !scoped && !staged && "text-ink-2"
                )}
              />
              {/* No count: the rows on screen are the *filtered* result, and
                  the whole-catalogue figure this used to show is not something
                  a scoped request can honestly report. The header carries the
                  count of what is actually being looked at. */}
              All products
            </button>

            {/* The shortlist, as a scope rather than an app: the same rows,
                narrowed to what has been starred. */}
            <button
              type="button"
              data-sound="page"
              onClick={() => setScope({ staged: !staged })}
              className={cn(
                navRow,
                "relative text-ink-2 hover:bg-hover hover:text-ink",
                staged && "font-semibold text-ink",
                staged &&
                  "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
              )}
            >
              <Icon
                path={paths.star}
                className={cn("shrink-0 text-ink-4", staged && "text-honey")}
              />
              Staged
              <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                {shortlistIds.size}
              </span>
            </button>

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Divisions
            </div>
            {divisions.map((d) => {
              const on = division?.includes(d.id) ?? false
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setScope({ division: toggleId(division, d.id) })
                  }
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    on && "bg-hover font-semibold text-ink"
                  )}
                >
                  <span className="truncate">{d.name}</span>
                  {on && (
                    <Icon
                      path={paths.check}
                      size={13}
                      width={2.4}
                      className="ml-auto shrink-0 text-accent"
                    />
                  )}
                </button>
              )
            })}

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Suppliers
            </div>
            {suppliersFromApi.map((s) => {
              const on = supplier?.includes(s.id) ?? false
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setScope({ supplier: toggleId(supplier, s.id) })
                  }
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-[110ms]",
                    "hover:bg-hover",
                    on && "bg-hover"
                  )}
                >
                  <span
                    style={{ background: s.hue }}
                    className="grid size-[20px] shrink-0 place-items-center rounded-chip text-[9px] font-semibold text-white uppercase"
                  >
                    {s.name[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-xs",
                        on ? "font-semibold text-ink" : "font-medium text-ink-2"
                      )}
                    >
                      {s.name}
                    </span>
                    <span className="block truncate text-[10.5px] text-ink-4">
                      {s.division}
                    </span>
                  </span>
                </button>
              )
            })}

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Tags
            </div>
            <div className="flex flex-wrap gap-1 px-1 pt-0.5">
              {allTags.map((t) => {
                const on = tag?.includes(t.id) ?? false
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setScope({ tag: toggleId(tag, t.id) })}
                    style={
                      {
                        "--tag": TAG_HUE[t.name.toLowerCase()],
                      } as React.CSSProperties
                    }
                    className={cn(
                      "inline-flex h-[23px] items-center rounded-[7px] border px-[7px] text-[11.5px] font-medium transition-colors duration-[130ms]",
                      on
                        ? "border-[color-mix(in_srgb,var(--tag)_40%,var(--surface))] bg-[color-mix(in_srgb,var(--tag)_16%,var(--surface))] text-[color-mix(in_srgb,var(--tag)_62%,var(--ink))]"
                        : "border-line-strong bg-surface text-ink-3 hover:border-ink-4 hover:text-ink-2"
                    )}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </nav>

          <div className="shrink-0 p-2">
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
            >
              <Icon path={paths.sound} className="shrink-0 text-ink-4" />
              Interaction sounds
              <Switch on={soundOn} />
            </button>
          </div>
        </aside>
      </AppShellSidebar>

      <main
        className={cn(
          /* `max-lg:pl-2` unconditionally below the breakpoint: with the rail
           * in a drawer there is no sidebar column to sit flush against. */
          "flex min-h-0 min-w-0 flex-col overflow-hidden py-2 pr-2 max-lg:pl-2",
          railHidden && "pl-2"
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 pr-2.5 pl-3.5">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <h1 className="text-sm font-semibold tracking-[-0.01em]">
                {staged ? "Staged" : "Sourcing"}
              </h1>
              <span className="font-mono text-[11.5px] text-ink-4">
                {products.length} style{products.length === 1 ? "" : "s"}
                {staged &&
                  ` \u00b7 ${stagedGroups.length} supplier${stagedGroups.length === 1 ? "" : "s"}`}
              </span>
            </div>

            <div className="flex items-center gap-[7px]">
              <label className="inline-flex h-[30px] items-center gap-[7px] rounded-control bg-field px-[9px] text-ink-4 shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] duration-[130ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
                <Icon path={paths.search} size={14} width={1.9} />
                <input
                  value={query}
                  onChange={(e) => setScope({ q: e.target.value || undefined })}
                  placeholder="Style, SKU, supplier…"
                  aria-label="Search products"
                  className="w-[158px] text-xs font-medium placeholder:text-ink-4"
                />
              </label>

              <div className="flex items-center gap-0.5 rounded-control bg-inset p-0.5">
                {(
                  [
                    ["grid", paths.grid, "Grid view"],
                    ["table", paths.list, "Table view"],
                  ] as const
                ).map(([id, icon, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={label}
                    aria-pressed={layout === id}
                    onClick={() => setScope({ layout: id })}
                    className={cn(
                      "grid size-[26px] place-items-center rounded-[7px] transition-[background-color,color,box-shadow] duration-[130ms]",
                      layout === id
                        ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_rgb(18_18_18/.05)]"
                        : "text-ink-4 hover:text-ink-2"
                    )}
                  >
                    <Icon path={icon} size={14} width={1.9} />
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => toast(`Exported ${products.length} styles`)}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover"
              >
                <Icon path={paths.download} size={14} width={1.9} />
                Export
              </button>
              <button
                type="button"
                onClick={openSourceSheet}
                disabled={
                  !suppliersFromApi.length || !divisions.length
                }
                title={
                  !suppliersFromApi.length || !divisions.length
                    ? "Load supplier and division master data first"
                    : "Add a supplier-product candidate"
                }
                className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                New source
              </button>
              <button
                type="button"
                aria-pressed={staged}
                onClick={() => setScope({ staged: !staged })}
                className={cn(
                  "inline-flex h-[30px] items-center gap-1.5 rounded-control px-2.5 text-xs font-medium transition-colors duration-[120ms]",
                  staged
                    ? "bg-accent-tint text-accent-ink"
                    : "bg-surface text-ink shadow-btn hover:bg-hover"
                )}
              >
                <Icon
                  path={paths.star}
                  size={14}
                  width={1.9}
                  className={cn(
                    shortlistEntries.length > 0 && !staged && "text-honey"
                  )}
                />
                Staged
                {shortlistEntries.length > 0 && (
                  <span className="font-mono tabular-nums">
                    {shortlistEntries.length}
                  </span>
                )}
              </button>
              {staged && shortlistEntries.length > 0 && shortlistSupported && (
                <button
                  type="button"
                  disabled={clearBusy}
                  onClick={() => void clearStaged()}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-control px-2.5 text-xs font-medium text-ink-3 transition-colors duration-[120ms] hover:bg-hover hover:text-ink disabled:opacity-50"
                >
                  {clearBusy ? "Clearing\u2026" : "Clear"}
                </button>
              )}
              <button
                type="button"
                onClick={() => draftPo([])}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] duration-[120ms] hover:brightness-105"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                New PO
              </button>
            </div>
          </div>

          {itemsResource.data?.source === "product_families_compatibility" && (
            <div className="flex shrink-0 items-start gap-2 border-b border-honey/20 bg-honey/5 px-3.5 py-2 text-[11px] leading-[1.45] text-ink-3">
              <Icon
                path={paths.alert}
                size={14}
                width={1.8}
                className="mt-px shrink-0 text-honey"
              />
              <span>
                Compatibility view: these rows come from Internal product
                families. Supplier quotes, MOQ, and lead time will appear when
                the relational sourcing-item contract is enabled.
              </span>
            </div>
          )}

          {/* scope + aggregates */}
          <div className="flex h-10 shrink-0 items-center gap-1 border-t border-b border-t-line border-b-line-strong pr-3.5 pl-3">
            <span className="pr-1 pl-0.5 text-[11px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              Sort
            </span>
            {sortButton("updated", "Updated")}
            {sortButton("price", "Price")}
            {sortButton("lead", "Lead time")}
            {sortButton("name", "Name")}

            {scoped && (
              <button
                type="button"
                onClick={clearScope}
                className="ml-2 inline-flex h-[26px] items-center gap-1.5 rounded-control bg-accent-tint px-2 text-xs font-medium text-accent-ink transition-[filter] hover:brightness-[0.97]"
              >
                {scopeLabel}
                <Icon path={paths.close} size={11} width={2.4} />
              </button>
            )}

            <span className="ml-auto flex items-center gap-4 font-mono text-[11px] text-ink-4">
              <span>
                avg{" "}
                <span className="text-ink-2">
                  {money(stats.avg, stats.currency)}
                </span>
              </span>
              <span>
                lead{" "}
                <span className="text-ink-2">
                  {stats.lead > 0 ? `${stats.lead}d` : "—"}
                </span>
              </span>
              <span>
                <span className="text-ink-2">{stats.suppliers}</span> suppliers
              </span>
            </span>
          </div>

          {(shortlistActionError ||
            shortlistResource.errorMessage ||
            (shortlistResource.data && !shortlistSupported)) && (
            <div
              className={cn(
                "border-b px-3.5 py-2 text-[11.5px]",
                shortlistActionError || shortlistResource.errorMessage
                  ? "border-ember/20 bg-ember/5 text-ember"
                  : "border-honey/20 bg-honey/5 text-ink-3"
              )}
            >
              {shortlistActionError ??
                shortlistResource.errorMessage ??
                shortlistResource.data?.reason}
            </div>
          )}

          <div className="min-h-0 flex-1 [scrollbar-color:var(--line-strong)_transparent] overflow-auto">
            {itemsResource.isLoading ? (
              <div className="flex h-[240px] items-center justify-center text-xs text-ink-4">
                Loading catalogue…
              </div>
            ) : itemsResource.errorMessage ? (
              <div className="flex h-[240px] flex-col items-center justify-center gap-3 text-center">
                <span className="text-xs text-ember">
                  Unable to load catalogue: {itemsResource.errorMessage}
                </span>
                <button
                  type="button"
                  onClick={itemsResource.reload}
                  className="inline-flex h-[28px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn hover:bg-hover"
                >
                  Retry
                </button>
              </div>
            ) : products.length === 0 ? (
              <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-ink-4">
                <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
                  <Icon
                    path={staged ? paths.star : paths.search}
                    size={17}
                    width={1.8}
                  />
                </span>
                <span className="text-xs">
                  {!staged
                    ? "No styles match this scope."
                    : !shortlistSupported
                      ? "Shortlist is unavailable from the configured backend."
                      : shortlistIds.size === 0
                        ? "Nothing staged yet. Star a style to stage it for ordering."
                        : "Nothing staged matches this scope."}
                </span>
              </div>
            ) : staged ? (
              stagedGroups.map(([supplierId, items]) => (
                <section
                  key={supplierId}
                  className="border-b border-line last:border-b-0"
                >
                  <StagedGroupHeader
                    supplierId={supplierId}
                    supplier={supplierOf(supplierId, suppliersFromApi)}
                    products={items}
                    onDraft={() => draftPo(items.map((item) => item.id))}
                  />
                  {layout === "grid" ? (
                    <ProductGrid products={items} {...viewProps} />
                  ) : (
                    <ProductTable products={items} {...viewProps} />
                  )}
                </section>
              ))
            ) : layout === "grid" ? (
              <ProductGrid products={products} {...viewProps} />
            ) : (
              <ProductTable products={products} {...viewProps} />
            )}
          </div>

          {selected.size > 0 && (
            <div className="absolute bottom-4 left-1/2 z-25 flex -translate-x-1/2 animate-rise items-center gap-1.5 rounded-full bg-ink py-1.5 pr-[7px] pl-[13px] text-white shadow-[0_8px_28px_-8px_rgb(18_18_18/.45)]">
              <span className="text-xs font-semibold tabular-nums">
                {selected.size} selected
              </span>
              <span className="h-[17px] w-px bg-white/20" />
              <button
                type="button"
                onClick={() => {
                  if (!shortlistSupported) {
                    toast(
                      shortlistResource.data?.reason ??
                        "Shortlist API tidak tersedia dari backend"
                    )
                    return
                  }
                  void Promise.all(
                    [...selected].map((id) =>
                      addEntry.execute({
                        sourcingItemId: id,
                        colorwayId: productsFromApi.find(
                          (product) => product.id === id
                        )?.colorways[0]?.id,
                      })
                    )
                  )
                    .then(() => {
                      toast(`Shortlisted ${selected.size} styles`)
                      setSelected(new Set())
                    })
                    .catch((error: unknown) => {
                      const message = getErrorMessage(error)
                      setShortlistActionError(message)
                      toast(`Shortlist update failed: ${message}`)
                    })
                }}
                className="inline-flex h-[27px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white"
              >
                <Icon path={paths.star} size={13} width={2} />
                Shortlist
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = [...selected]
                  setSelected(new Set())
                  draftPo(ids)
                }}
                className="inline-flex h-[27px] items-center gap-1.5 rounded-full bg-white px-2.5 text-xs font-semibold text-ink transition-[filter] duration-[120ms] hover:brightness-95"
              >
                <Icon path={paths.doc} size={13} width={2} />
                Draft PO
              </button>
              <span className="h-[17px] w-px bg-white/20" />
              <button
                type="button"
                aria-label="Clear selection"
                onClick={() => setSelected(new Set())}
                className="grid size-[27px] place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Icon path={paths.close} size={13} width={2.2} />
              </button>
            </div>
          )}
        </div>
      </main>

      <SheetShell
        open={Boolean(detail)}
        eyebrow={detail?.category ?? "Style"}
        title={detail?.name ?? ""}
        onRequestClose={() => openDetail(null)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => openDetail(null)}
              className={sheetButton.secondary}
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                if (detail) toggleShortlist(detail.id)
              }}
              disabled={!shortlistSupported || shortlistBusyId === detail?.id}
              title={
                !shortlistSupported ? "Shortlist API belum tersedia" : undefined
              }
              className={sheetButton.secondary}
            >
              <Icon path={paths.star} size={14} width={2} />
              {detail && isShortlisted(detail.id) ? "Shortlisted" : "Shortlist"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (detail) draftPo([detail.id])
              }}
              className={sheetButton.primary}
            >
              <Icon path={paths.doc} size={14} width={2} />
              Draft PO
            </button>
          </>
        }
      >
        {detail && (
          <div className="px-[18px] pt-4 pb-[18px]">
            <div className="mb-4 grid grid-cols-2 gap-2">
              {detail.colorways.slice(0, 4).map((c) =>
                c.image ? (
                  <img
                    key={c.id}
                    src={c.image}
                    alt={detail.name}
                    loading="lazy"
                    className="aspect-[3/4] w-full rounded-panel bg-inset object-cover shadow-[inset_0_0_0_1px_var(--line)]"
                  />
                ) : (
                  <div
                    key={c.id}
                    className="grid aspect-[3/4] w-full place-items-center rounded-panel bg-inset text-xs text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]"
                  >
                    No image
                  </div>
                )
              )}
            </div>

            <div className="flex items-baseline gap-2 pb-3">
              <span className="font-mono text-[22px] leading-none font-medium tracking-[-0.02em] text-ink">
                {productMoney(detail)}
              </span>
              <span className="text-[11.5px] text-ink-4">
                per unit · MOQ {detail.moq > 0 ? detail.moq : "—"}
              </span>
              <span className="ml-auto">
                <StatusDot status={detail.status} />
              </span>
            </div>

            <div className="rounded-panel bg-inset p-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                Supplier
              </div>
              <SupplierCell
                id={detail.supplierId}
                supplier={supplierOf(detail.supplierId, suppliersFromApi)}
                subtitle={detail.category}
              />
              <div className="pt-2 text-[11.5px] text-ink-4">
                {supplierOf(detail.supplierId, suppliersFromApi)?.country ||
                  "Supplier master"}{" "}
                ·{" "}
                {detail.leadTime > 0
                  ? `${detail.leadTime} day lead time`
                  : "Lead time unavailable"}
              </div>
            </div>

            {[
              { label: "SKU", value: detail.sku },
              { label: "Division", value: detail.category },
              { label: "Status", value: STATUS_META[detail.status].label },
              {
                label: "Updated",
                value:
                  detail.updated > 0
                    ? `${updatedLabel(detail.updated)} ago`
                    : "Unknown",
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-start gap-3 border-t border-line py-[9px]"
              >
                <span className="w-[92px] shrink-0 pt-px text-xs text-ink-4">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">
                  {row.value}
                </span>
              </div>
            ))}

            <div className="flex items-start gap-3 border-t border-b border-line py-[9px]">
              <span className="w-[92px] shrink-0 pt-0.5 text-xs text-ink-4">
                Tags
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <Tag key={t} name={t} />
                ))}
              </span>
            </div>
          </div>
        )}
      </SheetShell>

      <SourceSheet
        open={sourceSheetOpen}
        onClose={() => setSourceSheetOpen(false)}
        suppliers={suppliersFromApi}
        divisions={divisions}
        tags={allTags}
        currency={itemsResource.data?.currency}
        onCreate={(input) => createItem.execute(input)}
        onCreated={() => toast("Sourcing item added")}
      />

      <div className="fixed right-4 bottom-4 z-90 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex animate-pop items-center gap-2.5 rounded-panel bg-surface px-3.5 py-2.5 text-xs font-medium shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]"
          >
            <Icon
              path={paths.check}
              size={15}
              width={2.2}
              className="text-grass"
            />
            {t.message}
          </div>
        ))}
      </div>
    </AppShell>
  )
}
