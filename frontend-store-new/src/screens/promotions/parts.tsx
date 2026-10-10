import { CalendarClock, Check, Clock, Copy, Search, X } from "lucide-react"
import { useEffect, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { button } from "@/components/ui/button-style"
import { Input } from "@/components/ui/field"
import { LeadCard } from "@/components/ui/lead-card"
import { Pill, Status } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Tag } from "@/components/ui/tag"
import { count, moment } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  away,
  benefitOf,
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
///
/// Every list here is the template's: lead-figure cards, one column on a phone
/// and a grid on a desk. The figure a card leads with is what the offer GIVES
/// (20%, Rp 50.000 off, Buy 2 get 1) or how long is LEFT of it; the foot carries
/// the countdown or the reach, and ONE status as a dot and a word. A card opens
/// a sheet with the terms. On a phone the phase is the dock's status chip and
/// the search its field; a desk has the same two in a toolbar.

// ── The frame ──────────────────────────────────────────────────────────────

/// Nothing to list, because nothing has arrived to list it from.
///
/// Said differently from an empty list on purpose. "No promotions" would tell
/// a cashier the sale is off; this tells them the sync is what to look at.
export function NoPriceBook() {
  return (
    <div className="mx-auto flex max-w-[30em] flex-col items-center gap-4 px-4 py-12 text-center">
      <p className="text-meta text-body">
        No price book has reached this shop yet, so there is nothing to show.
        Check the sync.
      </p>
      <AppLink
        to="/node/sync"
        className={button({ variant: "ghost", size: "lg" })}
      >
        Open Sync
      </AppLink>
    </div>
  )
}

/// The desk's row of controls over a list: the filter at the left, the search
/// at the right. A phone has neither here — the phase is the dock's status chip
/// and the search its field.
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 max-md:hidden">
      {children}
    </div>
  )
}

/// The one line of figures a list opens with: "3 active · 2 scheduled".
/// A part with nothing in it is left out, so a shop running nothing is not told
/// "0 active" every time it looks.
export function Summary({
  parts,
}: {
  parts: readonly (readonly [number, string])[]
}) {
  const shown = parts.filter(([n]) => n > 0)
  if (shown.length === 0) return null
  return (
    <p className="mb-3 text-meta text-body">
      {shown.map(([n, word], index) => (
        <span key={word}>
          {index > 0 && " · "}
          <b className="font-medium text-ink tabular-nums">{count(n)}</b> {word}
        </span>
      ))}
    </p>
  )
}

/// What the phase choice offers, with how many are in each: the dock's status
/// sheet reads these, and so does the desk's switch below.
export function phaseOptions(
  active: number,
  scheduled: number,
  activeLabel = "Active",
): readonly { value: Phase; label: string; count: number }[] {
  return [
    { value: "RUNNING", label: activeLabel, count: active },
    { value: "UPCOMING", label: "Scheduled", count: scheduled },
    { value: "ALL", label: "All", count: active + scheduled },
  ]
}

/// Active / Scheduled / All, with how many are in each — the desk's switch.
///
/// The counts are in the labels because the one question a filter always
/// raises is "how many would I see", and a tab that answers it before it is
/// pressed saves the press.
export function PhaseFilter({
  value,
  onChange,
  running,
  upcoming,
}: {
  value: Phase
  onChange: (next: Phase) => void
  running: number
  upcoming: number
}) {
  return (
    <Segmented<Phase>
      value={value}
      onChange={onChange}
      className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
      options={phaseOptions(running, upcoming).map((one) => ({
        value: one.value,
        label: `${one.label} · ${count(one.count)}`,
      }))}
    />
  )
}

/// The desk's search box: a glass, the field, and a way to clear it.
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
        className="pr-11 pl-10 md:pointer-fine:h-9 md:pointer-fine:text-cell [&::-webkit-search-cancel-button]:hidden"
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

// ── Where something stands ─────────────────────────────────────────────────

/// Where an offer stands, in the pill vocabulary — the badge in a sheet's head.
///
/// Three words, not two. An `Active` offer that only runs on Saturdays is this
/// week's promotion and still will not ring up on a Tuesday — "Active" in green
/// would send a cashier to promise it, and "Scheduled" would file it as a
/// thing that has not begun.
export function OfferPill({ offer }: { offer: StoreOffer }) {
  switch (standingOf(offer)) {
    case "on":
      return <Pill tone="ok">Active</Pill>
    case "paused-hours":
      return (
        <Pill tone="warn" title="Running this period, but not at this hour">
          Not now
        </Pill>
      )
    case "soon":
      return <Pill tone="info">Scheduled</Pill>
  }
}

/// The same three words as a dot and a word — a card's foot and a list's rows.
export function OfferStatus({ offer }: { offer: StoreOffer }) {
  switch (standingOf(offer)) {
    case "on":
      return <Status tone="ok">Active</Status>
    case "paused-hours":
      return <Status tone="warn">Not now</Status>
    case "soon":
      return <Status tone="info">Scheduled</Status>
  }
}

/// A run's state, for a sheet's head. Active rather than "live": the node
/// reports no "this minute" for a markdown, so a run with hours says when on the
/// line under it and the badge does not guess.
export function PhasePill({ state }: { state: string }) {
  return state === "UPCOMING" ? (
    <Pill tone="info">Scheduled</Pill>
  ) : (
    <Pill tone="ok">Active</Pill>
  )
}

/// …and as a dot and a word.
export function PhaseStatus({ state }: { state: string }) {
  return state === "UPCOMING" ? (
    <Status tone="info">Scheduled</Status>
  ) : (
    <Status tone="ok">Active</Status>
  )
}

/// A price-drop run's badge.
export function DropPill({ window }: { window: PriceDropWindow }) {
  return <PhasePill state={window.state} />
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
  urgentHours,
  className,
}: {
  /// How close to the end it turns red. Six hours unless said otherwise.
  urgentHours?: number
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
          : urgent(endsAt, now, urgentHours)
            ? "font-medium text-bad-fg"
            : "text-mute",
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
/// under it still says which campaign this is. `thumb` fills a card's square
/// instead of keeping the poster's own 3:1.
export function CampaignBanner({
  campaign,
  alt,
  className,
  thumb = false,
  onFail,
}: {
  campaign: string
  alt: string
  className?: string
  thumb?: boolean
  onFail?: () => void
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={`/api/v1/catalog/campaign-image?campaign=${encodeURIComponent(campaign)}`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true)
        onFail?.()
      }}
      className={cn(
        "bg-soft-2 object-cover",
        thumb ? "size-full" : "aspect-[3/1] w-full",
        className,
      )}
    />
  )
}

// ── Cards ──────────────────────────────────────────────────────────────────

/// One offer as the uniform card: its name over its code, what it gives as the
/// one figure, the countdown and the status in the foot. It opens its sheet.
///
/// `byCode` is the Vouchers card: there the code is what somebody comes to read,
/// so it stands where the name does — with its copy button — and the name moves
/// under it.
export function OfferCard({
  offer,
  onOpen,
  byCode = false,
}: {
  offer: StoreOffer
  onOpen: () => void
  byCode?: boolean
}) {
  const benefit = benefitOf(offer.effect)
  const hours = slot(offer.weekdays, offer.time_window)
  const limits = [
    offer.members_only ? "Members only" : null,
    offer.uses_remaining === null
      ? null
      : `${count(offer.uses_remaining)} ${offer.uses_remaining === 1 ? "use" : "uses"} left`,
    offer.budget_remaining_minor === null
      ? null
      : `${money(offer.budget_remaining_minor)} budget left`,
  ].filter((part) => part !== null)
  return (
    <LeadCard
      onOpen={onOpen}
      title={
        byCode && offer.coupon_code !== null ? (
          <CopyCode code={offer.coupon_code} size="lg" />
        ) : (
          offer.name
        )
      }
      code={byCode ? undefined : (offer.coupon_code ?? undefined)}
      lines={[
        byCode
          ? offer.campaign_name === null
            ? offer.name
            : `${offer.name} · ${offer.campaign_name}`
          : offer.campaign_name,
        describeScope(offer.applies_to),
        hours,
        limits.length === 0 ? null : limits.join(" · "),
      ]}
      lead={{ figure: benefit.figure, caption: benefit.caption }}
      foot={{
        info: (
          <Countdown
            state={offer.state}
            startsAt={offer.starts_at}
            endsAt={offer.ends_at}
          />
        ),
        status: <OfferStatus offer={offer} />,
      }}
    />
  )
}

// ── The sheet ──────────────────────────────────────────────────────────────

/// Everything the node knows about one offer, as a record sheet: the code in
/// mono over the name, the one badge, then label and value — and the terms.
///
/// Every default is spelled out where the card leaves it unsaid: "every day",
/// "all day", "anyone". On a card the missing line is the ordinary case; in a
/// sheet somebody is reading to answer a customer, and a blank reads as
/// "unknown". Nothing sits in the foot: an offer is read, not acted on here.
///
/// Kept while it slides away, so closing does not blank the record mid-travel.
export function OfferSheet({
  offer,
  onClose,
}: {
  /// The offer asked for. `undefined` is closed.
  offer: StoreOffer | undefined
  onClose: () => void
}) {
  const [shown, setShown] = useState<StoreOffer | undefined>(undefined)
  if (offer !== undefined && offer !== shown) setShown(offer)
  const record = offer ?? shown
  const codes = record === undefined ? [] : scopeCodes(record.applies_to)
  const hours =
    record === undefined ? null : slot(record.weekdays, record.time_window)
  const terms = sentences(record?.campaign_terms ?? null)

  return (
    <Sheet
      open={offer !== undefined}
      onOpenChange={(next) => !next && onClose()}
      id={record?.coupon_code ?? undefined}
      title={record?.name ?? ""}
      badge={record === undefined ? undefined : <OfferPill offer={record} />}
      caption={record?.campaign_name ?? undefined}
    >
      {record !== undefined && (
        <div className="flex flex-col gap-6">
          <Facts>
            <Fact term="Benefit" wide>
              <span className="text-[1.5rem] leading-tight font-semibold tracking-tight">
                {describeEffect(record.effect)}
              </span>
            </Fact>
            <Fact term="Applies to" wide>
              {describeScope(record.applies_to)}
            </Fact>
            <Fact term="Valid" wide>
              {validity(record)}
            </Fact>
            <Fact term="Hours">{hours ?? "All day, every day"}</Fact>
            <Fact term="Who">
              {record.members_only ? "Members only" : "Everyone"}
            </Fact>
            {record.coupon_code !== null && (
              <Fact term="Code" wide>
                <CopyCode code={record.coupon_code} size="lg" />
              </Fact>
            )}
            {record.uses_remaining !== null && (
              <Fact term="Uses left">
                <span
                  className={cn(record.uses_remaining === 0 && "text-bad-fg")}
                >
                  {count(record.uses_remaining)}
                </span>
              </Fact>
            )}
            {record.budget_remaining_minor !== null && (
              <Fact term="Budget left">
                <span
                  className={cn(
                    record.budget_remaining_minor <= 0 && "text-bad-fg",
                  )}
                >
                  {money(record.budget_remaining_minor)}
                </span>
              </Fact>
            )}
          </Facts>
          {(record.uses_remaining !== null ||
            record.budget_remaining_minor !== null) && (
            // Counted at head office and as fresh as the last sync: a brake, not
            // a gate, so nobody promises the last use to a customer.
            <p className="text-meta text-mute">
              Limits are counted at head office and may be a little behind.
            </p>
          )}
          {terms.length > 0 && (
            <section>
              <h3 className="mb-2.5 text-card-title font-semibold text-ink">
                Terms
              </h3>
              <Bullets lines={terms} />
            </section>
          )}
          {codes.length > 1 && (
            <section>
              <h3 className="mb-2.5 text-card-title font-semibold text-ink">
                Covers{" "}
                <span className="font-normal text-mute tabular-nums">
                  {count(codes.length)}
                </span>
              </h3>
              <CodeList codes={codes} />
            </section>
          )}
          {record.campaign_name !== null && (
            <AppLink
              to="/promotions/campaigns"
              className="text-cell font-medium text-accent underline-offset-2 hover:underline"
            >
              Part of {record.campaign_name}
            </AppLink>
          )}
        </div>
      )}
    </Sheet>
  )
}

/// When an offer is valid, in one phrase.
function validity(offer: StoreOffer): string {
  if (offer.starts_at === null)
    return offer.ends_at === null
      ? "No end date"
      : `Until ${moment(offer.ends_at)}`
  return offer.ends_at === null
    ? `From ${moment(offer.starts_at)}`
    : `${moment(offer.starts_at)} – ${moment(offer.ends_at)}`
}

// ── The detail ─────────────────────────────────────────────────────────────

/// Everything the node knows about one offer, opened under its row — the
/// Catalogue's product sheet reads its Promotions tab with this.
///
/// Every default is spelled out here where the list leaves it unsaid: "every
/// day", "all day", "anyone". In a list the missing line is the ordinary case;
/// in a detail somebody is reading to answer a customer, and a blank reads as
/// "unknown".
export function OfferDetail({ offer }: { offer: StoreOffer }) {
  const codes = scopeCodes(offer.applies_to)
  const hours = slot(offer.weekdays, offer.time_window)
  const when = validity(offer)

  return (
    <div className="flex max-w-[46em] flex-col gap-2 pt-1">
      <h4 className="text-cell font-semibold text-ink">Terms and conditions</h4>
      <Bullets
        lines={[
          `${describeEffect(offer.effect)} · ${describeScope(offer.applies_to)}`,
          `Valid ${when}${hours !== null ? `, ${hours}` : ""}`,
          offer.members_only ? "Identified members only" : "For everyone",
          offer.coupon_code !== null && (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              Use code <CopyCode code={offer.coupon_code} />
            </span>
          ),
          ...sentences(offer.campaign_terms),
          offer.uses_remaining !== null && (
            <span className={cn(offer.uses_remaining === 0 && "text-bad-fg")}>
              {count(offer.uses_remaining)} uses left
            </span>
          ),
          offer.budget_remaining_minor !== null && (
            <span
              className={cn(offer.budget_remaining_minor <= 0 && "text-bad-fg")}
            >
              {money(offer.budget_remaining_minor)} budget left
            </span>
          ),
          // Counted at head office and as fresh as the last sync: a brake, not
          // a gate, so nobody promises the last use to a customer.
          (offer.uses_remaining !== null ||
            offer.budget_remaining_minor !== null) && (
            <span className="text-body">
              Limits are counted at head office and may be a little behind.
            </span>
          ),
        ]}
      />
      {codes.length > 1 && (
        <div className="mt-1 flex flex-col gap-1.5">
          <span className="text-meta text-mute">
            Covers {count(codes.length)}
          </span>
          <CodeList codes={codes} />
        </div>
      )}
      {offer.campaign_name !== null && (
        <AppLink
          to="/promotions/campaigns"
          className="text-cell font-medium text-accent underline-offset-2 hover:underline"
        >
          Part of {offer.campaign_name}
        </AppLink>
      )}
    </div>
  )
}

/// The centre writes its small print as running sentences; one bullet each
/// reads faster across a counter.
export function sentences(text: string | null): string[] {
  return (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
}

/// A bulleted list that skips what is not there: a `false` entry is a line
/// that does not apply.
export function Bullets({
  lines,
}: {
  lines: readonly (React.ReactNode | false | null)[]
}) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-cell text-ink marker:text-line-ico">
      {lines
        .filter((line) => line !== false && line !== null)
        .map((line, index) => (
          <li key={index}>{line}</li>
        ))}
    </ul>
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
          // Inside a card that opens on a press; copying must not also open it.
          event.stopPropagation()
          void copyText(code).then((ok) => setOutcome(ok ? "copied" : "failed"))
        }}
        className={cn(
          "relative inline-flex shrink-0 items-center gap-1 rounded-inner border border-hairline-2 bg-canvas px-2 text-meta font-medium text-text shadow-soft transition-colors hover:bg-soft",
          // 32 to look at, 44 to land on.
          "h-8 after:absolute after:-inset-1.5 after:content-['']",
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
