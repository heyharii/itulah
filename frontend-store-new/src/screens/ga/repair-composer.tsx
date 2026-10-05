import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { RecordSheet } from "@/components/ui/record-sheet"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import {
  coveringContract,
  gaKeys,
  knownVendors,
  lastVendorFor,
  noteGaAsset,
  recordGaRepair,
  useGaAssets,
  useGaPlace,
  useGaRepairObjects,
  useGaRepairs,
} from "@/lib/queries/ga"
import { useIdentity } from "@/lib/session"
import {
  classOf,
  repairObjectFor,
  repairObjectIcon,
  repairObjectWords,
  today,
} from "@/screens/ga/format"
import { ChoiceTiles, SheetBlock, TextArea } from "@/screens/ga/parts"
import { describeGa } from "@/screens/ga/state"
import type { GaAssetRow } from "@itulah/contract"

type Urgency = "LATER" | "SOON" | "URGENT"

const URGENCY: readonly { value: Urgency; label: string; says: string }[] = [
  { value: "LATER", label: "Can wait", says: "can wait" },
  { value: "SOON", label: "This week", says: "should be fixed this week" },
  {
    value: "URGENT",
    label: "Urgent",
    says: "urgent — it is affecting trading or safety",
  },
]

/// Telling head office something is broken, from the shop it broke in.
///
/// # Two ways to tell them, when there is an asset
///
/// A **repair request** (`POST /ga/repairs`) is a job: it lands on GA's repair
/// book and climbs the ladder there — approved, being fixed, fixed. A **note**
/// (`POST /ga/assets/{id}/notes`) is a line on the thing's own history that
/// changes nothing else — "moved to the stockroom", "rattles when it starts".
/// The note needs an asset to hang on; a leak in the ceiling is a repair or
/// nothing.
///
/// # Who fixes it, and why the shop is asked
///
/// A repair must name a vendor — the column is NOT NULL at the centre — and
/// the company's vendor book is head office's, not the till's to browse. So
/// the choice is the vendors this shop already has on record: its contracts'
/// parties and whoever fixed something here before. The one under a
/// maintenance contract for this thing (or this kind of thing) is put first,
/// and the contract rides on the repair. GA can re-assign it afterwards; a
/// shop with no vendor on record at all is told so and offered the note.
///
/// # Urgency has no column
///
/// The repair record carries no priority, so the shop's urgency is written
/// where head office reads it: the first line of the notes always, and an
/// "[Urgent]" in front of the title when it is — the title is the one line
/// GA's list shows.
///
/// No photo, no estimate. A photo is not required, and what a repair costs is
/// the vendor's quote and Finance's bill, not a number typed at a counter.
export function RepairComposer({
  open,
  onClose,
  site,
  asset,
  onFiled,
}: {
  open: boolean
  onClose: () => void
  site: string
  /// The thing it is about, when the composer was opened from its sheet. It
  /// is then fixed rather than chosen.
  asset?: GaAssetRow | null
  /// Told what was filed, so the screen can say so.
  onFiled?: (what: "repair" | "note") => void
}) {
  const client = useQueryClient()
  const me = useIdentity()
  const assets = useGaAssets(site)
  const objects = useGaRepairObjects(open)
  const place = useGaPlace(site)
  const repairs = useGaRepairs(site)

  const [mode, setMode] = useState<"repair" | "note">("repair")
  const [assetId, setAssetId] = useState<string>(asset?.asset_id ?? "")
  const [objek, setObjek] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [details, setDetails] = useState("")
  const [urgency, setUrgency] = useState<Urgency>("SOON")
  const [vendor, setVendor] = useState<string | null>(null)
  const [noticed, setNoticed] = useState(today())
  const [tried, setTried] = useState(false)

  const chosen: GaAssetRow | undefined =
    asset ?? assets.data?.rows.find((one) => one.asset_id === assetId)
  const withAsset = chosen !== undefined
  // The class decides the object for most things; when it does not, the
  // person is asked, because the server would refuse the repair otherwise.
  const derived = chosen === undefined ? null : repairObjectFor(chosen)
  const askObject = !withAsset || derived === null
  const effective = derived ?? objek
  const vendors = knownVendors(place.data, repairs.data)
  const covering = coveringContract(
    place.data,
    chosen?.asset_id ?? null,
    effective,
  )
  const suggested =
    covering?.supplier_id ??
    lastVendorFor(repairs.data, chosen?.asset_id ?? null, effective)
  // The person's choice wins; until they make one, the covering vendor (or
  // whoever fixed it last) stands in the box.
  const who =
    vendor ??
    (suggested !== undefined &&
    vendors.some((one) => one.supplier_id === suggested)
      ? suggested
      : null)
  const noting = withAsset && mode === "note"
  const says = URGENCY.find((one) => one.value === urgency)?.says ?? ""

  const reset = () => {
    setMode("repair")
    setAssetId(asset?.asset_id ?? "")
    setObjek(null)
    setTitle("")
    setDetails("")
    setUrgency("SOON")
    setVendor(null)
    setNoticed(today())
    setTried(false)
  }

  const file = useMutation({
    mutationFn: async (): Promise<"repair" | "note"> => {
      if (noting && chosen !== undefined) {
        await noteGaAsset(chosen.asset_id, {
          reason: [
            title.trim(),
            details.trim() === "" ? null : details.trim(),
            `Urgency: ${says}.`,
          ]
            .filter((line) => line !== null)
            .join(" — "),
        })
        return "note"
      }
      await recordGaRepair({
        // Always this shop. The asset is this shop's too — the list it was
        // chosen from was asked for this site and nothing else.
        site_id: site,
        asset_id: chosen?.asset_id ?? null,
        // Absent when the asset's class decides it: the server derives the
        // object itself, so the form and the account cannot disagree.
        objek: askObject ? objek : null,
        title: `${urgency === "URGENT" ? "[Urgent] " : ""}${title.trim()}`,
        supplier_id: who ?? "",
        contract_id:
          covering !== undefined && covering.supplier_id === who
            ? covering.contract_id
            : null,
        task_id: null,
        inspection_id: null,
        estimated_cost_minor: null,
        failure_at: noticed,
        notes: [
          `Urgency: ${says}.`,
          details.trim() === "" ? null : details.trim(),
          `Reported from the shop by ${me.data?.display_name ?? me.data?.username ?? "the till"}.`,
        ]
          .filter((line) => line !== null)
          .join("\n"),
      })
      return "repair"
    },
    onSuccess: (what) => {
      void client.invalidateQueries({ queryKey: gaKeys.all() })
      reset()
      onFiled?.(what)
      onClose()
    },
  })

  const problems = {
    title: title.trim() === "" ? "Say what is wrong." : null,
    objek:
      !noting && askObject && objek === null
        ? "Choose a kind."
        : null,
    vendor:
      !noting && who === null
        ? vendors.length === 0
          ? null
          : "Choose who should fix it."
        : null,
  }
  const blocked = !noting && vendors.length === 0 && !place.isPending
  const submit = () => {
    setTried(true)
    if (
      problems.title !== null ||
      problems.objek !== null ||
      problems.vendor !== null ||
      blocked
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
      title={asset ? "Report a problem" : "New repair request"}
      caption={
        chosen !== undefined
          ? `${chosen.name} · ${chosen.asset_number}`
          : undefined
      }
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={file.isPending} onClick={submit}>
            {file.isPending
              ? "Sending…"
              : noting
                ? "Add the note"
                : "Send to head office"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {file.error !== null && (
          <Banner tone="bad">{describeGa(file.error)}</Banner>
        )}

        {withAsset && (
          <Segmented
            value={mode}
            onChange={setMode}
            className="[&>button]:pointer-coarse:h-tap"
            options={[
              { value: "repair", label: "Needs fixing" },
              { value: "note", label: "Just a note" },
            ]}
          />
        )}

        <SheetBlock title="What is it">
          <div className="flex flex-col gap-3">
            {asset ? (
              <p className="text-cell text-body">
                {asset.name} · {asset.class_name}
                {asset.sub_location !== null && ` · ${asset.sub_location}`}
              </p>
            ) : (
              <Field
                label="Asset"
                hint={
                  chosen !== undefined
                    ? `${classOf(chosen.build).label} · ${chosen.class_name}${chosen.sub_location !== null ? ` · ${chosen.sub_location}` : ""}`
                    : "Empty for the building itself"
                }
              >
                <Select
                  value={assetId}
                  onChange={(next) => {
                    setAssetId(next)
                    setObjek(null)
                    setVendor(null)
                  }}
                  aria-label="Asset"
                >
                  <option value="">Not a registered asset</option>
                  {(assets.data?.rows ?? []).map((one) => (
                    <option key={one.asset_id} value={one.asset_id}>
                      {one.name} · {one.asset_number}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!noting && askObject && (
              <div className="flex flex-col gap-1.5">
                <span className="text-meta font-medium text-text">
                  {withAsset
                    ? "Kind of repair"
                    : "What kind of thing"}
                </span>
                {objects.isPending ? (
                  <p className="text-meta text-mute">Loading…</p>
                ) : objects.isError ? (
                  <p className="text-meta text-bad">
                    {describeGa(objects.error)}
                  </p>
                ) : (
                  <ChoiceTiles
                    label="What kind of thing"
                    value={objek}
                    onChange={(next) => {
                      setObjek(next)
                      setVendor(null)
                    }}
                    options={(objects.data ?? []).map((one) => ({
                      value: one.code,
                      label: repairObjectWords(one.code, one.name),
                      icon: repairObjectIcon(one.code),
                    }))}
                  />
                )}
                {tried && problems.objek !== null && (
                  <span className="text-meta text-bad">{problems.objek}</span>
                )}
              </div>
            )}
          </div>
        </SheetBlock>

        <SheetBlock title="What is wrong">
          <div className="flex flex-col gap-3">
            <Field
              label={noting ? "Note" : "In one line"}
              problem={tried ? problems.title : null}
            >
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  noting
                    ? "Moved to the stockroom"
                    : "AC by the till is not cooling"
                }
                invalid={tried && problems.title !== null}
              />
            </Field>
            <Field
              label="More detail"
              hint="Optional"
            >
              <TextArea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="Since this morning. Dripping water onto the counter."
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-meta font-medium text-text">
                How urgent
              </span>
              <Segmented
                value={urgency}
                onChange={setUrgency}
                className="[&>button]:pointer-coarse:h-tap"
                options={URGENCY.map((one) => ({
                  value: one.value,
                  label: one.label,
                }))}
              />
            </div>
          </div>
        </SheetBlock>

        {!noting && (
          <SheetBlock title="Who should fix it">
            {blocked ? (
              <Banner tone="warn">
                No supplier on record for this shop.{" "}
                {withAsset
                  ? "Add a note on the asset instead."
                  : "Pick an asset to leave a note, or call GA."}
              </Banner>
            ) : (
              <div className="flex flex-col gap-3">
                <Field
                  label="Supplier"
                  hint={
                    covering !== undefined && covering.supplier_id === who
                      ? `Under ${covering.contract_number ?? "the maintenance contract"}`
                      : undefined
                  }
                  problem={tried ? problems.vendor : null}
                >
                  <Select
                    value={who ?? ""}
                    onChange={(next) => setVendor(next === "" ? null : next)}
                    aria-label="Supplier"
                    disabled={place.isPending || repairs.isPending}
                  >
                    <option value="">
                      {place.isPending || repairs.isPending
                        ? "Loading…"
                        : "Choose…"}
                    </option>
                    {vendors.map((one) => (
                      <option key={one.supplier_id} value={one.supplier_id}>
                        {one.name} · {one.why}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Noticed on">
                  <Input
                    type="date"
                    value={noticed}
                    max={today()}
                    onChange={(event) =>
                      setNoticed(
                        event.target.value === ""
                          ? today()
                          : event.target.value,
                      )
                    }
                  />
                </Field>
              </div>
            )}
          </SheetBlock>
        )}
      </div>
    </RecordSheet>
  )
}
