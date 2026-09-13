import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/// The one class joiner — and the one place `text-*` is disambiguated.
///
/// `twMerge` is what lets a component's classes be overridden from the outside
/// without a specificity fight. It only works if it knows this app's scale,
/// which is why it is extended rather than used stock.
///
/// **The failure this prevents is silent, and it has already happened once.**
/// `text-*` is ambiguous in Tailwind — it is both font-size and text-colour —
/// and stock `twMerge` resolves an unknown name against Tailwind's OWN scale.
/// A name it does not recognise is guessed to be a colour, so
/// `cn("text-ctl", "text-black")` decides the two are rival colours, keeps one,
/// and throws the other away. Nothing warns. Nothing fails to compile. The
/// button is simply black text on a black fill, and the bug looks like a
/// rendering problem rather than a class problem.
///
/// So: **every token added to `@theme` in `styles/index.css` is added to one of
/// the two lists below.** They are next to each other so they are read
/// together and a name cannot quietly join both.

/// The sizes that live in the `text-*` namespace.
const TYPE_SCALE = ["title", "metric", "cell", "ctl", "meta", "label"] as const

/// The colours that live in the `text-*` namespace.
const TEXT_COLOURS = [
  "ink",
  "ink-2",
  "ink-3",
  "ink-4",
  "canvas",
  "side",
  "rail",
  "hover",
  "field",
  "line",
  "line-2",
  "black",
  "black-hover",
  "blue",
  "blue-soft",
  "ok",
  "ok-ink",
  "ok-wash",
  "warn",
  "warn-ink",
  "warn-wash",
  "bad",
  "bad-ink",
  "bad-wash",
  "info",
  "info-ink",
  "info-wash",
  "c-blue",
  "c-sky",
  "c-amber",
  "c-green",
  "c-pink",
  "c-violet",
] as const

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_SCALE] }],
      "text-color": [{ text: [...TEXT_COLOURS] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
