import { cn } from "@/lib/utils";
import * as React from "react";

interface TableProps extends React.ComponentProps<"table"> {
  containerClassName?: string;
  /// The container is what scrolls, so a caller that has to know about the
  /// scrolling element — a virtualiser being told which box to measure — needs
  /// a handle on it. Without this the only way to get one is to stop using this
  /// frame and write the div and the table again by hand.
  containerRef?: React.Ref<HTMLDivElement>;
  /// `grid` is the operational list grammar (mono micro-caps, cell hairlines,
  /// pinned first column). `rows` is the looser document table. Size, weight
  /// and case live in CSS so a sortable heading cannot drift from an unsortable
  /// one by wrapping itself in a Button.
  grammar?: "grid" | "rows";
}

function Table({
  className,
  containerClassName,
  containerRef,
  onScroll,
  grammar = "rows",
  ...props
}: TableProps) {
  return (
    <div
      ref={containerRef}
      className={cn("w-full overflow-auto", containerClassName)}
      // REMINDER: we are not scrolling the table, but the container
      {...{ onScroll }}
    >
      <table
        data-os-grid={grammar === "grid" ? "" : undefined}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

/// Type, weight and case belong to the `th` CSS, not to this component. A
/// filled header row reads as a second surface stacked on the card.
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn("[&_tr]:border-b [&_tr]:bg-transparent!", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "bg-[var(--os-soft,var(--muted))] font-medium",
        className,
      )}
      {...props}
    />
  );
}

/// Hairline between rows, `{soft}` on hover, and the selected row tinted with
/// the indigo — selection is indigo in this language, never the status blue.
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b transition-colors",
        "hover:bg-[var(--os-soft,var(--muted))]",
        "data-[state=selected]:bg-[var(--os-accent-bg,var(--muted))]",
        className,
      )}
      {...props}
    />
  );
}

/// Inherit size, weight, case and tracking from the `th` rule so a sortable
/// heading and an unsortable one in the same table cannot drift.
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "text-left align-middle whitespace-nowrap uppercase",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn("align-middle tabular-nums", className)}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
