import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

/// The fingerprint scanner on HR's PC, reached through the Central desktop app.
///
/// The shell (`desktop/src-tauri/src/fingerprint.rs`) exposes
/// `window.itulahDesktop.scanner` to the hub's own origin and nothing else; a
/// plain browser, and a Central older than the scanner, have no such member,
/// and every caller reads that as "not here". Each press of an enrolment is
/// announced on `window` as a `central-fingerprint` event.

export interface ScannerStatus {
  readonly connected: boolean
  /// The shell's sentence for why it is not, in its own words.
  readonly problem: string | null
}

/// Three presses merged by the vendor's SDK. `quality` is `null` when the
/// scanner gave no score — never zero.
export interface CapturedFinger {
  readonly template_hex: string
  readonly quality: number | null
}

/// One press, as the shell announces it.
export interface ScannerPress {
  readonly presses: number
  readonly needed: number
  readonly message: string
}

export interface ScannerBridge {
  status(): Promise<ScannerStatus>
  capture(): Promise<CapturedFinger>
  cancel(): Promise<void>
}

const PRESS_EVENT = "central-fingerprint"

/// What to say when this page is not in Central on the HR PC.
export const OFF_THE_HR_PC =
  "Enrol on the HR PC in the Central app, with the scanner plugged in."

function bridgeOf(): ScannerBridge | null {
  if (typeof window === "undefined") return null
  const desktop = (
    window as unknown as { itulahDesktop?: { scanner?: ScannerBridge } }
  ).itulahDesktop
  return desktop?.scanner ?? null
}

/// The shell refuses with its own sentence, as a bare string.
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

const unchanging = () => () => {}

/// The scanner as this page can reach it.
///
/// `bridge` is `null` outside the desktop app and on the server render.
/// `blocked` is the one line that says why Enrol is off, `null` once the
/// scanner answers. Asked again every five seconds while it is not connected,
/// so plugging it in turns Enrol on without a reload.
export function useScanner(wanted: boolean) {
  const bridge = useSyncExternalStore(unchanging, bridgeOf, () => null)
  const status = useQuery({
    queryKey: ["desktop", "scanner"],
    queryFn: async () => {
      try {
        return await bridge!.status()
      } catch (error) {
        throw asError(error)
      }
    },
    enabled: wanted && bridge !== null,
    refetchInterval: (query) =>
      query.state.data?.connected === true ? false : 5_000,
  })
  const blocked =
    bridge === null
      ? OFF_THE_HR_PC
      : status.data === undefined
        ? status.isError
          ? (status.error?.message ?? OFF_THE_HR_PC)
          : null
        : status.data.connected
          ? null
          : (status.data.problem ?? OFF_THE_HR_PC)
  return {
    bridge,
    ready: bridge !== null && status.data?.connected === true,
    blocked,
    recheck: () => void status.refetch(),
  }
}

/// Three presses of one finger, with each press handed to `onPress` as it
/// lands.
export async function captureFinger(
  bridge: ScannerBridge,
  onPress: (press: ScannerPress) => void
): Promise<CapturedFinger> {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ScannerPress | undefined>).detail
    if (detail) onPress(detail)
  }
  window.addEventListener(PRESS_EVENT, listener)
  try {
    return await bridge.capture()
  } catch (error) {
    throw asError(error)
  } finally {
    window.removeEventListener(PRESS_EVENT, listener)
  }
}
