import { CalendarClock, Check, Clock, Copy, Search, X } from "lucide-react"
import { useEffect, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Tag } from "@/components/ui/tag"
import { count, moment } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  away,
  describeEffect,
  describeScope,
  scopeCodes,
  slot,
  standingOf,
  urgent,
  useNow,
  type Phase,
} from "@/screens/promotions/shared"
import type { PriceDropWindow, StoreOffer } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The drawn pieces the four Promotions screens share. The words behind them
/// are in `shared.ts`.

// ── The frame ──────────────────────────────────────────────────────────────

/// Nothing to list, because nothing has arrived to list it from.
///
/// Said differently from an empty list on purpose. "No promotions" would tell
/// a cashier the sale is off; this tells them the sync is what to look at.
export function NoPriceBook() {
  return (
    <div className="mx-auto flex max-w-[30em] flex-col items-center gap-4 px-4 py-12 text-center">
      <p className="text-meta text-body">
        No price book has reached this shop yet, so it holds no promotions,
        campaigns or price drops. Head office's offers arrive with the price
        book on the sync lane — if the shop should be running something, check
        the sync.
      </p>
      <AppLink
        to="/node/sync"
        className="inline-flex h-11 items-center rounded-inner border border-hairline-2 bg-canvas px-4 text-control font-medium text-text shadow-soft"
      >
        Open Sync
      </AppLink>
    </div>
  )
}

/// The row of controls over a list: the filter at the left, the search at
/// the right. Stacked on a phone, where the two cannot share 375px.
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
      {children}
    </div>
  )
}

/// Running / Starting soon / All, with how many are in each.
///
/// The counts are in the labels because the one question a filter always
/// raises is "how many would I see", and a tab that answers it before it is
/// pressed saves the press.
export function PhaseFilter({
  value,
  onChange,
  running,
  upcoming,
  runningLabel = "Running",
}: {
  value: Phase
  onChange: (next: Phase) => void
  running: number
  upcoming: number
  runningLabel?: string
}) {
  return (
    <Segmented<Phase>
      value={value}
      onChange={onChange}
      className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
      options={[
        { value: "RUNNING", label: `${runningLabel} · ${count(running)}` },
        { value: "UPCOMING", label: `Starting soon · ${count(upcoming)}` },
        { value: "ALL", label: `All · ${count(running + upcoming)}` },
      ]}
    />
  )
}

/// The list's search box: a glass, the field, and a way to clear it.
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="relative md:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-line-ico" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        // The hub's compact field on a desk with a mouse; the touch floor, and
        // 16px type, anywhere a finger is — iOS zooms the page into any field
        // set smaller than that.
        className="h-11 pr-11 pl-10 md:pointer-fine:h-9 md:pointer-fine:text-cell [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear the search"
          className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center text-line-ico md:pointer-fine:size-9"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

// ── One offer ──────────────────────────────────────────────────────────────

/// Where an offer stands, in the pill vocabulary.
///
/// Three words, not two. A `RUNNING` offer that only runs on Saturdays is this
/// week's promotion and still will not ring up on a Tuesday — "Live" in green
/// would send a cashier to promise it, and "Starting soon" would file it as a
/// thing that has not begun.
export function OfferPill({ offer }: { offer: StoreOffer }) {
  switch (standingOf(offer)) {
    case "on":
      return <Pill tone="ok">Live now</Pill>
    case "paused-hours":
      return (
        <Pill tone="warn" title="Running this period, but not at this hour">
          Not now
        </Pill>
      )
    case "soon":
      return <Pill tone="info">Starting soon</Pill>
  }
}

/// A price-drop run's pill. Running rather than "live": the node reports no
/// "this minute" for a markdown, so a run with hours says when on the line
/// under it and the pill does not guess.
export function DropPill({ window }: { window: PriceDropWindow }) {
  return window.state === "UPCOMING" ? (
    <Pill tone="info">Starting soon</Pill>
  ) : (
    <Pill tone="ok">Running</Pill>
  )
}

/// The countdown. Two different sentences, and the difference is the whole
/// reason a shop reads this: one is a deadline a cashier can still act on
/// ("ends in 3h 12m" — offer it to the person at the counter), the other is a
/// promise not yet kept ("starts in 2 days" — do not offer it, and say when).
export function Countdown({
  state,
  startsAt,
  endsAt,
  verbs = { start: "Starts", end: "Ends" },
  className,
}: {
  state: string
  startsAt: string | null
  endsAt: string | null
  verbs?: { start: string; end: string }
  className?: string
}) {
  const upcoming = state === "UPCOMING"
  const now = useNow(upcoming ? startsAt !== null : endsAt !== null)
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 tabular-nums",
        upcoming
          ? "text-info-fg"
          : urgent(endsAt, now)
            ? "font-medium text-bad-fg"
            : "text-text",
        className,
      )}
    >
      {upcoming ? (
        <CalendarClock className="size-3.5 shrink-0" />
      ) : (
        <Clock className="size-3.5 shrink-0 text-line-ico" />
      )}
      <span className="min-w-0 truncate">
        {upcoming
          ? startsAt === null
            ? "When its campaign starts"
            : `${verbs.start} in ${away(startsAt, now)}`
          : endsAt === null
            ? "No end date"
            : `${verbs.end} in ${away(endsAt, now)}`}
      </span>
    </span>
  )
}

/// The campaign's poster, through the node's own proxy.
///
/// Never straight at the centre's URL, for the reason a garment's photograph
/// is not either: one banner is shown to everybody in the shop, so it is the
/// single most worthwhile thing in the node's image cache — and pointed at the
/// centre it would be the first thing to go blank when the line drops.
///
/// A banner that fails to load is removed rather than drawn broken: the name
/// under it still says which campaign this is.
export function CampaignBanner({
  campaign,
  alt,
  className,
}: {
  campaign: string
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={`/api/v1/catalog/campaign-image?campaign=${encodeURIComponent(campaign)}`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("aspect-[3/1] w-full bg-soft-2 object-cover", className)}
    />
  )
}

// ── The detail ─────────────────────────────────────────────────────────────

/// A labelled fact in a detail panel — the hub sheet's `Fact`, for a panel
/// that opens in place.
export function Fact({
  term,
  children,
  wide = false,
}: {
  term: React.ReactNode
  children: React.ReactNode
  /// Spans the whole panel — for terms and lists that read badly in a column.
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2 lg:col-span-3")}>
      <dt className="text-meta text-mute">{term}</dt>
      <dd className="mt-0.5 text-cell text-ink tabular-nums">{children}</dd>
    </div>
  )
}

export function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:gap-x-6 lg:grid-cols-3">
      {children}
    </dl>
  )
}

/// Everything the node knows about one offer, opened under its row.
///
/// Every default is spelled out here where the list leaves it unsaid: "every
/// day", "all day", "anyone". In a list the missing line is the ordinary case;
/// in a detail somebody is reading to answer a customer, and a blank reads as
/// "unknown".
export function OfferDetail({ offer }: { offer: StoreOffer }) {
  const codes = scopeCodes(offer.applies_to)
  return (
    <Facts>
      <Fact term="Benefit">{describeEffect(offer.effect)}</Fact>
      <Fact term="Applies to">{describeScope(offer.applies_to)}</Fact>
      <Fact term="Who">
        {offer.members_only ? "Identified members only" : "Anyone"}
      </Fact>

      <Fact term="Starts">
        {offer.starts_at === null
          ? offer.state === "UPCOMING"
            ? "When its campaign starts"
            : "Already running"
          : moment(offer.starts_at)}
      </Fact>
      <Fact term="Ends">
        {offer.ends_at === null ? "No end date" : moment(offer.ends_at)}
      </Fact>
      <Fact term="Runs">
        {slot(offer.weekdays, offer.time_window) ?? "Every day, all day"}
      </Fact>

      <Fact term="Code">
        {offer.coupon_code === null ? (
          "None — the till applies it by itself"
        ) : (
          <CopyCode code={offer.coupon_code} />
        )}
      </Fact>
      {offer.uses_remaining !== null && (
        <Fact term="Uses left">
          <span className={cn(offer.uses_remaining === 0 && "text-bad-fg")}>
            {count(offer.uses_remaining)}
          </span>
        </Fact>
      )}
      {offer.budget_remaining_minor !== null && (
        <Fact term="Budget left">
          <span
            className={cn(offer.budget_remaining_minor <= 0 && "text-bad-fg")}
          >
            {money(offer.budget_remaining_minor)}
          </span>
        </Fact>
      )}

      {offer.campaign_name !== null && (
        <Fact term="Campaign">
          <AppLink
            to="/promotions/campaigns"
            className="text-accent underline-offset-2 hover:underline"
          >
            {offer.campaign_name}
          </AppLink>
        </Fact>
      )}

      {codes.length > 1 && (
        <Fact term={`What it covers (${count(codes.length)})`} wide>
          <CodeList codes={codes} />
        </Fact>
      )}

      {(offer.uses_remaining !== null ||
        offer.budget_remaining_minor !== null) && (
        // A cap is counted at head office and reaches this shop with the
        // sync, so the figure here is as old as the last one — a brake, not
        // a gate. Said, so nobody promises the last use to a customer.
        <Fact term="About the limits" wide>
          <span className="text-body">
            Counted at head office and only as fresh as this shop's last sync.
            The till stops the offer once it is told the limit is reached.
          </span>
        </Fact>
      )}

      {offer.campaign_terms !== null && offer.campaign_terms !== "" && (
        <Fact term="Terms" wide>
          <span className="whitespace-pre-line text-body">
            {offer.campaign_terms}
          </span>
        </Fact>
      )}

      <Fact term="Rule" wide>
        <span className="font-mono text-id text-mute">{offer.rule_id}</span>
      </Fact>
    </Facts>
  )
}

/// A scope's codes as tags — the first forty, then how many more.
///
/// Capped because a rule over a whole season can name eight hundred SKUs, and
/// a panel that draws them all is a panel nobody scrolls past to the terms.
/// The count is in the heading, so nothing is hidden by the cap.
function CodeList({ codes }: { codes: readonly string[] }) {
  const LIMIT = 40
  const [all, setAll] = useState(false)
  const shown = all ? codes : codes.slice(0, LIMIT)
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {shown.map((code) => (
        <Tag key={code}>{code}</Tag>
      ))}
      {codes.length > LIMIT && !all && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setAll(true)
          }}
          className="h-6 px-1.5 text-meta font-medium text-accent pointer-coarse:h-tap"
        >
          +{count(codes.length - LIMIT)} more
        </button>
      )}
    </div>
  )
}

// ── Codes ──────────────────────────────────────────────────────────────────

/// A coupon code with a way to copy it.
///
/// Copying is the whole use: the code is read here and typed somewhere else —
/// a chat to a customer, a poster, the till's own code field — and a code
/// retyped by hand is a code with a typo in it.
export function CopyCode({
  code,
  size = "sm",
}: {
  code: string
  size?: "sm" | "lg"
}) {
  /// What the last press did. A failure is said rather than swallowed: a
  /// cashier who pressed Copy and pastes nothing has lost the code twice. The
  /// code itself is `select-all`, so the fallback is one tap on it.
  const [outcome, setOutcome] = useState<"idle" | "copied" | "failed">("idle")
  useEffect(() => {
    if (outcome === "idle") return
    const timer = setTimeout(() => setOutcome("idle"), 1800)
    return () => clearTimeout(timer)
  }, [outcome])

  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span
        className={cn(
          "truncate rounded-md bg-accent-bg font-mono font-semibold tracking-wide text-accent select-all",
          size === "lg" ? "px-2.5 py-1 text-[1rem]" : "px-1.5 py-0.5 text-id",
        )}
      >
        {code}
      </span>
      <button
        type="button"
        aria-label={`Copy ${code}`}
        onClick={(event) => {
          // Inside a row that opens on a press; copying must not also close it.
          event.stopPropagation()
          void copyText(code).then((ok) => setOutcome(ok ? "copied" : "failed"))
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-inner border border-hairline-2 bg-canvas px-2 text-meta font-medium text-text shadow-soft transition-colors hover:bg-soft",
          "h-8 pointer-coarse:h-tap pointer-coarse:px-3",
        )}
      >
        {outcome === "copied" ? (
          <Check className="size-3.5 text-ok-fg" />
        ) : (
          <Copy className="size-3.5 text-line-ico" />
        )}
        <span aria-live="polite">
          {outcome === "copied"
            ? "Copied"
            : outcome === "failed"
              ? "Select it instead"
              : "Copy"}
        </span>
      </button>
    </span>
  )
}

/// Put text on the clipboard, and say whether it got there.
///
/// The async Clipboard API only exists in a secure context, and a shop's
/// tablet often reaches its node over plain http on the LAN — so the old
/// select-and-copy is kept as the fallback rather than failing silently there.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the old way.
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
