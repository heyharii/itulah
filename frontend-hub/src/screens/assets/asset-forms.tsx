import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Banknote,
  CircleCheck,
  CircleX,
  Trash2,
  TriangleAlert,
  Users,
  Wrench,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Choices } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import {
  gaAssetBuilds,
  gaKeys,
  recordGaReplacement,
  requestGaDisposal,
  transferGaAsset,
  updateGaAsset,
  useGaSites,
} from "@/lib/queries/ga"
import { assetRepairsQuery } from "@/lib/queries/ga-records"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { uploadDocument } from "@/lib/queries/workplace"
import { toast } from "@/lib/toast"
import { blank, specsOf } from "@/screens/assets/asset-words"
import type { GaAssetRow } from "@itulah/contract"

/// The things GA does TO an asset, each in its own layer over the asset sheet.
///
/// They were forms inside the body, opened one at a time under an "Actions"
/// heading. A form in the body put a second foot (its own Submit row) under
/// the sheet's, so each is now a rail sheet with the one foot a sheet has:
/// Cancel in red, the act in blue. The logic is what the inline forms had.

/// A thing that arrived on a bill and that nobody has walked the floor for.
///
/// The bill came first and made the row; GA's job is to say where the thing
/// actually is and who has it, which is the half a purchase document cannot
/// know.
export function CompleteDraft({ asset }: { asset: GaAssetRow }) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const schema = useQuery({
    queryKey: gaKeys.builds(),
    queryFn: ({ signal }) => gaAssetBuilds(signal),
    staleTime: Infinity,
  })
  const build = schema.data?.builds.find((one) => one.build === asset.build)

  const save = useMutation({
    mutationFn: () =>
      updateGaAsset(asset.asset_id, {
        name: blank(form.name),
        sub_location: blank(form.sub_location),
        holder: blank(form.holder),
        serial_number: blank(form.serial_number),
        condition: form.condition ?? asset.condition,
        specs: specsOf(build, form),
        // Absent means "no change" on this surface, and the form does not show
        // a note, so it sends the "leave it" spelling rather than the empty
        // string, which the server would take as "erase it".
        notes: null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("Details saved")
    },
  })

  const ready =
    (form.sub_location ?? "").trim() !== "" && (form.holder ?? "").trim() !== ""

  return (
    <section className="rounded-inner border border-warn-fg/30 bg-warn-bg/40 p-3.5">
      <h4 className="text-card-title font-semibold text-ink">
        The bill arrived first
      </h4>
      <p className="mt-1 mb-3 text-meta text-body">
        This asset was created automatically when Finance posted the bill. Make
        sure the item is there, then fill in its area and holder.
      </p>
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Area" required>
          <Input
            value={form.sub_location ?? ""}
            onChange={(event) => set("sub_location", event.target.value)}
          />
        </Field>
        <Field label="Holder" required>
          <Input
            value={form.holder ?? ""}
            onChange={(event) => set("holder", event.target.value)}
          />
        </Field>
        <Field label="Serial / plate">
          <Input
            value={form.serial_number ?? ""}
            onChange={(event) => set("serial_number", event.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="field-label text-[0.9375rem] text-mute">
            Condition
          </span>
          <Choices
            label="Condition"
            columns={3}
            value={form.condition ?? asset.condition}
            onChange={(next) => set("condition", next)}
            options={[
              { value: "BAIK", label: "Good", icon: CircleCheck },
              { value: "PERLU_SERVIS", label: "Needs service", icon: Wrench },
              { value: "RUSAK", label: "Broken", icon: CircleX },
            ]}
          />
        </div>
        {(build?.fields ?? []).map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              type={field.kind === "DATE" ? "date" : "text"}
              value={form[`spec:${field.key}`] ?? ""}
              onChange={(event) => set(`spec:${field.key}`, event.target.value)}
            />
          </Field>
        ))}
      </div>
      <div className="mt-3">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!ready}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save details"}
        </Button>
      </div>
    </section>
  )
}

/// Moving one, with a reason and a date.
///
/// The reason is required by the server and by the form: a thing that moves
/// without one is a thing nobody can reconcile six months later, and the site
/// is what Finance's next month of depreciation follows.
export function MoveSheet({
  asset,
  open,
  onClose,
}: {
  asset: GaAssetRow
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const { sites } = useGaSites(open)
  const [form, setForm] = useState<Record<string, string>>({
    occurred_on: today(),
  })
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const here = sites.find((one) => one.value === asset.site_id)?.label
  const move = useMutation({
    mutationFn: () =>
      transferGaAsset(asset.asset_id, {
        to_site: form.to_site ?? "",
        to_sub_location: blank(form.to_sub_location),
        to_holder: blank(form.to_holder),
        reason: (form.reason ?? "").trim(),
        occurred_on: form.occurred_on ?? "",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("Asset moved")
      onClose()
    },
  })

  const ready =
    (form.to_site ?? "") !== "" &&
    (form.reason ?? "").trim() !== "" &&
    (form.occurred_on ?? "") !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context={asset.asset_number}
      title="Move"
      caption={`From ${here ?? asset.site_id} · ${asset.sub_location ?? "no area"}`}
      dirty={(form.reason ?? "").trim() !== ""}
      footer={
        <SheetFooter
          error={move.error}
          note={ready ? undefined : "Choose the new site and write the reason."}
          onCancel={onClose}
          primary={{
            label: "Move",
            pending: move.isPending,
            disabled: !ready,
            onClick: () => move.mutate(),
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="To site" required>
          <Select
            value={form.to_site ?? ""}
            onChange={(next) => set("to_site", next)}
            aria-label="To site"
          >
            <option value="">Select…</option>
            {sites
              .filter((one) => one.value !== asset.site_id)
              .map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Date moved" required>
          <Day
            value={form.occurred_on ?? ""}
            onChange={(next) => set("occurred_on", next)}
            clearable={false}
          />
        </Field>
        <Field label="Area">
          <Input
            value={form.to_sub_location ?? ""}
            onChange={(event) => set("to_sub_location", event.target.value)}
          />
        </Field>
        <Field label="New holder">
          <Input
            value={form.to_holder ?? ""}
            onChange={(event) => set("to_holder", event.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reason" required>
            <Input
              value={form.reason ?? ""}
              onChange={(event) => set("reason", event.target.value)}
            />
          </Field>
        </div>
      </div>
    </Sheet>
  )
}

/// Proposing a replacement for this asset — the swap that ends with the old
/// thing marked REPLACED and a new one standing where it stood.
///
/// # Why the vendor and the repair are optional
///
/// The reason is required, because a swap without a why is a question six
/// months later. The vendor and the repair that led here are facts that may
/// not exist yet: a mannequin that cracks was never repaired, and the
/// supplier of the new one may not be chosen. The server takes them null;
/// the form does not invent them.
export function ReplaceSheet({
  asset,
  open,
  onClose,
  onSaved,
}: {
  asset: GaAssetRow
  open: boolean
  onClose: () => void
  /// The replacement is a record people read in Maintenance › Replacement; the
  /// proposal lands them on it rather than leaving them on a form that closed.
  onSaved?: (replacementId: string) => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({
    proposed_on: today(),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  // This asset's own repairs, so the one that led here can be named.
  const repairs = useQuery({
    ...assetRepairsQuery(asset.asset_id),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: () =>
      recordGaReplacement({
        old_asset_id: asset.asset_id,
        reason: (form.reason ?? "").trim(),
        repair_id: form.repair === "" ? null : (form.repair ?? null),
        supplier_id: form.vendor === "" ? null : (form.vendor ?? null),
        proposed_on: form.proposed_on ?? "",
      }),
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("Replacement proposed")
      onClose()
      onSaved?.(row.replacement_id)
    },
  })

  const submit = () => {
    if ((form.reason ?? "").trim() === "") {
      setProblems({ reason: "Write the reason first." })
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context={asset.asset_number}
      title="Propose replacement"
      dirty={(form.reason ?? "").trim() !== ""}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Propose replacement",
            pendingLabel: "Proposing…",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Reason for replacement"
          required
          problem={problems.reason || undefined}
        >
          <Input
            value={form.reason ?? ""}
            onChange={(event) => set("reason", event.target.value)}
          />
        </Field>
        <Field label="Related repair">
          <Select
            value={form.repair ?? ""}
            onChange={(next) => set("repair", next)}
            aria-label="Related repair"
          >
            <option value="">None</option>
            {(repairs.data?.rows ?? []).map((one) => (
              <option key={one.repair_id} value={one.repair_id}>
                {one.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor">
          <Select
            value={form.vendor ?? ""}
            onChange={(next) => set("vendor", next)}
            aria-label="Vendor"
          >
            <option value="">Not chosen yet</option>
            {(vendors.data?.rows ?? []).map((one) => (
              <option key={one.supplier_id} value={one.supplier_id}>
                {one.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date proposed" required>
          <Day
            value={form.proposed_on ?? ""}
            onChange={(next) => set("proposed_on", next)}
            clearable={false}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// The four ways an asset leaves the company, with the sale's proceeds asked
/// only when the thing is being SOLD. Filing the request marks the asset
/// DISPOSAL_REQUESTED; Finance's booking of the gain or loss is its own act.
export function DisposeSheet({
  asset,
  open,
  onClose,
  onSaved,
}: {
  asset: GaAssetRow
  open: boolean
  onClose: () => void
  /// The disposal is a record people read in Maintenance; the request lands
  /// them on it.
  onSaved?: (disposalId: string) => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({
    method: "SOLD",
    requested_on: today(),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const method = form.method ?? "SOLD"

  const save = useMutation({
    mutationFn: () =>
      requestGaDisposal({
        asset_id: asset.asset_id,
        method,
        // Proceeds only make sense for a sale; the wire CHECK agrees, so
        // the other three methods send absence rather than zero.
        proceeds_minor:
          method === "SOLD" && (form.proceeds ?? "") !== ""
            ? Number(form.proceeds)
            : null,
        reason: (form.reason ?? "").trim(),
        requested_on: form.requested_on ?? "",
      }),
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("Disposal requested")
      onClose()
      onSaved?.(row.disposal_id)
    },
  })

  const submit = () => {
    if ((form.reason ?? "").trim() === "") {
      setProblems({ reason: "Write the reason first." })
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context={asset.asset_number}
      title="Request disposal"
      dirty={(form.reason ?? "").trim() !== ""}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Request disposal",
            pendingLabel: "Requesting…",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Choices
          label="Disposal method"
          columns={2}
          value={method}
          onChange={(next) => set("method", next)}
          options={[
            { value: "SOLD", label: "Sold", icon: Banknote },
            { value: "SCRAPPED", label: "Scrap", icon: Trash2 },
            { value: "DONATED", label: "Donated", icon: Users },
            { value: "LOST", label: "Lost", icon: TriangleAlert },
          ]}
        />
        {method === "SOLD" && (
          <Field label="Sale proceeds">
            <Money
              prefix="Rp"
              value={form.proceeds ?? ""}
              onChange={(next) => set("proceeds", next)}
            />
          </Field>
        )}
        <Field label="Reason" required problem={problems.reason || undefined}>
          <Input
            value={form.reason ?? ""}
            onChange={(event) => set("reason", event.target.value)}
          />
        </Field>
        <Field label="Date requested" required>
          <Day
            value={form.requested_on ?? ""}
            onChange={(next) => set("requested_on", next)}
            clearable={false}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// Filing one file against this asset.
///
/// The file is uploaded first and the document filed afterwards, which is the
/// two-step the Library already uses: a slow photograph never blocks the form,
/// and a form that fails does not lose the upload.
///
/// # Why the file is filed from here and not from the Library
///
/// Because the person who has the paper in their hand is standing at the thing
/// it belongs to. Sending them to another screen to type the asset's number in
/// again is how a register ends up with the documents filed under nothing.
/// What they file still lands in the Library like every other document — this
/// is a door onto the same room, not a second drawer.
export function UploadSheet({
  asset,
  open,
  onClose,
}: {
  asset: GaAssetRow
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error("Choose the file first.")
      return uploadDocument(file, {
        title: blank(form.title) ?? undefined,
        doc_type: blank(form.doc_type) ?? undefined,
        doc_number: blank(form.doc_number) ?? undefined,
        issuer: blank(form.issuer) ?? undefined,
        issued_on: blank(form.issued_on) ?? undefined,
        expires_on: blank(form.expires_on) ?? undefined,
        path_tokens: ["GA", asset.asset_number],
        tags: [],
        links: [{ subject_kind: "asset", subject_id: asset.asset_id }],
      })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("File uploaded")
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context={asset.asset_number}
      title="Upload file"
      dirty={file !== null}
      footer={
        <SheetFooter
          error={save.error}
          note={file === null ? "Choose the file first." : undefined}
          onCancel={onClose}
          primary={{
            label: "Upload file",
            pendingLabel: "Uploading…",
            pending: save.isPending,
            disabled: file === null,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="File" required>
            <Input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        <Field label="Paper type">
          <Input
            value={form.doc_type ?? ""}
            onChange={(event) => set("doc_type", event.target.value)}
          />
        </Field>
        <Field label="Number">
          <Input
            value={form.doc_number ?? ""}
            onChange={(event) => set("doc_number", event.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Issuer">
            <Input
              value={form.issuer ?? ""}
              onChange={(event) => set("issuer", event.target.value)}
            />
          </Field>
        </div>
        <Field label="Issued">
          <Day
            value={form.issued_on ?? ""}
            onChange={(next) => set("issued_on", next)}
          />
        </Field>
        <Field label="Valid until">
          <Day
            value={form.expires_on ?? ""}
            onChange={(next) => set("expires_on", next)}
          />
        </Field>
      </div>
    </Sheet>
  )
}
