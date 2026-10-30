import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  Layers,
  Pause,
  Plus,
  Receipt,
  Search,
  Shirt,
  ShoppingCart,
  Tag as TagIcon,
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { Choices, Section, Stepper, Switch, type Tile } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { searchArticles } from "@/lib/queries/articles"
import {
  deleteReturnPolicy,
  returnPolicyQuery,
  saveReturnPolicy,
  saveReturnPolicySettings,
  type ReturnPolicyRow,
  type ReturnPolicySettings,
  type ReturnScopeKind,
  type SaveReturnPolicy,
} from "@/lib/queries/return-policy"
import { termsQuery } from "@/lib/queries/vocabulary"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"

/// The return promise — Marketing's to write, the till's to keep.
///
/// "Every article" is the fallback every article has. An exception is a policy
/// for a division, a tag or an article; the most specific one decides, and a
/// Never at that level wins over any window (cloud's `resolve_exchangeable`).
/// "Check an article" shows that decision for one article, so a merchandiser
/// choosing tags sees the promise they are making instead of reading a rule.
///
/// The same-item card is the owner's rule of 28 Oct 2026: an article may be
/// exchanged for itself even when today's price is lower, provided its HPP and
/// supplier are unchanged. The price is deliberately absent from that test.
///
/// The screen is English; only the printed-receipt preview is Indonesian, as
/// the paper is.

// ── what a kind is ──────────────────────────────────────────────────────────

const KIND: Readonly<
  Record<ReturnScopeKind, { word: string; icon: LucideIcon; rank: number }>
> = {
  ARTICLE: { word: "Article", icon: Shirt, rank: 3 },
  TAG: { word: "Tag", icon: TagIcon, rank: 2 },
  DIVISION: { word: "Division", icon: Layers, rank: 1 },
  // Old rows only; the sheet no longer offers it — Every article is the
  // setting.
  GLOBAL: { word: "Every article", icon: Layers, rank: 0 },
}

const PICKABLE: readonly ReturnScopeKind[] = ["DIVISION", "TAG", "ARTICLE"]
const DAY_CHIPS: readonly number[] = [3, 7, 14, 30]
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
]

const plus = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

const untilWord = (days: number) =>
  plus(days).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

/// The sentence as the paper will read it, in Indonesian, with a sample date.
function receiptLines(
  days: number,
  needs: { hangTag: boolean; receipt: boolean }
): string {
  const date = plus(days)
  const out = [
    `Penukaran barang paling lambat ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}.`,
  ]
  if (needs.hangTag) out.push("Hang tag harus utuh dan masih terpasang.")
  if (needs.receipt) out.push("Struk tidak boleh hilang.")
  return out.join(" ")
}

/// The paper names the rule that refuses the exchange.
const neverLine = (name: string) => `* ${name} tidak bisa ditukar`

function Paper({ children }: { children: string }) {
  return (
    <div className="rounded-inner border border-hairline bg-soft px-4 py-3 font-mono text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-ink">
      {children}
    </div>
  )
}

/// What the domain answers for one article: the most specific active rules
/// decide; among them a Never wins, else the longer window. Paused rules never
/// match.
function resolve(
  policies: readonly ReturnPolicyRow[],
  article: {
    readonly article_code: string
    readonly division_code: string | null
    readonly tags: readonly string[]
  }
): { win: ReturnPolicyRow | null; hits: readonly ReturnPolicyRow[]; never: boolean } {
  const hits = policies.filter(
    (policy) =>
      policy.active &&
      (policy.scope_kind === "GLOBAL" ||
        (policy.scope_kind === "ARTICLE" &&
          policy.targets.includes(article.article_code)) ||
        (policy.scope_kind === "TAG" &&
          policy.targets.some((target) => article.tags.includes(target))) ||
        (policy.scope_kind === "DIVISION" &&
          article.division_code !== null &&
          policy.targets.includes(article.division_code)))
  )
  const top = Math.max(-1, ...hits.map((one) => KIND[one.scope_kind].rank))
  const no = hits.find(
    (one) => KIND[one.scope_kind].rank === top && !one.exchangeable
  )
  if (no)
    return { win: no, hits: [no, ...hits.filter((one) => one !== no)], never: true }
  const open = hits
    .filter((one) => one.exchangeable)
    .sort(
      (a, b) =>
        KIND[b.scope_kind].rank - KIND[a.scope_kind].rank ||
        b.max_days - a.max_days
    )
  return { win: open[0] ?? null, hits: open, never: false }
}

// ── the screen ──────────────────────────────────────────────────────────────

type Filter = "all" | "ARTICLE" | "TAG" | "DIVISION" | "never" | "paused"

export function ReturnPolicyScreen() {
  const catalogue = useQuery(returnPolicyQuery)
  const [editing, setEditing] = useState<ReturnPolicyRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [base, setBase] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [found, setFound] = useState<string | null>(null)

  const policies = useMemo(
    () => catalogue.data?.policies ?? [],
    [catalogue.data]
  )
  const count = (pick: (one: ReturnPolicyRow) => boolean) =>
    policies.filter(pick).length
  const shown = policies.filter(
    (one) =>
      filter === "all" ||
      (filter === "paused"
        ? !one.active
        : filter === "never"
          ? !one.exchangeable
          : one.scope_kind === filter)
  )

  return (
    <>
      {/* Inside the content, as Vouchers and Promotions are: the head then
          lines up with the cards under it (Hari, 30 Oct 2026). */}
      <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Return policy"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New return policy
          </Button>
        }
      />
        {catalogue.isPending ? (
          <LoadingState>Reading the return policy…</LoadingState>
        ) : catalogue.isError ? (
          <ErrorState
            error={catalogue.error}
            onRetry={() => void catalogue.refetch()}
          />
        ) : (
          <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-4">
            <BaseCard
              settings={catalogue.data.settings}
              onEdit={() => setBase(true)}
            />
            <CheckCard
              settings={catalogue.data.settings}
              policies={policies}
              onWin={setFound}
            />
            <FilterChips
              label="Kind"
              value={filter === "all" ? null : filter}
              onChange={(next) => setFilter((next as Filter | null) ?? "all")}
              options={[
                { value: null, label: "All", count: policies.length },
                {
                  value: "ARTICLE",
                  label: "Article",
                  icon: Shirt,
                  count: count((one) => one.scope_kind === "ARTICLE"),
                },
                {
                  value: "TAG",
                  label: "Tag",
                  icon: TagIcon,
                  count: count((one) => one.scope_kind === "TAG"),
                },
                {
                  value: "DIVISION",
                  label: "Division",
                  icon: Layers,
                  count: count((one) => one.scope_kind === "DIVISION"),
                },
                {
                  value: "never",
                  label: "Never",
                  icon: X,
                  count: count((one) => !one.exchangeable),
                },
                {
                  value: "paused",
                  label: "Paused",
                  icon: Pause,
                  count: count((one) => !one.active),
                },
              ]}
            />
            <Card className="overflow-x-auto">
              {shown.length === 0 ? (
                <p className="px-4 py-5 text-[0.9375rem] text-mute">
                  Nothing here.
                </p>
              ) : (
                <table className="w-full min-w-[40rem] border-collapse text-[0.9375rem]">
                  <thead>
                    <tr className="text-left text-mute">
                      <th className="w-[30%] px-4 py-3 font-medium">
                        Return policy
                      </th>
                      <th className="px-4 py-3 font-medium">Applies to</th>
                      <th className="w-32 px-4 py-3 text-right font-medium">
                        Return within
                      </th>
                      <th className="w-32 px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((policy) => (
                      <RuleRow
                        key={policy.policy_id}
                        policy={policy}
                        winning={found === policy.policy_id}
                        onOpen={() => setEditing(policy)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        )}
      </PageContent>
      {catalogue.data && base && (
        <BaseSheet
          settings={catalogue.data.settings}
          onClose={() => setBase(false)}
        />
      )}
      {catalogue.data && (adding || editing !== null) && (
        <RuleSheet
          policy={editing}
          settings={catalogue.data.settings}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

// ── every article ───────────────────────────────────────────────────────────

function BaseCard({
  settings,
  onEdit,
}: {
  settings: ReturnPolicySettings
  onEdit: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Every article</CardTitle>
        <Button variant="primary" onClick={onEdit}>
          Edit
        </Button>
      </CardHeader>
      <div className="grid gap-4 px-4 pt-1 pb-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Return within">
          <b className="text-2xl text-ink">{settings.max_days}</b> days
        </Fact>
      </div>
    </Card>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-[0.9375rem] text-mute">{label}</p>
      <p className="text-[1.0625rem] font-semibold text-ink">{children}</p>
    </div>
  )
}

// ── check an article ────────────────────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [later, setLater] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setLater(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return later
}

function CheckCard({
  settings,
  policies,
  onWin,
}: {
  settings: ReturnPolicySettings
  policies: readonly ReturnPolicyRow[]
  onWin: (policyId: string | null) => void
}) {
  const [text, setText] = useState("")
  const needle = useDebounced(text.trim(), 250)
  const hits = useQuery({
    queryKey: ["return-policy", "check", needle],
    queryFn: ({ signal }) => searchArticles({ q: needle, limit: 5 }, signal),
    enabled: needle !== "",
  })
  const article =
    hits.data?.items.find(
      (one) => one.article_code.toLowerCase() === needle.toLowerCase()
    ) ??
    hits.data?.items[0] ??
    null
  const answer = article === null ? null : resolve(policies, article)
  const winId = answer?.win?.policy_id ?? null

  // The table lights the row that decides, so the answer and its rule are
  // read together.
  useEffect(() => {
    onWin(winId)
  }, [winId, onWin])

  const days = answer?.win?.max_days ?? settings.max_days
  const beaten = (answer?.hits ?? [])
    .slice(1)
    .map((one) => `“${one.name}” ${one.exchangeable ? `${one.max_days} d` : "never"}`)
    .join(", ")

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="relative max-w-[26rem]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
          />
          <Input
            type="search"
            aria-label="Check an article"
            placeholder="Check an article"
            className="pl-9"
            autoComplete="off"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        {needle !== "" && hits.isPending && (
          <p className="text-[0.9375rem] text-mute">Searching…</p>
        )}
        {needle !== "" && hits.data && article === null && (
          <p className="text-[0.9375rem] text-mute">No article matches.</p>
        )}
        {article !== null && answer !== null && (
          <div
            aria-live="polite"
            className="grid items-start gap-4 md:grid-cols-[1fr_auto_minmax(0,22rem)]"
          >
            <div className="min-w-0">
              <p className="text-[0.9375rem] text-ink">
                <b>{article.name}</b>{" "}
                <span className="text-mute">
                  {article.article_code}
                  {article.division_code ? ` · ${article.division_code}` : ""}
                  {article.tags.length > 0 ? ` · ${article.tags.join(", ")}` : ""}
                </span>
              </p>
              <p className="text-[0.9375rem] text-mute">
                From{" "}
                {answer.win
                  ? `${KIND[answer.win.scope_kind].word.toLowerCase()} rule “${answer.win.name}”`
                  : "Every article"}
                {beaten && ` · beats ${beaten}`}
              </p>
            </div>
            <p className="text-xl font-semibold text-ink md:text-right">
              {answer.never ? (
                "Never"
              ) : (
                <>
                  {days} days
                  <span className="block text-[0.9375rem] font-normal text-mute">
                    until {untilWord(days)}
                  </span>
                </>
              )}
            </p>
            <Paper>
              {answer.never && answer.win
                ? neverLine(answer.win.name)
                : receiptLines(days, {
                    hangTag: settings.require_hang_tag,
                    receipt: settings.require_receipt,
                  })}
            </Paper>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── the table ───────────────────────────────────────────────────────────────

function RuleRow({
  policy,
  winning,
  onOpen,
}: {
  policy: ReturnPolicyRow
  winning: boolean
  onOpen: () => void
}) {
  const Glyph = KIND[policy.scope_kind].icon
  return (
    <tr
      className={cn(
        "cursor-pointer border-t border-hairline hover:bg-soft-2",
        winning && "bg-accent-bg",
        !policy.active && "text-mute"
      )}
      onClick={onOpen}
    >
      <td className="px-4 py-3">
        <button
          type="button"
          className="text-left font-semibold text-ink"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          {policy.name}
        </button>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-2">
          <Glyph className="size-4 shrink-0 text-line-ico" />
          {policy.targets.join(", ")}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {policy.exchangeable ? `${policy.max_days} days` : "Never"}
      </td>
      <td className="px-4 py-3">
        <Status tone={policy.active ? "ok" : "neutral"}>
          {policy.active ? "On" : "Paused"}
        </Status>
      </td>
    </tr>
  )
}

// ── shared sheet pieces ─────────────────────────────────────────────────────

/// Days as a stepper with the usual windows beside it. The chips are a
/// shortcut to the stepper, not a second answer.
function DaysField({
  value,
  onChange,
}: {
  value: number
  onChange: (days: number) => void
}) {
  // The quick days sit beside the stepper, in the room on its right (Hari,
  // 29 Oct 2026), and wrap under it only when there is none.
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Stepper
        label="Days"
        min={1}
        max={365}
        suffix="days"
        value={String(value)}
        onChange={(next) =>
          onChange(Math.min(365, Math.max(1, Number(next) || 1)))
        }
      />
      <FilterChips
        label="Days"
        value={DAY_CHIPS.includes(value) ? String(value) : null}
        onChange={(next) => next !== null && onChange(Number(next))}
        options={DAY_CHIPS.map((one) => ({
          value: String(one),
          label: `${one} days`,
        }))}
      />
    </div>
  )
}

/// A tile that flips on its own, unlike `Choices` where one of several is on.
function Flip({
  icon: Glyph,
  label,
  on,
  disabled,
  onFlip,
}: {
  icon: LucideIcon
  label: string
  on: boolean
  disabled?: boolean
  onFlip: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onFlip}
      className={cn(
        "choice-tile flex min-w-0 items-center gap-2.5 rounded-inner border px-3 py-2.5 text-left transition-colors disabled:cursor-default disabled:opacity-50",
        on ? "border-accent bg-accent-bg" : "border-hairline-2 bg-canvas"
      )}
    >
      <span
        className={cn(
          "grid size-[1.875rem] shrink-0 place-items-center rounded-inner",
          on ? "bg-canvas text-accent" : "bg-soft-2 text-body"
        )}
      >
        <Glyph className="size-4 stroke-[1.7]" />
      </span>
      <span
        className={cn(
          "text-[0.9375rem] font-medium",
          on ? "text-accent" : "text-ink"
        )}
      >
        {label}
      </span>
    </button>
  )
}

// ── Every article · sheet ───────────────────────────────────────────────────

function BaseSheet({
  settings,
  onClose,
}: {
  settings: ReturnPolicySettings
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState({
    max_days: settings.max_days,
    // Every other rule is off (Hari, 30 Oct 2026): saving puts them back to
    // the most open answer, whatever was stored before — but a struk is
    // returned once: two pieces bought, one back today, the other never.
    require_hang_tag: false,
    require_receipt: false,
    same_item_exchange: true,
    same_item_same_cost: false,
    same_item_same_supplier: false,
    one_return_per_receipt: true,
    return_receipt_returnable: true,
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const save = useMutation({
    mutationFn: () => saveReturnPolicySettings(form),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["return-policy"] })
      toast.success("Return policy saved")
      onClose()
    },
    onError: (error: Error) =>
      toast.error("Return policy not saved", { description: error.message }),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title="Every article"
      // Wide, in paired rows, so nothing scrolls (Hari, 29 Oct 2026).
      caption={
        settings.updated_by === null
          ? undefined
          : `Changed by ${settings.updated_by}`
      }
      size="wide"
      stack
      footer={
        <SheetFooter
          error={save.error}
          primary={{
            label: "Save",
            pending: save.isPending,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      {/* Only Return within (Hari, 30 Oct 2026): the till asks for nothing
          else — no hang tag, receipt, one-return or same-item rules. */}
      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
      <Section title="Return within">
        <DaysField
          value={form.max_days}
          onChange={(days) => set("max_days", days)}
        />
      </Section>
      </div>
    </Sheet>
  )
}

// ── an exception · sheet ────────────────────────────────────────────────────

const KIND_TILES: readonly Tile<ReturnScopeKind>[] = PICKABLE.map((kind) => ({
  value: kind,
  label: KIND[kind].word,
  icon: KIND[kind].icon,
}))
const TAKEN_BACK: readonly Tile<"days" | "never">[] = [
  { value: "days", label: "Within days", icon: Undo2 },
  { value: "never", label: "Never", icon: X },
]
const STATUS: readonly Tile<"on" | "paused">[] = [
  { value: "on", label: "On", icon: Check },
  { value: "paused", label: "Paused", icon: Pause },
]

function RuleSheet({
  policy,
  settings,
  onClose,
}: {
  policy: ReturnPolicyRow | null
  settings: ReturnPolicySettings
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<SaveReturnPolicy>(() =>
    policy === null
      ? {
          name: "",
          scope_kind: "TAG",
          max_days: 7,
          exchangeable: true,
          active: true,
          note: null,
          targets: [],
        }
      : {
          policy_id: policy.policy_id,
          name: policy.name,
          // An old Every-article row is edited as a division one would be;
          // the sheet has no such tile, so the targets pick starts empty.
          scope_kind: policy.scope_kind === "GLOBAL" ? "DIVISION" : policy.scope_kind,
          max_days: policy.max_days,
          exchangeable: policy.exchangeable,
          active: policy.active,
          note: policy.note,
          targets: [...policy.targets],
        }
  )
  const [needle, setNeedle] = useState("")
  const [tried, setTried] = useState(false)
  // Names of the articles seen, so a picked article keeps its name as a chip.
  const [names, setNames] = useState<Readonly<Record<string, string>>>({})

  const kind = form.scope_kind
  const divisions = useQuery({
    ...termsQuery("divisions"),
    enabled: kind === "DIVISION",
  })
  const tags = useQuery({ ...termsQuery("tags"), enabled: kind === "TAG" })
  const typed = useDebounced(needle.trim(), 250)
  const articles = useQuery({
    queryKey: ["return-policy", "pick-article", typed],
    queryFn: ({ signal }) => searchArticles({ q: typed, limit: 12 }, signal),
    enabled: kind === "ARTICLE" && typed !== "",
  })
  useEffect(() => {
    if (!articles.data) return
    setNames((current) => ({
      ...current,
      ...Object.fromEntries(
        articles.data.items.map((one) => [one.article_code, one.name])
      ),
    }))
  }, [articles.data])

  // Everything pickable for the kind, as code and the word shown for it.
  const pool: readonly { code: string; word: string; sub?: string }[] =
    kind === "ARTICLE"
      ? (articles.data?.items ?? []).map((one) => ({
          code: one.article_code,
          word: one.name,
          sub: one.article_code,
        }))
      : (kind === "TAG" ? tags.data : divisions.data)?.terms
          .filter((term) => term.active)
          .map((term) => ({ code: term.code, word: term.label })) ?? []
  const term = (code: string) =>
    (kind === "TAG" ? tags.data : divisions.data)?.terms.find(
      (one) => one.code === code
    )?.label
  const label = (code: string) =>
    kind === "ARTICLE" ? (names[code] ?? code) : (term(code) ?? code)
  const q = needle.trim().toLowerCase()
  const left = pool.filter(
    (one) =>
      !form.targets.includes(one.code) &&
      (kind === "ARTICLE" ||
        q === "" ||
        `${one.word} ${one.code}`.toLowerCase().includes(q))
  )
  const noun = kind === "ARTICLE" ? "articles" : kind === "TAG" ? "tags" : "divisions"

  const set = <K extends keyof SaveReturnPolicy>(
    key: K,
    value: SaveReturnPolicy[K]
  ) => setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => saveReturnPolicy({ ...form, name: form.name.trim() }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["return-policy"] })
      toast.success("Return policy saved")
      onClose()
    },
    onError: (error: Error) =>
      toast.error("Return policy not saved", { description: error.message }),
  })
  const remove = useMutation({
    mutationFn: () => deleteReturnPolicy(policy?.policy_id ?? ""),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["return-policy"] })
      toast.success("Return policy removed")
      onClose()
    },
    onError: (error: Error) =>
      toast.error("Return policy not removed", { description: error.message }),
  })

  const ready = form.name.trim() !== "" && form.targets.length > 0
  const add = (code: string, word: string) => {
    setNames((current) => ({ ...current, [code]: word }))
    set("targets", [...form.targets, code])
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={policy === null ? "New return policy" : form.name || "Return policy"}
      // The widest sheet, in paired rows, so nothing scrolls (Hari, 29 Oct 2026).
      size="workspace"
      stack
      footer={
        <SheetFooter
          error={save.error ?? remove.error}
          danger={
            policy === null ? undefined : (
              <ConfirmButton
                label="Remove"
                title={`Remove “${policy.name}”?`}
                confirmLabel="Remove"
                tone="danger"
                variant="destructive"
                pending={remove.isPending}
                onConfirm={() => remove.mutateAsync()}
              />
            )
          }
          primary={{
            label: policy === null ? "Add return policy" : "Save",
            pending: save.isPending,
            onClick: () => {
              setTried(true)
              if (ready) save.mutate()
            },
          }}
        />
      }
    >
      {/* Rows, not two stacks, so each pair starts on one line (Hari, 29 Oct
          2026): Name | Taken back, Applies to | Return within, the targets |
          Status. No receipt preview. */}
      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
      <Section title="Name">
        <Input
          aria-label="Name"
          className="h-12"
          value={form.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </Section>
      <Section title="Return time">
        <Choices
          label="Return time"
          options={TAKEN_BACK}
          value={form.exchangeable ? "days" : "never"}
          onChange={(next) => set("exchangeable", next === "days")}
        />
      </Section>
      <Section title="Applies to">
        <Choices
          label="Applies to"
          options={KIND_TILES}
          value={kind}
          columns={3}
          onChange={(next) => {
            if (next === kind) return
            setForm((current) => ({ ...current, scope_kind: next, targets: [] }))
            setNeedle("")
          }}
        />
      </Section>
      <div className="min-w-0">
      {form.exchangeable && (
        <Section title="Return within">
          <DaysField
            value={form.max_days}
            onChange={(days) => set("max_days", days)}
          />
        </Section>
      )}
      </div>
      <Section
        title={KIND[kind].word + (kind === "TAG" ? "s" : "s")}
        aside={form.targets.length > 0 ? form.targets.length : undefined}
      >
        {form.targets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.targets.map((code) => (
              <button
                key={code}
                type="button"
                aria-label={`Remove ${label(code)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-accent bg-accent-bg px-3.5 text-[0.9375rem] font-medium text-accent"
                onClick={() =>
                  set(
                    "targets",
                    form.targets.filter((one) => one !== code)
                  )
                }
              >
                {label(code)}
                <X className="size-3.5" />
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
          />
          <Input
            type="search"
            aria-label={`Search ${noun}`}
            placeholder={`Search ${noun}`}
            className="h-12 pl-9"
            autoComplete="off"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
          />
        </div>
        {left.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {left.slice(0, 12).map((one) => (
              <button
                key={one.code}
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-hairline-2 bg-canvas px-3.5 text-[0.9375rem] font-medium whitespace-nowrap text-ink hover:bg-soft-2"
                onClick={() => add(one.code, one.word)}
              >
                <Plus className="size-3.5 text-line-ico" />
                {one.word}
                {one.sub && <span className="text-mute">{one.sub}</span>}
              </button>
            ))}
            {left.length > 12 && (
              <span className="self-center text-[0.9375rem] text-mute">
                +{left.length - 12}
              </span>
            )}
          </div>
        ) : (
          q !== "" &&
          !articles.isFetching && (
            <p className="text-[0.9375rem] text-mute">Nothing matches.</p>
          )
        )}
        {tried && form.targets.length === 0 && (
          <p className="text-[0.9375rem] text-bad-fg">Pick at least one</p>
        )}
      </Section>
      {/* On or paused as one switch in a bordered row (Hari, 29 Oct 2026). */}
      <Section title="Status">
        <div className="flex h-12 items-center justify-between gap-3 rounded-[10px] border border-hairline-2 px-4">
          <span className="text-[0.9375rem] font-medium text-ink">Active</span>
          <Switch label="Active" on={form.active} onToggle={() => set("active", !form.active)} />
        </div>
      </Section>
      </div>
    </Sheet>
  )
}
