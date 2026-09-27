import { useEffect, useState } from "react"

import { Banner } from "@/components/ui/states"

/// What a cashier needs to know about the shop's server, and nothing else.
///
/// Three moments from the store-server work (STORE-SERVER-PLAN §4), each a
/// sentence rather than a spinner:
///
/// - the node is restarting — a few seconds, the basket is safe here;
/// - the node is holding back after repeated failures — it says until when,
///   in its own words (the 503 `CRASH_LOOP_HOLD` answer from `edge/node.rs`);
/// - the mains is off and the UPS carries the node — and when the battery is
///   nearly flat, finish the sale in hand now (`power` in `/api/v1/health`).
///
/// Read from `/api/v1/health`, which needs no session, so it works on the
/// login screen too. Silent when all is well.

type Status =
  | { kind: "ok" }
  | { kind: "reconnecting"; since: number }
  | { kind: "holding"; message: string }
  | {
      kind: "battery"
      low: boolean
      charge: number | null
      runtime: number | null
    }

interface Health {
  power?: {
    source: "MAINS" | "BATTERY" | "UNKNOWN"
    charge_percent: number | null
    runtime_seconds: number | null
    low: boolean
  } | null
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  return `${m} min`
}

export function ServerStatus() {
  const [status, setStatus] = useState<Status>({ kind: "ok" })
  const [, tick] = useState(0)

  useEffect(() => {
    let failures = 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    const check = async () => {
      let next: Status = { kind: "ok" }
      try {
        const response = await fetch("/api/v1/health", {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        })
        if (response.status === 503) {
          const body = (await response.json().catch(() => ({}))) as {
            state?: string
            message?: string
          }
          failures = 0
          next =
            body.state === "CRASH_LOOP_HOLD" && body.message
              ? { kind: "holding", message: body.message }
              : { kind: "reconnecting", since: Date.now() }
        } else if (response.ok) {
          failures = 0
          const health = (await response.json()) as Health
          const power = health.power
          if (power && power.source === "BATTERY") {
            next = {
              kind: "battery",
              low: power.low,
              charge: power.charge_percent,
              runtime: power.runtime_seconds,
            }
          }
        } else {
          failures += 1
        }
      } catch {
        failures += 1
      }
      // One missed answer is a blip; two in a row is the node away.
      if (failures >= 2) {
        setStatus((current) =>
          current.kind === "reconnecting"
            ? current
            : { kind: "reconnecting", since: Date.now() },
        )
      } else if (failures === 0) {
        setStatus(next)
      }
      if (!stopped) {
        timer = setTimeout(
          check,
          failures > 0 || next.kind !== "ok" ? 3000 : 10000,
        )
      }
    }
    void check()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  // Keep "N s so far" moving while reconnecting.
  useEffect(() => {
    if (status.kind !== "reconnecting") return
    const interval = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [status.kind])

  if (status.kind === "ok") return null

  const content =
    status.kind === "reconnecting" ? (
      <Banner tone="info" role="status">
        <span>
          <strong className="font-medium">
            Reconnecting to the store server…
          </strong>{" "}
          This basket is safe on this device; carry on once it is back (
          {Math.round((Date.now() - status.since) / 1000)} s so far).
        </span>
      </Banner>
    ) : status.kind === "holding" ? (
      <Banner tone="bad" role="alert">
        <span>
          <strong className="font-medium">The store server has paused.</strong>{" "}
          {status.message}
        </span>
      </Banner>
    ) : status.low ? (
      <Banner tone="bad" role="alert">
        <span>
          <strong className="font-medium">
            UPS battery almost flat — finish the sale now.
          </strong>{" "}
          The server will shut down cleanly soon and start again on its own when
          the power is back.
        </span>
      </Banner>
    ) : (
      <Banner tone="warn" role="status">
        <span>
          <strong className="font-medium">
            Power cut — the server is running on the UPS.
          </strong>{" "}
          {status.runtime !== null
            ? `About ${minutes(status.runtime)} left.`
            : status.charge !== null
              ? `Battery at ${status.charge} %.`
              : "Sales carry on as normal."}
        </span>
      </Banner>
    )

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="pointer-events-auto w-full max-w-xl shadow-lg">
        {content}
      </div>
    </div>
  )
}
