import { Check, ChevronRight } from "lucide-react"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  useSetupStatus,
  type SetupTask,
  type SetupTaskId,
} from "@/lib/queries/setup"
import { cn } from "@/lib/utils"
import { useSheet } from "@/lib/sheets"
import { CompanySheet } from "@/screens/setup/company-sheet"
import { deferSetup } from "@/screens/setup/defer"

/// What is left before the stores can trade, on the home screen.
///
/// The wizard asks three questions and stops; everything else a store needs
/// is asked here, next to the moment it is needed — "before stores open",
/// "before the first PO" — so the owner can see what blocks what without
/// having been made to answer it all on day one. Each row opens the screen
/// where it is done. Whether a row is done is the server's reading of the
/// data (a paired node, a second user), never a box ticked here.
///
/// Put off the wizard, and this is where it comes back from.

interface TaskCopy {
  readonly title: string
  readonly detail: (pending: number | null) => string
  readonly when: string
  /// Soon enough that a store opening next week is blocked by it.
  readonly urgent?: boolean
  /// Where it is done. None yet for the two whose screens do not exist.
  readonly to?: string
  /// Or the sheet it is done in, over this page.
  readonly sheet?: "company"
}

const TASKS: Record<SetupTaskId, TaskCopy> = {
  team: {
    title: "Invite your team",
    detail: () =>
      "Finance, the warehouse, and a supervisor for each store. Cashiers sign in on the store's own devices.",
    when: "before stores open",
    urgent: true,
    to: "/system/access",
  },
  store_nodes: {
    title: "Pair the store servers",
    detail: (pending) =>
      pending
        ? `${pending} ${pending === 1 ? "store is" : "stores are"} waiting — enter the pairing code on each store's server.`
        : "Enter the pairing code on each store's server.",
    when: "before stores open",
    urgent: true,
    to: "/stores",
  },
  payments: {
    title: "Turn on QRIS & debit",
    detail: () =>
      "Register a QRIS merchant and EDC terminals for each store. Cash already works.",
    when: "before stores open",
    urgent: true,
    to: "/finance/setup/shop-payment-methods",
  },
  store_addresses: {
    title: "Complete store addresses",
    detail: (pending) =>
      pending
        ? `Street and number for delivery notes to ${pending} ${pending === 1 ? "store" : "stores"}.`
        : "Street and number for delivery notes.",
    when: "before the first delivery",
    to: "/locations",
  },
  bank_accounts: {
    title: "Add bank accounts",
    detail: () => "For store deposits and paying suppliers.",
    when: "before paying suppliers",
    to: "/finance/cash-bank/bank-accounts",
  },
  tax_id: {
    title: "Add NPWP",
    detail: () => "Printed on purchase orders and invoices.",
    when: "before the first PO",
    sheet: "company",
  },
  opening_balances: {
    title: "Enter opening balances",
    detail: () =>
      "Only when moving from other software — balances, stock, payables.",
    when: "optional",
  },
}

const ORDER = Object.keys(TASKS) as SetupTaskId[]

const HIDDEN_KEY = "central.hub.setup-card-hidden"

export function SetupCard({ className }: { className?: string }) {
  const setup = useSetupStatus()
  const company = useSheet("company")
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) === "1"
    } catch {
      return false
    }
  })

  // No endpoint, no permission, or still asking: the brief is the page, and
  // a card that flickers in or apologises would be noise on top of it.
  const status = setup.data
  if (status === undefined) return null

  if (!status.finished) {
    return (
      <Card className={cn("flex items-center gap-4 px-5 py-4", className)}>
        <div className="min-w-0 flex-1">
          <b className="block text-card-title font-semibold text-ink">
            Setup is not finished
          </b>
          <p className="text-meta text-body">
            Three questions — the business, its stores and the books — before
            the stores can sell.
          </p>
        </div>
        <Button variant="primary" onClick={() => deferSetup(false)}>
          Continue setup
        </Button>
      </Card>
    )
  }

  // In this app's order, and only the ones it has words for.
  const tasks = ORDER.flatMap((id) => {
    const task = status.tasks.find((one) => one.id === id)
    return task ? [{ task, copy: TASKS[id] }] : []
  })
  const done = tasks.filter(({ task }) => task.done).length
  if (tasks.length === 0 || done === tasks.length || hidden) return null

  const hide = () => {
    try {
      localStorage.setItem(HIDDEN_KEY, "1")
    } catch {
      // Hidden until the next reload, then.
    }
    setHidden(true)
  }

  return (
    <>
      <Card className={cn("max-w-180 overflow-hidden", className)}>
        <div className="flex items-center gap-3.5 border-b border-hairline px-4.5 py-4">
          <Ring share={done / tasks.length} />
          <div className="min-w-0 flex-1">
            <b className="block text-card-title font-semibold text-ink">
              Get the stores ready to open
            </b>
            <p className="text-meta text-body">
              {done} of {tasks.length} done · each row opens its screen
            </p>
          </div>
          <Button variant="quiet" size="sm" onClick={hide}>
            Hide
          </Button>
        </div>
        {tasks.map(({ task, copy }) => (
          <TaskRow
            key={task.id}
            task={task}
            copy={copy}
            onOpen={
              copy.sheet === "company" ? () => company.open(true) : undefined
            }
          />
        ))}
      </Card>
      <CompanySheet
        company={status.company}
        open={company.isOpen}
        onClose={company.close}
      />
    </>
  )
}

function TaskRow({
  task,
  copy,
  onOpen,
}: {
  task: SetupTask
  copy: TaskCopy
  onOpen?: () => void
}) {
  const body = (
    <>
      <span
        className={cn(
          "grid size-5.5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors duration-(--t-panel)",
          task.done ? "border-ok bg-ok text-cta-fg" : "border-hairline-strong"
        )}
      >
        {task.done && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <b
          className={cn(
            "block text-cell",
            task.done
              ? "font-medium text-mute line-through decoration-faint"
              : "font-semibold text-ink"
          )}
        >
          {copy.title}
        </b>
        {!task.done && (
          <span className="block text-meta text-body">
            {copy.detail(task.pending)}
          </span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-meta whitespace-nowrap max-sm:hidden",
          !task.done && copy.urgent ? "text-warn-fg" : "text-mute"
        )}
      >
        {task.done ? "done" : copy.when}
      </span>
      {(copy.to !== undefined || onOpen !== undefined) && !task.done && (
        <ChevronRight className="size-4 shrink-0 text-line-ico" />
      )}
    </>
  )
  const row =
    "flex items-center gap-3.5 border-b border-hairline px-4.5 py-3.5 last:border-b-0"
  if (onOpen !== undefined && !task.done) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(row, "w-full text-left transition-colors hover:bg-soft")}
      >
        {body}
      </button>
    )
  }
  return copy.to !== undefined && !task.done ? (
    <AppLink
      to={copy.to}
      className={cn(row, "transition-colors hover:bg-soft")}
    >
      {body}
    </AppLink>
  ) : (
    <div className={row}>{body}</div>
  )
}

/// How far along, as a ring — the one figure on the card, read before the
/// rows.
function Ring({ share }: { share: number }) {
  const round = 100.53 // 2π × 16
  return (
    <svg
      viewBox="0 0 40 40"
      className="size-10 shrink-0 -rotate-90"
      aria-hidden
    >
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        className="stroke-hairline-2"
        strokeWidth="4"
      />
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        className="stroke-ok transition-[stroke-dashoffset] duration-(--t-sheet) ease-(--ease-out)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={round}
        strokeDashoffset={round * (1 - share)}
      />
    </svg>
  )
}
