import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AppWindow,
  Armchair,
  Building2,
  Car,
  Droplets,
  Monitor,
  MoveVertical,
  Paintbrush,
  Snowflake,
  Zap,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Choices, Section, Toggle } from "@/components/ui/form"
import type { Tile } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import {
  financeKeys,
  listAssets,
  siteAccounts,
  type SiteAccount,
} from "@/lib/queries/finance"
import { gaKeys, gaContractTypes, recordGaContract } from "@/lib/queries/ga"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { CONTRACT_GROUPS } from "@/screens/contracts/groups"
import { FinanceMark } from "@/screens/contracts/parts"
import type { GaContractType } from "@itulah/contract"

/// Recording a contract, the way the paper describes it.
///
/// # Group first, then type, then the rest
///
/// The six groups are how the register is read, and the seventeen types are
/// how a deal is named; asking for the type first would be one flat list of
/// seventeen. Each type card carries the accounts it proposes at the chosen
/// site (`1038 → 7004`) — codes the reader checks, not prose — because the
/// whole point of recording a contract is that Finance can bill it without
/// asking GA which account they meant.
///
/// # The accounts are read, never kept
///
/// The proposed accounts come from the account map for the chosen site, the
/// same place Finance's posting rules read. A copy of the vocabulary in the
/// browser would propose an account the map had stopped pointing at; this box
/// can only ever show what the map says today.
export function ContractComposer({
  open,
  group,
  onClose,
  onSaved,
}: {
  open: boolean
  /// The group the register was narrowed to when Add contract was pressed, so
  /// the composer opens on the chip it came from; empty when it was showing
  /// every group, and the composer asks for one first.
  group: string
  onClose: () => void
  onSaved: (contractId: string) => void
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

  // `group` is the door this composer was opened from; the screen keys the
  // composer by it, so a cancelled form never leaks a type from one door into
  // another, and the form starts following its door's group.
  const groupCode = form.group || group
  const typeCode = form.type ?? ""
  const disewakan = groupCode === "DISEWAKAN"
  const langganan = groupCode === "LANGGANAN"
  const scope = form.scope ?? "SITE"

  // The site list, from the register's facets — the same cached answer the
  // asset register asks, because a site is a site in both forms.
  const shape = useQuery({
    queryKey: financeKeys.assets(false, null),
    queryFn: ({ signal }) => listAssets({ limit: 1 }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })
  const site = form.site || null

  // The types, with their proposed accounts, resolved for the chosen site —
  // and for the server's default site while no site is chosen, which is the
  // same reading Finance starts from.
  const types = useQuery({
    queryKey: gaKeys.contractTypes(site),
    queryFn: ({ signal }) => gaContractTypes(site, signal),
    enabled: open,
  })

  // The vendors, from the book of parties that send bills — the same list
  // Vendors keeps, narrowed to it.
  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // What every role resolves to at the chosen site: the proposed accounts
  // below are FILTERED out of this one read. No new route — the account links
  // are the source.
  const map = useQuery({
    queryKey: financeKeys.siteAccounts(site),
    queryFn: ({ signal }) => siteAccounts(site, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const type = types.data?.find((one) => one.code === typeCode)
  const multiSite = typeCode !== "" && MULTI_SITE_TYPES.includes(typeCode)

  const proposed: readonly { role: string; code: string; name: string }[] =
    type === undefined
      ? []
      : [
          ...(type.prepaid_account_code !== null
            ? [
                {
                  role: "Prepaid",
                  code: type.prepaid_account_code,
                  name: mapName(
                    map.data,
                    "prepaid_expense",
                    type.prepaid_account_code
                  ),
                },
              ]
            : []),
          ...(type.expense_account_code !== null
            ? [
                {
                  role: "Expense",
                  code: type.expense_account_code,
                  name: mapName(map.data, "contract_expense", typeCode),
                },
              ]
            : typeCode === "JASA_MAINTENANCE"
              ? [
                  {
                    role: "Expense",
                    code:
                      REPAIR_OBJECTS.find((one) => one.value === form.objek)
                        ?.code ?? "—",
                    name: `follows the object being maintained${
                      form.objek === undefined
                        ? ""
                        : ` · ${REPAIR_OBJECTS.find((one) => one.value === form.objek)?.label}`
                    }`,
                  },
                ]
              : typeCode === "SEWA_KENDARAAN"
                ? [
                    {
                      role: "Expense",
                      code: "—",
                      name: "Vehicle rental expense not yet in COA",
                    },
                  ]
                : []),
          ...(ACCRUAL_KIND_OF[typeCode]
            ? [
                {
                  role: "YMHD",
                  code:
                    map.data?.find(
                      (row) =>
                        row.role === "accrued_expense" &&
                        row.source_id === ACCRUAL_KIND_OF[typeCode]
                    )?.account_code ?? "—",
                  name:
                    map.data?.find(
                      (row) =>
                        row.role === "accrued_expense" &&
                        row.source_id === ACCRUAL_KIND_OF[typeCode]
                    )?.account_name ?? "",
                },
              ]
            : []),
          ...(type.income_account_code !== null
            ? [
                {
                  role: "Income",
                  code: type.income_account_code,
                  name: mapName(map.data, "contract_income", typeCode),
                },
              ]
            : []),
        ]

  const save = useMutation({
    mutationFn: () =>
      recordGaContract({
        contract_number: blank(form.contract_number),
        contract_type: typeCode,
        objek: typeCode === "JASA_MAINTENANCE" ? (form.objek ?? null) : null,
        supplier_id: disewakan ? null : (form.vendor ?? null),
        counterparty_name: disewakan ? blank(form.tenant) : null,
        site_id: scope === "SITE" ? (form.site ?? null) : null,
        site_scope: scope === "SITE" ? null : scope,
        asset_id: null,
        starts_on: form.starts_on ?? "",
        ends_on: blank(form.ends_on),
        contract_value_minor:
          blank(form.value) === null ? null : Number(form.value),
        is_signed: form.signed === "yes",
        signed_by: form.signed === "yes" ? blank(form.signed_by) : null,
        customer_number: langganan ? blank(form.customer_number) : null,
        // The server's default reminder window, sent because the request's
        // field has no way to say "leave it".
        reminder_days: 60,
        notes: blank(form.notes),
      }),
    onSuccess: (row) => {
      // A new contract moves the overview's expiring list and the register's
      // every reading; the GA namespace drops as one, as every GA write here
      // does.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({})
      onSaved(row.contract_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (!disewakan && (form.vendor ?? "") === "")
      next.vendor = "Choose a vendor first."
    if (disewakan && (form.tenant ?? "").trim() === "")
      next.tenant = "Enter the tenant's name first."
    if (!multiSite && scope === "SITE" && (form.site ?? "") === "")
      next.site = "Choose a site first."
    if ((form.starts_on ?? "") === "") next.starts_on = "Enter the start date."
    if (
      (form.starts_on ?? "") !== "" &&
      (form.ends_on ?? "") !== "" &&
      form.ends_on <= form.starts_on
    ) {
      next.ends_on = "The end date must be after the start date."
    }
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  const typeOptions = (types.data ?? []).filter(
    (one) => one.group_code === groupCode
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title="New contract"
      caption="This records the agreement: its type, party and time window. Bills are still raised in Finance."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {type === undefined ? "Choose a type first" : type.name}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" pending={save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Save contract"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Group" aside="same door as the register">
          <Choices
            label="Group"
            columns={3}
            value={groupCode}
            onChange={(next) => {
              // Changing the group changes which types fit, so the type —
              // and everything the type asked for — is dropped rather than
              // carried into a form it does not belong to.
              setForm((current) => ({
                ...current,
                group: next,
                type: "",
                objek: "",
              }))
            }}
            options={CONTRACT_GROUPS.map((one) => ({
              value: one.group_code,
              label: one.label,
              icon: one.icon,
            }))}
          />
        </Section>

        <Section title="Contract type" aside="the card carries its proposed accounts">
          {typeOptions.length === 0 ? (
            <p className="text-meta text-mute">
              {/* Opened from the whole register rather than from one group,
                  the composer has no group yet — say what comes first. */}
              {groupCode === ""
                ? "Pick a group first."
                : types.isLoading
                  ? "Reading the list…"
                  : "No types in this group."}
            </p>
          ) : (
            <Choices
              label="Contract type"
              columns={2}
              value={typeCode}
              onChange={(next) => {
                setForm((current) => ({
                  ...current,
                  type: next,
                  // The object belongs to maintenance alone; the scope
                  // answers reset with the type that permits them.
                  objek: "",
                  scope: "SITE",
                }))
              }}
              options={typeOptions.map((one) => ({
                value: one.code,
                label: one.name,
                tag: typeTag(one),
              }))}
            />
          )}
        </Section>

        {typeCode === "JASA_MAINTENANCE" && (
          <Section title="Object being maintained" aside="expense follows the object">
            <Choices
              label="Object being maintained"
              columns={3}
              value={form.objek ?? "AC"}
              onChange={(next) => set("objek", next)}
              options={REPAIR_OBJECTS}
            />
          </Section>
        )}

        <Section title="Party and location">
          {disewakan ? (
            <Field
              label="Tenant"
              required
              aside="text, not a vendor"
              problem={problems.tenant || undefined}
            >
              <Input
                value={form.tenant ?? ""}
                onChange={(event) => set("tenant", event.target.value)}
                placeholder="Employee Cooperative"
              />
            </Field>
          ) : (
            <Field
              label="Party (vendor)"
              required
              problem={problems.vendor || undefined}
            >
              <Select
                value={form.vendor ?? ""}
                onChange={(next) => set("vendor", next)}
                aria-label="Party (vendor)"
              >
                <option value="">Choose a vendor…</option>
                {(vendors.data?.rows ?? []).map((one) => (
                  <option key={one.supplier_id} value={one.supplier_id}>
                    {one.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {multiSite ? (
            <>
              {/* One contract CAN span the estate (brief §13) — four types
                  may, and for them the scope is the question before the site
                  is. */}
              <Choices
                label="Scope"
                columns={3}
                value={scope}
                onChange={(next) => set("scope", next)}
                options={[
                  { value: "SITE", label: "One site" },
                  { value: "ALL_STORES", label: "All stores" },
                  { value: "ALL_SITES", label: "All sites" },
                ]}
              />
              {scope === "SITE" && (
                <Field label="Site" problem={problems.site || undefined}>
                  <SiteSelect
                    sites={shape.data?.facets.sites ?? []}
                    site={form.site ?? ""}
                    onChange={(next) => set("site", next)}
                  />
                </Field>
              )}
            </>
          ) : (
            <Field label="Site" problem={problems.site || undefined} required>
              <SiteSelect
                sites={shape.data?.facets.sites ?? []}
                site={form.site ?? ""}
                onChange={(next) => set("site", next)}
              />
            </Field>
          )}

          {langganan && (
            <Field
              label="Customer no."
              aside="PLN / PDAM / Telkom connection number"
            >
              <Input
                value={form.customer_number ?? ""}
                onChange={(event) => set("customer_number", event.target.value)}
                placeholder="5381 2294 0017"
              />
            </Field>
          )}
        </Section>

        <Section title="Term and value">
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Number on the agreement"
              aside="the paper's own number, not made up"
            >
              <Input
                value={form.contract_number ?? ""}
                onChange={(event) => set("contract_number", event.target.value)}
                placeholder="e.g. 01/C007-PTS/2026"
              />
            </Field>
            <Field label="Notes" aside="appears below the party in the register">
              <Input
                value={form.notes ?? ""}
                onChange={(event) => set("notes", event.target.value)}
                placeholder="Store C009 · unit 1-04"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Starts"
              problem={problems.starts_on || undefined}
              required
            >
              <Input
                type="date"
                value={form.starts_on ?? ""}
                onChange={(event) => set("starts_on", event.target.value)}
              />
            </Field>
            <Field
              label="Ends"
              aside="empty = open-ended"
              problem={problems.ends_on || undefined}
            >
              <Input
                type="date"
                value={form.ends_on ?? ""}
                onChange={(event) => set("ends_on", event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Contract value"
            aside="total for the whole contract, can be left empty"
          >
            <Money
              value={form.value ?? ""}
              onChange={(next) => set("value", next)}
              placeholder="360000000"
            />
          </Field>
        </Section>

        <Section title="Signature">
          <Toggle
            on={form.signed === "yes"}
            onToggle={() =>
              setForm((current) => ({
                ...current,
                signed: current.signed === "yes" ? "" : "yes",
              }))
            }
            label="Signed"
            note={
              form.signed === "yes"
                ? "Yes — say who signed"
                : "Not signed yet"
            }
          />
          {form.signed === "yes" && (
            <Field label="Signed by">
              <Input
                value={form.signed_by ?? ""}
                onChange={(event) => set("signed_by", event.target.value)}
                placeholder="e.g. GA Manager"
              />
            </Field>
          )}
        </Section>

        <Section
          title="Accounts proposed to Finance"
          aside="from this site's account map"
        >
          {proposed.length === 0 ? (
            <p className="text-meta text-mute">
              Choose the type first — proposed accounts follow the contract
              type and site.
            </p>
          ) : (
            <div className="flex flex-col">
              {proposed.map((row) => (
                <div
                  key={`${row.role}:${row.code}`}
                  className="flex items-baseline gap-3 border-b border-hairline py-2 last:border-b-0"
                >
                  <span className="w-28 shrink-0 text-meta text-body">
                    {row.role}
                  </span>
                  <span className="w-14 shrink-0 font-mono text-id text-body tabular-nums">
                    {row.code}
                  </span>
                  <span className="min-w-0 truncate text-meta text-mute">
                    {row.name}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="flex items-center gap-1.5 text-pill text-mute">
            <FinanceMark className="align-[0.0625rem]" /> Set by Finance in
            the Account map; proposed on the bill line, and Finance can still
            change it.
          </p>
        </Section>
      </div>
    </Sheet>
  )
}

/// One site picker, shared by the two shapes the question takes.
function SiteSelect({
  sites,
  site,
  onChange,
}: {
  sites: readonly { value: string; label: string | null }[]
  site: string
  onChange: (next: string) => void
}) {
  return (
    <Select value={site} onChange={onChange} aria-label="Site">
      <option value="">Choose…</option>
      {sites.map((one) => (
        <option key={one.value} value={one.value}>
          {one.label ?? one.value}
        </option>
      ))}
    </Select>
  )
}

/// The card's account tag, in the prototype's arrow grammar: prepaid →
/// expense, or the income for the two Leased out types. A deliberate gap says
/// itself ("object", "no expense yet") rather than printing a dash, because a
/// dash reads as data nobody typed and these are decisions somebody made.
function typeTag(type: GaContractType): string {
  const parts: string[] = []
  if (type.prepaid_account_code !== null) parts.push(type.prepaid_account_code)
  if (type.code === "JASA_MAINTENANCE") parts.push("object")
  else if (type.expense_account_code !== null)
    parts.push(type.expense_account_code)
  else if (type.code === "SEWA_KENDARAAN") parts.push("no expense yet")
  if (type.income_account_code !== null) parts.push(type.income_account_code)
  return parts.join(" → ")
}

/// The linked account's name for a (role, source) pair, looked up by code
/// when the source vocabulary is not the type code's. `undefined` map =
/// still loading; the code stands alone until the name arrives.
function mapName(
  map: readonly SiteAccount[] | undefined,
  role: string,
  code: string
): string {
  return (
    map?.find(
      (row) =>
        row.role === role &&
        (row.account_code === code || row.source_id === code)
    )?.account_name ?? ""
  )
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/// The four types a contract may span the estate for, as the server's own
/// constant names them (`MULTI_SITE_TYPES` in `domain/ga.rs`). Every other
/// type must carry one site, and the server refuses the rest — this list is
/// the form asking the same question, not the answer.
const MULTI_SITE_TYPES: readonly string[] = [
  "SEWA_TOKO",
  "JASA_MAINTENANCE",
  "JASA_CLEANING",
  "ASURANSI_PROPERTI",
]

/// The eleven objects a maintenance contract can be about, with the account
/// each one's repairs charge — the `ga_repair_object` table (migration 0359).
///
/// Written here because tahap 3 serves no endpoint for the table; tahap 4's
/// repair form reads the same rows, and when a route appears this list moves
/// to the wire and out of the browser.
const REPAIR_OBJECTS: readonly (Tile<string> & { code: string })[] = [
  { value: "FFE", label: "FFE & OE", icon: Armchair, code: "6066" },
  { value: "SOFTWARE", label: "Software", icon: AppWindow, code: "6067" },
  { value: "KOMPUTER", label: "Computer", icon: Monitor, code: "6068" },
  { value: "BANGUNAN", label: "Building", icon: Building2, code: "6069" },
  {
    value: "STAFF_HOUSE",
    label: "Staff house / mess",
    icon: Building2,
    code: "6070",
  },
  { value: "KENDARAAN", label: "Vehicle", icon: Car, code: "6071" },
  { value: "AC", label: "AC & refrigerator", icon: Snowflake, code: "6072" },
  {
    value: "POWER_PLANT",
    label: "Generator / power plant",
    icon: Zap,
    code: "6073",
  },
  {
    value: "GENSET_BBM",
    label: "Lubricant & generator fuel",
    icon: Droplets,
    code: "6058",
  },
  { value: "CAT", label: "Painting", icon: Paintbrush, code: "6074" },
  {
    value: "LIFT",
    label: "Lift & escalator",
    icon: MoveVertical,
    code: "6075",
  },
]

/// The YMHD accrual each type's monthly bill lands on, keyed by type code.
///
/// The contract-types payload deliberately carries prepaid/expense/income but
/// not the accrual, and the accrual_kind vocabulary is not derivable from the
/// type code — so the five pairs migration 0360 seeds are spelled here. A
/// type with no entry simply shows no YMHD row; the map, not this table, is
/// what Finance bills against.
const ACCRUAL_KIND_OF: Readonly<Record<string, string>> = {
  SEWA_TOKO: "BIAYA_SEWA_KANTOR_TOKO_YMHD",
  SEWA_RUMAH: "BIAYA_SEWA_RUMAH_MESS_YMHD",
  LANGGANAN_LISTRIK: "BIAYA_PEMAKAIAN_LISTRIK_YMHD",
  LANGGANAN_AIR: "BIAYA_PEMAKAIAN_AIR_BERSIH_YMHD",
  LANGGANAN_TELEKOM: "BIAYA_TELEPHONE_FAX_MODEM_YMHD",
}
