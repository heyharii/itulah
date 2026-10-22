# UI consistency for frontend-hub

For UI work in this directory, read these before editing:

1. `design-system/README.md`: the Central design system, extracted from the live hub. It holds the tokens, page and sheet anatomy, words and formats, motion, phone, the 36 component cards (`design-system/components/<Name>.md`), and the Retired list of drift still in the code.
2. `UI-PATTERNS.md`: the owner's visual decisions, written in Indonesian.
3. `PATTERN.md`: implementation, data, routing and existing primitives.

Where they disagree on a visual rule, the design system wins. Direct user instructions take precedence over all of them.

- Before you change a shared component, read its card in `design-system/components/`. Before you touch a screen, check `design-system/06-retired.md` for the drift it still carries, and remove what you fix.
- When a token or a kit component changes, update `design-system/` in the same change, then run `node scripts/design-tokens-css.mjs`.
- Choose the closest existing page pattern before creating a layout: list, detail, create/edit form, dashboard/report, board/matrix, or workspace.
- Pages with similar jobs should reuse the same pattern and shared components. Different jobs may use different layouts while keeping the same visual foundation and interaction behavior.
- Keep common typography, spacing, action styling, sheet anatomy, responsive behavior, and states in their shared owners. Do not fix common inconsistencies through screen-specific CSS overrides.
- Main actions use filled primary blue. Supporting actions (Filter, Columns, Print, Close, and row edit/delete controls) use neutral ghost styling: dark text/icons, white background, subtle grey hover. Cancel is filled red. Navigation and selection retain their semantic components.
- UI text has a 15 px minimum (owner, 14 Oct 2026), and body text is 15 px. Make a quieter line quieter by colour or weight, never by size. Only printed papers may be smaller.
- Explain a new structural variation through the user's work. Promote repeated variations to a shared component when appropriate.
- Validate changed shared primitives against representative consumers and relevant desktop/tablet/mobile views. Automated checks do not replace visual review.
- Report existing adoption gaps honestly. Do not claim the whole frontend is consistent merely because documentation or one prototype changed.
