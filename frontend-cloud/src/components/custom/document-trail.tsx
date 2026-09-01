import { cn } from "@/lib/utils"

/// Every document this record has already turned into, in the order it turned
/// into them.
///
/// This is the "no dead ends" rule made visible. A PO is not a thing on its
/// own — it becomes a receipt, a three-way match, an invoice, a journal
/// entry — and a buyer chasing a discrepancy needs to see which of those
/// exist, which is the live one, and which have not happened yet, then click
/// straight through. Without it the panel can only say "Status: Partial" and
/// the user has to go and search four other screens to find out why.
///
/// The mark is a mono code, not an icon, because these are document *types*
/// with names the business already uses (PO, GRN, INV, JE). An icon would
/// make the reader translate; the code is the thing they say out loud.
export type DocumentTrailState = "done" | "current" | "todo"

export type DocumentTrailStep = {
  /// Three or four characters. The squircle is 25px and the face is mono at
  /// 8.5px — longer than that and it stops fitting on one line.
  code: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  amount?: React.ReactNode
  state: DocumentTrailState
  onClick?: () => void
}

const MARK: Record<DocumentTrailState, string> = {
  done: "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]",
  // Indigo, and the only indigo in the panel: this is the step you are
  // standing on, and selection in this language is always indigo. The sky
  // blue would say "in motion", which is a different claim.
  current: "bg-[var(--os-accent,#3c52f0)] text-[var(--os-on-dark,#fff)]",
  todo: "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-faint,#d3d3d8)]",
}

export function DocumentTrail({
  steps,
  className,
}: {
  steps: readonly DocumentTrailStep[]
  className?: string
}) {
  return (
    <div className={cn("mt-[0.375rem] mb-[0.125rem]", className)}>
      {steps.map((step, index) => {
        const Tag = step.onClick ? "button" : "div"
        return (
          <Tag
            key={index}
            {...(step.onClick
              ? { type: "button" as const, onClick: step.onClick }
              : {})}
            className={cn(
              "relative flex w-full items-center gap-[0.6875rem] py-[0.375rem] text-left",
              step.onClick && "cursor-pointer",
            )}
          >
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className="absolute top-[1.875rem] left-[0.75rem] h-[0.875rem] w-[1.5px] bg-[var(--os-hairline-2,#e4e4e8)]"
              />
            )}
            <span
              aria-hidden
              className={cn(
                "z-[1] grid size-[1.5625rem] shrink-0 place-items-center rounded-[0.4375rem]",
                "font-mono text-[0.53125rem] leading-none font-semibold",
                MARK[step.state],
              )}
            >
              {step.code}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.78125rem] font-medium text-[var(--os-ink,#1d1d1f)]">
                {step.title}
              </span>
              {step.subtitle !== undefined && (
                <span className="block truncate text-[0.6875rem] text-[var(--os-mute,#a6a6ad)]">
                  {step.subtitle}
                </span>
              )}
            </span>
            {step.amount !== undefined && (
              <span className="shrink-0 text-right text-[0.75rem] tabular-nums whitespace-nowrap text-[var(--os-body,#74747b)]">
                {step.amount}
              </span>
            )}
          </Tag>
        )
      })}
    </div>
  )
}
