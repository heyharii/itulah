import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Choices, Section } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { financeKeys, listAssets } from "@/lib/queries/finance"
import {
  gaKeys,
  gaSupplyCategories,
  recordGaSupplyRequest,
} from "@/lib/queries/ga"

/// Asking for something, as the place that needs it.
///
/// # The category is a card, not a dropdown
///
/// Because the category IS the choice the request turns on: each one proposes
/// the account its bills will charge, and the code rides on the card as its
/// `tag`, so the person asking sees "Rumah tangga · 6042" rather than having
/// to open a dropdown to learn what a word costs (brief §10.2, §9.4). Seven
/// cards fit a column; seven hidden options do not say anything until opened.
///
/// # Read from the server, never written here
///
/// The seven are `ga_supply_category`, seeded by the migration and the same
/// table the request is VALIDATED against — so the form and the validator
/// cannot disagree about what GA may ask for. The two categories that belong
/// to somebody else (Customer Supplies, kantong belanja) are absent from that
/// table by design, which is why no code in this file has to exclude them.
///
/// # Site first after the category
///
/// A request is for a PLACE — the shop that ran out, the mess that needs a
/// kettle — and the site is what makes the cost readable per location later.
/// The requester is a name, not a login: the form may be filled in for
/// somebody standing at the counter.
export function SupplyComposer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: (requestId: string) => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field takes its error back (brief §10.2): a problem sentence
    // survives only while the field itself is still wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  // The seven GA categories, with their accounts — the server's own list, the
  // same one the request is validated against.
  const categories = useQuery({
    queryKey: gaKeys.supplyCategories(),
    queryFn: ({ signal }) => gaSupplyCategories(signal),
    enabled: open,
    staleTime: Infinity,
  })

  // Sites, from Finance's facet — the same list every GA form offers, because
  // a site is a site in all of them.
  const shape = useQuery({
    queryKey: financeKeys.assets(false, null),
    queryFn: ({ signal }) => listAssets({ limit: 1 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const category = form.category ?? categories.data?.[0]?.category_code ?? ""

  const save = useMutation({
    mutationFn: () =>
      recordGaSupplyRequest({
        site_id: form.site ?? "",
        requested_by: (form.requested_by ?? "").trim(),
        category_code: category,
        item: (form.item ?? "").trim(),
        quantity: blank(form.quantity),
        needed_by: blank(form.needed_by),
        estimated_cost_minor:
          (form.estimate ?? "") === "" ? null : Number(form.estimate),
        notes: blank(form.notes),
      }),
    onSuccess: (row) => {
      // A new request moves the overview's new-request list and this screen's
      // own book; the GA namespace drops as one, as every GA write here does.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({})
      onSaved(row.request_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (category === "") next.category = "Pilih kategorinya dulu."
    if ((form.item ?? "").trim() === "") next.item = "Tulis barangnya dulu."
    if ((form.site ?? "") === "") next.site = "Pilih lokasinya dulu."
    if ((form.requested_by ?? "").trim() === "")
      next.requested_by = "Tulis nama pemintanya."
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title="Minta barang"
      caption="Barang habis pakai untuk kantor, gudang, toko dan mess. Akun yang diusulkan mengikuti kategorinya; tagihannya lahir di Finance."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {category === ""
              ? "Pilih kategori dulu"
              : (categories.data?.find((one) => one.category_code === category)
                  ?.name ?? "Kategori")}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button
              variant="primary"
              disabled={category === "" || save.isPending}
              onClick={submit}
            >
              {save.isPending ? "Mengajukan…" : "Ajukan"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Kategori" aside="tiap kartu memuat akun usulannya">
          {categories.data === undefined ? (
            <p className="text-meta text-mute">
              {categories.isLoading
                ? "Membaca daftar kategori…"
                : "Tidak ada kategori."}
            </p>
          ) : (
            <Choices
              label="Kategori"
              columns={2}
              value={category}
              onChange={(next) => set("category", next)}
              options={categories.data.map((one) => ({
                value: one.category_code,
                label: one.name,
                tag: one.account_code,
              }))}
            />
          )}
          {problems.category !== undefined && problems.category !== "" && (
            <p className="text-pill text-bad">{problems.category}</p>
          )}
        </Section>

        <Section title="Barangnya">
          <Field label="Barang" problem={problems.item || undefined}>
            <Input
              value={form.item ?? ""}
              onChange={(event) => set("item", event.target.value)}
              placeholder="mis. Lampu LED, kabel roll, stop kontak"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Jumlah" aside="teks bebas, mis. 10 pcs">
              <Input
                value={form.quantity ?? ""}
                onChange={(event) => set("quantity", event.target.value)}
                placeholder="10 pcs"
              />
            </Field>
            <Field label="Dibutuhkan">
              <Input
                type="date"
                value={form.needed_by ?? ""}
                onChange={(event) => set("needed_by", event.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Tempat dan peminta">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Lokasi" problem={problems.site || undefined}>
              <Select
                value={form.site ?? ""}
                onChange={(next) => set("site", next)}
                aria-label="Lokasi"
              >
                <option value="">Pilih…</option>
                {(shape.data?.facets.sites ?? []).map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label ?? one.value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Diminta oleh"
              problem={problems.requested_by || undefined}
            >
              <Input
                value={form.requested_by ?? ""}
                onChange={(event) => set("requested_by", event.target.value)}
                placeholder="mis. Kepala toko C007"
              />
            </Field>
          </div>
        </Section>

        <Section title="Estimasi dan catatan">
          <Field
            label="Estimasi biaya"
            aside="fakta GA; tagihan sebenarnya menyusul di Finance"
          >
            <Money
              value={form.estimate ?? ""}
              onChange={(next) => set("estimate", next)}
              placeholder="850000"
            />
          </Field>
          <Field label="Catatan">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="mis. untuk mess Cikarang"
            />
          </Field>
        </Section>

        {/* The one sentence this form owes the reader: two categories that look
            like they belong here are somebody else's. */}
        <p className="text-pill text-mute">
          Customer supplies dan kantong belanja tidak lewat sini: masing-masing
          milik Commercial dan Inventory.
        </p>
      </div>
    </Sheet>
  )
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}
