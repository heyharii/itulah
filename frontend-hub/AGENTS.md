# UI consistency for frontend-hub

For UI work in this directory, read `UI-PATTERNS.md` and `PATTERN.md` before editing. `UI-PATTERNS.md` contains the latest visual decisions; `PATTERN.md` describes implementation, data, routing, and existing primitives. Direct user instructions take precedence.

- Choose the closest existing page pattern before creating a layout: list, detail, create/edit form, dashboard/report, board/matrix, or workspace.
- Pages with similar jobs should reuse the same pattern and shared components. Different jobs may use different layouts while keeping the same visual foundation and interaction behavior.
- Keep common typography, spacing, action styling, sheet anatomy, responsive behavior, and states in their shared owners. Do not fix common inconsistencies through screen-specific CSS overrides.
- Main actions use filled primary blue. Supporting actions (Filter, Columns, Print, Close, and row edit/delete controls) use neutral ghost styling: dark text/icons, white background, subtle grey hover. Cancel is filled red. Navigation and selection retain their semantic components.
- UI text has a 14 px minimum; standard body is 15 px. Use the shared scale and preserve readability on narrow screens.
- Explain a new structural variation through the user's work. Promote repeated variations to a shared component when appropriate.
- Validate changed shared primitives against representative consumers and relevant desktop/tablet/mobile views. Automated checks do not replace visual review.
- Report existing adoption gaps honestly. Do not claim the whole frontend is consistent merely because documentation or one prototype changed.
