import { useEffect, useState } from "react"

export interface Jump {
  id: number
  dir: 1 | -1
}

/// Notices the business instant leaping by more than `threshold` ms between
/// two renders — an Advance, Back to real time, or somebody else's jump seen
/// on the next poll — and says which way. `null` until one happens, and for
/// the first instant it ever sees.
export function useJump(ms: number | null, threshold: number): Jump | null {
  const [seen, setSeen] = useState<{ ms: number | null; jump: Jump | null }>({
    ms,
    jump: null,
  })
  if (seen.ms !== ms) {
    const delta = seen.ms === null || ms === null ? 0 : ms - seen.ms
    setSeen({
      ms,
      jump:
        Math.abs(delta) > threshold
          ? { id: (seen.jump?.id ?? 0) + 1, dir: delta > 0 ? 1 : -1 }
          : seen.jump,
    })
  }
  return seen.jump
}

/// True for `ms` after each jump — the stretch in which the virtual clock's
/// dust streaks and brightens (`ParticleField`'s `burst`). A jump already on
/// record when this mounts is old news and does not burst, so call it where
/// the clock is always mounted — then the first jump off the wall clock, which
/// is also when the field first appears, bursts too.
export function useBurst(jump: Jump | null, ms = 650): boolean {
  const id = jump?.id ?? 0
  const [spent, setSpent] = useState(id)
  const bursting = id !== spent
  useEffect(() => {
    if (!bursting) return
    const timer = window.setTimeout(() => setSpent(id), ms)
    return () => window.clearTimeout(timer)
  }, [bursting, id, ms])
  return bursting
}
