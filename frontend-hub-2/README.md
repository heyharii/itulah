# frontend-hub-2

The Central hub, written again. `frontend-hub` stays running until this replaces
it screen by screen; nothing here shares code with it.

    npm run dev        # http://localhost:5320, proxying /api to $VITE_API_TARGET
    npm run check      # typecheck · lint · design-lint · test — run this before pushing
    npm run build

The API it talks to:

    cd ../backend && DATABASE_URL=postgresql:///inventory_rfid \
      BIND_ADDR=127.0.0.1:8080 INVENTORY_AUTH_MODE=disabled \
      INVENTORY_NODE_ID=cloud-primary INVENTORY_NODE_ROLE=CLOUD \
      INVENTORY_ORIGIN_GENERATION=1 ./target/debug/cloud

## Where things are

    src/styles/index.css   the design system — every colour, size and radius
    src/lib/               cn, api, format, nav, table features, url state
    src/kit/               table, sheet, button, tag, field, tabs, figure
    src/shell/             rail · sidebar · content, and the three widths
    src/modules/<name>/    nav.tsx declares the screens; the screens sit beside it

## Four rules the code assumes

**Money is never divided.** `*_minor` from this backend is already whole rupiah —
IDR has no minor unit in practice. `lib/format.ts` says so at length, because it
has been got wrong once and every figure on the screen was a hundredth of itself.

**The server narrows the list.** Search, filters, sort and paging all go on the
wire. `lib/table.ts` registers no client-side sorted or filtered row model on
purpose: over a paged list they order the rows that happen to be loaded and leave
the rest, which looks like it worked.

**Every narrowing is in the URL.** So a filtered view is a link, Back undoes one
filter, and a reload keeps your place. See `lib/query-state.ts`.

**A new token goes in two places.** `styles/index.css` for the value and
`lib/cn.ts` for the name — `text-*` is both a size and a colour in Tailwind, and
`tailwind-merge` silently drops one of them if it has not been told which is
which. The symptom is a black button with invisible text.

`npm run design-lint` checks the four rules that break the language silently: a
raw px size, a hex colour, a fourth font weight, a dark overlay.
