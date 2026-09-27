import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, FileSpreadsheet } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Choices, Toggle } from "@/components/ui/form"
import { Problem } from "@/components/ui/states"
import {
  openStores,
  saveCompany,
  setupKeys,
  startBooks,
  uploadChart,
  legalFormOf,
  type LegalForm,
  type SetupStatus,
} from "@/lib/queries/setup"
import { cn } from "@/lib/utils"
import { BusinessMap, type MapStore } from "@/screens/setup/business-map"
import { LegalFormPills } from "@/screens/setup/legal-form-pills"
import { companyName, nextCodes } from "@/screens/setup/names"
import {
  StoreList,
  draftStore,
  storesToOpen,
  type DraftStore,
} from "@/screens/setup/store-list"

/// The first minutes of a company with nothing in it yet.
///
/// # Three questions, then the app
///
/// The company, its stores, and how the books start. That is everything the
/// server needs to make the units, sites and pools, install a chart and open a
/// month — and nothing else is asked, because everything else has a default
/// or is only needed later: the team before the shops open, a bank account
/// before the first supplier is paid, the NPWP before the first PO. Those are
/// the tasks on the home screen, each with the moment it is needed, which is a
/// better time to ask than the first two minutes.
///
/// # Every step is saved as it is left
///
/// Lanjut writes that step. Somebody who closes the tab after the stores comes
/// back to the books question with the stores already open, and "Finish later"
/// is not a loss — the wizard is in front of the app until the three are
/// answered or the owner puts it off.
///
/// # Not a route
///
/// It stands in front of the router rather than inside it (`App.tsx`), the
/// way the login does: a shell with a rail of modules is a promise that there
/// is something in them, and on a company with no stores there is not yet.
export function Onboarding({
  status,
  onDefer,
  onDone,
}: {
  status: SetupStatus
  /// "Finish later" — into the app with the wizard put off.
  onDefer: () => void
  /// "Open the hub", after the last step.
  onDone: () => void
}) {
  const client = useQueryClient()
  const company = status.company

  const [step, setStep] = useState<1 | 2 | 3 | 4>(() =>
    company === null
      ? 1
      : status.books === null
        ? status.stores.length > 0
          ? 3
          : 2
        : 4
  )
  const [name, setName] = useState(company?.name ?? "")
  const [legalForm, setLegalForm] = useState<LegalForm>(
    legalFormOf(company?.legal_form) ?? "CV"
  )
  const [address, setAddress] = useState(company?.address ?? "")
  const [hasWarehouse, setHasWarehouse] = useState(
    company?.has_warehouse ?? true
  )
  const [touched, setTouched] = useState(false)
  const [drafts, setDrafts] = useState<DraftStore[]>(() => [draftStore()])
  const [chart, setChart] = useState<"STANDARD" | "IMPORTED">("STANDARD")
  const [chartFile, setChartFile] = useState<File | null>(null)
  const months = useMemo(openableMonths, [])
  const [firstPeriod, setFirstPeriod] = useState(months[1].value)
  /// One key per batch of stores: a double press, or a retry after a timeout
  /// that did land, opens the stores once.
  const [storesKey, setStoresKey] = useState(() => crypto.randomUUID())

  const refresh = () =>
    client.invalidateQueries({ queryKey: setupKeys.status() })

  const saveStep1 = useMutation({
    mutationFn: () =>
      saveCompany({
        name: name.trim(),
        legal_form: legalForm,
        address: address.trim(),
        has_warehouse: hasWarehouse,
        // Not asked here; kept as it was, so Back and Continue never clear it.
        tax_id: company?.tax_id ?? null,
      }),
    onSuccess: () => {
      void refresh()
      setStep(2)
    },
  })

  const saveStep2 = useMutation({
    mutationFn: () => openStores(storesToOpen(drafts), storesKey),
    onSuccess: (answer) => {
      // Written into the status at once, so the tiles on the map do not blink
      // out between the drafts clearing and the refetch landing.
      client.setQueryData<SetupStatus>(setupKeys.status(), (old) =>
        old ? { ...old, stores: [...old.stores, ...answer.created] } : old
      )
      void refresh()
      setDrafts([draftStore()])
      setStoresKey(crypto.randomUUID())
      setStep(3)
    },
  })

  // Not refreshed on success: the answer would say the setup is finished,
  // and `App` would take the wizard away before the last screen is seen.
  // "Open the hub" does it.
  const saveStep3 = useMutation({
    mutationFn: async () => {
      const file =
        chart === "IMPORTED" && chartFile ? await uploadChart(chartFile) : null
      return startBooks({
        chart,
        file_id: file?.file_id ?? null,
        first_period: firstPeriod,
      })
    },
    onSuccess: () => setStep(4),
  })

  const fullName = companyName(name, legalForm)
  const toOpen = storesToOpen(drafts)
  const codes = nextCodes(status.stores, drafts.length)
  const mapStores: MapStore[] = [
    ...status.stores.map((store) => ({
      key: store.unit_code,
      code: store.unit_code,
      name: store.name,
      city: store.city,
    })),
    ...drafts
      .map((row, index) => ({
        key: row.key,
        code: codes[index],
        name: row.name.trim(),
        city: row.city,
      }))
      .filter((row) => row.name !== ""),
  ]
  const monthLabel =
    months.find((month) => month.value === firstPeriod)?.label ?? firstPeriod

  const nameProblem =
    touched && name.trim() === "" ? "Enter the business name." : null
  const addressProblem =
    touched && address.trim() === "" ? "Enter the head office address." : null

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-15 shrink-0 items-center gap-3 border-b border-hairline px-6">
        <span className="grid size-7 place-items-center rounded-lg bg-accent text-cell font-semibold text-cta-fg">
          i
        </span>
        <b className="text-cell font-semibold text-ink">Setup</b>
        <div
          className="mx-auto flex items-center gap-1.5"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={Math.min(step, 3)}
          aria-label="Setup progress"
        >
          {[1, 2, 3].map((dot) => (
            <i
              key={dot}
              className={cn(
                "h-1 w-7 rounded-full transition-colors duration-(--t-panel)",
                step >= dot ? "bg-ink" : "bg-hairline-2"
              )}
            />
          ))}
        </div>
        {step < 4 && (
          <Button variant="quiet" onClick={onDefer}>
            Finish later
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="w-full overflow-y-auto lg:w-[35rem] lg:shrink-0 lg:border-r lg:border-hairline">
          <div
            key={step}
            className="mx-auto max-w-110 animate-[assistant-rise_var(--t-page)_var(--ease-out)_both] px-6 py-10 lg:px-0 lg:py-12"
          >
            {step === 1 && (
              <>
                <Heading
                  eyebrow="Step 1 of 3"
                  title="Your business"
                  sub="Printed on receipts, purchase orders and delivery notes."
                />
                <div className="mt-7 flex flex-col gap-5">
                  <Field label="Business name" required problem={nameProblem}>
                    <Input
                      autoFocus
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Sepatu Sejahtera"
                      className="h-12 text-card-title"
                    />
                  </Field>
                  <div className="flex flex-col gap-[0.4375rem]">
                    <span className="text-[0.875rem] font-medium text-text">
                      Legal form
                    </span>
                    <LegalFormPills value={legalForm} onChange={setLegalForm} />
                  </div>
                  <Field
                    label="Head office address"
                    aside="Letterhead & POs"
                    required
                    problem={addressProblem}
                  >
                    <Input
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="Street, number, city"
                    />
                  </Field>
                  <Toggle
                    on={hasWarehouse}
                    onToggle={() => setHasWarehouse((on) => !on)}
                    label="Central warehouse"
                    note={
                      hasWarehouse
                        ? "Suppliers deliver to the warehouse, and it ships to the stores. Same address as the office for now — you can change it later."
                        : "Suppliers deliver straight to the stores. A warehouse can be added later."
                    }
                  />
                </div>
                <Problem error={saveStep1.error} className="mt-5" />
                <Footer>
                  <Button
                    variant="primary"
                    className="h-11 px-5"
                    pending={saveStep1.isPending}
                    onClick={() => {
                      setTouched(true)
                      if (name.trim() === "" || address.trim() === "") return
                      saveStep1.mutate()
                    }}
                  >
                    {saveStep1.isPending ? "Saving…" : "Continue"}
                  </Button>
                </Footer>
              </>
            )}

            {step === 2 && (
              <>
                <Heading
                  eyebrow="Step 2 of 3"
                  title="Your stores"
                  sub="A name and a city each. One store, or all of them at once."
                />
                <div className="mt-7">
                  <StoreList
                    existing={status.stores}
                    rows={drafts}
                    onChange={setDrafts}
                  />
                </div>
                <details className="group mt-4 rounded-card border border-hairline bg-canvas">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-meta text-body [&::-webkit-details-marker]:hidden">
                    {toOpen.length > 1
                      ? `${toOpen.length} stores, each set up automatically`
                      : "Each store is set up automatically"}
                    <ChevronDown className="ml-auto size-4 text-mute transition-transform duration-(--t-panel) group-open:rotate-180" />
                  </summary>
                  <ul className="flex flex-col gap-1 px-3.5 pb-3.5 text-meta text-body">
                    <li>Its time zone, from the city</li>
                    <li>Its own cash, sales and profit & loss</li>
                    <li>Floor, back-room and reject stock</li>
                    <li>A return pool for it at the central warehouse</li>
                    <li>A code to pair its store server</li>
                  </ul>
                </details>
                <Problem error={saveStep2.error} className="mt-5" />
                <Footer back={() => setStep(1)}>
                  {toOpen.length === 0 ? (
                    <Button
                      variant={status.stores.length > 0 ? "primary" : "quiet"}
                      className="h-11 px-5"
                      onClick={() => setStep(3)}
                    >
                      {status.stores.length > 0 ? "Continue" : "No stores yet"}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      className="h-11 px-5"
                      pending={saveStep2.isPending}
                      onClick={() => saveStep2.mutate()}
                    >
                      {saveStep2.isPending
                        ? "Opening stores…"
                        : toOpen.length > 1
                          ? `Open ${toOpen.length} stores`
                          : "Open store"}
                    </Button>
                  )}
                </Footer>
              </>
            )}

            {step === 3 && (
              <>
                <Heading
                  eyebrow="Step 3 of 3"
                  title="Books"
                  sub="One chart of accounts for the whole business — new stores join it automatically."
                />
                <div className="mt-7 flex flex-col gap-5">
                  <Choices
                    label="Chart of accounts"
                    columns={1}
                    value={chart}
                    onChange={setChart}
                    options={[
                      {
                        value: "STANDARD",
                        label: "Start fresh",
                        note: "Use the standard retail chart. Finance can change it any time.",
                      },
                      {
                        value: "IMPORTED",
                        label: "Moving from other software",
                        note: "Upload your chart (7Soft, Accurate, Excel). It is matched automatically and Finance reviews it later.",
                      },
                    ]}
                  />
                  {chart === "IMPORTED" && (
                    <label className="flex cursor-pointer items-center gap-3 rounded-card border border-dashed border-hairline-strong px-4 py-3.5 text-meta text-body transition-colors hover:bg-soft">
                      <FileSpreadsheet className="size-5 shrink-0 text-line-ico" />
                      <span className="min-w-0 flex-1 truncate">
                        {chartFile ? (
                          <b className="font-medium text-ink">
                            {chartFile.name}
                          </b>
                        ) : (
                          "Choose the chart file — CSV or Excel"
                        )}
                      </span>
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls,text/csv"
                        className="sr-only"
                        onChange={(event) =>
                          setChartFile(event.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                  )}
                  <Field
                    label="Start recording from"
                    hint="This month is opened. Anything earlier goes into opening balances."
                  >
                    <Select value={firstPeriod} onChange={setFirstPeriod}>
                      {months.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Problem error={saveStep3.error} className="mt-5" />
                <Footer back={() => setStep(2)}>
                  <Button
                    variant="primary"
                    className="h-11 px-5"
                    pending={saveStep3.isPending}
                    disabled={chart === "IMPORTED" && chartFile === null}
                    onClick={() => saveStep3.mutate()}
                  >
                    {saveStep3.isPending ? "Setting up the books…" : "Finish"}
                  </Button>
                </Footer>
              </>
            )}

            {step === 4 && (
              <>
                <span className="grid size-14 animate-[assistant-rise_var(--t-sheet)_var(--ease-out)_both] place-items-center rounded-full bg-ok-bg text-ok-fg">
                  <Check className="size-7" strokeWidth={2.5} />
                </span>
                <h1 className="mt-5 text-[1.75rem] leading-tight font-semibold tracking-[-0.024em] text-ink">
                  {fullName || "Your business"} is ready.
                </h1>
                <p className="mt-2 text-[0.9375rem] text-body">
                  The rest — your team, bank accounts, store servers — is asked
                  for when it is needed, from the home screen.
                </p>
                <dl className="mt-6 divide-y divide-hairline rounded-card border border-hairline">
                  <Made label="Head office" value="1" />
                  {hasWarehouse && <Made label="Central warehouse" value="1" />}
                  <Made
                    label="Stores"
                    value={
                      mapStores.length > 0 ? String(mapStores.length) : "—"
                    }
                  />
                  <Made
                    label="Chart of accounts"
                    value={
                      chart === "STANDARD"
                        ? "Standard retail"
                        : "Imported, awaiting Finance"
                    }
                  />
                  <Made label="Open period" value={monthLabel} />
                </dl>
                <Footer>
                  <Button
                    variant="primary"
                    className="h-11 px-5"
                    onClick={onDone}
                  >
                    Open the hub
                  </Button>
                </Footer>
              </>
            )}
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 overflow-y-auto lg:block">
          <BusinessMap
            step={step}
            name={fullName}
            hasWarehouse={hasWarehouse}
            stores={mapStores}
            books={step >= 3 ? monthLabel : null}
          />
        </div>
      </div>
    </div>
  )
}

function Heading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string
  title: string
  sub: string
}) {
  return (
    <>
      <p className="text-meta font-medium text-mute">{eyebrow}</p>
      <h1 className="mt-1.5 text-[1.75rem] leading-tight font-semibold tracking-[-0.024em] text-ink">
        {title}
      </h1>
      <p className="mt-2 text-[0.9375rem] text-body">{sub}</p>
    </>
  )
}

function Footer({
  back,
  children,
}: {
  back?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mt-8 flex items-center gap-2.5">
      {back && (
        <Button variant="quiet" className="h-11 px-4" onClick={back}>
          Back
        </Button>
      )}
      <span className="flex-1" />
      {children}
    </div>
  )
}

function Made({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-4 py-3 text-cell">
      <dt className="text-body">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  )
}

/// The month the books start in: last month, this month (the default) and
/// next — a company rarely starts its books further off than that, and one
/// that does is migrating and will open the earlier months with its opening
/// balances.
function openableMonths(): { value: string; label: string }[] {
  const now = new Date()
  const label = new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
  })
  return [-1, 0, 1].map((offset) => {
    const month = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    return {
      value: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
      label: label.format(month),
    }
  })
}
