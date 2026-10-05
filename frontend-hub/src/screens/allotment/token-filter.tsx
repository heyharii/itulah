import { Search, X } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/// What a token narrows by.
export type TokenKind =
  "search" | "order" | "division" | "tag" | "colour" | "size"

/// One committed filter: a kind and a value, with the words it is shown as.
export interface FilterToken {
  readonly kind: TokenKind
  readonly value: string
  readonly label: string
}

/// Something the box can suggest for what has been typed.
export interface TokenOption extends FilterToken {
  /// How many rows it would keep — shown beside it, muted.
  readonly count?: number
}

const KIND_LABEL: Record<TokenKind, string> = {
  search: "Search",
  order: "Delivery",
  division: "Division",
  tag: "Tag",
  colour: "Colour",
  size: "Size",
}

/// How many suggestions the list shows at once. Enough to choose between;
/// fewer than a screen, so the list never needs its own scroll.
const SHOWN = 8

/// Every filter of the page in one box: type, press Enter, type, press Enter.
///
/// Six dropdowns in a row wrapped onto two lines and asked somebody to know
/// which dropdown a word lived in before they could use it — is "Sepatu" a
/// tag or a division? Here the word is typed and the box says what it is:
/// the suggestions come from every vocabulary at once, each marked with its
/// kind, and Enter takes the one highlighted. Something that matches none of
/// them is still a filter — Enter makes it a search on the article's name,
/// code and SKU.
///
/// Tokens of one kind widen (Sepatu OR Kaos); tokens of different kinds
/// narrow (Sepatu AND Beige). Backspace in the empty box takes the last token
/// back, the way a mail client's address field does.
export function TokenFilter({
  tokens,
  options,
  onChange,
  className,
}: {
  tokens: readonly FilterToken[]
  options: readonly TokenOption[]
  onChange: (tokens: readonly FilterToken[]) => void
  className?: string
}) {
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useId()

  const typed = text.trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (typed === "") return []
    const taken = new Set(tokens.map((one) => `${one.kind}:${one.value}`))
    return (
      options
        .filter(
          (one) =>
            !taken.has(`${one.kind}:${one.value}`) &&
            one.label.toLowerCase().includes(typed)
        )
        // A word that STARTS with what was typed is the likelier meaning.
        .sort(
          (left, right) =>
            Number(!left.label.toLowerCase().startsWith(typed)) -
            Number(!right.label.toLowerCase().startsWith(typed))
        )
        .slice(0, SHOWN)
    )
  }, [options, tokens, typed])

  /// The last row is always the plain search, so Enter never does nothing.
  const rows: TokenOption[] =
    typed === ""
      ? []
      : [
          ...suggestions,
          { kind: "search", value: text.trim(), label: text.trim() },
        ]

  function commit(option: TokenOption) {
    onChange([
      ...tokens,
      { kind: option.kind, value: option.value, label: option.label },
    ])
    setText("")
    setActive(0)
    input.current?.focus()
  }

  function remove(index: number) {
    onChange(tokens.filter((_, at) => at !== index))
    input.current?.focus()
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      {/* The box is a label so a click anywhere in it — between tokens, past
          the last one — lands in the input. */}
      <label className="flex min-h-[2.125rem] w-full cursor-text flex-wrap items-center gap-1 rounded-inner border border-hairline-2 bg-canvas py-1 pr-1.5 pl-2.5 shadow-soft focus-within:border-accent">
        <Search className="size-3.5 shrink-0 text-line-ico" />
        {tokens.map((token, index) => (
          <span
            key={`${token.kind}:${token.value}`}
            className="inline-flex h-6 max-w-56 items-center gap-1 rounded-[0.375rem] bg-soft-2 pr-1 pl-2 text-[0.875rem]"
          >
            <span className="text-mute">{KIND_LABEL[token.kind]}</span>
            <span className="truncate text-ink">{token.label}</span>
            <button
              type="button"
              aria-label={`Remove ${KIND_LABEL[token.kind]} ${token.label}`}
              onClick={(event) => {
                event.preventDefault()
                remove(index)
              }}
              className="grid size-5 place-items-center rounded-[0.25rem] text-mute hover:bg-hairline hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={text}
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-controls={list}
          aria-activedescendant={
            open && rows.length > 0 ? `${list}-${active}` : undefined
          }
          aria-label="Filter the articles"
          onChange={(event) => {
            setText(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          // Late enough that a click on a suggestion lands first.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && rows.length > 0) {
              event.preventDefault()
              commit(rows[Math.min(active, rows.length - 1)])
            } else if (event.key === "ArrowDown" && rows.length > 0) {
              event.preventDefault()
              setActive((at) => (at + 1) % rows.length)
            } else if (event.key === "ArrowUp" && rows.length > 0) {
              event.preventDefault()
              setActive((at) => (at - 1 + rows.length) % rows.length)
            } else if (event.key === "Escape") {
              setText("")
              setOpen(false)
            } else if (
              event.key === "Backspace" &&
              text === "" &&
              tokens.length > 0
            ) {
              remove(tokens.length - 1)
            }
          }}
          className="h-6 min-w-40 flex-1 bg-transparent text-[0.875rem] text-ink outline-none placeholder:text-body"
        />
        {tokens.length > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              onChange([])
              setText("")
            }}
            className="shrink-0 rounded-[0.25rem] px-1.5 text-[0.875rem] text-mute hover:text-ink"
          >
            Clear
          </button>
        )}
      </label>

      {open && rows.length > 0 && (
        <ul
          id={list}
          role="listbox"
          className="absolute top-full left-0 z-40 mt-1 w-full max-w-md overflow-hidden rounded-inner border border-hairline bg-canvas py-1 shadow-soft"
        >
          {rows.map((row, index) => (
            <li
              key={`${row.kind}:${row.value}`}
              id={`${list}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                commit(row)
              }}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-3 py-1.5 text-[0.875rem]",
                index === active && "bg-soft"
              )}
            >
              <span className="w-16 shrink-0 text-mute">
                {KIND_LABEL[row.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {row.kind === "search" ? `“${row.label}”` : row.label}
              </span>
              {row.count !== undefined && (
                <span className="text-mute tabular-nums">{row.count}</span>
              )}
              {index === active && <span className="text-faint">Enter</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
