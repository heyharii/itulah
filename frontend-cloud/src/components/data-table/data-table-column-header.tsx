import type { DataTableFeatures } from "@/lib/table/features";
import { cn } from "@/lib/utils";
import type { Column, RowData } from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type React from "react";

interface DataTableColumnHeaderProps<TData extends RowData, TValue>
  extends React.ComponentProps<"button"> {
  column: Column<DataTableFeatures, TData, TValue>;
  title: string;
  /// Which end of the column the heading sits at. A number column wants its
  /// heading over the digits, and the button is full width, so it has to be
  /// told to push its content to the end — which every numeric call site used
  /// to say for itself by passing `justify-end` and knowing how this button
  /// lays itself out.
  align?: "start" | "end";
}

/// A column heading that can be sorted.
///
/// A bare button rather than the shared `Button`: that component sets its own
/// font size, weight, height and tracking, which meant a sortable heading and
/// an unsortable one in the same table were set in two different typefaces of
/// the same family. The heading's type belongs to the `th`, and the only job
/// left here is the click target and the arrow.
///
/// The arrow is always present, in the faint grey, rather than appearing on
/// sort: a heading that grows a control when you touch it moves the text under
/// the cursor, and columns that can be sorted should say so before they are.
export function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
  align = "start",
  className,
  ...props
}: DataTableColumnHeaderProps<TData, TValue>) {
  const alignment = align === "end" ? "justify-end" : "justify-between";

  if (!column.getCanSort()) {
    return (
      <div className={cn(align === "end" && "text-right", className)}>
        {title}
      </div>
    );
  }

  const sorted = column.getIsSorted();

  return (
    <button
      type="button"
      onClick={() => {
        column.toggleSorting(undefined);
      }}
      aria-label={`Sort by ${title}`}
      className={cn(
        // inherit: the th owns size, weight, case, tracking and colour
        "group/sort flex w-full items-center gap-1.5 font-[inherit] text-[inherit] tracking-[inherit] text-inherit uppercase",
        "cursor-pointer transition-colors hover:text-[var(--os-text,currentColor)]",
        "focus-visible:ring-ring/50 rounded-[4px] outline-none focus-visible:ring-2",
        alignment,
        className,
      )}
      {...props}
    >
      {align === "end" && <SortMark sorted={sorted} />}
      <span className="truncate">{title}</span>
      {align !== "end" && <SortMark sorted={sorted} />}
    </button>
  );
}

/// One glyph, three states — unsorted, ascending, descending — so the column
/// never changes width as it is sorted.
function SortMark({ sorted }: { sorted: false | "asc" | "desc" }) {
  const Icon =
    sorted === "asc" ? ChevronUp : sorted === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <Icon
      aria-hidden
      strokeWidth={2}
      className={cn(
        "size-2.5 shrink-0 transition-colors",
        sorted === false
          ? "text-[var(--os-faint,currentColor)] opacity-0 group-hover/sort:opacity-100"
          : "text-[var(--os-ink,currentColor)]",
      )}
    />
  );
}
