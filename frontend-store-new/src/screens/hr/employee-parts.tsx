import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/// The pieces the person's page is made of — the hub's (`employee-page.tsx`):
/// a titled card, label-over-value facts, one figure, and the quiet sentence
/// that stands where there is nothing to show.
///
/// Facts are drawn here at 15px rather than with the sheet kit's `Fact`, which
/// is 14: a page is read, a sheet is glanced at.

export function Block({
  title,
  aside,
  children,
}: {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside}
      </CardHeader>
      <div className="px-4 pt-1 pb-5">{children}</div>
    </Card>
  )
}

export function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 max-sm:grid-cols-1">
      {children}
    </dl>
  )
}

export function Fact({
  term,
  wide = false,
  children,
}: {
  term: React.ReactNode
  /// Spans both columns — an address, a list of names.
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2 max-sm:col-span-1")}>
      <dt className="text-[0.9375rem] text-body">{term}</dt>
      <dd className="mt-1 text-[0.9375rem] [overflow-wrap:anywhere] text-ink">
        {children}
      </dd>
    </div>
  )
}

export function Figure({
  label,
  tone,
  children,
}: {
  label: string
  tone?: "ok" | "bad"
  children: React.ReactNode
}) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[0.9375rem] text-body">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-[1.0625rem] font-semibold tabular-nums",
          tone === "bad"
            ? "text-bad-fg"
            : tone === "ok"
              ? "text-ok-fg"
              : "text-ink",
        )}
      >
        {children}
      </div>
    </Card>
  )
}

export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.9375rem] text-body">{children}</p>
}

/// The dash for a value nobody has recorded.
export function Blank() {
  return <span className="text-mute">—</span>
}

/// One step of a history, numbered down a line — the hub's `Timeline`, trimmed
/// to what a person's history needs.
export function Timeline({
  events,
}: {
  events: readonly {
    readonly id: string
    readonly title: React.ReactNode
    readonly detail?: React.ReactNode
    readonly at?: React.ReactNode
    readonly current?: boolean
  }[]
}) {
  return (
    <ol className="flex flex-col">
      {events.map((event, index) => (
        <li key={event.id} className="relative flex items-start gap-2.5 py-1.5">
          {index < events.length - 1 && (
            <span
              aria-hidden
              className="absolute top-[1.875rem] left-3 h-[calc(100%-1.5rem)] w-[1.5px] bg-hairline-2"
            />
          )}
          <span
            className={cn(
              "z-10 grid size-[1.5625rem] shrink-0 place-items-center rounded-[7px] font-mono text-[0.9375rem] font-semibold",
              event.current === true
                ? "bg-accent text-white"
                : "bg-ok-bg text-ok-fg",
            )}
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-medium text-ink">
              {event.title}
            </span>
            {event.detail !== undefined && (
              <span className="block text-[0.9375rem] text-mute">
                {event.detail}
              </span>
            )}
          </span>
          {event.at !== undefined && (
            <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
              {event.at}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

/// A small table inside a card: a header line and rows, 15px throughout.
export function Rows({
  head,
  children,
}: {
  head: readonly { label: string; right?: boolean }[]
  children: React.ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[0.9375rem]">
        <thead>
          <tr>
            {head.map((one) => (
              <th
                key={one.label}
                className={cn(
                  "border-b border-hairline px-3 py-2 text-[0.9375rem] font-medium whitespace-nowrap text-body",
                  one.right === true ? "text-right" : "text-left",
                )}
              >
                {one.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Row({
  cells,
}: {
  cells: readonly { content: React.ReactNode; right?: boolean }[]
}) {
  return (
    <tr className="border-b border-hairline last:border-b-0">
      {cells.map((cell, index) => (
        <td
          key={index}
          className={cn(
            "px-3 py-2.5 align-top text-ink",
            cell.right === true && "text-right tabular-nums",
          )}
        >
          {cell.content}
        </td>
      ))}
    </tr>
  )
}
