import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { TintButton } from "@/components/ui/tint-button"
import { Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { koliEpcs, rfidKeys, verifyRfid } from "@/lib/operations/rfid"
import { toast } from "@/lib/toast"

export interface VerifyKoli {
  readonly id: string
  readonly label: string
  readonly code: string
  readonly store: string
}

/// **Verify RFID** (owner, 21 Oct 2026): the koli ticked on the Packed tab,
/// read by the handheld. The handheld types each tag it reads into the field
/// and presses Enter (or a list is pasted); every koli shows how many of its
/// own tags were read. Save keeps the check of each: a koli whose every tag
/// was read is Verified.
export function RfidVerifySheet({
  koli,
  open,
  onClose,
}: {
  koli: readonly VerifyKoli[]
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set())
  const lists = useQueries({
    queries: koli.map((one) => ({
      queryKey: rfidKeys.epcs(one.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => koliEpcs(one.id, signal),
      enabled: open,
    })),
  })
  const own = new Set(
    lists.flatMap((list) => (list.data?.epcs ?? []).map((one) => one.epc))
  )
  const total = own.size
  const read = [...seen].filter((epc) => own.has(epc)).length
  const extra = [...seen].filter((epc) => !own.has(epc)).length
  const loading = lists.some((list) => list.isPending)

  /// A simulated read (owner, 21 Oct 2026: "verify rfid dibuat simulasi saja
  /// dlu"): Scan reads the chosen koli's own tags one by one, as a handheld
  /// sweeping them would, until every one is in.
  ///
  /// A simulation is never saved (owner, 21 Oct 2026: "Simulasi tidak
  /// disimpan"). It feeds in the koli's own list, so saving it would record a
  /// koli as Verified without one tag having been read; Verified comes only
  /// from real reads.
  const [scanning, setScanning] = useState(false)
  const [simulated, setSimulated] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const stop = () => {
    if (timer.current !== null) clearInterval(timer.current)
    timer.current = null
    setScanning(false)
  }
  useEffect(() => stop, [])
  const scan = () => {
    const left = [...own].filter((epc) => !seen.has(epc))
    if (left.length === 0) return
    setScanning(true)
    setSimulated(true)
    const step = Math.max(1, Math.ceil(left.length / 25))
    timer.current = setInterval(() => {
      const next = left.splice(0, step)
      if (next.length === 0) return stop()
      setSeen((was) => new Set([...was, ...next]))
    }, 60)
  }

  const save = useMutation({
    mutationFn: () =>
      verifyRfid({ koli_ids: koli.map((one) => one.id), epcs: [...seen] }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: keys.dc.all })
      const ok = result.items.filter((one) => one.verified_at !== null).length
      const short = result.items.length - ok
      toast.success(
        short === 0
          ? `${count(ok)} koli verified`
          : `${count(ok)} verified · ${count(short)} with tags not read`
      )
      setSeen(new Set())
      setSimulated(false)
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          stop()
          setSeen(new Set())
          setSimulated(false)
          onClose()
        }
      }}
      context="Packed"
      title={`Verify RFID · ${count(koli.length)} koli`}
      size="table"
      footer={
        <div className="flex w-full items-center gap-3">
          <span className="text-[0.9375rem] text-mute tabular-nums">
            {`${count(read)} of ${count(total)} read`}
            {extra > 0 && ` · ${count(extra)} not in these koli`}
            {simulated && " · simulation, not saved"}
          </span>
          <div className="ml-auto">
            <Button
              variant="ghost"
              disabled={seen.size === 0 || scanning}
              onClick={() => {
                setSeen(new Set())
                setSimulated(false)
              }}
            >
              Clear
            </Button>
          </div>
          <div>
            <Button
              variant="primary"
              disabled={seen.size === 0 || loading || scanning || simulated}
              pending={save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {koli.map((one, index) => {
            const tags = lists[index]?.data?.epcs ?? []
            const got = tags.filter((tag) => seen.has(tag.epc)).length
            const full = tags.length > 0 && got === tags.length
            return (
              <span
                key={one.id}
                className="inline-flex items-center gap-2 rounded-[9px] border border-hairline px-3 py-1.5"
              >
                <span className="font-semibold text-ink">{one.label}</span>
                <span className="text-mute">
                  {one.code} · {one.store.split(" · ")[0]}
                </span>
                <span
                  className={
                    full
                      ? "font-semibold text-ok-fg tabular-nums"
                      : "text-body tabular-nums"
                  }
                >
                  {lists[index]?.isPending
                    ? "…"
                    : `${count(got)}/${count(tags.length)}`}
                </span>
                {full && <Check className="size-4 text-ok-fg" aria-hidden />}
              </span>
            )
          })}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-[2.25rem] leading-none font-bold text-ink tabular-nums">
            {count(read)}
          </span>
          <span className="text-body tabular-nums">
            of {count(total)} tags
          </span>
        </div>

        <div>
          <TintButton
            tone="ok"
            disabled={loading || scanning || (total > 0 && read === total)}
            onClick={scan}
          >
            {scanning
              ? "Scanning…"
              : read === 0
                ? "Scan"
                : read === total
                  ? "Every tag read"
                  : "Scan again"}
          </TintButton>
        </div>

        <Problem error={save.error} />
      </div>
    </Sheet>
  )
}
