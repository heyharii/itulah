import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/// The type scale, by name.
///
/// These have to be declared or `twMerge` cannot see them. `text-*` is
/// ambiguous in Tailwind — it is both font-size and text-colour — and the
/// stock config resolves it against Tailwind's OWN scale. A name it does not
/// recognise is guessed to be a colour, so `cn("text-card-title", "text-ink")`
/// decided the two were rival colours and threw the size away. Silently:
/// nothing warns, nothing fails, the heading is just the wrong size.
///
/// On this surface that is worse than an untidy heading. `text-total` is the
/// number a customer is asked for, and a screen that hands the total a colour
/// of its own would silently drop it from 32px to 14 — the same size as the
/// line items above it, on the one figure nobody may misread.
const TYPE_SCALE = [
  "hero",
  "title",
  "card-title",
  "kpi",
  "total",
  "metric",
  "nav",
  "section",
  "eyebrow",
  "control",
  "meta",
  "pill",
  "id",
  "cell",
] as const

/// The colours that live in the `text-*` namespace.
///
/// Declared for the same reason and in the same place, so the two lists are
/// read together and a name cannot quietly join both — which is exactly what
/// `body` did. `--text-body` and `--color-body` both compiled to `.text-body`,
/// Tailwind kept the colour, and the size token generated nothing at all. The
/// size is gone from `index.css` (it is `--size-body` now, outside the
/// namespace); `text-body` is a colour, and prose takes its size from the base
/// layer.
const TEXT_COLOURS = [
  "ink",
  "text",
  "body",
  "mute",
  "faint",
  "line-ico",
  "accent",
  "info",
  "ok",
  "warn",
  "bad",
  "ok-fg",
  "warn-fg",
  "bad-fg",
  "info-fg",
  "new-fg",
  "on-dark",
  "cta",
  "cta-fg",
  "cta-hover",
  "tooltip",
  "canvas",
  "soft",
  "soft-2",
  "soft-3",
  "dark",
  "a-orange",
  "a-green",
  "a-blue",
  "a-pink",
  "a-violet",
] as const

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_SCALE] }],
      "text-color": [{ text: [...TEXT_COLOURS] }],
    },
  },
})

/// The one class joiner.
///
/// `twMerge` is what makes a component's own classes overridable from the
/// outside without a specificity fight — but only if it knows this app's
/// scale, which is why it is extended above rather than used stock.
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
