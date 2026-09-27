import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/// The one class joiner, taught this app's scales.
///
/// `twMerge` is what lets a component's own classes be overridden from outside
/// without a specificity fight, but out of the box it only knows Tailwind's
/// stock names. Every size in `styles/index.css` is ours, so plain `twMerge`
/// files `text-nav` (a size) and `text-text` (a colour) under one group and
/// silently drops the first — which is exactly what happened: nav links lost
/// their size and the black CTA lost its white lettering and went unreadable.
/// Teaching it the two groups is the fix; leaving the default in place would
/// mean never writing a size and a colour on the same element.
///
/// `text-body` appears only under colours, because that is now all it is:
/// DESIGN.md gives the name to a size and a grey both, and the size was taken
/// out of Tailwind's namespace so the two could stop fighting — see the note
/// beside `--size-body` in `styles/index.css`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "title",
            "headline",
            "button",
            "tab",
            "code",
            "hero",
            "appbar",
            "card-title",
            "kpi",
            "points",
            "metric",
            "nav",
            "section",
            "eyebrow",
            "meta",
            "pill",
            "id",
          ],
        },
      ],
      "text-color": [
        {
          text: [
            "ink",
            "text",
            "body",
            "mute",
            "faint",
            "line-ico",
            "canvas",
            "on-dark",
            "accent",
            "info",
            "info-fg",
            "ok",
            "ok-fg",
            "warn",
            "warn-fg",
            "bad",
            "bad-fg",
            "new-fg",
            "cta-fg",
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
