import type { LucideIcon } from "lucide-react"
import { useState } from "react"

import { Banner } from "@/components/ui/states"
import { Garment } from "@/lib/garment"
import { ArticleCell as SharedCell } from "@/components/article-cell"
import { useArticleFacts } from "@/lib/article-facts"
import { articleId, count } from "@/lib/format"
import type { ReturnArticle } from "@/lib/return-steps"
import { cn } from "@/lib/utils"

/// The drawn pieces of Return to HO. The hub's Ops › Allotment board
/// (`frontend-hub/src/screens/operations/board/tables.tsx`) is the pattern; the
/// store's copy has no store rail — every koli goes to HO.

/// A footer button on a phone: 44px, whatever the kit's footer says (the kit's
/// `Sheet` pins every button in its foot to 36px).
export const FOOT = "max-md:h-11!"

/// A solid red button — every way back (Back to Picklist, Unpack). The same
/// recipe as a destructive `confirm()`.
export const RED = "bg-bad text-on-dark hover:bg-bad hover:brightness-95"

/// "3 SKUs", "1 article".
export function many(n: number, word: string): string {
  return `${count(n)} ${n === 1 ? word : `${word}s`}`
}

/// One quiet red word in a row: Unpick, Take out.
export function RedText({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="inline-flex h-8 items-center rounded-inner px-1.5 text-[0.9375rem] font-semibold text-bad-fg transition-transform duration-(--t-press) ease-(--ease-out) hover:underline active:scale-[0.97] disabled:opacity-50 pointer-coarse:h-11"
    >
      {children}
    </button>
  )
}

/// What a garment is drawn from: the article's name and its first colour, so a
/// black shirt is drawn black.
export function drawn(article: ReturnArticle): string {
  return `${article.name} ${article.skus[0]?.variant ?? ""}`.trim()
}

/// The article's photograph, or a garment drawn from its name when it has none.
export function Thumb({
  url,
  name,
  className,
}: {
  url: string | null
  name: string
  className?: string
}) {
  // *Which* URL failed, not whether one did: a row is recycled as the list
  // changes, and one dead URL must not blank the next photograph.
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span
      className={cn(
        "grid size-[2.125rem] shrink-0 place-items-center overflow-hidden rounded-[0.375rem] border border-hairline bg-canvas",
        className,
      )}
    >
      {url !== null && failed !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(url)}
          className="size-full object-cover"
        />
      ) : (
        <Garment name={name} />
      )}
    </span>
  )
}

/// An article in a table: photograph, name, and one quiet line under it.
export function ArticleCell({
  article,
}: {
  article: ReturnArticle
  /// Kept for call sites; the identity cell is the shared one.
  sub?: React.ReactNode
}) {
  const facts = useArticleFacts()(article.article_code)
  return (
    <SharedCell
      photo={
        article.image_url !== null ? (
          <Thumb
            url={article.image_url}
            name={drawn(article)}
            className="size-full rounded-none border-0"
          />
        ) : null
      }
      id={articleId(article.article_code)}
      name={article.name}
      division={facts.division}
      tags={facts.tags}
    />
  )
}

export type Tab = "picklist" | "picked" | "packed" | "transit" | "received"

export interface TabSpec {
  readonly id: Tab
  readonly label: string
  readonly icon: LucideIcon
  readonly n: number
}

/// The stages as icon tabs — the hub's: a 32px icon square, the word and its
/// count. On a phone each is an equal-width icon over its word.
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly TabSpec[]
  value: Tab
  onChange: (tab: Tab) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Stage"
      className="mb-4 flex gap-1 border-b border-hairline max-md:gap-0"
    >
      {tabs.map((one) => {
        const on = one.id === value
        const Icon = one.icon
        return (
          <button
            key={one.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(one.id)}
            className={cn(
              "relative flex h-12 items-center gap-2.5 rounded-t-inner pr-3.5 pl-2 text-[0.9375rem] transition-colors duration-150 [&_svg]:size-[1.125rem]",
              on ? "font-medium text-ink" : "text-body hover:bg-soft-2",
              "max-md:h-auto max-md:min-w-0 max-md:flex-1 max-md:basis-0 max-md:flex-col max-md:gap-1 max-md:px-0.5 max-md:py-2 max-md:text-center",
            )}
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-inner transition-colors duration-150",
                on ? "bg-accent-bg text-accent" : "bg-soft-2 text-body",
              )}
            >
              <Icon />
            </span>
            <span className="max-md:leading-tight md:whitespace-nowrap">
              {one.label}{" "}
              <span className="text-body tabular-nums">{count(one.n)}</span>
            </span>
            {on && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />
            )}
          </button>
        )
      })}
    </div>
  )
}

/// A table's head row: 44px, soft ground.
export function Head({ children }: { children: React.ReactNode }) {
  return (
    <tr className="h-11 border-b border-hairline bg-soft text-left text-meta font-medium whitespace-nowrap text-body">
      {children}
    </tr>
  )
}

/// A table's foot row.
export function Foot({ children }: { children: React.ReactNode }) {
  return <tr className="h-12 border-t border-hairline bg-soft">{children}</tr>
}

/// A body row, 63px; pressable when it opens something.
export function Row({
  children,
  onClick,
  selected = false,
}: {
  children: React.ReactNode
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "h-[3.9375rem] border-b border-hairline last:border-b-0",
        onClick !== undefined &&
          "cursor-pointer transition-colors duration-150 hover:bg-soft",
        selected && "bg-accent-bg hover:bg-accent-bg",
      )}
    >
      {children}
    </tr>
  )
}

/// A table's tick: the row's own, or the head's for every row.
export function Tick({
  on,
  label,
  onChange,
}: {
  on: boolean
  label: string
  onChange: () => void
}) {
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
      aria-label={label}
      className="size-[1.125rem] cursor-pointer accent-[var(--color-accent)]"
    />
  )
}

/// What went wrong or was left out, said where the press was: the node's own
/// sentences, one line each. Nothing when there is nothing to say.
export function Notice({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null
  return (
    <Banner tone="bad" role="alert" className="mb-4">
      <span className="flex flex-col gap-1">
        {lines.map((line, at) => (
          <span key={`${at}:${line}`}>{line}</span>
        ))}
      </span>
    </Banner>
  )
}
