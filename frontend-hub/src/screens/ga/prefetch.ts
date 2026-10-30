import type { PrefetchMap } from "@/lib/prefetch"

/// What GA asks first, before the screen is open (`lib/prefetch.ts`). The
/// options are the screen's own (`lib/queries/ga.ts`).

export const prefetch: PrefetchMap = {}
