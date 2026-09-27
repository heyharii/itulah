import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ImagePlus, Plus, Trash2 } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Section } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { ColourSwatch } from "@/components/ui/swatch"
import { Thumbnail } from "@/components/ui/thumbnail"
import { asJpeg, PICTURE_TYPES } from "@/lib/image"
import { isPositiveDecimal, wholeProduct } from "@/lib/decimal"
import { unitFactor, useUnits } from "@/lib/queries/units"
import { PricingFields, VariantGrid } from "@/screens/procurement/line-pricing"
import {
  variantPieces,
  variantRows,
  type VariantDraft,
} from "@/screens/procurement/line-pricing-model"
import { colourKeys, listColours } from "@/lib/queries/colours"
import {
  catalogueVocabulary,
  createSupplierItem,
  listSuppliers,
  procurementKeys,
  supplierDetail,
  updateSupplierItem,
  uploadSupplierItemImage,
} from "@/lib/queries/procurement"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  useIdempotencyKey,
  type PendingItem,
} from "@/screens/procurement/shared"
import type { CreateSupplierItemRequest, SupplierItem } from "@itulah/contract"

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
  /// How many to order, in `orderUnit` — asked only from an order.
  quantity: string
  orderUnit: string
  /// What it will sell for, and the markup over the price below.
  markup: string
  basePrice: string
  /// The item's own pack sizes: a carton of it holds this many pieces.
  units: readonly { unit_code: string; factor: string }[]
  /// How many of each colour and size, when ordering an item that has them.
  variants: readonly VariantDraft[]
  name: string
  description: string
  price: string
  division: string | null
  tags: readonly string[]
  colours: readonly string[]
  sizes: readonly string[]
  /// The photograph already stored against this item, as a URL. Read-only
  /// here: what replaces it is a file, not a string somebody types.
  image: string
}

function blank(supplierId: string | null = null): Draft {
  return {
    supplierId,
    code: "",
    quantity: "1",
    orderUnit: "PCS",
    markup: "",
    basePrice: "",
    units: [],
    variants: [],
    name: "",
    description: "",
    price: "",
    division: null,
    tags: [],
    colours: [],
    sizes: [],
    image: "",
  }
}

function from(item: SupplierItem): Draft {
  return {
    supplierId: item.supplier_id,
    code: item.supplier_item_code,
    quantity: "1",
    orderUnit: "PCS",
    markup: "",
    basePrice: "",
    units: item.units ?? [],
    variants: [],
    name: item.name,
    description: item.description ?? "",
    price: String(item.unit_price_minor),
    division: item.division_code,
    tags: item.tags,
    colours: item.colours.map((one) => one.colour_code),
    sizes: item.size_codes,
    image: item.image_url ?? "",
  }
}

export function ItemFormSheet({
  open,
  item,
  supplierId,
  onClose,
  onSaved,
  onDraft,
}: {
  open: boolean
  /// The item being corrected, or absent to add one.
  item?: SupplierItem
  /// Whose catalogue this is being added to, when the caller already knows.
  ///
  /// The composer does: an order is for one supplier, decided before any line
  /// exists on it, and asking again — with the wrong answer available — is a
  /// way to put an item in the wrong catalogue and then fail to find it. Given
  /// one, the question is not put and the picker is not drawn.
  supplierId?: string
  onClose: () => void
  onSaved?: (item: SupplierItem) => void
  /// Draft the new item instead of creating it — the order composer's way in.
  ///
  /// Given, "Add it to the order" writes nothing: the item goes back to the
  /// caller as the request it will be, and is created when the order is. An
  /// order abandoned halfway therefore leaves no items behind in the
  /// catalogue. Corrections to an item that already exists (`item`) still
  /// save straight away — that record is real either way.
  onDraft?: (pending: PendingItem) => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const editing = item !== undefined

  // Keyed on the item so switching which one is open reseeds the fields. A
  // `useEffect` doing the same thing would render the previous item's values
  // for one frame, which on a form reads as the wrong record being edited.
  const [draft, setDraft] = useState<Draft>(() =>
    item === undefined ? blank(supplierId ?? null) : from(item)
  )
  const [seededFor, setSeededFor] = useState(item?.supplier_item_id ?? null)
  if (seededFor !== (item?.supplier_item_id ?? null)) {
    setSeededFor(item?.supplier_item_id ?? null)
    setDraft(item === undefined ? blank(supplierId ?? null) : from(item))
  }

  const set = (change: Partial<Draft>) =>
    setDraft((was) => ({ ...was, ...change }))

  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
    enabled: open && !editing && supplierId === undefined,
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

  /// The photograph waiting to be uploaded, if somebody chose one.
  ///
  /// Held as a `File` and sent AFTER the item is written, because the object
  /// key is the supplier's code and the item's own code — neither of which
  /// exists as a saved fact until the item does. A picture chosen for an item
  /// that is never saved is therefore never uploaded, which is the right way
  /// round: the bucket should not collect orphans from abandoned forms.
  const [photo, setPhoto] = useState<File | null>(null)
  /// Why the photograph did not make it, when the item itself did.
  ///
  /// The two are saved in sequence and only the first is the point: an item
  /// with no picture is a usable catalogue row, and failing the whole write
  /// over an upload would leave the item created, the form still open, and a
  /// retry refused for a duplicate code. So the picture is allowed to fail on
  /// its own and say so.
  const [photoTrouble, setPhotoTrouble] = useState<string | null>(null)
  /// Why the picture that was just CHOSEN cannot be used — a format the
  /// browser will not decode. Separate from `photoTrouble`, which is about an
  /// upload that failed after the item was written: this one is about a file
  /// that never got as far as the form, and it is answered by choosing
  /// another, not by opening the item again.
  const [photoRefused, setPhotoRefused] = useState<string | null>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const chosen = useMemo(
    () => (photo === null ? null : URL.createObjectURL(photo)),
    [photo]
  )
  const showing = chosen ?? (draft.image.trim() === "" ? null : draft.image)

  /// The supplier as a record, for the one thing the id cannot answer: the
  /// code the bucket files this supplier's imagery under.
  const supplier = useQuery({
    queryKey: procurementKeys.supplier(draft.supplierId ?? ""),
    queryFn: ({ signal }) => supplierDetail(draft.supplierId!, signal),
    staleTime: 5 * 60 * 1000,
    enabled: open && draft.supplierId !== null,
  })

  /// The item as the server will be asked to create it. One builder for the
  /// two ways it is sent: now, from the catalogue, or later, with the order.
  const newItemRequest = (): CreateSupplierItemRequest => ({
    // The supplier's own code is optional now (owner, 2026-09-26): a blank one
    // is given a unique code of ours, so the item can still be filed.
    supplier_item_code: draft.code.trim() === "" ? autoItemCode() : draft.code.trim(),
    name: draft.name.trim(),
    description:
      draft.description.trim() === "" ? null : draft.description.trim(),
    // Nothing to name yet: a new item's picture is uploaded once the item
    // exists — see `createSupplierItemWithPhoto`.
    image_url: null,
    unit_price_minor: Number.parseInt(draft.price, 10),
    currency: "IDR",
    internal_article_code: null,
    status: "ACTIVE",
    division_code: draft.division,
    tags: [...draft.tags],
    colour_codes: [...draft.colours],
    size_codes: [...draft.sizes],
    units: draft.units.filter((one) => isPositiveDecimal(one.factor)),
  })

  const save = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: async () => {
      setPhotoTrouble(null)
      const price = Number.parseInt(draft.price, 10)
      const description =
        draft.description.trim() === "" ? null : draft.description.trim()
      const stored = draft.image.trim() === "" ? null : draft.image.trim()

      const saved =
        item !== undefined
          ? await updateSupplierItem(
              item.supplier_item_id,
              {
                name: draft.name.trim(),
                description,
                unit_price_minor: price,
                // Present replaces, so this is how "take the photograph off"
                // is said. A new one chosen this session overwrites it a
                // moment later, below.
                image_url: stored,
                division_code: draft.division,
                // `internal_article_code` is deliberately absent rather than
                // null. The field left this form — it is minted at goods
                // receipt, not typed by a buyer — and the server reads absent
                // as "leave it alone", so an item that already has one keeps
                // it. Sending null here would erase it on the next edit of a
                // name.
                //
                // Present replaces for the three lists too. An empty one
                // therefore means "remove every one", which is a thing
                // somebody may legitimately say — and is why these are not
                // merged into what is already there.
                tags: [...draft.tags],
                colour_codes: [...draft.colours],
                size_codes: [...draft.sizes],
                units: draft.units.filter((one) => isPositiveDecimal(one.factor)),
              },
              item.version,
              idempotency.key
            )
          : await createSupplierItem(
              draft.supplierId!,
              newItemRequest(),
              idempotency.key
            )

      if (photo === null) return saved

      try {
        const code = supplier.data?.supplier_code
        if (code === undefined) {
          throw new Error(
            "the supplier's code has not loaded, so there was nowhere to file it"
          )
        }
        const url = await uploadSupplierItemImage(
          code,
          saved.supplier_item_code,
          photo
        )
        // Its own key: the same one would be read as a retry of the write
        // above and replayed, leaving the item saved and the picture
        // unattached.
        return await updateSupplierItem(
          saved.supplier_item_id,
          { image_url: url },
          saved.version,
          crypto.randomUUID()
        )
      } catch (error) {
        setPhotoTrouble((error as Error).message)
        return saved
      }
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
      setPhoto(null)
      if (!editing) setDraft(blank(supplierId ?? null))
      onSaved?.(saved)
    },
  })

  /// Shutting the sheet forgets the last write.
  ///
  /// The form stays mounted between openings — it is a sibling of whatever
  /// screen opened it — so without this the success banner from the item added
  /// ten minutes ago is the first thing the next one says, and so is an error
  /// somebody has already dealt with.
  const close = () => {
    save.reset()
    setPhoto(null)
    setPhotoTrouble(null)
    setPhotoRefused(null)
    onClose()
  }

  /// What a saveable item is.
  ///
  /// **Division and one tag are required**, which they were not. Both travel
  /// onto every purchase order line raised from this item and from there to
  /// goods receipt, so an item filed under nothing is an article filed under
  /// nothing — and "Unclassified is a real state" is true of the scraped feed
  /// that arrived that way, not of a row somebody is typing by hand right now.
  /// A person adding an item knows what it is; the moment to say so is here.
  ///
  /// Colours and sizes stay optional. Most of what a supplier quotes has not
  /// been broken down into variants when it is ordered, and a required picker
  /// would be answered with a guess.
  const price = Number.parseInt(draft.price, 10)
  /// Opened from an order: the item goes straight onto it, with a quantity.
  const ordering = onDraft !== undefined && !editing
  const unitBook = useUnits()
  /// Units this item can be ordered in: the base, the global conversions and
  /// its own pack sizes typed above.
  const orderUnits = unitBook.units.filter(
    (one) =>
      one.active &&
      unitFactor(one.code, draft.units, unitBook.conversions, unitBook.baseUnit) !==
        null
  )
  /// Every SKU the chosen colours and sizes make — the grid the owner asked
  /// for when the item comes in variants.
  const skuRows = variantRows(draft.colours, draft.sizes, draft.variants)
  const byVariant = skuRows.length > 0
  const factor = unitFactor(
    draft.orderUnit,
    draft.units,
    unitBook.conversions,
    unitBook.baseUnit
  )
  /// Pieces this order wants: the SKU rows added up, or the quantity typed in
  /// its unit converted exactly.
  const quantity = byVariant
    ? variantPieces(skuRows)
    : factor === null
      ? null
      : wholeProduct(draft.quantity, factor)
  const ready =
    draft.name.trim() !== "" &&
    Number.isFinite(price) &&
    price >= 0 &&
    draft.division !== null &&
    draft.tags.length > 0 &&
    (!ordering || (quantity !== null && quantity > 0)) &&
    (editing || draft.supplierId !== null)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title={editing ? "Edit item" : "Add an item"}
      id={editing ? item.supplier_item_code : undefined}
      // As wide as the composer, and for the same reason: this is the form
      // that decides what Sourcing is able to show, and a rail would make the
      // colour and size pickers two stacked strips of chips.
      //
      // `wide` and `md:`, both load-bearing. A rail sheet sets `md:w-[27.5rem]`
      // and twMerge only lets a class beat another at the SAME breakpoint, so
      // the bare `w-[64rem]` this carried lost everywhere except a phone — the
      // form has been 27.5rem wide on every desk since it was written. `wide`
      // additionally makes it a task over the page rather than a column beside
      // the list, which is what lets it open on top of the composer.
      width="wide"
      className="md:w-[64rem]"
      // Two buttons at their own size, at the trailing edge — the shape the
      // composer's footer settled on, and this form now opens over it. A
      // full-width black bar across 64rem reads as a banner, and it left the ×
      // in the corner as the only way to abandon a half-filled form.
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() => {
              if (onDraft !== undefined && !editing) {
                // Nothing is written: the line carries the item until the
                // order is raised. See `onDraft`.
                onDraft({
                  request: newItemRequest(),
                  photo,
                  key: crypto.randomUUID(),
                  quantity: quantity ?? 1,
                  unitCode: byVariant ? undefined : draft.orderUnit,
                  unitQuantity: byVariant ? undefined : draft.quantity,
                  basePrice: draft.basePrice,
                  markup: draft.markup,
                  variants: byVariant
                    ? skuRows.filter(
                        (one) => Number.parseInt(one.quantity, 10) > 0
                      )
                    : undefined,
                })
                setDraft(blank(supplierId ?? null))
                close()
                return
              }
              save.mutate()
            }}
          >
            {save.isPending
              ? "Saving…"
              : editing
                ? "Save the item"
                : // Said as what it does from here. Opened from the composer
                  // the item is created AND put on the open order, and
                  // "Add it to the catalogue" describes half of that — the
                  // half the buyer did not come for.
                  supplierId !== undefined
                  ? "Add it to the order"
                  : "Add it to the catalogue"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Banner tone="bad">{(save.error as Error).message}</Banner>
        )}
        {photoTrouble !== null && (
          <Banner tone="warn" onDismiss={() => setPhotoTrouble(null)}>
            The item is saved, but its photograph is not: {photoTrouble}. Open
            the item from the catalogue to try the picture again.
          </Banner>
        )}

        {/* **The picture leads.** It is the half of a catalogue row anybody
            actually recognises, and standing it beside the identity fields —
            rather than under the description, where the URL box used to be —
            is what makes this a product form instead of a list of ten boxes.

            Who sells it and under what code of theirs is asked once, when the
            item is created: changing either afterwards does not correct this
            item, it describes a different one. */}
        <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
          <Field label="Photograph" problem={photoRefused ?? undefined}>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => chooser.current?.click()}
                className="group relative block aspect-square w-full overflow-hidden rounded-card border border-hairline bg-soft-2 transition-colors hover:border-hairline-strong"
                aria-label={
                  showing === null
                    ? "Choose a photograph"
                    : "Replace the photograph"
                }
              >
                {showing === null ? (
                  <span className="flex size-full flex-col items-center justify-center gap-1.5 text-mute">
                    <ImagePlus className="size-5" />
                    <span className="text-[0.875rem]">Choose a picture</span>
                  </span>
                ) : (
                  <Thumbnail
                    url={showing}
                    fallback="Cannot be read"
                    className="size-full"
                  />
                )}
              </button>
              {/* The file input itself is never seen. A bare one renders as
                  the browser's own grey "No file chosen" strip, which is the
                  one control on this form nobody could restyle. */}
              <input
                ref={chooser}
                type="file"
                // Every picture the browser can decode, not just the one the
                // bucket stores. A screenshot is a PNG, and `accept` greyed
                // every one of them out with no way to tell why — see
                // `lib/image`, which converts what is chosen.
                accept={PICTURE_TYPES}
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0] ?? null
                  if (picked !== null) {
                    setPhotoRefused(null)
                    void asJpeg(picked).then(setPhoto, (error: Error) =>
                      setPhotoRefused(error.message)
                    )
                  }
                  // Cleared so choosing the SAME file twice still fires a
                  // change — the second pick is a person correcting a mistake,
                  // and a silent no-op reads as the form ignoring them.
                  event.target.value = ""
                }}
              />
              {showing !== null && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setPhoto(null)
                    setPhotoRefused(null)
                    set({ image: "" })
                  }}
                >
                  <Trash2 />
                  Remove
                </Button>
              )}
            </div>
          </Field>

          <div className="flex flex-col gap-4">
            {/* One column when the supplier is already known, two when it has
                to be asked. A lone code box occupying half a row, with the
                other half empty, reads as a field somebody forgot to fill in
                rather than as the only question on the line. */}
            {!editing && (
              <div
                className={cn(
                  "grid gap-4",
                  supplierId === undefined && "md:grid-cols-2"
                )}
              >
                {supplierId === undefined && (
                  <Field label="Supplier">
                    <PickOne
                      label="Supplier"
                      choices={supplierChoices}
                      value={draft.supplierId}
                      onChange={(chosen) => set({ supplierId: chosen })}
                      placeholder="Choose a supplier"
                    />
                  </Field>
                )}
                <Field label="Supplier's item code" aside="Optional">
                  <Input
                    value={draft.code}
                    onChange={(event) => set({ code: event.target.value })}
                    placeholder="Given automatically when blank"
                  />
                </Field>
              </div>
            )}

            <Field label={<Required>Name</Required>}>
              <Input
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
                placeholder="2-p basic cotton tights"
              />
            </Field>

            {/* Grouped and prefixed, not a bare number box. `200000000` is a
                figure somebody has to count the zeros of; `Rp 200.000.000` is
                one they can read — and the money field hands back the digits
                either way, so nothing downstream learns about separators. */}

          </div>
        </div>

        <Field label="Description">
          <Textarea
            rows={2}
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder="What the supplier says it is."
          />
        </Field>

        {/* What it IS, and it has to be said. The same vocabulary our own
            articles are filed under — a supplier's shirt and our shirt have to
            be the same word, or the two catalogues cannot be compared, and
            comparing them is the whole point of sourcing. Both are required:
            see the note on `ready`. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={<Required>Division</Required>}>
            <PickOne
              label="Division"
              choices={divisionChoices}
              value={draft.division}
              onChange={(division) => set({ division })}
              placeholder="Choose a division"
            />
          </Field>
          <Field label={<Required>Tags</Required>}>
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
          <Field label="Colours">
            <PickMany
              label="Colours"
              choices={colourChoices}
              values={draft.colours}
              onChange={(colours) => set({ colours })}
              leading={(code) => <ColourSwatch hex={hexOf(code)} />}
            />
          </Field>
          <Field label="Sizes">
            <PickMany
              label="Sizes"
              choices={sizeChoices}
              values={draft.sizes}
              onChange={(sizes) => set({ sizes })}
            />
          </Field>
        </div>

        {/* What it costs and what it will sell for — the markup and the base
            price move together, so they cannot disagree. */}
        <Section title="Price">
          <PricingFields
            required
            pricing={{
              purchase: draft.price,
              markup: draft.markup,
              base: draft.basePrice,
            }}
            onChange={(next) =>
              set({
                price: next.purchase,
                markup: next.markup,
                basePrice: next.base,
              })
            }
          />
        </Section>

        {/* The item's own pack sizes — a carton of THIS item holds 24 —
            which override the global conversions (Lusin 12, Kodi 20) for this
            item only. */}
        <Section title="Pack sizes">
          <div className="flex flex-col gap-2.5">
            {draft.units.length === 0 && (
              <p className="text-[0.875rem] text-body">
                None. The global conversions apply — see Inventory → Units &
                conversions.
              </p>
            )}
            {draft.units.map((one, index) => (
              <div key={index} className="flex items-end gap-2.5">
                <Field label="Unit" className="w-[12rem]">
                  <Select
                    aria-label={`Pack unit ${index + 1}`}
                    value={one.unit_code}
                    onChange={(unit_code) =>
                      set({
                        units: draft.units.map((was, at) =>
                          at === index ? { ...was, unit_code } : was
                        ),
                      })
                    }
                  >
                    {unitBook.units
                      .filter((unit) => unit.active && !unit.is_base)
                      .map((unit) => (
                        <option key={unit.code} value={unit.code}>
                          {unit.label}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Pieces in one" className="w-[10rem]">
                  <Input
                    inputMode="decimal"
                    value={one.factor}
                    placeholder="24"
                    onChange={(event) =>
                      set({
                        units: draft.units.map((was, at) =>
                          at === index
                            ? { ...was, factor: event.target.value }
                            : was
                        ),
                      })
                    }
                    className="text-right tabular-nums"
                  />
                </Field>
                <Button
                  variant="quiet"
                  aria-label={`Remove pack unit ${index + 1}`}
                  className="size-10"
                  onClick={() =>
                    set({ units: draft.units.filter((_, at) => at !== index) })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div>
              <Button
                onClick={() => {
                  const first = unitBook.units.find(
                    (unit) =>
                      unit.active &&
                      !unit.is_base &&
                      !draft.units.some((one) => one.unit_code === unit.code)
                  )
                  if (first !== undefined)
                    set({
                      units: [
                        ...draft.units,
                        { unit_code: first.code, factor: "" },
                      ],
                    })
                }}
              >
                <Plus />
                Add a pack size
              </Button>
            </div>
          </div>
        </Section>

        {/* How many, when the item is going straight onto an order: one
            quantity in any unit, or — when it comes in colours and sizes —
            a quantity and a price per SKU. */}
        {ordering && (
          <Section title="Order">
            {byVariant ? (
              <VariantGrid
                variants={skuRows}
                onChange={(variants) => set({ variants })}
                colourLabel={(code) =>
                  colourTerms.find((one) => one.code === code)?.label ?? code
                }
                basePrice={draft.basePrice}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-[10rem_12rem_1fr] md:items-end">
                <Field label={<Required>Qty</Required>}>
                  <Input
                    inputMode="decimal"
                    value={draft.quantity}
                    onChange={(event) => set({ quantity: event.target.value })}
                    className="text-right tabular-nums"
                    aria-label="Quantity to order"
                  />
                </Field>
                <Field label="Unit">
                  <Select
                    aria-label="Unit"
                    value={draft.orderUnit}
                    onChange={(orderUnit) => set({ orderUnit })}
                  >
                    {orderUnits.map((unit) => (
                      <option key={unit.code} value={unit.code}>
                        {unit.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <p className="pb-2.5 text-[0.875rem] text-body">
                  {quantity === null
                    ? "Not a whole number of pieces."
                    : `${count(quantity)} pcs`}
                </p>
              </div>
            )}
          </Section>
        )}
      </div>
    </Sheet>
  )
}

/// A field label with the star the owner uses for "required".
function Required({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <span className="ml-0.5 text-bad">*</span>
    </>
  )
}

/// A code for an item whose supplier gave none: `ITM-` and eight characters
/// of a fresh uuid, uppercased — unique enough within one supplier's shelf,
/// and the server's own uniqueness check is the backstop.
function autoItemCode(): string {
  return `ITM-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`
}
