import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Camera,
  ChevronDown,
  Images,
  ImagePlus,
  Maximize2,
  Trash2,
  Pencil,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { PhotoSheet } from "@/components/ui/photo-sheet"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Section } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { ColourSwatch } from "@/components/ui/swatch"
import { Thumbnail } from "@/components/ui/thumbnail"
import { asJpeg, cleaningAvailable, PICTURE_TYPES } from "@/lib/image"
import { wholeProduct } from "@/lib/decimal"
import { unitFactor, useUnits } from "@/lib/queries/units"
import {
  capitaliseFirst,
  supplierDisplayName,
  titled,
} from "@/screens/procurement/supplier-format"
import { PricingFields, VariantGrid } from "@/screens/procurement/line-pricing"
import {
  lineTotal,
  sellingProblem,
  variantPieces,
  variantRows,
  type VariantDraft,
} from "@/screens/procurement/line-pricing-model"
import { colourKeys, listColours } from "@/lib/queries/colours"
import { useColourwayFill } from "@/lib/colourway-fill"
import {
  catalogueVocabulary,
  createSupplierItem,
  listSuppliers,
  procurementKeys,
  supplierDetail,
  updateSupplierItem,
  uploadSupplierItemImage,
} from "@/lib/queries/procurement"
import { count, money } from "@/lib/format"
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

/// A line of an order, opened on this form — picked from the catalogue, or
/// opened again by the pencil or Complete. The same form as Add item, so a
/// line is never set on a sheet that looks different from the one that made
/// it (the owner, 2026-10-02).
export interface LineSeed {
  /// Reseeds the form when it changes.
  readonly key: string
  readonly title: string
  /// The muted line under the title: the item's name.
  readonly caption: string
  readonly name: string
  readonly description: string
  readonly division: string | null
  readonly tags: readonly string[]
  readonly colours: readonly string[]
  readonly sizes: readonly string[]
  readonly quantity: string
  readonly unit: string
  /// Per `unit`, as agreed; per piece when `unit` is the stock unit.
  readonly price: string
  readonly markup: string
  readonly basePrice: string
  readonly variants: readonly VariantDraft[]
  readonly image: string | null
  /// A new item typed into this order: its picture, description, colours and
  /// sizes are still the buyer's to change. A catalogue item's are the
  /// supplier's record, which a PO line does not carry — shown, not edited.
  readonly draftItem: boolean
  readonly photo: Blob | null
  readonly units: readonly { code: string; label: string }[]
  readonly stockUnit: string
  /// Stock units in one of `unit` for this line, or null when it does not
  /// convert.
  readonly factorOf: (unit: string) => string | null
}

/// What the form hands back for a line.
export interface LineResult {
  readonly name: string
  readonly description: string
  readonly division: string | null
  readonly tags: readonly string[]
  readonly colours: readonly string[]
  readonly sizes: readonly string[]
  readonly quantity: string
  readonly unit: string
  readonly price: string
  readonly markup: string
  readonly basePrice: string
  readonly variants: readonly VariantDraft[]
  readonly photo: Blob | null
  readonly image: string | null
}

function fromLine(line: LineSeed, supplierId: string | null): Draft {
  return {
    supplierId,
    code: "",
    quantity: line.quantity,
    orderUnit: line.unit,
    markup: line.markup,
    basePrice: line.basePrice,
    variants: line.variants,
    name: line.name,
    description: line.description,
    price: line.price,
    division: line.division,
    tags: line.tags,
    colours: line.colours,
    sizes: line.sizes,
    image: line.image ?? "",
  }
}

function blank(supplierId: string | null = null): Draft {
  return {
    supplierId,
    code: "",
    quantity: "",
    orderUnit: "PCS",
    markup: "",
    basePrice: "",
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
    quantity: "",
    orderUnit: "PCS",
    markup: "",
    basePrice: "",
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
  line,
  onLine,
  onSkip,
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
  ///
  /// `keepOpen` is true for "Add next item": the caller leaves the sheet up
  /// and this form empties itself for the next one.
  onDraft?: (pending: PendingItem, keepOpen: boolean) => void
  /// A line of the order, set on this form: Submit hands it back through
  /// `onLine` and nothing is written.
  line?: LineSeed
  onLine?: (line: LineResult) => void
  /// Leave this line out and go on to the next one picked.
  onSkip?: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const editing = item !== undefined

  const seed = (): Draft =>
    line !== undefined
      ? fromLine(line, supplierId ?? null)
      : item === undefined
        ? blank(supplierId ?? null)
        : from(item)
  const seedKey = line?.key ?? item?.supplier_item_id ?? null
  // Keyed on the item so switching which one is open reseeds the fields. A
  // `useEffect` doing the same thing would render the previous item's values
  // for one frame, which on a form reads as the wrong record being edited.
  const [draft, setDraft] = useState<Draft>(seed)
  const [seededFor, setSeededFor] = useState(seedKey)
  /// Save is never greyed out: pressed on a form that is not ready, it says
  /// every gap under its box and brings the first one into view.
  const [tried, setTried] = useState(false)
  /// A line's price was typed here, so a change of unit leaves it alone.
  const [priceTyped, setPriceTyped] = useState(false)
  const body = useRef<HTMLDivElement>(null)

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
        label: supplierDisplayName(one),
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
  // The placeholder wears the first colour picked, and repaints as it changes.
  const fill = useColourwayFill()

  /// The photograph waiting to be uploaded, if somebody chose one.
  ///
  /// Held as a `File` and sent AFTER the item is written, because the object
  /// key is the supplier's code and the item's own code — neither of which
  /// exists as a saved fact until the item does. A picture chosen for an item
  /// that is never saved is therefore never uploaded, which is the right way
  /// round: the bucket should not collect orphans from abandoned forms.
  const [photo, setPhoto] = useState<Blob | null>(line?.photo ?? null)
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
  /// A picture taken or chosen, from either input: converted to a JPEG, and the
  /// input cleared so choosing the SAME file twice still fires a change — the
  /// second pick is a person correcting a mistake, and a silent no-op reads as
  /// the form ignoring them.
  const pickPicture = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null
    if (picked !== null) {
      setPhotoRefused(null)
      // Shown first, as it was taken (`PhotoSheet`): cleaning it up and
      // cutting it square are choices there, and skipping both keeps it as is.
      void asJpeg(picked).then(setReviewing, (error: Error) =>
        setPhotoRefused(error.message)
      )
    }
    event.target.value = ""
  }
  /// A picture on the Check the Photo sheet.
  const [reviewing, setReviewing] = useState<Blob | null>(null)
  /// Whether the cleaning service answers; the button is offered only if so.
  const [canClean, setCanClean] = useState(false)
  useEffect(() => {
    void cleaningAvailable().then(setCanClean)
  }, [])
  /// Edit the photo that is on the form: the one just taken, or the item's own
  /// from the image store, read back (the bucket allows this origin to read).
  const editPhoto = () => {
    if (photo !== null) {
      setReviewing(photo)
      return
    }
    if (showing === null) return
    void fetch(showing)
      .then((response) => {
        if (!response.ok) throw new Error("not readable")
        return response.blob()
      })
      .then(setReviewing)
      .catch(() =>
        setPhotoRefused(
          "this photo cannot be opened here — take a new one instead"
        )
      )
  }
  const chooser = useRef<HTMLInputElement>(null)
  /// The photo library, on a phone, where the picture box itself opens the
  /// camera (owner, 2026-10-05): somebody adding an item from an order is
  /// holding the garment, not a gallery.
  const gallery = useRef<HTMLInputElement>(null)
  const touch =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
  if (seededFor !== seedKey) {
    setSeededFor(seedKey)
    setDraft(seed())
    setPhoto(line?.photo ?? null)
    setTried(false)
    setPriceTyped(false)
  }
  /// A catalogue item's name, colours and the rest are the supplier's record
  /// and stay shut on its line. Its picture does not: a buyer holding the
  /// garment can take it, replace it or take it off from the order itself
  /// (owner, 2026-10-06) — saved to the item when the order is.
  const identityFixed = line !== undefined && !line.draftItem
  /// The photo's menu on a phone.
  const [photoMenu, setPhotoMenu] = useState(false)
  /// What the empty picture box says: the camera opens on a phone, so it says
  /// so (owner, 2026-10-05).
  const photoLabel = touch ? "Take a Photo" : "Choose a Picture"
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
    supplier_item_code:
      draft.code.trim() === "" ? autoItemCode() : draft.code.trim(),
    name: draft.name.trim(),
    description:
      draft.description.trim() === "" ? null : draft.description.trim(),
    // Nothing to name yet: a new item's picture is uploaded once the item
    // exists — see `createSupplierItemWithPhoto`.
    image_url: null,
    unit_price_minor: pricePerPiece,
    currency: "IDR",
    internal_article_code: null,
    status: "ACTIVE",
    division_code: draft.division,
    tags: [...draft.tags],
    colour_codes: [...draft.colours],
    size_codes: [...draft.sizes],
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
    setTried(false)
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
  const ordering = (onDraft !== undefined || line !== undefined) && !editing
  const unitBook = useUnits()
  /// Units this item can be ordered in: the base and every active global
  /// conversion — the per-item pack size is gone (owner, 2026-09-28), so
  /// every item offers the same units. A line already on an order says its
  /// own: an article's line only its stock unit and the article's units.
  const orderUnits: readonly { code: string; label: string }[] =
    line !== undefined
      ? line.units
      : unitBook.units.filter(
          (one) =>
            one.active &&
            unitFactor(one.code, unitBook.conversions, unitBook.baseUnit) !==
              null
        )
  const factorOf = (code: string) =>
    line !== undefined
      ? line.factorOf(code)
      : unitFactor(code, unitBook.conversions, unitBook.baseUnit)
  const baseUnit = line?.stockUnit ?? unitBook.baseUnit
  /// The unit the price is quoted in: the one being ordered, when the item
  /// goes straight onto an order (the owner, 2026-10-01 — "per unit, not
  /// always per pc"). `price` is that unit's, and the catalogue keeps the
  /// per-piece figure it comes to.
  const pricedIn =
    ordering && draft.orderUnit !== "" ? draft.orderUnit : baseUnit
  /// Pieces the price is per: 1 in the stock unit, else the unit's factor.
  const pricedFactorOf = (code: string) =>
    code === baseUnit ? 1 : Number(factorOf(code) ?? "1")
  const pricedFactor = pricedFactorOf(pricedIn)
  const unitLabel = (
    orderUnits.find((one) => one.code === pricedIn)?.label ?? "pc"
  ).toLowerCase()
  const pricePerPiece =
    pricedFactor > 1 ? Math.round(price / pricedFactor) : price
  /// Every SKU the chosen colours and sizes make — the grid the owner asked
  /// for when the item comes in variants. A catalogue item's line is ordered
  /// as a whole unless it already was by SKU: its colours are the supplier's
  /// and only shown here.
  const skuRows = variantRows(draft.colours, draft.sizes, draft.variants)
  const byVariant =
    skuRows.length > 0 &&
    (line === undefined || line.draftItem || line.variants.length > 0)
  const factor = factorOf(draft.orderUnit)
  /// A new unit keeps a line's price per piece, unless it was typed here.
  const changeUnit = (orderUnit: string) => {
    const now = Number.parseInt(draft.price, 10)
    set(
      line === undefined || priceTyped || !Number.isFinite(now)
        ? { orderUnit }
        : {
            orderUnit,
            price: String(
              Math.round(
                (now * pricedFactorOf(orderUnit)) / pricedFactorOf(pricedIn)
              )
            ),
          }
    )
  }
  /// Pieces this order wants: the SKU rows added up, or the quantity typed in
  /// its unit converted exactly.
  const quantity = byVariant
    ? variantPieces(skuRows)
    : factor === null
      ? null
      : wholeProduct(draft.quantity, factor)
  /// What is still missing, field by field. On an order the unit price
  /// must be more than nothing (the owner, 2026-09-28: every figure on a PO
  /// line is required); in the catalogue a free sample may cost 0.
  const gaps = {
    supplier:
      editing || draft.supplierId !== null ? null : "Choose a supplier.",
    name: draft.name.trim() === "" ? "Give it a name." : null,
    price:
      Number.isFinite(price) && (ordering ? price > 0 : price >= 0)
        ? null
        : "Fill in the price.",
    division: draft.division === null ? "Choose a division." : null,
    tags: draft.tags.length === 0 ? "Choose at least one tag." : null,
    quantity:
      !ordering || (quantity !== null && quantity > 0)
        ? null
        : "Fill in how many.",
    // Never at a loss or at cost — see `sellingProblem`.
    selling: sellingProblem(
      { purchase: draft.price, markup: draft.markup, base: draft.basePrice },
      byVariant ? skuRows : [],
      byVariant ? 1 : pricedFactor
    ),
  }
  const ready = Object.values(gaps).every((gap) => gap === null)
  const say = (gap: string | null) => (tried ? gap : null)

  const submit = (andNext: boolean) => {
    if (!ready) {
      setTried(true)
      requestAnimationFrame(() => {
        const first = body.current?.querySelector<HTMLElement>(
          '[id$="-problem"], [data-problem]'
        )
        first?.scrollIntoView({ block: "center", behavior: "smooth" })
        first
          ?.closest("label")
          ?.querySelector<HTMLElement>("input, textarea, button")
          ?.focus({ preventScroll: true })
      })
      return
    }
    if (line !== undefined) {
      // Nothing is written: the line goes back to the order it is on.
      onLine?.({
        name: draft.name.trim(),
        description: draft.description.trim(),
        division: draft.division,
        tags: draft.tags,
        colours: draft.colours,
        sizes: draft.sizes,
        quantity: byVariant ? String(quantity ?? 0) : draft.quantity.trim(),
        unit: byVariant ? line.stockUnit : draft.orderUnit,
        price: draft.price,
        markup: draft.markup,
        basePrice: draft.basePrice,
        variants: byVariant
          ? skuRows.filter((one) => Number.parseInt(one.quantity, 10) > 0)
          : [],
        photo,
        image: draft.image.trim() === "" ? null : draft.image.trim(),
      })
      return
    }
    if (onDraft !== undefined && !editing) {
      // Nothing is written: the line carries the item until the
      // order is raised. See `onDraft`.
      onDraft(
        {
          request: newItemRequest(),
          photo,
          key: crypto.randomUUID(),
          quantity: quantity ?? 1,
          unitCode: byVariant ? undefined : draft.orderUnit,
          unitQuantity: byVariant ? undefined : draft.quantity,
          unitPrice: byVariant || pricedFactor <= 1 ? undefined : draft.price,
          basePrice: draft.basePrice,
          markup: draft.markup,
          variants: byVariant
            ? skuRows.filter((one) => Number.parseInt(one.quantity, 10) > 0)
            : undefined,
        },
        andNext
      )
      setDraft(blank(supplierId ?? null))
      if (andNext) {
        // Straight on to the next one: the form is empty again and
        // the first box has the cursor. The sheet stays.
        setPhoto(null)
        setPhotoRefused(null)
        setTried(false)
        requestAnimationFrame(() => {
          body.current?.scrollTo({ top: 0 })
          body.current
            ?.querySelector<HTMLElement>(
              'input[type="text"], input:not([type])'
            )
            ?.focus({ preventScroll: true })
        })
        return
      }
      close()
      return
    }
    save.mutate()
  }

  /// Typed into, or a photograph picked, since the form opened: closing it
  /// then asks first. An outside click used to throw a half-filled item and
  /// its photo away without a word.
  const dirty =
    open &&
    (JSON.stringify(draft) !== JSON.stringify(seed()) ||
      (photo !== null && photo !== (line?.photo ?? null)))
  const [discarding, setDiscarding] = useState(false)
  const askClose = () => (dirty ? setDiscarding(true) : close())

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && askClose()}
        title={line?.title ?? (editing ? "Edit item" : "Add item")}
        id={line?.caption ?? (editing ? item.supplier_item_code : undefined)}
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
            <Button variant="ghost" onClick={askClose}>
              Cancel
            </Button>
            {onSkip !== undefined && (
              <Button variant="ghost" onClick={onSkip}>
                Skip this one
              </Button>
            )}
            {onDraft !== undefined && !editing && line === undefined && (
              <Button variant="ghost" onClick={() => submit(true)}>
                Add next item
              </Button>
            )}
            <Button
              variant="primary"
              pending={save.isPending}
              onClick={() => submit(false)}
            >
              {save.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        }
      >
        <div ref={body} className="flex flex-col gap-4">
          {save.isError && (
            <Banner tone="bad">{(save.error as Error).message}</Banner>
          )}
          {photoTrouble !== null && (
            <Banner tone="warn" onDismiss={() => setPhotoTrouble(null)}>
              The item is saved, but its photo is not: {photoTrouble}. Open the
              item from the catalogue to try the picture again.
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
            <Field label="Photo" problem={photoRefused ?? undefined}>
              <div className="flex flex-col gap-2">
                {touch ? (
                  // On a phone: the picture and ONE button, which opens the
                  // menu — take a photo, choose from the gallery, remove. Two
                  // buttons and a link ran past the edge of the form.
                  <div className="flex items-center gap-3">
                    {showing === null ? (
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-label="Add a photo"
                        onClick={() => setPhotoMenu(true)}
                        className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-card border border-hairline bg-soft-2 text-mute transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96]"
                      >
                        <ImagePlus className="size-6" />
                      </button>
                    ) : (
                      // A tap on the picture shows it full size.
                      <ZoomPhoto
                        url={showing}
                        name={draft.name}
                        className="size-16 overflow-hidden rounded-card border border-hairline"
                      >
                        <Thumbnail
                          url={showing}
                          fallback="Cannot be read"
                          className="size-16"
                        />
                      </ZoomPhoto>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => setPhotoMenu(true)}
                      aria-haspopup="dialog"
                    >
                      {showing === null ? "Add Photo" : "Edit Photo"}
                      <ChevronDown />
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => chooser.current?.click()}
                      className="group relative block aspect-square w-full overflow-hidden rounded-card border border-hairline bg-soft-2 transition-colors enabled:hover:border-hairline-strong"
                      aria-label={
                        showing === null
                          ? touch
                            ? "Take a photo"
                            : "Choose a photo"
                          : "Replace the photo"
                      }
                    >
                      {showing === null &&
                      (draft.name.trim() !== "" || draft.division !== null) ? (
                        <>
                          <Thumbnail
                            url={null}
                            name={draft.name}
                            division={draft.division}
                            colours={fill(draft.colours[0])}
                            className="size-full"
                          />
                          <span className="absolute inset-x-0 bottom-2 text-center text-[0.875rem] text-mute">
                            {photoLabel}
                          </span>
                        </>
                      ) : showing === null ? (
                        <span className="flex size-full flex-col items-center justify-center gap-1.5 text-mute">
                          <ImagePlus className="size-5" />
                          <span className="text-[0.875rem]">{photoLabel}</span>
                        </span>
                      ) : (
                        <Thumbnail
                          url={showing}
                          fallback="Cannot be read"
                          className="size-full"
                        />
                      )}
                    </button>
                    {showing !== null && (
                      // Beside the box, not inside it: a click on the box
                      // replaces the photo, a click here shows it.
                      <ZoomPhoto
                        url={showing}
                        name={draft.name}
                        className="absolute top-2 right-2 rounded-full"
                      >
                        <span className="grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                          <Maximize2 className="size-4" />
                        </span>
                      </ZoomPhoto>
                    )}
                  </div>
                )}
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
                  // On a phone: the rear camera, straight away. Ignored on a
                  // desktop, where this stays the file picker.
                  capture={touch ? "environment" : undefined}
                  onChange={pickPicture}
                />
                {touch && (
                  <input
                    ref={gallery}
                    type="file"
                    accept={PICTURE_TYPES}
                    className="hidden"
                    onChange={pickPicture}
                  />
                )}
                {showing !== null && !touch && (
                  <Button
                    variant="quiet"
                    size="sm"
                    className="self-start"
                    onClick={editPhoto}
                  >
                    <Pencil />
                    Edit Photo
                  </Button>
                )}
                {showing !== null && !touch && (
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
            {touch && (
              <BottomSheet
                open={photoMenu}
                onOpenChange={setPhotoMenu}
                title="Photo"
              >
                <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
                  {/* The file pickers are opened inside this press, not after
                    the sheet has closed: iOS only lets a gesture open one. */}
                  <button
                    type="button"
                    className={SHEET_ROW}
                    onClick={() => {
                      chooser.current?.click()
                      setPhotoMenu(false)
                    }}
                  >
                    <Camera className="size-5 shrink-0 text-line-ico" />
                    <span className="flex-1">Take a Photo</span>
                  </button>
                  <button
                    type="button"
                    className={SHEET_ROW}
                    onClick={() => {
                      gallery.current?.click()
                      setPhotoMenu(false)
                    }}
                  >
                    <Images className="size-5 shrink-0 text-line-ico" />
                    <span className="flex-1">From Gallery</span>
                  </button>
                  {showing !== null && (
                    <button
                      type="button"
                      className={SHEET_ROW}
                      onClick={() => {
                        editPhoto()
                        setPhotoMenu(false)
                      }}
                    >
                      <Pencil className="size-5 shrink-0 text-line-ico" />
                      <span className="flex-1">Edit Photo</span>
                    </button>
                  )}
                  {showing !== null && (
                    <button
                      type="button"
                      className={cn(SHEET_ROW, "text-bad-fg")}
                      onClick={() => {
                        setPhoto(null)
                        setPhotoRefused(null)
                        set({ image: "" })
                        setPhotoMenu(false)
                      }}
                    >
                      <Trash2 className="size-5 shrink-0" />
                      <span className="flex-1">Remove Photo</span>
                    </button>
                  )}
                </div>
              </BottomSheet>
            )}

            {reviewing !== null && (
              <PhotoSheet
                file={reviewing}
                canClean={canClean}
                onUse={(kept) => {
                  setPhoto(kept)
                  setReviewing(null)
                }}
                onRetake={() => {
                  setReviewing(null)
                  chooser.current?.click()
                }}
                onCancel={() => setReviewing(null)}
              />
            )}

            <div className="flex flex-col gap-4">
              {/* One column when the supplier is already known, two when it has
                to be asked. A lone code box occupying half a row, with the
                other half empty, reads as a field somebody forgot to fill in
                rather than as the only question on the line. */}
              {/* The supplier's own code is not asked for an item added from an
                order (the owner, 2026-10-01): the order's supplier is known and
                the item is given a code of ours. The catalogue still asks. */}
              {!editing &&
                line === undefined &&
                (supplierId === undefined || onDraft === undefined) && (
                  <div
                    className={cn(
                      "grid gap-4",
                      supplierId === undefined &&
                        onDraft === undefined &&
                        "md:grid-cols-2"
                    )}
                  >
                    {supplierId === undefined && (
                      <Field
                        label="Supplier"
                        required
                        problem={say(gaps.supplier)}
                      >
                        <PickOne
                          label="Supplier"
                          choices={supplierChoices}
                          value={draft.supplierId}
                          onChange={(chosen) => set({ supplierId: chosen })}
                        />
                      </Field>
                    )}
                    {onDraft === undefined && (
                      <Field label="Supplier's Item Code">
                        <Input
                          value={draft.code}
                          onChange={(event) =>
                            set({ code: event.target.value })
                          }
                        />
                      </Field>
                    )}
                  </div>
                )}

              <Field label="Name" required problem={say(gaps.name)}>
                <Input
                  value={draft.name}
                  onChange={(event) => titled(event, (name) => set({ name }))}
                />
              </Field>

              <Field label="Description">
                <Textarea
                  rows={3}
                  value={draft.description}
                  readOnly={identityFixed}
                  onChange={(event) =>
                    titled(
                      event,
                      (description) => set({ description }),
                      capitaliseFirst
                    )
                  }
                />
              </Field>

              {/* Grouped and prefixed, not a bare number box. `200000000` is a
                figure somebody has to count the zeros of; `Rp 200.000.000` is
                one they can read — and the money field hands back the digits
                either way, so nothing downstream learns about separators. */}
            </div>
          </div>

          {/* What it IS, and it has to be said. The same vocabulary our own
            articles are filed under — a supplier's shirt and our shirt have to
            be the same word, or the two catalogues cannot be compared, and
            comparing them is the whole point of sourcing. Both are required:
            see the note on `ready`. */}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Division" required problem={say(gaps.division)}>
              <PickOne
                label="Division"
                choices={divisionChoices}
                value={draft.division}
                onChange={(division) => set({ division })}
              />
            </Field>
            <Field label="Tags" required problem={say(gaps.tags)}>
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
              it is better shown as nothing than guessed at. Not asked on an order. */}
          {!ordering && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Colors">
                <PickMany
                  label="Colors"
                  choices={colourChoices}
                  loading={
                    colourMaster.isPending ? "Loading colours…" : undefined
                  }
                  values={draft.colours}
                  disabled={identityFixed}
                  onChange={(colours) => set({ colours })}
                  leading={(code) => <ColourSwatch hex={hexOf(code)} />}
                />
              </Field>
              <Field label="Sizes">
                <PickMany
                  label="Sizes"
                  choices={sizeChoices}
                  loading={vocabulary.isPending ? "Loading sizes…" : undefined}
                  values={draft.sizes}
                  disabled={identityFixed}
                  onChange={(sizes) => set({ sizes })}
                />
              </Field>
            </div>
          )}

          {/* What it costs and what it will sell for — the markup and the base
            price move together, so they cannot disagree. */}
          {!(ordering && !byVariant) && (
            <Section title="Price" rule={false}>
              {ordering ? (
                // On an order the item is bought, not priced for sale: one price,
                // what the supplier charges (the owner, 2026-10-01). Markup and the
                // selling price are the catalogue's to set.
                <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
                  <Field label="Price" required aside="per pc">
                    <Money
                      label="Price"
                      prefix="Rp"
                      value={draft.price}
                      onChange={(price) => {
                        setPriceTyped(true)
                        set({ price })
                      }}
                      className="pl-10"
                    />
                  </Field>
                </div>
              ) : (
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
                  sellingProblem={gaps.selling}
                />
              )}
              {say(gaps.price) !== null && (
                <span data-problem className="text-[0.875rem] text-bad">
                  {gaps.price}
                </span>
              )}
            </Section>
          )}

          {/* How many, when the item is going straight onto an order: one
            quantity in any unit, or — when it comes in colours and sizes —
            a quantity and a price per SKU. */}
          {ordering && (
            <div className="flex flex-col gap-3.5 pt-3">
              {byVariant && (
                <h4 className="text-card-title font-semibold text-ink">
                  Order
                </h4>
              )}
              {byVariant ? (
                <VariantGrid
                  variants={skuRows}
                  onChange={(variants) => set({ variants })}
                  colourLabel={(code) =>
                    colourTerms.find((one) => one.code === code)?.label ?? code
                  }
                  basePrice={draft.basePrice}
                  fallbackPrice={draft.price}
                  sizeLabel={(code) =>
                    sizeChoices.find((one) => one.value === code)?.label ?? code
                  }
                />
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* The number and its unit are one box: "10 | Kodi" is a
                      single quantity, not two answers. */}
                    <Field
                      label="Quantity"
                      required
                      problem={say(gaps.quantity)}
                    >
                      <div className="flex">
                        <Input
                          inputMode="decimal"
                          value={draft.quantity}
                          onChange={(event) =>
                            set({ quantity: event.target.value })
                          }
                          className="min-w-0 flex-1 rounded-r-none text-right tabular-nums"
                          aria-label="Quantity to order"
                        />
                        <Select
                          aria-label="Unit"
                          value={draft.orderUnit}
                          onChange={changeUnit}
                          className="-ml-px w-32 shrink-0 rounded-l-none"
                        >
                          {orderUnits.map((unit) => (
                            <option key={unit.code} value={unit.code}>
                              {unit.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </Field>
                    <Field label="Price" required problem={say(gaps.price)}>
                      <span className="relative flex w-full min-w-0 items-center">
                        <Money
                          label="Price"
                          prefix="Rp"
                          value={draft.price}
                          onChange={(price) => {
                            setPriceTyped(true)
                            set({ price })
                          }}
                          className="pr-20 pl-10"
                        />
                        <span className="pointer-events-none absolute right-3 text-[0.875rem] text-mute">
                          / {unitLabel}
                        </span>
                      </span>
                    </Field>
                  </div>
                  <p className="text-[0.875rem] text-body tabular-nums">
                    {/* Open hands: nothing typed, nothing said — the line speaks
                      once a quantity is in (owner, 2026-10-04: the quantity
                      opens empty). */}
                    {draft.quantity.trim() === ""
                      ? null
                      : quantity === null
                        ? "Not a whole number of pieces."
                        : `${count(quantity)} pcs`}
                    {Number.isFinite(price) &&
                      Number.isFinite(Number(draft.quantity)) &&
                      Number(draft.quantity) > 0 && (
                        <>
                          {" · Total "}
                          <span className="font-medium text-ink">
                            {money(
                              quantity === null
                                ? 0
                                : lineTotal(
                                    quantity,
                                    price,
                                    pricedFactor > 1 && !byVariant
                                      ? pricedFactor
                                      : null
                                  )
                            )}
                          </span>
                        </>
                      )}
                  </p>
                </div>
              )}
              {gaps.selling !== null && (
                <span data-problem className="text-[0.875rem] text-bad">
                  {gaps.selling}
                </span>
              )}
            </div>
          )}
        </div>
      </Sheet>
      <Dialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard This Item?"
        confirm="Discard"
        cancel="Keep Editing"
        tone="danger"
        onConfirm={() => {
          setDiscarding(false)
          close()
        }}
      >
        What you typed and the photo will be lost.
      </Dialog>
    </>
  )
}

/// A code for an item whose supplier gave none: `ITM-` and eight characters
/// of a fresh uuid, uppercased — unique enough within one supplier's shelf,
/// and the server's own uniqueness check is the backstop.
function autoItemCode(): string {
  return `ITM-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`
}
