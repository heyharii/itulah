import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { ColourSwatch } from "@/components/ui/swatch"
import { colourKeys, listColours } from "@/lib/queries/colours"
import {
  catalogueVocabulary,
  createSupplierItem,
  listSuppliers,
  procurementKeys,
  updateSupplierItem,
} from "@/lib/queries/procurement"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import type { SupplierItem } from "@itulah/contract"

/// Putting something into the sourcing catalogue, or correcting what is in it.
///
/// One form for both, because they answer the same question — what is this
/// thing, who sells it, what does it come in and what does it cost — and two
/// forms would be two lists of fields drifting apart the week somebody adds
/// one. Creating additionally asks who sells it and under what code of theirs;
/// neither can be changed afterwards without becoming a different item, which
/// is why they are absent when editing.
///
/// **Wide, and in two columns.** The catalogue is the thing Sourcing browses,
/// so what this form can say is the ceiling on what that screen can show — and
/// since 0092 that includes the colours and sizes an item is offered in. Ten
/// fields down a rail is a form somebody scrolls; the same ten in two columns
/// is a form somebody reads.
///
/// The vocabularies are pickers, not free text. A supplier's Navy and our Navy
/// have to be one row or a colour filter finds a third of the navy garments
/// and reports that as the answer — which is the split the colour master was
/// created to prevent.

interface Draft {
  supplierId: string | null
  code: string
  name: string
  description: string
  price: string
  division: string | null
  tags: readonly string[]
  colours: readonly string[]
  sizes: readonly string[]
  article: string
}

function blank(): Draft {
  return {
    supplierId: null,
    code: "",
    name: "",
    description: "",
    price: "",
    division: null,
    tags: [],
    colours: [],
    sizes: [],
    article: "",
  }
}

function from(item: SupplierItem): Draft {
  return {
    supplierId: item.supplier_id,
    code: item.supplier_item_code,
    name: item.name,
    description: item.description ?? "",
    price: String(item.unit_price_minor),
    division: item.division_code,
    tags: item.tags,
    colours: item.colours.map((one) => one.colour_code),
    sizes: item.size_codes,
    article: item.internal_article_code ?? "",
  }
}

export function ItemFormSheet({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean
  /// The item being corrected, or absent to add one.
  item?: SupplierItem
  onClose: () => void
  onSaved?: (item: SupplierItem) => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const editing = item !== undefined

  // Keyed on the item so switching which one is open reseeds the fields. A
  // `useEffect` doing the same thing would render the previous item's values
  // for one frame, which on a form reads as the wrong record being edited.
  const [draft, setDraft] = useState<Draft>(() =>
    item === undefined ? blank() : from(item)
  )
  const [seededFor, setSeededFor] = useState(item?.supplier_item_id ?? null)
  if (seededFor !== (item?.supplier_item_id ?? null)) {
    setSeededFor(item?.supplier_item_id ?? null)
    setDraft(item === undefined ? blank() : from(item))
  }

  const set = (change: Partial<Draft>) =>
    setDraft((was) => ({ ...was, ...change }))

  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
    enabled: open && !editing,
  })
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
    enabled: open,
  })
  const colourMaster = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
    enabled: open,
  })

  const supplierChoices = useMemo<Choice[]>(
    () =>
      (suppliers.data ?? []).map((one) => ({
        value: one.supplier_id,
        label: one.name,
      })),
    [suppliers.data]
  )
  const divisionChoices = useMemo<Choice[]>(
    () =>
      (vocabulary.data?.divisions ?? []).map((one) => ({
        value: one.code,
        label: one.label,
      })),
    [vocabulary.data]
  )
  const tagChoices = useMemo<Choice[]>(
    () =>
      (vocabulary.data?.tags ?? []).map((one) => ({
        value: one.code,
        label: one.label,
      })),
    [vocabulary.data]
  )
  const sizeChoices = useMemo<Choice[]>(
    () =>
      (vocabulary.data?.sizes ?? []).map((one) => ({
        value: one.code,
        label: one.label,
      })),
    [vocabulary.data]
  )
  // Retired colours are left out. They stay on the articles already wearing
  // them — retiring a colour never unpaints a garment — but offering one here
  // would be putting a word back into circulation that somebody withdrew.
  const colourTerms = useMemo(
    () => (colourMaster.data?.colours ?? []).filter((one) => one.active),
    [colourMaster.data]
  )
  const colourChoices = useMemo<Choice[]>(
    () => colourTerms.map((one) => ({ value: one.code, label: one.label })),
    [colourTerms]
  )
  const hexOf = (code: string) =>
    colourTerms.find((one) => one.code === code)?.hex_code ?? null

  const save = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: () => {
      const price = Number.parseInt(draft.price, 10)
      if (item !== undefined) {
        return updateSupplierItem(
          item.supplier_item_id,
          {
            name: draft.name.trim(),
            description:
              draft.description.trim() === "" ? null : draft.description.trim(),
            unit_price_minor: price,
            division_code: draft.division,
            internal_article_code:
              draft.article.trim() === "" ? null : draft.article.trim(),
            // Present replaces. An empty list therefore means "remove every
            // one", which is a thing somebody may legitimately say — and is
            // why these are not merged into what is already there.
            tags: [...draft.tags],
            colour_codes: [...draft.colours],
            size_codes: [...draft.sizes],
          },
          item.version,
          idempotency.key
        )
      }
      return createSupplierItem(
        draft.supplierId!,
        {
          supplier_item_code: draft.code.trim(),
          name: draft.name.trim(),
          description:
            draft.description.trim() === "" ? null : draft.description.trim(),
          image_url: null,
          unit_price_minor: price,
          currency: "IDR",
          internal_article_code:
            draft.article.trim() === "" ? null : draft.article.trim(),
          status: "ACTIVE",
          division_code: draft.division,
          tags: [...draft.tags],
          colour_codes: [...draft.colours],
          size_codes: [...draft.sizes],
        },
        idempotency.key
      )
    },
    onSuccess: (saved) => {
      // Everything that reads supplier items: the cross-supplier search
      // Sourcing and Catalogue both run, this supplier's own list, and the
      // record itself. Named rather than a blanket prefix.
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierItems(),
      })
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierCatalogue(saved.supplier_id),
      })
      void client.invalidateQueries({
        queryKey: procurementKeys.supplierItem(saved.supplier_item_id),
      })
      idempotency.rotate()
      if (!editing) setDraft(blank())
      onSaved?.(saved)
    },
  })

  const price = Number.parseInt(draft.price, 10)
  const ready =
    draft.name.trim() !== "" &&
    Number.isFinite(price) &&
    price >= 0 &&
    (editing || (draft.supplierId !== null && draft.code.trim() !== ""))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={editing ? "Edit item" : "Add an item"}
      id={editing ? item.supplier_item_code : undefined}
      // As wide as the composer, and for the same reason: this is the form
      // that decides what Sourcing is able to show, and a rail would make the
      // colour and size pickers two stacked strips of chips.
      className="w-[64rem]"
      footer={
        <Button
          variant="dark"
          className="w-full"
          disabled={!ready || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending
            ? "Saving…"
            : editing
              ? "Save the item"
              : "Add it to the catalogue"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Banner tone="bad">{(save.error as Error).message}</Banner>
        )}
        {save.isSuccess && !editing && (
          <Banner tone="ok" onDismiss={() => save.reset()}>
            {save.data.name} is in the catalogue. Add another, or close this.
          </Banner>
        )}

        {/* Who sells it and under what code of theirs. Asked once, when the
            item is created: changing either afterwards does not correct this
            item, it describes a different one. */}
        {!editing && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Supplier"
              hint="Whose catalogue this belongs to. It cannot be moved afterwards."
            >
              <PickOne
                label="Supplier"
                choices={supplierChoices}
                value={draft.supplierId}
                onChange={(supplierId) => set({ supplierId })}
                placeholder="Choose a supplier"
              />
            </Field>
            <Field
              label="Supplier's item code"
              hint="Their numbering, not ours. It is what appears on their quote and on the carton."
            >
              <Input
                value={draft.code}
                onChange={(event) => set({ code: event.target.value })}
                placeholder="0293433029"
              />
            </Field>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="2-p basic cotton tights"
            />
          </Field>
          <Field label="Unit price" hint="Rupiah, as the supplier quotes it.">
            <Input
              type="number"
              min={0}
              value={draft.price}
              onChange={(event) => set({ price: event.target.value })}
              placeholder="31000"
            />
          </Field>
        </div>

        <Field label="Description">
          <Textarea
            rows={2}
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder="What the supplier says it is."
          />
        </Field>

        {/* What it IS. The same vocabulary our own articles are filed under —
            a supplier's shirt and our shirt have to be the same word, or the
            two catalogues cannot be compared, and comparing them is the whole
            point of sourcing. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Division"
            hint="Unclassified is a real state, not a fault. Leave it empty when nobody has decided."
          >
            <PickOne
              label="Division"
              choices={divisionChoices}
              value={draft.division}
              onChange={(division) => set({ division })}
            />
          </Field>
          <Field label="Tags" hint="What kind of thing it is.">
            <PickMany
              label="Tags"
              choices={tagChoices}
              values={draft.tags}
              onChange={(tags) => set({ tags })}
            />
          </Field>
        </div>

        {/* What it COMES IN. Both optional and both may stay empty: an item
            nobody has broken down into variants is most of a scraped feed, and
            it is better shown as nothing than guessed at. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Colours"
            hint="From the colour master, so a supplier's Navy and our Navy are one row."
          >
            <PickMany
              label="Colours"
              choices={colourChoices}
              values={draft.colours}
              onChange={(colours) => set({ colours })}
              leading={(code) => <ColourSwatch hex={hexOf(code)} />}
            />
          </Field>
          <Field label="Sizes" hint="The company's own size table.">
            <PickMany
              label="Sizes"
              choices={sizeChoices}
              values={draft.sizes}
              onChange={(sizes) => set({ sizes })}
            />
          </Field>
        </div>

        <Field
          label="Our article code"
          hint="Eight digits from our own sequence. Until this is set the item cannot be tagged, priced or sold — and it is usually set later, at goods receipt."
        >
          <Input
            value={draft.article}
            onChange={(event) => set({ article: event.target.value })}
            placeholder="00000042"
          />
        </Field>
      </div>
    </Sheet>
  )
}
