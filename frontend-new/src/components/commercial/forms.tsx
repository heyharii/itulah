/*
 * The commercial authoring sheets.
 *
 * Each sheet edits ONE level of the engine, and none of them is allowed to
 * blur into another:
 *
 *   · a price list, and the entries inside it, author the CASCADE — the price
 *     the till starts from;
 *   · a markdown REPLACES that resolved price for a window. It is a price
 *     source, so it is authored as a price, not as a discount;
 *   · a pricing rule runs AFTER the price is settled. It is an offer on top;
 *   · a campaign is the lifecycle and budget container the rules sit in. It
 *     has no mechanic of its own and none is offered here.
 *
 * Every sheet edits the row Internal holds right now: opening one re-reads the
 * object and its version tag, so a save is guarded against an edit someone
 * else made in between, and every field the sheet does not show is handed back
 * untouched instead of being blanked by the replacing PUT.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import type { CommercialResourceState } from "@/components/commercial/screens"
import type { CommercialCoupon, CommercialVoucher } from "@/components/commercial/api"
import { rupiah } from "@/components/commercial/model"
import {
  CommercialWriteError,
  useCommercialWrite,
  blankCoupon,
  blankPricingRule,
  cancelVoucher,
  createVoucher,
  extendVoucher,
  retireCoupon,
  saveCoupon,
  type CouponWire,
  type VoucherTypeWire,
  createCampaign,
  createMarkdown,
  createPriceList,
  createPricingRule,
  addPriceEntry,
  dayToRfc3339,
  loadCampaign,
  loadMarkdown,
  loadPriceEntry,
  loadPriceList,
  loadPricingRule,
  mintId,
  retireCampaign,
  retireMarkdown,
  retirePriceEntry,
  retirePriceList,
  retirePricingRule,
  rfc3339ToDay,
  saveCampaign,
  saveMarkdown,
  savePriceEntry,
  savePriceList,
  savePricingRule,
  type CampaignStatusWire,
  type MarkdownStatusWire,
  type MarkdownTypeWire,
  type MarkdownWire,
  type PricingRuleWire,
} from "@/components/commercial/writes"
import { shortDate } from "@/lib/day"
import { z } from "zod"

import { useAppForm, useSheetForm } from "@/shared/form"
import type { SelectOption } from "@/shared/form"
import { cn } from "@/lib/utils"

/* ── shared field chrome ──────────────────────────────────────── */

const fieldClass =
  "h-[34px] w-full rounded-control bg-field px-2.5 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)] placeholder:font-normal placeholder:text-ink-4"


function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-line px-[18px] py-4 last:border-b-0">
      <h3 className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        {title}
      </h3>
      {hint && (
        <p className="pt-1 text-[11px] leading-[1.5] text-ink-4">{hint}</p>
      )}
      <div className="pt-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  required,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="pb-3.5 last:pb-0">
      <label htmlFor={htmlFor} className="block pb-1.5 text-xs font-medium text-ink-2">
        {label}
        {required && <span className="pl-1 text-ember">*</span>}
      </label>
      {children}
      {hint && (
        <p className="pt-1 text-[11px] leading-[1.5] text-ink-4">{hint}</p>
      )}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-3 sm:grid-cols-2">{children}</div>
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 py-1.5",
        disabled && "opacity-45"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[2px] size-[15px] shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink">{label}</span>
        {hint && (
          <span className="block text-[11px] leading-[1.5] text-ink-4">
            {hint}
          </span>
        )}
      </span>
    </label>
  )
}

interface Option {
  value: string
  label: string
}

/**
 * A free list of identifiers with suggestions. The engine's scope fields are
 * open lists of strings, so this offers what the catalogue knows without
 * pretending the list is closed.
 */
function TokenField({
  label,
  hint,
  required,
  values,
  options,
  placeholder,
  onChange,
}: {
  label: string
  hint?: string
  required?: boolean
  values: string[]
  options: Option[]
  placeholder: string
  onChange: (values: string[]) => void
}) {
  const id = useId()
  const [text, setText] = useState("")

  const add = () => {
    const parts = text
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean)
    if (!parts.length) return
    onChange([...new Set([...values, ...parts])])
    setText("")
  }

  return (
    <Field label={label} hint={hint} required={required} htmlFor={id}>
      <div className="flex gap-1.5">
        <input
          id={id}
          list={`${id}-options`}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add()
            }
          }}
          className={fieldClass}
        />
        <datalist id={`${id}-options`}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
        <button
          type="button"
          onClick={add}
          className="inline-flex h-[34px] shrink-0 items-center gap-1 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
        >
          <Icon path={paths.plus} size={13} width={2.2} />
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-2">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="inline-flex h-[21px] items-center gap-1 rounded-[6px] bg-inset px-1.5 font-mono text-[10.5px] text-ink-2 transition-colors hover:bg-hover"
            >
              {value}
              <Icon path={paths.close} size={10} width={2.4} className="text-ink-4" />
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}

/** Store scope. An empty selection means every store, which is what the
 * contract means by an empty `store_ids`, so it is said rather than implied. */
function StorePicker({
  label,
  stores,
  values,
  onChange,
}: {
  label: string
  stores: { id: string; name: string }[]
  values: string[]
  onChange: (values: string[]) => void
}) {
  return (
    <Field
      label={label}
      hint={
        values.length
          ? `${values.length} store${values.length === 1 ? "" : "s"} selected.`
          : "Nothing selected means every store."
      }
    >
      <div className="max-h-[152px] overflow-auto rounded-panel border border-line-strong">
        {stores.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-ink-4">
            The hub returned no stores.
          </p>
        ) : (
          stores.map((store) => {
            const on = values.includes(store.id)
            return (
              <label
                key={store.id}
                className="flex items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0 hover:bg-hover"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(
                      on
                        ? values.filter((item) => item !== store.id)
                        : [...values, store.id]
                    )
                  }
                  className="size-[14px] shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                  {store.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-4">
                  {store.id}
                </span>
              </label>
            )
          })
        )}
      </div>
    </Field>
  )
}

function Blocking({ issues }: { issues: string[] }) {
  if (!issues.length) return null
  return (
    <ul className="mb-3 flex flex-col rounded-panel border border-line-strong">
      {issues.map((issue) => (
        <li
          key={issue}
          className="flex items-start gap-2 border-b border-line px-3 py-2 text-[12px] text-ink-2 last:border-b-0"
        >
          <Icon
            path={paths.alert}
            size={13}
            width={2}
            className="mt-px shrink-0 text-ember"
          />
          {issue}
        </li>
      ))}
    </ul>
  )
}

function SaveError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="mb-3 rounded-panel border border-ember/20 bg-ember/5 px-3 py-2 text-[11.5px] leading-[1.5] text-ember">
      {message}
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-xs text-ink-4">
      Reading {label} from the hub…
    </div>
  )
}

/** Footer shared by every authoring sheet. */
function SheetFooter({
  blocks,
  busy,
  saveLabel,
  onCancel,
  onSave,
  retire,
}: {
  blocks: number
  busy: boolean
  saveLabel: string
  onCancel: () => void
  onSave: () => void
  retire?: { label: string; onRetire: () => void }
}) {
  return (
    <>
      {retire && (
        <button
          type="button"
          disabled={busy}
          onClick={retire.onRetire}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-control px-2.5 text-xs font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ember disabled:pointer-events-none disabled:opacity-45"
        >
          <Icon path={paths.archive} size={14} width={2} />
          {retire.label}
        </button>
      )}
      <span className="flex-1" />
      {blocks > 0 && (
        <span className="font-mono text-[11px] text-ember">
          {blocks} blocking issue{blocks === 1 ? "" : "s"}
        </span>
      )}
      <button type="button" onClick={onCancel} className={sheetButton.secondary}>
        Cancel
      </button>
      <button
        type="button"
        disabled={blocks > 0 || busy}
        onClick={onSave}
        className={cn(
          sheetButton.primary,
          "disabled:pointer-events-none disabled:opacity-45"
        )}
      >
        <Icon path={paths.check} size={14} width={2.2} />
        {busy ? "Saving…" : saveLabel}
      </button>
    </>
  )
}

/* ── loading one live row ─────────────────────────────────────── */

/**
 * Re-reads the row an edit is about to replace. The form is never seeded from
 * the list projection: the list has already dropped the fields this app does
 * not read, and a PUT built from it would blank them.
 */
function useLiveRow<T>(
  id: string | null,
  load: (id: string) => Promise<T>
): { row: T | null; error: string | null } {
  const [state, setState] = useState<{
    id: string | null
    row: T | null
    error: string | null
  }>({ id: null, row: null, error: null })

  // Asking about a different row clears the last answer during render, so the
  // sheet never shows the previous object's values for a frame.
  if (state.id !== id) setState({ id, row: null, error: null })

  useEffect(() => {
    if (!id) return
    let live = true
    load(id)
      .then((value) => {
        if (live) setState({ id, row: value, error: null })
      })
      .catch((cause: unknown) => {
        if (!live) return
        setState({
          id,
          row: null,
          error:
            cause instanceof Error
              ? cause.message
              : "The hub could not return this row.",
        })
      })
    return () => {
      live = false
    }
  }, [id, load])

  return { row: state.row, error: state.error }
}

/**
 * Seeds a sheet's draft once per opening, during render rather than from an
 * effect: the draft is derived state, and a render-time reset converges in the
 * same commit instead of flashing last time's values first.
 *
 * `token` identifies the opening (the id being edited, or "create"); `ready`
 * says the source the draft is built from has arrived.
 */
function useDraft<T>(
  token: string | null,
  ready: boolean,
  seed: () => T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [draft, setDraft] = useState<T>(seed)
  const [seeded, setSeeded] = useState<string | null>(null)

  if (token === null) {
    if (seeded !== null) setSeeded(null)
  } else if (ready && seeded !== token) {
    setSeeded(token)
    setDraft(seed())
  }

  return [draft, setDraft]
}

/**
 * The shared save runner: one in-flight attempt, one error sentence.
 *
 * The write goes through `useCommercialWrite`, so landing it invalidates the
 * commercial snapshot and every tab re-reads itself — the sheet no longer
 * tells its parent to reload.
 */
function useSaver(onClose: () => void) {
  const write = useCommercialWrite()
  const [error, setError] = useState<string | null>(null)

  const { execute } = write
  const run = useCallback(
    (work: () => Promise<unknown>) => {
      setError(null)
      void execute(work)
        .then(() => {
          onClose()
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof CommercialWriteError
              ? cause.message
              : cause instanceof Error
                ? cause.message
                : "The write was refused."
          )
        })
    },
    [execute, onClose]
  )

  return { busy: write.isLoading, error, setError, run }
}

/* ── pricing rules ────────────────────────────────────────────── */

const RULE_STATUS: Option[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "expired", label: "Expired" },
  { value: "archived", label: "Archived" },
]

const RULE_KIND: Option[] = [
  { value: "price", label: "Price — changes what the line costs" },
  { value: "product", label: "Product — gives an item away" },
  { value: "loyalty_earn", label: "Loyalty earn — records points" },
]

const APPLY_ON: Option[] = [
  { value: "sku", label: "Specific SKUs" },
  { value: "article", label: "Article — every variant" },
  { value: "division", label: "Division" },
  { value: "tag", label: "Item tag" },
  { value: "transaction", label: "The whole transaction" },
]

const EFFECT: Option[] = [
  { value: "percent", label: "Percent off" },
  { value: "amount", label: "Amount off" },
  { value: "fixed_price", label: "Fixed price" },
  { value: "margin", label: "Target margin" },
]

const CUSTOMER_SCOPE: Option[] = [
  { value: "all", label: "Every customer" },
  { value: "member", label: "Members only" },
  { value: "tiers", label: "Named tiers" },
]

const EARN_MODE: Option[] = [
  { value: "spend_rate", label: "Spend rate" },
  { value: "fixed_points", label: "Fixed points" },
  { value: "points_per_qty", label: "Points per quantity" },
]

const EARN_BASIS: Option[] = [
  {
    value: "post_markdown_pre_discount",
    label: "Price after markdown, before offers",
  },
  { value: "post_discount_net", label: "Net after offers" },
  { value: "eligible_line_total", label: "Eligible line total" },
  { value: "original", label: "Original list price" },
]

export type RuleSheetTarget = { mode: "create" } | { mode: "edit"; id: string }

export function PricingRuleSheet({
  target,
  resource,
  onClose,
}: {
  target: RuleSheetTarget | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const editId = target?.mode === "edit" ? target.id : null
  const { row, error: loadError } = useLiveRow(editId, loadPricingRule)
  const { busy, error, run } = useSaver(onClose)

  /* Percent and margin are held as typed text: the wire carries basis points,
   * and rounding a half-typed "2." back through them would fight the caret. */
  const [draft, setDraft] = useDraft(
    target ? (editId ?? "create") : null,
    target?.mode === "create" || Boolean(row),
    () => {
      const source: PricingRuleWire = editId && row ? row : blankPricingRule()
      return {
        wire: source,
        percent: source.percent_bps ? String(source.percent_bps / 100) : "",
        margin: source.margin_bps ? String(source.margin_bps / 100) : "",
      }
    }
  )
  const { wire, percent, margin } = draft
  const setPercent = (value: string) =>
    setDraft((current) => ({ ...current, percent: value }))
  const setMargin = (value: string) =>
    setDraft((current) => ({ ...current, margin: value }))

  const data = resource.data
  const skuOptions = useMemo<Option[]>(
    () =>
      (data?.articles ?? []).map((article) => ({
        value: article.id,
        label: article.name,
      })),
    [data]
  )
  /* The hub publishes no article/family master on this deployment, so the only
   * scope a rule can name here is a SKU. The article field stays free-text so
   * a rule authored elsewhere keeps its article scope on save. */
  const articleOptions: Option[] = []
  const divisionOptions = useMemo<Option[]>(
    () =>
      (data?.divisions ?? []).map((division) => ({
        value: division.name,
        label: division.name,
      })),
    [data]
  )
  /* Tags exist in master data but the hub joins none onto the item list, so
   * there is nothing to offer as a choice; the field stays free-text. */
  const tagOptions: Option[] = []

  const set = (patch: Partial<PricingRuleWire>) =>
    setDraft((current) => ({ ...current, wire: { ...current.wire, ...patch } }))

  const validFrom = rfc3339ToDay(wire.valid_from)
  const validTo = rfc3339ToDay(wire.valid_to)

  const issues: string[] = []
  if (!wire.name.trim()) issues.push("Name the rule.")
  if (wire.apply_on === "sku" && !wire.skus.length)
    issues.push("Add at least one SKU for a SKU-scoped rule.")
  if (wire.apply_on === "article" && !wire.article_ids.length)
    issues.push("Add at least one article for an article-scoped rule.")
  if (wire.apply_on === "division" && !wire.divisions.length)
    issues.push("Pick at least one division.")
  if (wire.apply_on === "tag" && !wire.tags.length)
    issues.push("Add at least one tag.")
  if (wire.customer_scope === "tiers" && !wire.tier_ids.length)
    issues.push("Name the tiers this rule is for.")
  if (validFrom && validTo && validFrom > validTo)
    issues.push("The window ends before it starts.")
  if (wire.kind === "price") {
    if (!wire.effect) issues.push("Choose what the rule does to the price.")
    if (wire.effect === "percent" && !(Number(percent) > 0))
      issues.push("A percent rule needs a percentage above zero.")
    if (wire.effect === "percent" && Number(percent) > 100)
      issues.push("A percentage cannot exceed 100.")
    if (wire.effect === "amount" && wire.amount <= 0)
      issues.push("An amount-off rule needs an amount above zero.")
    if (wire.effect === "fixed_price" && wire.fixed_price <= 0)
      issues.push("A fixed-price rule needs a price above zero.")
    if (wire.effect === "margin" && !(Number(margin) > 0))
      issues.push("A margin rule needs a target margin above zero.")
  }
  if (wire.kind === "product") {
    if (wire.free_qty <= 0) issues.push("Say how many units come free.")
    if (!wire.same_item && !wire.free_sku.trim())
      issues.push("Name the free SKU, or mark it as the same item.")
  }
  if (wire.kind === "loyalty_earn") {
    if (!wire.earn_mode) issues.push("Choose how the points are earned.")
    if (wire.earn_mode === "spend_rate" && wire.spend_per_point <= 0)
      issues.push("A spend-rate rule needs the spend per point.")
    if (
      (wire.earn_mode === "fixed_points" ||
        wire.earn_mode === "points_per_qty") &&
      wire.earn_points <= 0
    )
      issues.push("Say how many points the rule awards.")
  }

  /** Fields belonging to a scope or a kind the author did not choose are
   * cleared, so a rule never carries a target the engine will not read. */
  function payload(current: PricingRuleWire): PricingRuleWire {
    const price = wire.kind === "price"
    const product = wire.kind === "product"
    const loyalty = wire.kind === "loyalty_earn"
    return {
      ...current,
      campaign_id: wire.campaign_id,
      name: wire.name.trim(),
      status: wire.status,
      kind: wire.kind,
      apply_on: wire.apply_on,
      skus: wire.apply_on === "sku" ? wire.skus : [],
      article_ids: wire.apply_on === "article" ? wire.article_ids : [],
      divisions: wire.apply_on === "division" ? wire.divisions : [],
      tags: wire.apply_on === "tag" ? wire.tags : [],
      store_ids: wire.store_ids,
      channels: wire.channels,
      customer_scope: wire.customer_scope,
      tier_ids: wire.customer_scope === "tiers" ? wire.tier_ids : [],
      min_qty: wire.min_qty,
      max_qty: wire.max_qty,
      min_amount: wire.min_amount,
      max_amount: wire.max_amount,
      valid_from: dayToRfc3339(validFrom),
      valid_to: dayToRfc3339(validTo),
      coupon_id: wire.coupon_id,
      advisory: wire.advisory,
      effect: price ? wire.effect : "",
      percent_bps:
        price && wire.effect === "percent"
          ? Math.round(Number(percent) * 100)
          : 0,
      amount: price && wire.effect === "amount" ? wire.amount : 0,
      fixed_price: price && wire.effect === "fixed_price" ? wire.fixed_price : 0,
      margin_bps:
        price && wire.effect === "margin" ? Math.round(Number(margin) * 100) : 0,
      max_discount: price ? wire.max_discount : 0,
      free_sku: product && !wire.same_item ? wire.free_sku.trim() : "",
      same_item: product ? wire.same_item : false,
      free_qty: product ? wire.free_qty : 0,
      priority: wire.priority,
      exclusive: wire.exclusive,
      stack_with_other_rules: wire.exclusive ? false : wire.stack_with_other_rules,
      stack_with_voucher: wire.exclusive ? false : wire.stack_with_voucher,
      stack_with_points: wire.exclusive ? false : wire.stack_with_points,
      stack_with_employee: wire.exclusive ? false : wire.stack_with_employee,
      max_uses: wire.max_uses,
      per_customer_max: wire.per_customer_max,
      budget: wire.budget,
      earn_mode: loyalty ? wire.earn_mode : "",
      spend_per_point:
        loyalty && wire.earn_mode === "spend_rate" ? wire.spend_per_point : 0,
      earn_points: loyalty && wire.earn_mode !== "spend_rate" ? wire.earn_points : 0,
      earn_basis: loyalty && wire.earn_mode === "spend_rate" ? wire.earn_basis : "",
      exclude_markdown_items: loyalty ? wire.exclude_markdown_items : false,
    }
  }

  const save = () => {
    if (!target) return
    if (target.mode === "create") {
      run(() => createPricingRule({ ...payload(blankPricingRule()), id: "" }))
      return
    }
    run(() => savePricingRule(target.id, payload))
  }

  const ready = target?.mode === "create" || Boolean(row)

  return (
    <SheetShell
      open={Boolean(target)}
      size="wide"
      eyebrow="Offer on top of the price"
      title={
        target?.mode === "edit"
          ? wire.name || "Pricing rule"
          : "New pricing rule"
      }
      onRequestClose={onClose}
      footer={
        <SheetFooter
          blocks={ready ? issues.length : 1}
          busy={busy}
          saveLabel={target?.mode === "edit" ? "Save rule" : "Create rule"}
          onCancel={onClose}
          onSave={save}
          retire={
            target?.mode === "edit" && wire.status !== "archived"
              ? {
                  label: "Retire rule",
                  onRetire: () => run(() => retirePricingRule(target.id)),
                }
              : undefined
          }
        />
      }
    >
      {!ready ? (
        loadError ? (
          <p className="px-[18px] py-6 text-xs text-ember">{loadError}</p>
        ) : (
          <Loading label="the rule" />
        )
      ) : (
        <div>
          <div className="px-[18px] pt-4">
            <SaveError message={error} />
            <Blocking issues={issues} />
            <p className="rounded-panel bg-inset px-3 py-2 text-[11px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
              A rule runs after the price is settled. It never changes the price
              list or the markdown underneath it — it is an offer applied on top
              at the till.
            </p>
          </div>

          <Section title="The rule">
            <Field label="Name" required htmlFor="rule-name">
              <input
                id="rule-name"
                value={wire.name}
                onChange={(event) => set({ name: event.target.value })}
                placeholder="Weekend 20% off"
                className={fieldClass}
              />
            </Field>
            <Row>
              <Field label="Status" htmlFor="rule-status">
                <select
                  id="rule-status"
                  value={wire.status}
                  onChange={(event) => set({ status: event.target.value })}
                  className={fieldClass}
                >
                  {RULE_STATUS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Priority"
                hint="Offers are listed in priority order, lowest first."
                htmlFor="rule-priority"
              >
                <input
                  id="rule-priority"
                  type="number"
                  min={0}
                  value={wire.priority || ""}
                  onChange={(event) =>
                    set({ priority: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Kind" htmlFor="rule-kind">
                <select
                  id="rule-kind"
                  value={wire.kind}
                  onChange={(event) => set({ kind: event.target.value })}
                  className={fieldClass}
                >
                  {RULE_KIND.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Campaign"
                hint="A campaign carries the window and the budget. It applies no mechanic of its own."
                htmlFor="rule-campaign"
              >
                <select
                  id="rule-campaign"
                  value={wire.campaign_id}
                  onChange={(event) => set({ campaign_id: event.target.value })}
                  className={fieldClass}
                >
                  <option value="">In no campaign</option>
                  {(data?.campaigns ?? []).map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </Field>
            </Row>
          </Section>

          <Section
            title="What it targets"
            hint="Everything below is combined: a rule fires only when every condition holds."
          >
            <Field label="Applies on" htmlFor="rule-apply">
              <select
                id="rule-apply"
                value={wire.apply_on}
                onChange={(event) => set({ apply_on: event.target.value })}
                className={fieldClass}
              >
                {APPLY_ON.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {wire.apply_on === "sku" && (
              <TokenField
                label="SKUs"
                required
                values={wire.skus}
                options={skuOptions}
                placeholder="Type or paste a SKU"
                onChange={(skus) => set({ skus })}
              />
            )}
            {wire.apply_on === "article" && (
              <TokenField
                label="Articles"
                required
                hint="Covers every SKU beneath the article."
                values={wire.article_ids}
                options={articleOptions}
                placeholder="Article id"
                onChange={(article_ids) => set({ article_ids })}
              />
            )}
            {wire.apply_on === "division" && (
              <TokenField
                label="Divisions"
                required
                hint="Matched against the article's division name."
                values={wire.divisions}
                options={divisionOptions}
                placeholder="Women"
                onChange={(divisions) => set({ divisions })}
              />
            )}
            {wire.apply_on === "tag" && (
              <TokenField
                label="Tags"
                required
                values={wire.tags}
                options={tagOptions}
                placeholder="clearance"
                onChange={(tags) => set({ tags })}
              />
            )}
            {wire.apply_on === "transaction" && (
              <p className="pb-3.5 text-[11px] leading-[1.5] text-ink-4">
                A transaction rule needs no target — it is judged on the basket
                as a whole, through the conditions below.
              </p>
            )}

            <StorePicker
              label="Stores"
              stores={data?.stores ?? []}
              values={wire.store_ids}
              onChange={(store_ids) => set({ store_ids })}
            />

            <Row>
              <Field label="Channels" hint="Nothing ticked means every channel.">
                <div className="rounded-panel border border-line-strong px-3 py-1">
                  {(
                    [
                      ["pos", "In store"],
                      ["online", "Online"],
                    ] as const
                  ).map(([value, label]) => (
                    <Toggle
                      key={value}
                      label={label}
                      checked={wire.channels.includes(value)}
                      onChange={(on) =>
                        set({
                          channels: on
                            ? [...wire.channels, value]
                            : wire.channels.filter((item) => item !== value),
                        })
                      }
                    />
                  ))}
                </div>
              </Field>
              <Field label="Customer" htmlFor="rule-customer">
                <select
                  id="rule-customer"
                  value={wire.customer_scope}
                  onChange={(event) =>
                    set({ customer_scope: event.target.value })
                  }
                  className={fieldClass}
                >
                  {CUSTOMER_SCOPE.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </Row>
            {wire.customer_scope === "tiers" && (
              <TokenField
                label="Tiers"
                required
                values={wire.tier_ids}
                options={[]}
                placeholder="gold"
                onChange={(tier_ids) => set({ tier_ids })}
              />
            )}
          </Section>

          {wire.kind === "price" && (
            <Section
              title="The mechanic"
              hint="Applied to the price the cascade and any markdown already settled on."
            >
              <Row>
                <Field label="Effect" required htmlFor="rule-effect">
                  <select
                    id="rule-effect"
                    value={wire.effect}
                    onChange={(event) => set({ effect: event.target.value })}
                    className={fieldClass}
                  >
                    <option value="">Choose…</option>
                    {EFFECT.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {wire.effect === "percent" && (
                  <Field label="Percent off" required htmlFor="rule-percent">
                    <input
                      id="rule-percent"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={percent}
                      onChange={(event) => setPercent(event.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                )}
                {wire.effect === "amount" && (
                  <Field label="Amount off (Rp)" required htmlFor="rule-amount">
                    <input
                      id="rule-amount"
                      type="number"
                      min={0}
                      value={wire.amount || ""}
                      onChange={(event) =>
                        set({ amount: Number(event.target.value) || 0 })
                      }
                      className={fieldClass}
                    />
                  </Field>
                )}
                {wire.effect === "fixed_price" && (
                  <Field
                    label="Fixed price (Rp)"
                    required
                    hint="The line rings up at exactly this, whatever the cascade said."
                    htmlFor="rule-fixed"
                  >
                    <input
                      id="rule-fixed"
                      type="number"
                      min={0}
                      value={wire.fixed_price || ""}
                      onChange={(event) =>
                        set({ fixed_price: Number(event.target.value) || 0 })
                      }
                      className={fieldClass}
                    />
                  </Field>
                )}
                {wire.effect === "margin" && (
                  <Field label="Target margin (%)" required htmlFor="rule-margin">
                    <input
                      id="rule-margin"
                      type="number"
                      min={0}
                      step="0.01"
                      value={margin}
                      onChange={(event) => setMargin(event.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                )}
              </Row>
              <Field
                label="Most it may take off (Rp)"
                hint="Zero means no cap."
                htmlFor="rule-maxdiscount"
              >
                <input
                  id="rule-maxdiscount"
                  type="number"
                  min={0}
                  value={wire.max_discount || ""}
                  onChange={(event) =>
                    set({ max_discount: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
            </Section>
          )}

          {wire.kind === "product" && (
            <Section title="The mechanic">
              <Toggle
                label="The free item is the item bought"
                hint="Buy two, get one of the same."
                checked={wire.same_item}
                onChange={(same_item) => set({ same_item })}
              />
              {!wire.same_item && (
                <div className="pt-2">
                  <Field label="Free SKU" required htmlFor="rule-freesku">
                    <input
                      id="rule-freesku"
                      list="rule-freesku-options"
                      value={wire.free_sku}
                      onChange={(event) => set({ free_sku: event.target.value })}
                      className={fieldClass}
                    />
                    <datalist id="rule-freesku-options">
                      {skuOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </datalist>
                  </Field>
                </div>
              )}
              <Field label="Free quantity" required htmlFor="rule-freeqty">
                <input
                  id="rule-freeqty"
                  type="number"
                  min={0}
                  value={wire.free_qty || ""}
                  onChange={(event) =>
                    set({ free_qty: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
            </Section>
          )}

          {wire.kind === "loyalty_earn" && (
            <Section
              title="The mechanic"
              hint="A loyalty rule records points. It changes no price."
            >
              <Row>
                <Field label="Earn mode" required htmlFor="rule-earnmode">
                  <select
                    id="rule-earnmode"
                    value={wire.earn_mode}
                    onChange={(event) => set({ earn_mode: event.target.value })}
                    className={fieldClass}
                  >
                    <option value="">Choose…</option>
                    {EARN_MODE.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {wire.earn_mode === "spend_rate" ? (
                  <Field
                    label="Spend per point (Rp)"
                    required
                    htmlFor="rule-spend"
                  >
                    <input
                      id="rule-spend"
                      type="number"
                      min={0}
                      value={wire.spend_per_point || ""}
                      onChange={(event) =>
                        set({ spend_per_point: Number(event.target.value) || 0 })
                      }
                      className={fieldClass}
                    />
                  </Field>
                ) : (
                  wire.earn_mode && (
                    <Field label="Points" required htmlFor="rule-points">
                      <input
                        id="rule-points"
                        type="number"
                        min={0}
                        value={wire.earn_points || ""}
                        onChange={(event) =>
                          set({ earn_points: Number(event.target.value) || 0 })
                        }
                        className={fieldClass}
                      />
                    </Field>
                  )
                )}
              </Row>
              {wire.earn_mode === "spend_rate" && (
                <Field label="Earn basis" htmlFor="rule-basis">
                  <select
                    id="rule-basis"
                    value={wire.earn_basis}
                    onChange={(event) => set({ earn_basis: event.target.value })}
                    className={fieldClass}
                  >
                    <option value="">Unset</option>
                    {EARN_BASIS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Toggle
                label="Skip items already sold on markdown"
                checked={wire.exclude_markdown_items}
                onChange={(exclude_markdown_items) =>
                  set({ exclude_markdown_items })
                }
              />
            </Section>
          )}

          <Section title="When it qualifies">
            <Row>
              <Field label="Minimum quantity" htmlFor="rule-minqty">
                <input
                  id="rule-minqty"
                  type="number"
                  min={0}
                  value={wire.min_qty || ""}
                  onChange={(event) =>
                    set({ min_qty: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field
                label="Maximum quantity"
                hint="Zero means no ceiling."
                htmlFor="rule-maxqty"
              >
                <input
                  id="rule-maxqty"
                  type="number"
                  min={0}
                  value={wire.max_qty || ""}
                  onChange={(event) =>
                    set({ max_qty: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Minimum basket (Rp)" htmlFor="rule-minamount">
                <input
                  id="rule-minamount"
                  type="number"
                  min={0}
                  value={wire.min_amount || ""}
                  onChange={(event) =>
                    set({ min_amount: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label="Maximum basket (Rp)" htmlFor="rule-maxamount">
                <input
                  id="rule-maxamount"
                  type="number"
                  min={0}
                  value={wire.max_amount || ""}
                  onChange={(event) =>
                    set({ max_amount: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Valid from" htmlFor="rule-from">
                <input
                  id="rule-from"
                  type="date"
                  value={validFrom}
                  onChange={(event) =>
                    set({ valid_from: dayToRfc3339(event.target.value) })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label="Valid to" htmlFor="rule-to">
                <input
                  id="rule-to"
                  type="date"
                  value={validTo}
                  onChange={(event) =>
                    set({ valid_to: dayToRfc3339(event.target.value) })
                  }
                  className={fieldClass}
                />
              </Field>
            </Row>
            <Field
              label="Coupon"
              hint="A coupon unlocks this rule. It carries no value of its own — that is a voucher."
              htmlFor="rule-coupon"
            >
              <select
                id="rule-coupon"
                value={wire.coupon_id}
                onChange={(event) => set({ coupon_id: event.target.value })}
                className={fieldClass}
              >
                <option value="">No coupon — applies on its own</option>
                {(data?.coupons ?? []).map((coupon) => (
                  <option key={coupon.code} value={coupon.code}>
                    {coupon.code} · {coupon.name}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle
              label="Advisory only"
              hint="Shown to the cashier as a suggestion instead of applying itself."
              checked={wire.advisory}
              onChange={(advisory) => set({ advisory })}
            />
          </Section>

          <Section title="Stacking">
            <Toggle
              label="Exclusive"
              hint="Nothing else may apply alongside it."
              checked={wire.exclusive}
              onChange={(exclusive) => set({ exclusive })}
            />
            <Toggle
              label="Stacks with other rules"
              disabled={wire.exclusive}
              checked={!wire.exclusive && wire.stack_with_other_rules}
              onChange={(stack_with_other_rules) =>
                set({ stack_with_other_rules })
              }
            />
            <Toggle
              label="May combine with a voucher"
              disabled={wire.exclusive}
              checked={!wire.exclusive && wire.stack_with_voucher}
              onChange={(stack_with_voucher) => set({ stack_with_voucher })}
            />
            <Toggle
              label="May combine with points"
              disabled={wire.exclusive}
              checked={!wire.exclusive && wire.stack_with_points}
              onChange={(stack_with_points) => set({ stack_with_points })}
            />
            <Toggle
              label="May combine with the employee discount"
              disabled={wire.exclusive}
              checked={!wire.exclusive && wire.stack_with_employee}
              onChange={(stack_with_employee) => set({ stack_with_employee })}
            />
          </Section>

          <Section title="Caps">
            <Row>
              <Field
                label="Total uses"
                hint="Zero means uncapped."
                htmlFor="rule-maxuses"
              >
                <input
                  id="rule-maxuses"
                  type="number"
                  min={0}
                  value={wire.max_uses || ""}
                  onChange={(event) =>
                    set({ max_uses: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label="Uses per customer" htmlFor="rule-percustomer">
                <input
                  id="rule-percustomer"
                  type="number"
                  min={0}
                  value={wire.per_customer_max || ""}
                  onChange={(event) =>
                    set({ per_customer_max: Number(event.target.value) || 0 })
                  }
                  className={fieldClass}
                />
              </Field>
            </Row>
            <Field
              label="Budget (Rp)"
              hint={
                target?.mode === "edit"
                  ? `Spent so far: ${rupiah(wire.budget_used)}. Internal owns that counter; it cannot be edited here.`
                  : "Zero means uncapped."
              }
              htmlFor="rule-budget"
            >
              <input
                id="rule-budget"
                type="number"
                min={0}
                value={wire.budget || ""}
                onChange={(event) =>
                  set({ budget: Number(event.target.value) || 0 })
                }
                className={fieldClass}
              />
            </Field>
          </Section>
        </div>
      )}
    </SheetShell>
  )
}

/* ── price lists ──────────────────────────────────────────────── */

export type ListSheetTarget = { mode: "create" } | { mode: "edit"; id: string }

/** What the hub accepts for a price list. The *write* shape, not the read
 *  model — validating a draft against what comes back rejects valid drafts for
 *  missing server-minted fields. */
const priceListInput = z.object({
  name: z.string().trim().min(1, "Name the price list."),
  description: z.string(),
  is_default: z.boolean(),
  is_active: z.boolean(),
})

type PriceListDraft = z.infer<typeof priceListInput>

export function PriceListSheet({
  target,
  onClose,
}: {
  target: ListSheetTarget | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const editId = target?.mode === "edit" ? target.id : null
  const { row, error: loadError } = useLiveRow(editId, loadPriceList)
  const ready = target?.mode === "create" || Boolean(row)

  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow="Price-list cascade"
      title={target?.mode === "edit" ? (row?.name ?? "Price list") : "New price list"}
      onRequestClose={onClose}
      footer={null}
    >
      {!ready ? (
        loadError ? (
          <p className="px-[18px] py-6 text-xs text-ember">{loadError}</p>
        ) : (
          <Loading label="the price list" />
        )
      ) : (
        /* Keyed by the opening, so a reopened sheet mounts a fresh form with
         * the right defaults rather than resetting a live one. `useDraft` used
         * to seed during render for the same reason — remounting is what "this
         * is a different record" actually means, and it converges in one
         * commit instead of flashing the last record's values. */
        <PriceListForm
          key={editId ?? "create"}
          target={target!}
          row={row}
          onClose={onClose}
        />
      )}
    </SheetShell>
  )
}

function PriceListForm({
  target,
  row,
  onClose,
}: {
  target: ListSheetTarget
  row: Awaited<ReturnType<typeof loadPriceList>> | null
  onClose: () => void
}) {
  const { busy, error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: {
      name: row?.name ?? "",
      description: row?.description ?? "",
      is_default: row?.is_default ?? false,
      is_active: row?.is_active ?? true,
    } satisfies PriceListDraft,
    /* zod is a Standard Schema, so it is the validator — no adapter. */
    validators: { onChange: priceListInput },
    onSubmit: async ({ value }) => {
      const body = { ...value, name: value.name.trim() }
      await run(() =>
        target.mode === "create"
          ? createPriceList(mintId("pricelist"), body)
          : savePriceList(target.id, body)
      )
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="px-[18px] pt-4">
        <form.FormError message={error} />
        <p className="rounded-panel bg-inset px-3 py-2 text-[11px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          The cascade reads most specific first: one store beats a store group, a
          store group beats a member tier, and a tier beats the global default.
          The hub&rsquo;s price list carries no store or tier scope, so every list
          it holds — this one included — feeds the global level, and its entries
          compete there on priority.
        </p>
      </div>

      <Section title="The list">
        <form.AppField name="name">
          {(field) => (
            <field.TextField label="Name" required placeholder="Jakarta stores" />
          )}
        </form.AppField>
        <form.AppField name="description">
          {(field) => (
            <field.TextAreaField
              label="Description"
              placeholder="What this list is for"
            />
          )}
        </form.AppField>
      </Section>

      <Section title="Where it applies">
        <form.AppField name="is_default">
          {(field) => (
            <field.SwitchField
              label="The global default list"
              hint="The list the engine treats as the base price for a SKU. Only one list should hold it."
            />
          )}
        </form.AppField>
        <p className="pt-2 text-[11px] leading-[1.5] text-ink-4">
          There is no store scope to set here: the hub&rsquo;s price-list row has
          no store column, and the pricing-management route that would author a
          store-level list is a stub. A markdown or a rule is where a per-store
          price is expressed on this deployment.
        </p>
        <form.AppField name="is_active">
          {(field) => (
            <field.SwitchField
              label="Active"
              hint="An inactive list is skipped at every level of the cascade."
            />
          )}
        </form.AppField>
      </Section>

      <div className="flex items-center gap-2 px-[18px] py-3">
        {target.mode === "edit" && (
          <form.Subscribe selector={(state) => state.values.is_active}>
            {(isActive) =>
              isActive ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => retirePriceList(target.id))}
                  className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-45"
                >
                  Retire list
                </button>
              ) : null
            }
          </form.Subscribe>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <form.SubmitButton
          label={target.mode === "edit" ? "Save list" : "Create list"}
        />
      </div>
    </form>
  )
}

/* ── price-list entries ───────────────────────────────────────── */

export type EntrySheetTarget =
  | { mode: "create"; listId?: string }
  | { mode: "edit"; listId: string; entryId: string }

/** What the hub accepts for one price-list entry. `cost_price` rides along
 *  round-tripped only — the sheet never shows it. */
const priceEntryInput = z
  .object({
    listId: z.string(),
    sku: z.string(),
    article_id: z.string(),
    base_price: z.number().optional(),
    sale_price: z.number().optional(),
    cost_price: z.number().optional(),
    priority: z.number().optional(),
    start: z.string(),
    end: z.string(),
    is_active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.listId)
      ctx.addIssue({
        code: "custom",
        path: ["listId"],
        message: "Choose the price list this price belongs to.",
      })
    if (!value.sku.trim())
      ctx.addIssue({
        code: "custom",
        path: ["sku"],
        message: "Name the SKU this price is for.",
      })
    if (!((value.base_price ?? 0) > 0))
      ctx.addIssue({
        code: "custom",
        path: ["base_price"],
        message: "A price entry needs a price above zero.",
      })
    if (value.sale_price !== undefined && value.sale_price < 0)
      ctx.addIssue({
        code: "custom",
        path: ["sale_price"],
        message: "A sale price cannot be negative.",
      })
    if (value.start && value.end && value.start > value.end)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "The window ends before it starts.",
      })
  })

type PriceEntryDraftShape = z.infer<typeof priceEntryInput>

export function PriceEntrySheet({
  target,
  resource,
  onClose,
}: {
  target: EntrySheetTarget | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  /* The entry is re-read from its own route rather than picked out of the
   * list projection: `sale_price` and `cost_price` never reach the screens,
   * and a PUT built from the projection would blank them. */
  const entryId = target?.mode === "edit" ? target.entryId : null
  const { row: entry, error: loadError } = useLiveRow(entryId, loadPriceEntry)
  const ready = target?.mode === "create" || Boolean(entry)

  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow="Price-list cascade"
      title={target?.mode === "edit" ? (entry?.sku ?? "Price") : "New price"}
      onRequestClose={onClose}
      footer={null}
    >
      {!ready ? (
        loadError ? (
          <p className="px-[18px] py-6 text-xs text-ember">{loadError}</p>
        ) : (
          <Loading label="the price" />
        )
      ) : (
        <PriceEntryForm
          key={entryId ?? "create"}
          target={target!}
          entry={entry}
          resource={resource}
          onClose={onClose}
        />
      )}
    </SheetShell>
  )
}

function PriceEntryForm({
  target,
  entry,
  resource,
  onClose,
}: {
  target: EntrySheetTarget
  entry: Awaited<ReturnType<typeof loadPriceEntry>> | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const { busy, error, run } = useSheetForm(onClose)
  const data = resource.data
  const skuOptions = useMemo<Option[]>(
    () =>
      (data?.articles ?? []).map((article) => ({
        value: article.id,
        label: article.name,
      })),
    [data]
  )
  const listOptions = useMemo<SelectOption[]>(
    () =>
      (data?.priceLists ?? []).map((option) => ({
        value: option.id,
        label: option.name + (option.isDefault ? " · global default" : ""),
      })),
    [data]
  )

  const defaultValues: PriceEntryDraftShape = {
    listId: entry
      ? entry.list_id
      : target.mode === "create"
        ? (target.listId ?? "")
        : "",
    sku: entry?.sku ?? "",
    article_id: entry?.article_id ?? "",
    base_price: entry?.base_price || undefined,
    sale_price: entry?.sale_price ?? undefined,
    cost_price: entry?.cost_price ?? undefined,
    priority: entry?.priority || undefined,
    start: entry ? rfc3339ToDay(entry.start_date) : "",
    end: entry ? rfc3339ToDay(entry.end_date) : "",
    is_active: entry ? entry.is_active : true,
  }

  const form = useAppForm({
    defaultValues,
    validators: { onChange: priceEntryInput },
    onSubmit: async ({ value }) => {
      const body = {
        sku: value.sku.trim(),
        article_id: value.article_id.trim(),
        base_price: value.base_price ?? 0,
        sale_price: value.sale_price ?? null,
        cost_price: value.cost_price ?? null,
        priority: value.priority ?? 0,
        start_date: dayToRfc3339(value.start),
        end_date: dayToRfc3339(value.end),
        is_active: value.is_active,
      }
      await run(() =>
        target.mode === "create"
          ? addPriceEntry(value.listId, mintId("pe"), body)
          : savePriceEntry(target.listId, target.entryId, body)
      )
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="px-[18px] pt-4">
        <form.FormError message={error} />
        <p className="rounded-panel bg-inset px-3 py-2 text-[11px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          This is the price the till starts from, not a discount. Entries
          compete on priority inside the global level, and a live markdown
          replaces whatever wins.
        </p>
      </div>

      <Section title="The price">
        <form.AppField name="listId">
          {(field) => (
            <field.SelectField
              label="Price list"
              required
              disabled={target.mode === "edit"}
              placeholder="Choose…"
              options={listOptions}
            />
          )}
        </form.AppField>
        <form.AppField name="sku">
          {(field) => (
            <Field label="SKU" required htmlFor="entry-sku">
              <input
                id="entry-sku"
                list="entry-sku-options"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className={cn(fieldClass, "font-mono")}
              />
              <datalist id="entry-sku-options">
                {skuOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </Field>
          )}
        </form.AppField>
        <Row>
          <form.AppField name="base_price">
            {(field) => <field.MoneyField label="Price (Rp)" required />}
          </form.AppField>
          <form.AppField name="priority">
            {(field) => (
              <field.NumberField
                label="Priority"
                hint="Breaks a tie between two entries at the same level; highest wins."
              />
            )}
          </form.AppField>
        </Row>
        <form.AppField name="sale_price">
          {(field) => (
            <field.MoneyField
              label="Sale price (Rp)"
              hint="Optional. When set, this is what the engine resolves to instead of the price above."
            />
          )}
        </form.AppField>
        <form.AppField name="article_id">
          {(field) => (
            <field.TextField
              label="Article"
              hint="Optional. Set it and the entry also matches by article, not only by SKU."
            />
          )}
        </form.AppField>
      </Section>

      <Section title="When it holds">
        <Row>
          <form.AppField name="start">
            {(field) => <field.DateField label="From" />}
          </form.AppField>
          <form.AppField name="end">
            {(field) => <field.DateField label="To" />}
          </form.AppField>
        </Row>
        <form.AppField name="is_active">
          {(field) => (
            <field.SwitchField
              label="Active"
              hint="An inactive entry is skipped; the cascade falls through to the next level."
            />
          )}
        </form.AppField>
      </Section>

      <div className="flex items-center gap-2 px-[18px] py-3">
        {target.mode === "edit" && entry?.is_active && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => retirePriceEntry(target.entryId))}
            className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-45"
          >
            Retire price
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <form.SubmitButton
          label={target.mode === "edit" ? "Save price" : "Add price"}
        />
      </div>
    </form>
  )
}

/* ── markdowns ────────────────────────────────────────────────── */

const MARKDOWN_TYPE: { value: MarkdownTypeWire; label: string }[] = [
  { value: "fixed", label: "Set to a fixed price" },
  { value: "amount", label: "Taken off the original" },
  { value: "percentage", label: "A percentage of the original" },
]

const MARKDOWN_STATUS: { value: MarkdownStatusWire; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
]

export type MarkdownSheetTarget = { mode: "create" } | { mode: "edit"; id: string }

/*
 * `markdown_value` is metadata describing how the author reached the price;
 * the engine reads `markdown_price` and nothing else. It is derived here
 * rather than collected, so the two can never disagree.
 */
function derivedMarkdownValue(
  type: MarkdownTypeWire,
  originalPrice: number,
  markdownPrice: number
): number {
  if (type === "fixed") return markdownPrice
  if (type === "amount") return Math.max(0, originalPrice - markdownPrice)
  return originalPrice > 0
    ? Math.round(((originalPrice - markdownPrice) / originalPrice) * 10_000)
    : 0
}

/* `start_date` / `end_date` are plain `time.Time` on the hub, never
 * pointers, so an unset window is sent as Go's own zero time rather than
 * as null — which the decoder would refuse. */
const ZERO_TIME = "0001-01-01T00:00:00Z"

/** What the hub accepts for a markdown. `article_id` rides along
 *  round-tripped only — the sheet never shows it. */
const markdownInput = z
  .object({
    name: z.string(),
    sku: z.string(),
    article_id: z.string(),
    list_id: z.string(),
    original_price: z.number().optional(),
    markdown_price: z.number().optional(),
    markdown_type: z.enum(["fixed", "amount", "percentage"]),
    start: z.string(),
    end: z.string(),
    store_ids: z.array(z.string()),
    reason: z.string(),
    status: z.enum(["draft", "scheduled", "active", "expired", "cancelled"]),
  })
  .superRefine((value, ctx) => {
    if (!value.name.trim())
      ctx.addIssue({ code: "custom", path: ["name"], message: "Name the markdown." })
    if (!value.sku.trim())
      ctx.addIssue({
        code: "custom",
        path: ["sku"],
        message: "Name the SKU being marked down.",
      })
    if (!((value.original_price ?? 0) > 0))
      ctx.addIssue({
        code: "custom",
        path: ["original_price"],
        message: "Record the price this replaces.",
      })
    if (!((value.markdown_price ?? 0) > 0))
      ctx.addIssue({
        code: "custom",
        path: ["markdown_price"],
        message: "A markdown needs a price above zero.",
      })
    if (
      (value.markdown_price ?? 0) > (value.original_price ?? 0) &&
      (value.original_price ?? 0) > 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["markdown_price"],
        message: "The markdown price is above the price it replaces.",
      })
    if (value.start && value.end && value.start > value.end)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "The window ends before it starts.",
      })
  })

type MarkdownDraftShape = z.infer<typeof markdownInput>

export function MarkdownSheet({
  target,
  resource,
  onClose,
}: {
  target: MarkdownSheetTarget | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const editId = target?.mode === "edit" ? target.id : null
  const { row, error: loadError } = useLiveRow(editId, loadMarkdown)
  const ready = target?.mode === "create" || Boolean(row)

  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow="A price source, not a discount"
      title={target?.mode === "edit" ? (row?.name ?? "Markdown") : "New markdown"}
      onRequestClose={onClose}
      footer={null}
    >
      {!ready ? (
        loadError ? (
          <p className="px-[18px] py-6 text-xs text-ember">{loadError}</p>
        ) : (
          <Loading label="the markdown" />
        )
      ) : (
        <MarkdownForm
          key={editId ?? "create"}
          target={target!}
          row={row}
          resource={resource}
          onClose={onClose}
        />
      )}
    </SheetShell>
  )
}

function MarkdownForm({
  target,
  row,
  resource,
  onClose,
}: {
  target: MarkdownSheetTarget
  row: Awaited<ReturnType<typeof loadMarkdown>> | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const { busy, error, run } = useSheetForm(onClose)
  const data = resource.data
  const skuOptions = useMemo<Option[]>(
    () =>
      (data?.articles ?? []).map((article) => ({
        value: article.id,
        label: article.name,
      })),
    [data]
  )

  const defaultValues: MarkdownDraftShape = {
    name: row?.name ?? "",
    sku: row?.sku ?? "",
    article_id: row?.article_id ?? "",
    list_id: row?.list_id ?? "",
    original_price: row?.original_price || undefined,
    markdown_price: row?.markdown_price || undefined,
    markdown_type: row?.markdown_type ?? ("fixed" as MarkdownTypeWire),
    start: row ? rfc3339ToDay(row.start_date) : "",
    end: row ? rfc3339ToDay(row.end_date) : "",
    store_ids: row?.store_ids ?? ([] as string[]),
    reason: row?.reason ?? "",
    status: row?.status ?? ("draft" as MarkdownStatusWire),
  }

  const form = useAppForm({
    defaultValues,
    validators: { onChange: markdownInput },
    onSubmit: async ({ value }) => {
      const body: Omit<MarkdownWire, "markdown_id"> = {
        name: value.name.trim(),
        sku: value.sku.trim(),
        article_id: value.article_id.trim(),
        list_id: value.list_id,
        original_price: value.original_price ?? 0,
        markdown_price: value.markdown_price ?? 0,
        markdown_type: value.markdown_type,
        markdown_value: derivedMarkdownValue(
          value.markdown_type,
          value.original_price ?? 0,
          value.markdown_price ?? 0
        ),
        start_date: dayToRfc3339(value.start) ?? ZERO_TIME,
        end_date: dayToRfc3339(value.end) ?? ZERO_TIME,
        store_ids: value.store_ids,
        reason: value.reason,
        status: value.status,
      }
      await run(() =>
        target.mode === "create"
          ? createMarkdown(mintId("md"), body)
          : saveMarkdown(target.id, body)
      )
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="px-[18px] pt-4">
        <form.FormError message={error} />
        <p className="rounded-panel bg-red-tint px-3 py-2 text-[11px] leading-[1.5] text-red">
          A markdown replaces whatever the cascade resolved to for as long
          as it runs. It does not stack with the price underneath it, and
          rules still run on top of the markdown price.
        </p>
      </div>

      <Section title="The markdown">
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              label="Name"
              required
              placeholder="End of season clearance"
            />
          )}
        </form.AppField>
        <form.AppField name="sku">
          {(field) => (
            <Field label="SKU" required htmlFor="md-sku">
              <input
                id="md-sku"
                list="md-sku-options"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className={cn(fieldClass, "font-mono")}
              />
              <datalist id="md-sku-options">
                {skuOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </Field>
          )}
        </form.AppField>
        <Row>
          <form.AppField name="status">
            {(field) => (
              <field.SelectField label="Status" options={MARKDOWN_STATUS} />
            )}
          </form.AppField>
          <form.AppField name="list_id">
            {(field) => (
              <field.SelectField
                label="Price list"
                hint="Optional. Records which list's price this replaces."
                placeholder="None"
                options={(data?.priceLists ?? []).map((option) => ({
                  value: option.id,
                  label: option.name,
                }))}
              />
            )}
          </form.AppField>
        </Row>
      </Section>

      <Section
        title="The price"
        hint="The engine reads the marked-down price. How it was reached is recorded alongside it."
      >
        <form.AppField name="markdown_type">
          {(field) => (
            <field.SelectField label="How it was set" options={MARKDOWN_TYPE} />
          )}
        </form.AppField>
        <Row>
          <form.AppField name="original_price">
            {(field) => (
              <field.MoneyField label="Price it replaces (Rp)" required />
            )}
          </form.AppField>
          <form.AppField name="markdown_price">
            {(field) => (
              <field.MoneyField label="Marked-down price (Rp)" required />
            )}
          </form.AppField>
        </Row>
        <form.Subscribe
          selector={(state) => ({
            originalPrice: state.values.original_price,
            markdownPrice: state.values.markdown_price,
            markdownType: state.values.markdown_type,
          })}
        >
          {({ originalPrice, markdownPrice, markdownType }) =>
            (originalPrice ?? 0) > 0 && (markdownPrice ?? 0) > 0 ? (
              <p className="text-[11px] text-ink-4">
                {rupiah((originalPrice ?? 0) - (markdownPrice ?? 0))} below the
                price it replaces
                {markdownType === "percentage"
                  ? ` · recorded as ${(
                      derivedMarkdownValue(
                        markdownType,
                        originalPrice ?? 0,
                        markdownPrice ?? 0
                      ) / 100
                    ).toFixed(2)}%`
                  : ""}
                .
              </p>
            ) : null
          }
        </form.Subscribe>
      </Section>

      <Section title="Where and when">
        <Row>
          <form.AppField name="start">
            {(field) => <field.DateField label="From" />}
          </form.AppField>
          <form.AppField name="end">
            {(field) => <field.DateField label="To" />}
          </form.AppField>
        </Row>
        <form.AppField name="store_ids">
          {(field) => (
            <StorePicker
              label="Stores"
              stores={data?.stores ?? []}
              values={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.AppField>
        <form.AppField name="reason">
          {(field) => (
            <field.TextAreaField
              label="Reason"
              placeholder="End of season, damaged packaging…"
            />
          )}
        </form.AppField>
      </Section>

      <div className="flex items-center gap-2 px-[18px] py-3">
        {target.mode === "edit" && (
          <form.Subscribe selector={(state) => state.values.status}>
            {(status) =>
              status !== "cancelled" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => retireMarkdown(target.id))}
                  className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-45"
                >
                  Cancel markdown
                </button>
              ) : null
            }
          </form.Subscribe>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <form.SubmitButton
          label={target.mode === "edit" ? "Save markdown" : "Create markdown"}
        />
      </div>
    </form>
  )
}

/* ── campaigns ────────────────────────────────────────────────── */

const CAMPAIGN_STATUS: { value: CampaignStatusWire; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

export type CampaignSheetTarget = { mode: "create" } | { mode: "edit"; id: string }

/** What the campaign sheet accepts. Same rules `CreateCampaign` enforced
 *  inline before: a name, both dates in order, and a non-negative budget. */
const campaignInput = z
  .object({
    name: z.string(),
    description: z.string(),
    theme: z.string(),
    status: z.enum(["draft", "scheduled", "active", "completed", "cancelled"]),
    start: z.string(),
    end: z.string(),
    budget: z.number().optional(),
    store_ids: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (!value.name.trim())
      ctx.addIssue({ code: "custom", path: ["name"], message: "Name the campaign." })
    /* `CreateCampaign` refuses a zero start or end date outright, so both are
     * required here rather than being sent as Go's zero time. */
    if (!value.start)
      ctx.addIssue({
        code: "custom",
        path: ["start"],
        message: "A campaign needs both a start and an end date.",
      })
    if (!value.end)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "A campaign needs both a start and an end date.",
      })
    if (value.start && value.end && value.start > value.end)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "The campaign ends before it starts.",
      })
  })

type CampaignDraft = z.infer<typeof campaignInput>

export function CampaignSheet({
  target,
  resource,
  onClose,
}: {
  target: CampaignSheetTarget | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const editId = target?.mode === "edit" ? target.id : null
  const { row, error: loadError } = useLiveRow(editId, loadCampaign)
  const ready = target?.mode === "create" || Boolean(row)

  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow="Lifecycle and budget container"
      title={target?.mode === "edit" ? (row?.name ?? "Campaign") : "New campaign"}
      onRequestClose={onClose}
      footer={null}
    >
      {!ready ? (
        loadError ? (
          <p className="px-[18px] py-6 text-xs text-ember">{loadError}</p>
        ) : (
          <Loading label="the campaign" />
        )
      ) : (
        <CampaignForm
          key={editId ?? "create"}
          target={target!}
          row={row}
          resource={resource}
          onClose={onClose}
        />
      )}
    </SheetShell>
  )
}

function CampaignForm({
  target,
  row,
  resource,
  onClose,
}: {
  target: CampaignSheetTarget
  row: Awaited<ReturnType<typeof loadCampaign>> | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const { busy, error, run } = useSheetForm(onClose)
  const editId = target.mode === "edit" ? target.id : null
  const rules = (resource.data?.pricingRules ?? []).filter(
    (item) => editId && item.campaignId === editId
  )

  const defaultValues: CampaignDraft = {
    name: row?.name ?? "",
    description: row?.description ?? "",
    theme: row?.theme ?? "",
    status: row?.status ?? ("draft" as CampaignStatusWire),
    start: row ? rfc3339ToDay(row.start_date) : "",
    end: row ? rfc3339ToDay(row.end_date) : "",
    budget: row?.budget && row.budget > 0 ? row.budget : undefined,
    store_ids: row?.store_ids ?? ([] as string[]),
  }

  const form = useAppForm({
    defaultValues,
    validators: { onChange: campaignInput },
    onSubmit: async ({ value }) => {
      const edit = {
        name: value.name.trim(),
        description: value.description,
        theme: value.theme.trim(),
        status: value.status,
        start_date: dayToRfc3339(value.start) ?? "",
        end_date: dayToRfc3339(value.end) ?? "",
        // `budget` is a *money.Money: null leaves the campaign uncapped,
        // which is not the same as capping it at zero.
        budget: value.budget && value.budget > 0 ? value.budget : null,
        store_ids: value.store_ids,
      }
      await run(() =>
        target.mode === "create"
          ? createCampaign(mintId("camp"), edit)
          : saveCampaign(target.id, edit)
      )
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="px-[18px] pt-4">
        <form.FormError message={error} />
        <p className="rounded-panel bg-inset px-3 py-2 text-[11px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          A campaign prices nothing itself. It holds the window, the budget
          and the store scope that the rules inside it are authored against
          {rules.length
            ? ` — ${rules.length} rule${rules.length === 1 ? "" : "s"} name this one.`
            : "."}
        </p>
      </div>

      <Section title="The campaign">
        <form.AppField name="name">
          {(field) => (
            <field.TextField label="Title" required placeholder="Ramadan sale" />
          )}
        </form.AppField>
        <form.AppField name="description">
          {(field) => (
            <field.TextAreaField
              label="Description"
              hint="Stored on the campaign itself, and shown on its detail."
              placeholder="What this campaign is for, and who it is aimed at"
            />
          )}
        </form.AppField>
        <Row>
          <form.AppField name="theme">
            {(field) => (
              <field.TextField label="Theme" placeholder="clearance" />
            )}
          </form.AppField>
          <form.AppField name="status">
            {(field) => (
              <field.SelectField label="Status" options={CAMPAIGN_STATUS} />
            )}
          </form.AppField>
        </Row>
      </Section>

      <Section title="Window and budget">
        <Row>
          <form.AppField name="start">
            {(field) => <field.DateField label="Starts" />}
          </form.AppField>
          <form.AppField name="end">
            {(field) => <field.DateField label="Ends" />}
          </form.AppField>
        </Row>
        <form.AppField name="budget">
          {(field) => (
            <field.MoneyField
              label="Budget (Rp)"
              hint="Zero means uncapped. Internal exposes no spend-to-date on the campaign read, so none is shown."
            />
          )}
        </form.AppField>
      </Section>

      <Section title="Store scope">
        <form.AppField name="store_ids">
          {(field) => (
            <StorePicker
              label="Stores"
              stores={resource.data?.stores ?? []}
              values={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.AppField>
      </Section>

      <div className="flex items-center gap-2 px-[18px] py-3">
        {target.mode === "edit" && (
          <form.Subscribe selector={(state) => state.values.status}>
            {(status) =>
              status !== "cancelled" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => retireCampaign(target.id))}
                  className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-45"
                >
                  Cancel campaign
                </button>
              ) : null
            }
          </form.Subscribe>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <form.SubmitButton
          label={target.mode === "edit" ? "Save campaign" : "Create campaign"}
        />
      </div>
    </form>
  )
}

/* ── campaign detail ──────────────────────────────────────────── */

/** The read view of one campaign: what it holds, and what names it. */
export function CampaignDetailSheet({
  id,
  resource,
  onClose,
  onEdit,
}: {
  id: string | null
  resource: CommercialResourceState
  onClose: () => void
  onEdit: (id: string) => void
}) {
  const { row, error } = useLiveRow(id, loadCampaign)
  const data = resource.data

  const promotions = (data?.promotions ?? []).filter(
    (promotion) =>
      (row?.promo_ids ?? []).includes(promotion.id) ||
      (id ? promotion.campaignIds.includes(id) : false)
  )
  const rules = (data?.pricingRules ?? []).filter(
    (item) => id && item.campaignId === id
  )
  const storeNames = (row?.store_ids ?? []).map(
    (code) => data?.stores.find((store) => store.id === code)?.name ?? code
  )

  return (
    <SheetShell
      open={Boolean(id)}
      size="wide"
      eyebrow="Lifecycle and budget container"
      title={row?.name ?? "Campaign"}
      onRequestClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={sheetButton.secondary}>
            Close
          </button>
          <button
            type="button"
            disabled={!id}
            onClick={() => id && onEdit(id)}
            className={cn(
              sheetButton.primary,
              "disabled:pointer-events-none disabled:opacity-45"
            )}
          >
            <Icon path={paths.edit} size={14} width={2} />
            Edit campaign
          </button>
        </>
      }
    >
      {!row ? (
        error ? (
          <p className="px-[18px] py-6 text-xs text-ember">{error}</p>
        ) : (
          <Loading label="the campaign" />
        )
      ) : (
        <div className="px-4 py-4">
          <div className="grid grid-cols-3 gap-2 pb-3">
            {[
              {
                label: "Window",
                value:
                  rfc3339ToDay(row.start_date) || rfc3339ToDay(row.end_date)
                    ? `${rfc3339ToDay(row.start_date) ? shortDate(rfc3339ToDay(row.start_date)) : "Open"} – ${rfc3339ToDay(row.end_date) ? shortDate(rfc3339ToDay(row.end_date)) : "Open"}`
                    : "Always",
              },
              {
                label: "Budget",
                value: row.budget ? rupiah(row.budget) : "Uncapped",
              },
              {
                label: "Stores",
                value: storeNames.length
                  ? `${storeNames.length} store${storeNames.length === 1 ? "" : "s"}`
                  : "Every store",
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
              >
                <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                  {stat.label}
                </div>
                <div className="truncate font-mono text-[13px] font-medium text-ink">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          <div className="pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
            Description
          </div>
          <p className="rounded-panel border border-line-strong px-3 py-2.5 text-[12px] leading-[1.6] text-ink-2">
            {row.description || (
              <span className="text-ink-4">
                No description was authored for this campaign.
              </span>
            )}
          </p>

          {row.theme && (
            <p className="pt-1.5 text-[11px] text-ink-4">
              Theme: <span className="text-ink-3">{row.theme}</span>
            </p>
          )}

          <div className="pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
            What it holds
          </div>
          {promotions.length === 0 && rules.length === 0 ? (
            <p className="rounded-panel bg-inset py-6 text-center text-xs text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
              No promotion or pricing rule names this campaign.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-panel border border-line-strong">
              {promotions.map((promotion) => (
                <li
                  key={promotion.id}
                  className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <span className="inline-flex h-[20px] shrink-0 items-center rounded-[6px] bg-accent-tint px-1.5 text-[10.5px] font-medium text-accent-ink">
                    {promotion.type.replaceAll("_", " ")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {promotion.name}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-4">
                    {promotion.summary}
                  </span>
                </li>
              ))}
              {rules.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <span className="inline-flex h-[20px] shrink-0 items-center rounded-[6px] bg-inset px-1.5 text-[10.5px] font-medium text-ink-2">
                    rule
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-4">
                    {item.applyOn} · {item.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {storeNames.length > 0 && (
            <>
              <div className="pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                Stores
              </div>
              <div className="flex flex-wrap gap-1">
                {storeNames.map((name) => (
                  <span
                    key={name}
                    className="inline-flex h-[20px] items-center rounded-[6px] bg-inset px-1.5 text-[11px] text-ink-3"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </>
          )}

          <p className="pt-4 text-[11px] leading-[1.5] text-ink-4">
            The budget above is the cap authored on the campaign. Internal's
            campaign read carries no spend-to-date, so none is shown rather than
            estimated here.
          </p>
        </div>
      )}
    </SheetShell>
  )
}

/* ── coupons ──────────────────────────────────────────────────── */

/**
 * A coupon UNLOCKS A RULE. It carries no value of its own — that is what a
 * voucher is for — so the only thing that makes it worth anything is the rule
 * it names, and that field is required here.
 *
 * The hub's coupon route has no per-code GET and no PUT: `POST /coupons` is an
 * upsert keyed on `code`. Editing therefore seeds from the collection read
 * this app already holds rather than from a second fetch.
 */
export type CouponSheetTarget =
  | { mode: "create" }
  | { mode: "edit"; code: string }

/** What upserting a coupon accepts. `used` rides along round-tripped only —
 *  the sheet never shows it. */
const couponInput = z
  .object({
    code: z.string(),
    name: z.string(),
    kind: z.enum(["promotional", "gift"]),
    rule_id: z.string(),
    campaign_id: z.string(),
    member_id: z.string(),
    max_uses: z.number().optional(),
    used: z.number(),
    require_online: z.boolean(),
    status: z.enum(["active", "draft", "expired"]),
    start: z.string(),
    end: z.string(),
  })
  .superRefine((value, ctx) => {
    if (!value.code.trim())
      ctx.addIssue({ code: "custom", path: ["code"], message: "Give the coupon a code." })
    if (/\s/.test(value.code.trim()))
      ctx.addIssue({
        code: "custom",
        path: ["code"],
        message: "A coupon code cannot contain spaces — it is typed at the till.",
      })
    if (!value.rule_id.trim())
      ctx.addIssue({
        code: "custom",
        path: ["rule_id"],
        message: "Name the rule this coupon unlocks. A coupon with no rule does nothing.",
      })
    if (value.start && value.end && value.start > value.end)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "The window ends before it starts.",
      })
  })

type CouponDraftShape = z.infer<typeof couponInput>

function couponWire(value: CouponDraftShape): CouponWire {
  return {
    code: value.code.trim().toUpperCase(),
    name: value.name.trim() || value.code.trim().toUpperCase(),
    kind: value.kind,
    rule_id: value.rule_id.trim(),
    campaign_id: value.campaign_id,
    member_id: value.member_id.trim(),
    valid_from: dayToRfc3339(value.start),
    valid_to: dayToRfc3339(value.end),
    max_uses: value.max_uses ?? 0,
    used: value.used,
    require_online: value.require_online,
    status: value.status,
  }
}

export function CouponSheet({
  target,
  resource,
  onClose,
}: {
  target: CouponSheetTarget | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const editCode = target?.mode === "edit" ? target.code : null
  const live = useMemo(
    () =>
      editCode
        ? (resource.data?.coupons ?? []).find(
            (coupon) => coupon.code === editCode
          )
        : undefined,
    [editCode, resource.data]
  )
  const ready = target?.mode === "create" || Boolean(live)

  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow="A code that unlocks a rule"
      title={target?.mode === "edit" ? (live?.code ?? "Coupon") : "New coupon"}
      onRequestClose={onClose}
      footer={null}
    >
      {!ready ? (
        <Loading label="the coupon" />
      ) : (
        <CouponForm
          key={editCode ?? "create"}
          target={target!}
          live={live}
          resource={resource}
          onClose={onClose}
        />
      )}
    </SheetShell>
  )
}

function CouponForm({
  target,
  live,
  resource,
  onClose,
}: {
  target: CouponSheetTarget
  live: CommercialCoupon | undefined
  resource: CommercialResourceState
  onClose: () => void
}) {
  const { busy, error, run } = useSheetForm(onClose)
  const data = resource.data
  const ruleOptions = useMemo<SelectOption[]>(
    () =>
      (data?.pricingRules ?? []).map((option) => ({
        value: option.id,
        label: `${option.name} · ${option.status}`,
      })),
    [data]
  )
  const campaignOptions = useMemo<SelectOption[]>(
    () =>
      (data?.campaigns ?? []).map((option) => ({
        value: option.id,
        label: option.name,
      })),
    [data]
  )

  /* `blankCoupon()` seeds the defaults every field below overrides — kept so
   * a field this sheet does not collect (there are none today) still has a
   * defined starting value rather than `undefined`. */
  const blank = blankCoupon()
  const defaultValues: CouponDraftShape = {
    code: live?.code ?? blank.code,
    name: live?.name ?? blank.name,
    kind: (live?.kind ?? blank.kind) as "promotional" | "gift",
    rule_id: live?.ruleId ?? blank.rule_id,
    campaign_id: live?.campaignId ?? blank.campaign_id,
    member_id: live?.memberId ?? blank.member_id,
    max_uses: live?.maxUses || undefined,
    used: live?.used ?? blank.used,
    require_online: live?.requireOnline ?? blank.require_online,
    status: (live?.status ?? blank.status) as "active" | "draft" | "expired",
    start: live?.startsOn ?? "",
    end: live?.endsOn ?? "",
  }

  const form = useAppForm({
    defaultValues,
    validators: { onChange: couponInput },
    onSubmit: async ({ value }) => {
      await run(() => saveCoupon(couponWire(value)))
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="px-[18px] pt-4">
        <form.FormError message={error} />
        <p className="rounded-panel bg-inset px-3 py-2 text-[11px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          A coupon holds no value. It gates one rule: while the code is on
          the cart and valid, that rule is allowed to apply — and the rule
          decides what the customer actually gets.
        </p>
      </div>

      <Section title="The code">
        <Row>
          <form.AppField name="code">
            {(field) => (
              <field.TextField
                label="Code"
                required
                disabled={target.mode === "edit"}
                placeholder="HEMAT20"
              />
            )}
          </form.AppField>
          <form.AppField name="name">
            {(field) => (
              <field.TextField label="Name" placeholder="Kupon Hemat 20%" />
            )}
          </form.AppField>
        </Row>
        <Row>
          <form.AppField name="kind">
            {(field) => (
              <field.SelectField
                label="Kind"
                options={[
                  { value: "promotional", label: "Promotional" },
                  { value: "gift", label: "Gift" },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="status">
            {(field) => (
              <field.SelectField
                label="Status"
                options={[
                  { value: "active", label: "Active" },
                  { value: "draft", label: "Draft" },
                  { value: "expired", label: "Expired" },
                ]}
              />
            )}
          </form.AppField>
        </Row>
      </Section>

      <Section title="What it unlocks">
        <form.AppField name="rule_id">
          {(field) => (
            <field.SelectField
              label="Rule"
              required
              placeholder="Choose…"
              options={ruleOptions}
            />
          )}
        </form.AppField>
        <form.AppField name="campaign_id">
          {(field) => (
            <field.SelectField
              label="Campaign"
              hint="Optional. Ties the coupon's usage to a campaign's shared caps."
              placeholder="In no campaign"
              options={campaignOptions}
            />
          )}
        </form.AppField>
      </Section>

      <Section title="Who and when">
        <Row>
          <form.AppField name="start">
            {(field) => <field.DateField label="From" />}
          </form.AppField>
          <form.AppField name="end">
            {(field) => <field.DateField label="To" />}
          </form.AppField>
        </Row>
        <Row>
          <form.AppField name="max_uses">
            {(field) => (
              <field.NumberField label="Maximum uses" hint="Zero is unlimited." />
            )}
          </form.AppField>
          <form.AppField name="member_id">
            {(field) => (
              <field.TextField
                label="Member"
                hint="Optional. Leave empty and anyone holding the code may use it."
              />
            )}
          </form.AppField>
        </Row>
        <form.AppField name="require_online">
          {(field) => (
            <field.SwitchField
              label="Requires an online check"
              hint="The till must reach the hub to validate the code before it applies."
            />
          )}
        </form.AppField>
      </Section>

      <div className="flex items-center gap-2 px-[18px] py-3">
        {target.mode === "edit" && (
          <form.Subscribe selector={(state) => state.values}>
            {(values) =>
              values.status === "active" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => retireCoupon(couponWire(values)))}
                  className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-45"
                >
                  Expire coupon
                </button>
              ) : null
            }
          </form.Subscribe>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <form.SubmitButton
          label={target.mode === "edit" ? "Save coupon" : "Create coupon"}
        />
      </div>
    </form>
  )
}

/* ── vouchers ─────────────────────────────────────────────────── */

const VOUCHER_TYPE: { value: VoucherTypeWire; label: string }[] = [
  { value: "percent_off", label: "A percentage off the cart" },
  { value: "fixed_amount", label: "A rupiah amount off the cart" },
  { value: "free_item", label: "A free item" },
  { value: "points_exchange", label: "Points awarded on redemption" },
]

/**
 * A voucher CARRIES VALUE. Unlike a coupon it names no rule: the value is the
 * instrument itself, which is why it is issued rather than authored.
 *
 * The hub exposes exactly three operations on one — issue, extend the expiry,
 * void it — so those are the three offered here. There is no general edit,
 * and the sheet says so rather than presenting fields it cannot save.
 */
export type VoucherSheetTarget =
  | { mode: "create" }
  | { mode: "edit"; id: string }

/** What issuing a voucher accepts. Extending one only ever touches `expiry`
 *  — the rest of the shape rides along disabled, so the schema is shared but
 *  the rules applied to it are chosen by which mode is open. */
const voucherShape = z.object({
  code: z.string(),
  type: z.enum(["percent_off", "fixed_amount", "free_item", "points_exchange"]),
  discountPct: z.number().optional(),
  valueIdr: z.number().optional(),
  minSpend: z.number().optional(),
  pointsValue: z.number().optional(),
  redeemableViaLoyalty: z.boolean(),
  expiry: z.string(),
})

const voucherIssueInput = voucherShape.superRefine((value, ctx) => {
  if (!value.code.trim())
    ctx.addIssue({ code: "custom", path: ["code"], message: "Give the voucher a serial code." })
  if (!value.expiry)
    ctx.addIssue({
      code: "custom",
      path: ["expiry"],
      message: "A voucher must expire; give it a date.",
    })
  if (value.type === "percent_off" && !((value.discountPct ?? 0) > 0))
    ctx.addIssue({
      code: "custom",
      path: ["discountPct"],
      message: "A percentage voucher needs a percentage above zero.",
    })
  if (value.type === "percent_off" && (value.discountPct ?? 0) > 100)
    ctx.addIssue({
      code: "custom",
      path: ["discountPct"],
      message: "A percentage cannot exceed 100.",
    })
  if (value.type === "fixed_amount" && !((value.valueIdr ?? 0) > 0))
    ctx.addIssue({
      code: "custom",
      path: ["valueIdr"],
      message: "An amount voucher needs a value above zero.",
    })
  if (value.type === "points_exchange" && !((value.pointsValue ?? 0) > 0))
    ctx.addIssue({
      code: "custom",
      path: ["pointsValue"],
      message: "A points voucher needs a points value above zero.",
    })
})

const voucherExtendInput = voucherShape.superRefine((value, ctx) => {
  if (!value.expiry)
    ctx.addIssue({
      code: "custom",
      path: ["expiry"],
      message: "Give the voucher a new expiry date.",
    })
})

type VoucherDraftShape = z.infer<typeof voucherShape>

export function VoucherSheet({
  target,
  resource,
  onClose,
}: {
  target: VoucherSheetTarget | null
  resource: CommercialResourceState
  onClose: () => void
}) {
  const editId = target?.mode === "edit" ? target.id : null
  const live = useMemo(
    () =>
      editId
        ? (resource.data?.vouchers ?? []).find(
            (voucher) => voucher.id === editId
          )
        : undefined,
    [editId, resource.data]
  )
  const ready = target?.mode === "create" || Boolean(live)

  return (
    <SheetShell
      open={Boolean(target)}
      eyebrow="Value the customer already holds"
      title={target?.mode === "edit" ? (live?.code ?? "Voucher") : "New voucher"}
      onRequestClose={onClose}
      footer={null}
    >
      {!ready ? (
        <Loading label="the voucher" />
      ) : (
        <VoucherForm
          key={editId ?? "create"}
          target={target!}
          live={live}
          onClose={onClose}
        />
      )}
    </SheetShell>
  )
}

function VoucherForm({
  target,
  live,
  onClose,
}: {
  target: VoucherSheetTarget
  live: CommercialVoucher | undefined
  onClose: () => void
}) {
  const { busy, error, run } = useSheetForm(onClose)
  const issued = target.mode === "edit"

  const defaultValues: VoucherDraftShape = {
    code: live?.code ?? "",
    type: (live?.kind ?? "percent_off") as VoucherTypeWire,
    discountPct: live?.discountPct || undefined,
    valueIdr: live?.valueIdr || undefined,
    minSpend: live?.minSpend || undefined,
    pointsValue: live?.pointsValue || undefined,
    redeemableViaLoyalty: live?.redeemableViaLoyalty ?? false,
    expiry: live?.expiresOn ?? "",
  }

  const form = useAppForm({
    defaultValues,
    validators: { onChange: issued ? voucherExtendInput : voucherIssueInput },
    onSubmit: async ({ value }) => {
      if (target.mode === "create") {
        await run(() =>
          createVoucher({
            code: value.code.trim().toUpperCase(),
            type: value.type,
            discountPct: value.type === "percent_off" ? (value.discountPct ?? 0) : null,
            valueIdr: value.type === "fixed_amount" ? (value.valueIdr ?? 0) : null,
            minSpend: value.minSpend && value.minSpend > 0 ? value.minSpend : null,
            expiryDate: value.expiry,
            redeemableViaLoyalty: value.redeemableViaLoyalty,
            pointsValue:
              value.type === "points_exchange" ? (value.pointsValue ?? 0) : null,
          })
        )
        return
      }
      await run(() => extendVoucher(target.id, value.expiry))
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="px-[18px] pt-4">
        <form.FormError message={error} />
        <p className="rounded-panel bg-inset px-3 py-2 text-[11px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          {issued
            ? "An issued voucher is money in someone's hand, so the hub will not let it be re-priced. The expiry can be pushed out, and the whole instrument can be voided — nothing else."
            : "A voucher carries its own value and names no rule. Once issued it is the customer's, so choose the value carefully."}
        </p>
      </div>

      <Section title="The voucher">
        <Row>
          <form.AppField name="code">
            {(field) => (
              <field.TextField
                label="Serial code"
                required
                disabled={issued}
                placeholder="VOUCHER-DISC10-1"
              />
            )}
          </form.AppField>
          <form.AppField name="expiry">
            {(field) => <field.DateField label="Expires" required />}
          </form.AppField>
        </Row>
        <form.AppField name="type">
          {(field) => (
            <field.SelectField
              label="What it is worth"
              required
              disabled={issued}
              options={VOUCHER_TYPE}
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.type}>
          {(type) => (
            <>
              {type === "percent_off" && (
                <form.AppField name="discountPct">
                  {(field) => (
                    <field.NumberField
                      label="Percentage off"
                      required
                      disabled={issued}
                      min={0}
                      max={100}
                    />
                  )}
                </form.AppField>
              )}
              {type === "fixed_amount" && (
                <form.AppField name="valueIdr">
                  {(field) => (
                    <field.MoneyField label="Value (Rp)" required disabled={issued} />
                  )}
                </form.AppField>
              )}
              {type === "points_exchange" && (
                <form.AppField name="pointsValue">
                  {(field) => (
                    <field.NumberField
                      label="Points awarded"
                      required
                      disabled={issued}
                      hint="Redeeming the voucher credits this many points to the holder."
                    />
                  )}
                </form.AppField>
              )}
            </>
          )}
        </form.Subscribe>
        <form.AppField name="minSpend">
          {(field) => (
            <field.MoneyField
              label="Minimum spend (Rp)"
              disabled={issued}
              hint="Zero means the voucher applies to any cart."
            />
          )}
        </form.AppField>
        <form.AppField name="redeemableViaLoyalty">
          {(field) => (
            <field.SwitchField
              label="Redeemable with loyalty points"
              hint="Members can claim this voucher by spending points."
              disabled={issued}
            />
          )}
        </form.AppField>
      </Section>

      <div className="flex items-center gap-2 px-[18px] py-3">
        {issued && live?.status !== "void" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => cancelVoucher(target.id))}
            className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-45"
          >
            Void voucher
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-control px-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <form.SubmitButton label={issued ? "Extend expiry" : "Issue voucher"} />
      </div>
    </form>
  )
}
