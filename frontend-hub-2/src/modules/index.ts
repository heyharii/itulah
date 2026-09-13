import type { Module } from "@/lib/nav"
import { commercialNav } from "@/modules/commercial/nav"
import { financeNav } from "@/modules/finance/nav"
import { peopleNav } from "@/modules/people/nav"

/// The rail, top to bottom.
///
/// The order this ends up in is the reading order of the business — what is
/// bought, what is held, what is sold, what it cost, who did it — so People
/// sits last, and will keep sitting last as the modules between them arrive.
///
/// Finance was written first because it has the most SHAPES in it: a money
/// table, a reconciliation, an import form, a ledger. A module that only listed
/// things would have taught the kit less. People was written second for the
/// opposite reason — it is mostly lists, against endpoints that page, search
/// and sort nothing, which is what turned `lib/list.ts`'s two hooks and
/// `kit/state.tsx`'s six states from a design into a requirement.
///
/// Commercial came third. It taught the kit a third thing: an endpoint that is
/// neither of `lib/list.ts`'s two shapes. Not one route on
/// `/api/v1/commercial/*` has a cursor, and most of them answer a single object
/// with an `items` key rather than either a page or a bare array — so every
/// screen in it reads through `useReport`, and each one says on the page what
/// its endpoint cannot do.
///
/// **It is placed second and not first, and that is a decision rather than an
/// oversight.** The reading order above would put what is sold ahead of what it
/// cost. But `/` is not a screen: `src/router.tsx` redirects it to
/// `itemsOf(modules[0])[0]`, so moving a module to the top silently moves the
/// application's landing page — which is a change somebody should make on
/// purpose, having looked at it, and not one that arrives as a side effect of
/// adding a module. Finance keeps the front door until then.
export const modules: readonly Module[] = [financeNav, commercialNav, peopleNav]
