import { Search, X } from "lucide-react"

import { cn } from "@/lib/cn"

/// The search box.
///
/// Its own component because a list's search has one behaviour worth getting
/// right and worth getting right once: a CLEAR affordance that appears only
/// when there is something to clear. A search somebody cannot see how to
/// undo is a list that looks broken — rows are missing and the reason is a
/// word they typed a minute ago and have scrolled past.
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex min-w-0 items-center gap-2 border px-2.5",
        className,
      )}
    >
      <Search className="text-ink-4 size-4 shrink-0" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="text-ctl text-ink placeholder:text-ink-4 min-w-0 flex-1 bg-transparent outline-none"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="rounded-tag text-ink-4 hover:bg-hover hover:text-ink grid size-[18px] shrink-0 place-items-center transition-colors"
        >
          <X className="size-3.5 stroke-[2]" />
        </button>
      )}
    </div>
  )
}

/// One facet value, as a real checkbox.
///
/// A real `<input type="checkbox">` and not a styled div: it is what a
/// keyboard reaches with Tab and toggles with Space, what a screen reader
/// announces as checked, and what a form would submit. A div with a tick drawn
/// in it is none of those and looks identical.
///
/// The COUNT is the point of the row. A filter list without counts is a
/// guessing game — a value that would leave nothing is a value nobody should
/// have to click to find out about.
export function CheckRow({
  checked,
  onChange,
  label,
  count,
  dot,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  count: number
  /// A colour, when the value has one the data carries.
  dot?: string
}) {
  return (
    <label className="rounded-ctl hover:bg-hover flex cursor-pointer items-center gap-2.5 px-2 py-[7px] transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="border-line-2 bg-canvas checked:border-blue checked:bg-blue size-[15px] shrink-0 appearance-none rounded-[4px] border-[1.5px]"
      />
      {dot && (
        <span
          aria-hidden
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: dot }}
        />
      )}
      <span className="text-ctl text-ink-2 min-w-0 flex-1 truncate">
        {label}
      </span>
      <span className="text-label text-ink-4 shrink-0 tabular-nums">
        {count}
      </span>
    </label>
  )
}
