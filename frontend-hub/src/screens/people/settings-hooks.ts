import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { orgKeys } from "@/lib/queries/people"

/// A sheet that opens on one row, or on nothing (a new one).
///
/// `id` changes with every opening, so a sheet keyed by it starts from the
/// row's own values — and from empty boxes for a new one — instead of keeping
/// whatever the last opening left in its fields. `target` outlives the close,
/// so the sheet can finish its exit animation still showing what it showed.
export function useSheetTarget<T>() {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<{ id: number; row: T | null }>({
    id: 0,
    row: null,
  })
  return {
    open,
    target,
    show: (row: T | null) => {
      setTarget((last) => ({ id: last.id + 1, row }))
      setOpen(true)
    },
    close: () => setOpen(false),
  }
}

/// Retire a code (department, level, grade) — and the org chart, which
/// draws all three.
export function useRetire(
  retire: (code: string, reason: string) => Promise<unknown>,
  key: readonly string[]
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ code, reason }: { code: string; reason: string }) =>
      retire(code, reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key })
      void client.invalidateQueries({ queryKey: orgKeys.chart() })
    },
  })
}

/// Digits only, or nothing — a pay-band edge left empty is "no limit".
export function figure(text: string): number | null {
  const digits = text.replace(/\D/g, "")
  return digits === "" ? null : Number(digits)
}

export const RELATIONS = [
  { value: "HOLDING", label: "Holding" },
  { value: "SUBSIDIARY", label: "Subsidiary" },
  { value: "AFFILIATE", label: "Affiliate" },
]

export const CHECKLIST_KINDS = [
  { value: "ONBOARDING", label: "Onboarding" },
  { value: "SEPARATION", label: "Offboarding" },
]

export const ESS_MODULES = [
  { value: "ATTENDANCE", label: "Attendance — clocking in and out" },
  { value: "CORRECTION", label: "Attendance corrections" },
  { value: "SWAP", label: "Roster swaps" },
  { value: "LEAVE", label: "Leave" },
  { value: "OVERTIME", label: "Overtime" },
  { value: "PAY", label: "Pay and payslips" },
  { value: "CLAIMS", label: "Expense claims" },
]
