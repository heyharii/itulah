import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, TriangleAlert, Wrench } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Choices, Section, type Tile } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { buildOf } from "@/lib/builds"
import { financeKeys, listAssetClasses } from "@/lib/queries/finance"
import {
  gaAssetBuilds,
  gaKeys,
  registerGaAsset,
  useGaSites,
} from "@/lib/queries/ga"
import type { GaBuildSpec } from "@itulah/contract"

/// Registering a thing, from the side of the person holding it.
///
/// # Build first, class second
///
/// The eleven builds are the eleven forms a thing comes in, and the fifty-nine
/// classes are the fifty-nine sets of accounts. Four of those classes are one
/// form — an air conditioner, a lift, an escalator and a genset are all a
/// machine with a capacity and a warranty — so asking for the class first would
/// be asking somebody to choose between four AC-shaped lists, and asking for
/// the build first narrows the class to the four that fit.
///
/// # The fields come from the server
///
/// `GET /api/v1/ga/asset-builds` is the same table `assert_specs` validates
/// against. A form that asks for a warranty date and a validator that refuses
/// one cannot both be right, and the only way to be sure they agree is for
/// there to be one list. A copy kept in the browser drifts the first time
/// somebody adds a field, and the symptom is a form that will not submit.
///
/// # No money, ever
///
/// Nothing on this sheet is a rupiah. What the thing is worth is Finance's
/// decision, taken afterwards, and a registration form that asked for a cost
/// would be a shop manager guessing at one.
export function RegisterAssetSheet({
  open,
  onClose,
  onRegistered,
  builds,
}: {
  open: boolean
  onClose: () => void
  onRegistered: (assetId: string) => void
  /// Which builds this screen offers: the builds of the reading the register
  /// is narrowed to, or all eleven when it is not. A licence is not offered
  /// from the vehicles, because it would be filed in the wrong place.
  builds: readonly string[]
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const schema = useQuery({
    queryKey: gaKeys.builds(),
    queryFn: ({ signal }) => gaAssetBuilds(signal),
    enabled: open,
    // The eleven are the client's own list and do not change while somebody
    // fills a form in. Refetching them on every open would be a request that
    // always answers the same thing.
    staleTime: Infinity,
  })

  // The class list, from the register itself rather than from a list of our
  // own: the classes ARE the client's own families, and the schema names which
  // of them fit the build while this names what the client calls each one. The
  // register's facets could not do both — a facet only exists for a class that
  // already holds something, and "Sepeda Motor" would print as its code.
  const classes = useQuery({
    queryKey: financeKeys.assetClasses(),
    queryFn: ({ signal }) => listAssetClasses(signal),
    enabled: open,
    staleTime: Infinity,
  })
  const { sites: siteOptions } = useGaSites(open)

  const offered = useMemo(
    () =>
      (schema.data?.builds ?? []).filter((one) => builds.includes(one.build)),
    [schema.data, builds]
  )

  // The first offered build, until somebody chooses. A default rather than an
  // empty form: the tiles are the first thing on the sheet, and an empty grid
  // reads as a question nobody has answered yet.
  const build = form.build ?? offered[0]?.build ?? ""
  const chosen: GaBuildSpec | undefined = offered.find(
    (one) => one.build === build
  )

  const save = useMutation({
    mutationFn: () =>
      registerGaAsset({
        asset_number: (form.asset_number ?? "").trim(),
        name: (form.name ?? "").trim(),
        class_code: form.class_code ?? "",
        site_id: form.site_id ?? "",
        sub_location: blank(form.sub_location),
        holder: blank(form.holder),
        condition: form.condition ?? "BAIK",
        serial_number: blank(form.serial_number),
        acquired_on: form.acquired_on ?? "",
        specs: specsOf(chosen, form),
        notes: blank(form.notes),
        quantity: form.quantity === undefined ? 1 : Number(form.quantity),
      }),
    onSuccess: (asset) => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({})
      onRegistered(asset.asset_id)
    },
  })

  const ready =
    (form.asset_number ?? "").trim() !== "" &&
    (form.name ?? "").trim() !== "" &&
    (form.class_code ?? "") !== "" &&
    (form.site_id ?? "") !== "" &&
    (form.acquired_on ?? "") !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Register asset"
      caption="GA registers the item at handover, with no rupiah value. Finance assesses its price once the bill arrives."
      width="wide"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {chosen ? buildOf(chosen.build).label : "Choose a type first"}
          </span>
          <div className="flex items-center gap-2">
            <Button data-cancel variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={save.isPending}
              disabled={!ready}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Register"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Asset type" aside="determines the fields below">
          {offered.length === 0 ? (
            <p className="text-meta text-mute">
              {schema.isLoading ? "Reading the list…" : "No types here."}
            </p>
          ) : (
            <Choices
              label="Asset type"
              columns={2}
              value={build}
              onChange={(next) => {
                // Changing the build changes which classes fit and which
                // fields are asked, so the answers to both are dropped rather
                // than carried into a form they do not belong to.
                setForm((current) => ({
                  ...current,
                  build: next,
                  class_code: "",
                }))
              }}
              options={offered.map((one) => ({
                value: one.build,
                label: buildOf(one.build).label,
                note: buildOf(one.build).note,
                icon: buildOf(one.build).icon,
              }))}
            />
          )}
        </Section>

        <Section title="Item">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Item name" required>
              <Input
                value={form.name ?? ""}
                onChange={(event) => set("name", event.target.value)}
              />
            </Field>
            <Field
              label="Asset code"
              required
              aside="the label stuck on the item"
            >
              <Input
                value={form.asset_number ?? ""}
                onChange={(event) => set("asset_number", event.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Class"
              required
              aside="determines the Finance account"
            >
              <Select
                value={form.class_code ?? ""}
                onChange={(next) => set("class_code", next)}
                aria-label="Class"
              >
                <option value="">Select…</option>
                {(chosen?.classes ?? []).map((code) => (
                  <option key={code} value={code}>
                    {className(classes.data?.classes, code)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Site" required>
              <Select
                value={form.site_id ?? ""}
                onChange={(next) => set("site_id", next)}
                aria-label="Site"
              >
                <option value="">Select…</option>
                {siteOptions.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label ?? one.value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Area" aside="building · floor · area">
              <Input
                value={form.sub_location ?? ""}
                onChange={(event) => set("sub_location", event.target.value)}
              />
            </Field>
            <Field label="Holder">
              <Input
                value={form.holder ?? ""}
                onChange={(event) => set("holder", event.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Serial / plate">
              <Input
                value={form.serial_number ?? ""}
                onChange={(event) => set("serial_number", event.target.value)}
              />
            </Field>
            <Field label="Date acquired" required>
              <Input
                type="date"
                value={form.acquired_on ?? ""}
                onChange={(event) => set("acquired_on", event.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Condition"
          aside="items needing service show up in Overview"
        >
          <Choices
            label="Condition"
            columns={3}
            value={form.condition ?? "BAIK"}
            onChange={(next) => set("condition", next)}
            options={
              [
                {
                  value: "BAIK",
                  label: "Good",
                  icon: Check,
                },
                {
                  value: "PERLU_SERVIS",
                  label: "Needs service",
                  icon: Wrench,
                },
                {
                  value: "RUSAK",
                  label: "Broken",
                  icon: TriangleAlert,
                },
              ] satisfies readonly Tile<string>[]
            }
          />
        </Section>

        {chosen !== undefined && chosen.fields.length > 0 && (
          <Section
            title={`Detail ${buildOf(chosen.build).label.toLowerCase()}`}
            aside="fields follow the build, not the class"
          >
            <div className="grid grid-cols-2 gap-4">
              {chosen.fields.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  required={field.required}
                >
                  <Input
                    type={field.kind === "DATE" ? "date" : "text"}
                    value={form[`spec:${field.key}`] ?? ""}
                    onChange={(event) =>
                      set(`spec:${field.key}`, event.target.value)
                    }
                  />
                </Field>
              ))}
            </div>
          </Section>
        )}

        <Section title="Notes">
          <Field label="Notes">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
        </Section>
      </div>
    </Sheet>
  )
}

/// The `specs` object, from the fields this build asks for.
///
/// Empty strings are dropped rather than sent: the server drops them anyway,
/// and sending `{"capacity": ""}` would be this screen asserting that the
/// capacity is empty rather than that nobody has measured it.
function specsOf(
  build: GaBuildSpec | undefined,
  form: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of build?.fields ?? []) {
    const value = (form[`spec:${field.key}`] ?? "").trim()
    if (value !== "") out[field.key] = value
  }
  return out
}

/// The client's own name for a class code, when the register knows one.
///
/// The codes come from the build schema and the names from the class list,
/// because the schema's job is which classes fit and the class list's job is
/// what the client calls them. A code with no name — a class nobody has filed
/// anything under yet — is shown as itself rather than hidden: it is still a
/// choice, and a missing option reads as a class that does not exist.
function className(
  classes: readonly { class_code: string; name: string }[] | undefined,
  code: string
): string {
  return classes?.find((one) => one.class_code === code)?.name ?? code
}

function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}
