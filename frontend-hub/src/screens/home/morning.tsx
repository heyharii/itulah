import { ArrowRight } from "lucide-react"

import { Composer } from "@/components/assistant/composer"
import { useAssistant } from "@/components/assistant/state"
import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { SHOW_MISSING } from "@/lib/features"
import { count, money } from "@/lib/format"
import { useBrief, type Brief } from "@/lib/queries/assistant"
import { queryState } from "@/lib/query-state"
import { SetupCard } from "@/screens/setup/setup-card"

/// The morning brief: the four figures worth knowing before anybody opens a
/// module, and a box to ask about them.
///
/// It is deliberately not a dashboard. A dashboard is a place charts go to be
/// ignored; this is four sentences with a number in each, and every one of
/// them is a thing somebody would otherwise have gone looking for. The three
/// suggested questions underneath are the point of the page as much as the
/// figures are — they are what turns "trade is down" into "down where".
///
/// None of it costs a model call. The server assembles these from reads it
/// already had; the assistant is beside them for the questions they raise.

export function Morning() {
  const brief = useBrief()
  return (
    <PageContent>
      {queryState(brief, {
        loading: "Reading the night's figures…",
        render: (data) => <Brief data={data} />,
      })}
    </PageContent>
  )
}

function Brief({ data }: { data: Brief }) {
  const { send } = useAssistant()
  const change = data.trade.today_minor - data.trade.yesterday_minor
  const share =
    data.trade.yesterday_minor > 0
      ? Math.round((change / data.trade.yesterday_minor) * 100)
      : null

  return (
    <>
      <h1 className="pt-6 text-[1.75rem] leading-none font-semibold tracking-[-0.024em] text-ink">
        {greetings[data.greeting]} <span className="text-mute">{data.who}</span>
      </h1>
      <p className="mt-2 text-[0.875rem] text-body">
        Here is how things are going.
      </p>

      {/* A company still opening its stores sees what is left first. */}
      <SetupCard className="mt-6" />

      <div
        className={`mt-6 grid gap-3 sm:grid-cols-2 ${
          SHOW_MISSING ? "xl:grid-cols-4" : "xl:grid-cols-3"
        }`}
      >
        <BriefCard
          title="Trade today"
          detail={
            share === null ? (
              <>
                The fleet has taken{" "}
                <Figure>{money(data.trade.today_minor)}</Figure> so far today.
              </>
            ) : (
              <>
                The fleet has taken{" "}
                <Figure>{money(data.trade.today_minor)}</Figure> today,{" "}
                {share >= 0 ? "up" : "down"} <Figure>{Math.abs(share)}%</Figure>{" "}
                on yesterday.
              </>
            )
          }
          foot={<Spark values={data.trade.daily_minor} />}
          link={{ to: "/reports", label: "See the fleet chart" }}
        />

        <BriefCard
          title="Stock"
          detail={
            <>
              <Figure>{count(data.stock.on_hand)}</Figure> pcs on hand across{" "}
              <Figure>{count(data.stock.sites)}</Figure> sites
              {SHOW_MISSING && (
                <>
                  , with <Figure>{count(data.stock.missing)}</Figure>{" "}
                  unaccounted for
                </>
              )}
              .
            </>
          }
          foot={
            data.stock.lost > 0 ? (
              <Big>
                {count(data.stock.lost)} lost in {data.stock.window_days} days
              </Big>
            ) : undefined
          }
          link={{ to: "/inventory", label: "See pools" }}
        />

        {SHOW_MISSING && (
          <BriefCard
            title="Missing"
            detail={
              data.missing.count === 0 ? (
                <>Nothing is missing anywhere in the fleet.</>
              ) : (
                <>
                  <Figure>{count(data.missing.count)}</Figure> tags the fleet
                  expected to see and has not, covering{" "}
                  <Figure>{count(data.missing.quantity)}</Figure> pcs.
                </>
              )
            }
            foot={
              data.missing.oldest_hours !== null ? (
                <Big>
                  {count(Math.round(data.missing.oldest_hours / 24))} days
                  oldest
                </Big>
              ) : undefined
            }
            link={{ to: "/inventory/missing", label: "See what is missing" }}
          />
        )}

        <BriefCard
          title="Commercial"
          detail={
            data.commercial.behind === 0 ? (
              <>
                Every shop is running version{" "}
                <Figure>{data.commercial.published_version ?? "—"}</Figure>, the
                newest published book.
              </>
            ) : (
              <>
                <Figure>{count(data.commercial.behind)}</Figure> of{" "}
                <Figure>{count(data.commercial.shop_count)}</Figure> shops are
                behind the newest published book.
              </>
            )
          }
          link={{ to: "/commercial", label: "See activation" }}
        />
      </div>

      {/* The questions the figures above provoke, offered rather than left to
          be typed. Clicking one starts the turn and opens the panel; the
          conversation is the same session either way. */}
      <div className="mx-auto mt-9 max-w-[42rem]">
        <div className="overflow-hidden rounded-card border border-hairline bg-soft">
          {data.prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => send(prompt)}
              className="group flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-left transition-colors last:border-0 hover:bg-soft-2"
            >
              <span className="min-w-0 flex-1 truncate text-meta text-body group-hover:text-ink">
                {prompt}
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-ink" />
            </button>
          ))}
        </div>
        <Composer reveal className="mt-3" />
      </div>
    </>
  )
}

const greetings: Record<Brief["greeting"], string> = {
  morning: "Morning,",
  afternoon: "Afternoon,",
  evening: "Evening,",
  night: "Evening,",
}

/// A figure inside a sentence. The sentence is what makes the number mean
/// something; the weight is what lets somebody read only the numbers.
function Figure({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-ink tabular-nums">{children}</span>
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[1.25rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
      {children}
    </div>
  )
}

function BriefCard({
  title,
  detail,
  foot,
  link,
}: {
  title: string
  detail: React.ReactNode
  foot?: React.ReactNode
  link: { to: string; label: string }
}) {
  return (
    <div className="flex min-h-[10.5rem] flex-col rounded-card border border-hairline bg-canvas px-4 pt-3.5 pb-3 shadow-soft">
      <div className="text-eyebrow font-semibold text-mute uppercase">
        {title}
      </div>
      <p className="mt-2 text-meta leading-relaxed text-body">{detail}</p>
      {foot && <div className="mt-auto pt-3">{foot}</div>}
      <AppLink
        to={link.to}
        className={`text-[0.875rem] text-mute hover:text-ink ${foot ? "pt-3" : "mt-auto pt-3"}`}
      >
        {link.label}
      </AppLink>
    </div>
  )
}

/// A fortnight of takings, at the size of a line of text.
///
/// Drawn here rather than with the chart component: that one is a bar chart
/// with axes, a grid and a tooltip, and none of those belong in a card whose
/// job is to say "roughly this shape". Nothing is labelled because nothing is
/// meant to be read off it — the figure above is the figure.
function Spark({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null
  const top = Math.max(...values, 1)
  const step = 100 / (values.length - 1)
  const points = values
    .map((value, index) => `${index * step},${28 - (value / top) * 26}`)
    .join(" ")
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="h-7 w-full"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
