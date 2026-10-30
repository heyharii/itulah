import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Ban,
  Coins,
  Layers,
  Pause,
  Plus,
  Search,
  Shirt,
  Tag as TagIcon,
  X,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input, Money } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { Choices, Section, Switch, type Tile } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { searchArticles } from "@/lib/queries/articles"
import {
  deletePointPolicy,
  pointPolicyQuery,
  savePointPolicy,
  savePointPolicySettings,
  type PointPolicyRow,
  type PointPolicySettingsRow,
  type PointScopeKind,
  type SavePointPolicyRequest,
} from "@/lib/queries/point-policy"
import { storesListQuery } from "@/lib/queries/stores"
import { termsQuery } from "@/lib/queries/vocabulary"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"

/// How many member points a purchase earns — Marketing's to write, the till's
/// to pay.
///
/// The return policy's shape: "Every article" is the everyday rate, and an
/// exception names a division, tags or articles, optionally for some stores
/// and dates. The most specific one decides; among equals the best rate wins,
/// and "No points" wins at its level (cloud's `rate_for`).
///
/// Points from this policy ADD to points from a promotion — never the larger
/// of the two (owner, 30 Oct 2026). "Check an article" shows the policy's
/// share for a sample basket.

// ── what a kind is ──────────────────────────────────────────────────────────

const KIND: Readonly<
  Record<PointScopeKind, { word: string; icon: LucideIcon; rank: number }>
> = {
  ARTICLE: { word: "Article", icon: Shirt, rank: 3 },
  TAG: { word: "Tag", icon: TagIcon, rank: 2 },
  DIVISION: { word: "Division", icon: Layers, rank: 1 },
}

const PICKABLE: readonly PointScopeKind[] = ["DIVISION", "TAG", "ARTICLE"]
const RATE_CHIPS: readonly number[] = [1_000, 5_000, 10_000, 50_000]
const SAMPLE = 100_000

const rp = (amount: number) => `Rp ${amount.toLocaleString("id-ID")}`

const todayIso = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

const dateWord = (iso: string) => day(iso)

function datesWord(policy: PointPolicyRow): string {
  if (policy.starts_on && policy.ends_on)
    return `${dateWord(policy.starts_on)} – ${dateWord(policy.ends_on)}`
  if (policy.starts_on) return `From ${dateWord(policy.starts_on)}`
  if (policy.ends_on) return `Until ${dateWord(policy.ends_on)}`
  return "Always"
}

const inDates = (policy: PointPolicyRow, today: string) =>
  (policy.starts_on === null || today >= policy.starts_on) &&
  (policy.ends_on === null || today <= policy.ends_on)

/// What the domain answers for one article today: the most specific active
/// rules in their dates decide; among them No points wins, else the best rate.
function resolve(
  policies: readonly PointPolicyRow[],
  article: {
    readonly article_code: string
    readonly division_code: string | null
    readonly tags: readonly string[]
  },
  today: string
): {
  win: PointPolicyRow | null
  hits: readonly PointPolicyRow[]
  none: boolean
} {
  const hits = policies.filter(
    (policy) =>
      policy.active &&
      inDates(policy, today) &&
      ((policy.scope_kind === "ARTICLE" &&
        policy.targets.includes(article.article_code)) ||
        (policy.scope_kind === "TAG" &&
          policy.targets.some((target) => article.tags.includes(target))) ||
        (policy.scope_kind === "DIVISION" &&
          article.division_code !== null &&
          policy.targets.includes(article.division_code)))
  )
  const top = Math.max(-1, ...hits.map((one) => KIND[one.scope_kind].rank))
  const no = hits.find((one) => KIND[one.scope_kind].rank === top && !one.earns)
  if (no)
    return {
      win: no,
      hits: [no, ...hits.filter((one) => one !== no)],
      none: true,
    }
  const open = hits
    .filter((one) => one.earns)
    .sort(
      (a, b) =>
        KIND[b.scope_kind].rank - KIND[a.scope_kind].rank ||
        a.spend_per_point - b.spend_per_point
    )
  return { win: open[0] ?? null, hits: open, none: false }
}

// ── the screen ──────────────────────────────────────────────────────────────

type Filter = "all" | "ARTICLE" | "TAG" | "DIVISION" | "none" | "paused"

export function PointPolicyScreen() {
  const catalogue = useQuery(pointPolicyQuery)
  const stores = useQuery(storesListQuery())
  const [editing, setEditing] = useState<PointPolicyRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [base, setBase] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [found, setFound] = useState<string | null>(null)

  const policies = useMemo(
    () => catalogue.data?.policies ?? [],
    [catalogue.data]
  )
  const storeName = useMemo(() => {
    const names = new Map<string, string>()
    for (const store of stores.data?.items ?? [])
      if (store.site_id) names.set(store.site_id, store.name)
    return (siteId: string) => names.get(siteId) ?? siteId
  }, [stores.data])
  const count = (pick: (one: PointPolicyRow) => boolean) =>
    policies.filter(pick).length
  const shown = policies.filter(
    (one) =>
      filter === "all" ||
      (filter === "paused"
        ? !one.active
        : filter === "none"
          ? !one.earns
          : one.scope_kind === filter)
  )

  return (
    <>
      {/* Inside the content, as Vouchers and Promotions are: the head then
          lines up with the cards under it (Hari, 30 Oct 2026). */}
      <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Point policy"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New point policy
          </Button>
        }
      />
        {catalogue.isPending ? (
          <LoadingState>Reading the point policy…</LoadingState>
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
                  value: "none",
                  label: "No points",
                  icon: Ban,
                  count: count((one) => !one.earns),
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
                <table className="w-full min-w-[52rem] border-collapse text-[0.9375rem]">
                  <thead>
                    <tr className="text-left text-mute">
                      <th className="w-[24%] px-4 py-3 font-medium">
                        Point policy
                      </th>
                      <th className="px-4 py-3 font-medium">Applies to</th>
                      <th className="px-4 py-3 font-medium">Stores</th>
                      <th className="px-4 py-3 font-medium">Dates</th>
                      <th className="w-36 px-4 py-3 text-right font-medium">
                        1 point per
                      </th>
                      <th className="w-28 px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((policy) => (
                      <RuleRow
                        key={policy.policy_id}
                        policy={policy}
                        storeName={storeName}
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
  settings: PointPolicySettingsRow
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
      <div className="grid gap-4 px-4 pt-1 pb-4 sm:grid-cols-3">
        <Fact label="1 point per">
          <b className="text-2xl text-ink">{rp(settings.spend_per_point)}</b>
        </Fact>
        <Fact label="Status">{settings.enabled ? "On" : "Off"}</Fact>
        <Fact label="With a points promotion">Points add up</Fact>
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
  settings: PointPolicySettingsRow
  policies: readonly PointPolicyRow[]
  onWin: (policyId: string | null) => void
}) {
  const [text, setText] = useState("")
  const needle = useDebounced(text.trim(), 250)
  const hits = useQuery({
    queryKey: ["point-policy", "check", needle],
    queryFn: ({ signal }) => searchArticles({ q: needle, limit: 5 }, signal),
    enabled: needle !== "",
  })
  const article =
    hits.data?.items.find(
      (one) => one.article_code.toLowerCase() === needle.toLowerCase()
    ) ??
    hits.data?.items[0] ??
    null
  const answer =
    article === null ? null : resolve(policies, article, todayIso())
  const winId = answer?.win?.policy_id ?? null

  useEffect(() => {
    onWin(winId)
  }, [winId, onWin])

  const rate = answer?.none
    ? null
    : (answer?.win?.spend_per_point ??
      (settings.enabled ? settings.spend_per_point : null))
  const beaten = (answer?.hits ?? [])
    .slice(1)
    .map(
      (one) =>
        `“${one.name}” ${one.earns ? rp(one.spend_per_point) : "no points"}`
    )
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
            className="grid items-start gap-4 md:grid-cols-[1fr_auto]"
          >
            <div className="min-w-0">
              <p className="text-[0.9375rem] text-ink">
                <b>{article.name}</b>{" "}
                <span className="text-mute">
                  {article.article_code}
                  {article.division_code ? ` · ${article.division_code}` : ""}
                  {article.tags.length > 0
                    ? ` · ${article.tags.join(", ")}`
                    : ""}
                </span>
              </p>
              <p className="text-[0.9375rem] text-mute">
                From{" "}
                {answer.win
                  ? `${KIND[answer.win.scope_kind].word.toLowerCase()} rule “${answer.win.name}”`
                  : "Every article"}
                {beaten && ` · beats ${beaten}`}
                {answer.win &&
                  answer.win.site_ids.length > 0 &&
                  ` · ${answer.win.site_ids.length} ${answer.win.site_ids.length === 1 ? "store" : "stores"}`}
              </p>
            </div>
            <p className="text-xl font-semibold text-ink md:text-right">
              {rate === null ? (
                "No points"
              ) : (
                <>
                  {Math.floor(SAMPLE / rate).toLocaleString("id-ID")} points
                  <span className="block text-[0.9375rem] font-normal text-mute">
                    on {rp(SAMPLE)} · plus promotions
                  </span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── the table ───────────────────────────────────────────────────────────────

function RuleRow({
  policy,
  storeName,
  winning,
  onOpen,
}: {
  policy: PointPolicyRow
  storeName: (siteId: string) => string
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
      <td className="px-4 py-3">
        {policy.site_ids.length === 0
          ? "All stores"
          : policy.site_ids.map(storeName).join(", ")}
      </td>
      <td className="px-4 py-3">{datesWord(policy)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {policy.earns ? rp(policy.spend_per_point) : "No points"}
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

/// Rupiah per point, with the usual rates beside it.
function RateField({
  value,
  onChange,
}: {
  value: number
  onChange: (rate: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-44">
        <Money
          label="1 point per"
          prefix="Rp"
          value={value > 0 ? String(value) : ""}
          onChange={(digits) => onChange(Number(digits) || 0)}
        />
      </div>
      <FilterChips
        label="1 point per"
        value={RATE_CHIPS.includes(value) ? String(value) : null}
        onChange={(next) => next !== null && onChange(Number(next))}
        options={RATE_CHIPS.map((one) => ({
          value: String(one),
          label: rp(one),
        }))}
      />
    </div>
  )
}

function ActiveRow({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className="flex h-12 items-center justify-between gap-3 rounded-[10px] border border-hairline-2 px-4">
      <span className="text-[0.9375rem] font-medium text-ink">Active</span>
      <Switch label="Active" on={on} onToggle={onToggle} />
    </div>
  )
}

// ── Every article · sheet ───────────────────────────────────────────────────

function BaseSheet({
  settings,
  onClose,
}: {
  settings: PointPolicySettingsRow
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState({
    enabled: settings.enabled,
    spend_per_point: settings.spend_per_point,
  })
  const save = useMutation({
    mutationFn: () => savePointPolicySettings(form),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["point-policy"] })
      toast.success("Point policy saved")
      onClose()
    },
    onError: (error: Error) =>
      toast.error("Point policy not saved", { description: error.message }),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title="Every article"
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
            disabled: form.spend_per_point < 1,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
        <Section title="1 point per">
          <RateField
            value={form.spend_per_point}
            onChange={(rate) =>
              setForm((current) => ({ ...current, spend_per_point: rate }))
            }
          />
        </Section>
        <Section title="Status">
          <ActiveRow
            on={form.enabled}
            onToggle={() =>
              setForm((current) => ({ ...current, enabled: !current.enabled }))
            }
          />
        </Section>
      </div>
    </Sheet>
  )
}

// ── an exception · sheet ────────────────────────────────────────────────────

const KIND_TILES: readonly Tile<PointScopeKind>[] = PICKABLE.map((kind) => ({
  value: kind,
  label: KIND[kind].word,
  icon: KIND[kind].icon,
}))
const EARNS: readonly Tile<"rate" | "none">[] = [
  { value: "rate", label: "Earns points", icon: Coins },
  { value: "none", label: "No points", icon: Ban },
]

function RuleSheet({
  policy,
  onClose,
}: {
  policy: PointPolicyRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<SavePointPolicyRequest>(() =>
    policy === null
      ? {
          policy_id: null,
          name: "",
          scope_kind: "TAG",
          spend_per_point: 10_000,
          earns: true,
          site_ids: [],
          starts_on: null,
          ends_on: null,
          active: true,
          note: null,
          targets: [],
        }
      : {
          policy_id: policy.policy_id,
          name: policy.name,
          scope_kind: policy.scope_kind,
          spend_per_point: policy.spend_per_point,
          earns: policy.earns,
          site_ids: [...policy.site_ids],
          starts_on: policy.starts_on,
          ends_on: policy.ends_on,
          active: policy.active,
          note: policy.note,
          targets: [...policy.targets],
        }
  )
  const [needle, setNeedle] = useState("")
  const [tried, setTried] = useState(false)
  const [names, setNames] = useState<Readonly<Record<string, string>>>({})

  const kind = form.scope_kind
  const divisions = useQuery({
    ...termsQuery("divisions"),
    enabled: kind === "DIVISION",
  })
  const tags = useQuery({ ...termsQuery("tags"), enabled: kind === "TAG" })
  const stores = useQuery(storesListQuery())
  const typed = useDebounced(needle.trim(), 250)
  const articles = useQuery({
    queryKey: ["point-policy", "pick-article", typed],
    queryFn: ({ signal }) => searchArticles({ q: typed, limit: 12 }, signal),
    enabled: kind === "ARTICLE" && typed !== "",
  })

  const pool: readonly { code: string; word: string; sub?: string }[] =
    kind === "ARTICLE"
      ? (articles.data?.items ?? []).map((one) => ({
          code: one.article_code,
          word: one.name,
          sub: one.article_code,
        }))
      : ((kind === "TAG" ? tags.data : divisions.data)?.terms
          .filter((term) => term.active)
          .map((term) => ({ code: term.code, word: term.label })) ?? [])
  const term = (code: string) =>
    (kind === "TAG" ? tags.data : divisions.data)?.terms.find(
      (one) => one.code === code
    )?.label
  const seen = (code: string) =>
    articles.data?.items.find((one) => one.article_code === code)?.name
  const label = (code: string) =>
    kind === "ARTICLE"
      ? (names[code] ?? seen(code) ?? code)
      : (term(code) ?? code)
  const q = needle.trim().toLowerCase()
  const left = pool.filter(
    (one) =>
      !form.targets.includes(one.code) &&
      (kind === "ARTICLE" ||
        q === "" ||
        `${one.word} ${one.code}`.toLowerCase().includes(q))
  )
  const noun =
    kind === "ARTICLE" ? "articles" : kind === "TAG" ? "tags" : "divisions"
  const shops = (stores.data?.items ?? []).filter(
    (store) => store.site_id !== null && store.status !== "CLOSED"
  )

  const set = <K extends keyof SavePointPolicyRequest>(
    key: K,
    value: SavePointPolicyRequest[K]
  ) => setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => savePointPolicy({ ...form, name: form.name.trim() }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["point-policy"] })
      toast.success("Point policy saved")
      onClose()
    },
    onError: (error: Error) =>
      toast.error("Point policy not saved", { description: error.message }),
  })
  const remove = useMutation({
    mutationFn: () => deletePointPolicy(policy?.policy_id ?? ""),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["point-policy"] })
      toast.success("Point policy removed")
      onClose()
    },
    onError: (error: Error) =>
      toast.error("Point policy not removed", { description: error.message }),
  })

  const datesOk =
    form.starts_on === null ||
    form.ends_on === null ||
    form.ends_on >= form.starts_on
  const ready =
    form.name.trim() !== "" &&
    form.targets.length > 0 &&
    form.spend_per_point >= 1 &&
    datesOk
  const add = (code: string, word: string) => {
    setNames((current) => ({ ...current, [code]: word }))
    set("targets", [...form.targets, code])
  }
  const flipStore = (siteId: string) =>
    set(
      "site_ids",
      form.site_ids.includes(siteId)
        ? form.site_ids.filter((one) => one !== siteId)
        : [...form.site_ids, siteId]
    )

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={policy === null ? "New point policy" : form.name || "Point policy"}
      caption={
        policy?.updated_by ? `Changed by ${policy.updated_by}` : undefined
      }
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
            label: policy === null ? "Add point policy" : "Save",
            pending: save.isPending,
            onClick: () => {
              setTried(true)
              if (ready) save.mutate()
            },
          }}
        />
      }
    >
      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
        <Section title="Name">
          <Input
            aria-label="Name"
            className="h-12"
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </Section>
        <Section title="Points">
          <Choices
            label="Points"
            options={EARNS}
            value={form.earns ? "rate" : "none"}
            onChange={(next) => set("earns", next === "rate")}
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
              setForm((current) => ({
                ...current,
                scope_kind: next,
                targets: [],
              }))
              setNeedle("")
            }}
          />
        </Section>
        <div className="min-w-0">
          {form.earns && (
            <Section title="1 point per">
              <RateField
                value={form.spend_per_point}
                onChange={(rate) => set("spend_per_point", rate)}
              />
            </Section>
          )}
        </div>
        <Section
          title={`${KIND[kind].word}s`}
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
        <Section
          title="Stores"
          aside={form.site_ids.length > 0 ? form.site_ids.length : undefined}
        >
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={form.site_ids.length === 0}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[0.9375rem] font-medium",
                form.site_ids.length === 0
                  ? "border-accent bg-accent-bg text-accent"
                  : "border-hairline-2 bg-canvas text-ink hover:bg-soft-2"
              )}
              onClick={() => set("site_ids", [])}
            >
              All stores
            </button>
            {shops.map((store) => {
              const on = form.site_ids.includes(store.site_id ?? "")
              return (
                <button
                  key={store.unit_id}
                  type="button"
                  aria-pressed={on}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[0.9375rem] font-medium whitespace-nowrap",
                    on
                      ? "border-accent bg-accent-bg text-accent"
                      : "border-hairline-2 bg-canvas text-ink hover:bg-soft-2"
                  )}
                  onClick={() => flipStore(store.site_id ?? "")}
                >
                  {store.name}
                </button>
              )
            })}
          </div>
        </Section>
        <Section title="Dates">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="From">
              <Input
                type="date"
                className="h-12"
                value={form.starts_on ?? ""}
                onChange={(event) =>
                  set("starts_on", event.target.value || null)
                }
              />
            </Field>
            <Field label="Until">
              <Input
                type="date"
                className="h-12"
                value={form.ends_on ?? ""}
                min={form.starts_on ?? undefined}
                onChange={(event) => set("ends_on", event.target.value || null)}
              />
            </Field>
          </div>
          {!datesOk && (
            <p className="text-[0.9375rem] text-bad-fg">Until is before From</p>
          )}
        </Section>
        <Section title="Status">
          <ActiveRow
            on={form.active}
            onToggle={() => set("active", !form.active)}
          />
        </Section>
      </div>
    </Sheet>
  )
}
