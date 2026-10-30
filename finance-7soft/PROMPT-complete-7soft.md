# Prompt: make the Central finance prototype cover everything 7Soft has

Give this to one agent **per group**. Replace `{GROUP}` with one row of the table. Run one group at a time.

| {GROUP} | Screen ids | Central file | 7Soft copy (read only) | Decisions file |
|---|---|---|---|---|
| cash | kas-info, kas-report, giro-board | `scr-cash.js` (giro-board: design 9 in `/Users/hari/Documents/itulah/bkm-bkk-prototype.html`) | `scr7-cash.js` | `decide-cash.js` |
| gl | gl-info, gl-journal, gl-closing, report-acc | `scr-gl.js` | `scr7-gl.js` | `decide-gl.js` |
| buy | buy-info, buy-invoice, buy-return, buy-reports | `scr-buy.js` | `scr7-buy.js` | `decide-buy.js` |
| sell | sell-info, sell-cash, sell-invoice, sell-return, sell-reports | `scr-sell.js` | `scr7-sell.js` | `decide-sell.js` |
| setup | coa-master, coa-opening, coa-links, setup-switches, parties, assets, users, history | `scr-setup.js` | `scr7-setup.js` | `decide-setup.js` (started — finish it) |

---

## The prompt

You are completing one group of screens in a plain-HTML prototype of a finance module, **"Central"**, that replaces the client's old accounting app **7Soft**. The owner wants every 7Soft element accounted for: nothing silently dropped.

**Your group: {GROUP}.**

### Read first
All paths are under `/Users/hari/Documents/itulah/finance-7soft/` unless absolute.
1. `base.js`: the helper API (`reg`, `page`, `table`, `chips`, `search`, `bar`, `field`, `input`, `select`, `section`, `openSheet`, `toast`, `money`, `day`, `btn`, `pill`, `S.tab`/`S.f`, `setTab`/`setFilt`/`tabOf`/`filt`, `render`) and `base.css`.
2. `data-coverage.js`: `COVER['<id>'].miss` lists what the Central screen is known to lack versus 7Soft.
3. Your **7Soft copy** file: the 7Soft screen's content (fields, columns, tabs, buttons, reports) as the manual shows it.
4. Your **Central file**: the screens you will change.
5. The 7Soft manual:
   - Text: `manual-7soft.txt`, split by `=====PAGE N=====`, where N is the PDF page and the printed page ≈ N − 6.
   - Real screenshots per menu: `/Users/hari/Documents/itulah/7soft-ref/manual/` (the list per screen id is in `data-manual.js`). Look at them.
6. Design rules: `/Users/hari/Documents/itulah/frontend-hub/design-system/README.md`.

### Step 1: audit and decide
Compare, element by element, the 7Soft copy (and the manual) with the Central screen. Cover every tab, column, field, tick, radio, button, status, report, right-click menu and behaviour. For each element the Central screen lacks or only partly has, decide one of:
- **keep**: add it as 7Soft has it.
- **improve**: add it, but the better Central way. Say how in 12 words or fewer.
- **drop**: only for pure 7Soft technical leftovers, such as:
  - Format / Default / DBF buttons
  - First / Prior / Next / Last paging (Central uses keyboard ↑/↓)
  - form-size options, Note for Today, menu pictures, a password shown on screen
  
  Give the reason and end the note with "· client to confirm".

Notes for specific groups:
- **Reports the client used (item-level, PO, SO, commission): keep.** Render them from the screen's own demo data.
- **sell group:** Central's chart of accounts has no customer receivable. Keep or improve credit-sales elements anyway, and append "· only if the client sells on credit".

Write every decision to your decisions file, exactly in this shape:
```js
;var DECIDE = window.DECIDE || (window.DECIDE = {});
DECIDE['<screen id>'] = [['7Soft element', 'keep|improve|drop', 'note'], …];
```

### Step 2: build
Implement every **keep** and **improve** in your **Central file** only. Never edit the 7Soft copy (`scr7-*`), `base.js` or other groups' files. Typical items:
- a from–to date range and "Sampai tanggal"
- Refresh where data can change
- Keterangan in the header and per line
- Lokasi / Gudang / No Ref
- discount in Rp or %
- READ ONLY once posted or paid
- Print and Excel export (a toast for the export is fine)
- stock info and price history from a line
- the missing tabs and reports

Keep the screen's existing data consistent. Its totals must still tie (payables to `SUPPLIERS[].hutang`, receivables to `CUSTOMERS[].piutang`, trial balance and balance sheet balanced).

### Design rules (the owner's, non-negotiable)
- English UI.
- Text is never smaller than 15px.
- Every action button is solid primary. No grey, outlined or tinted secondary buttons.
- Calm tables: one size, one figure per cell, colour only for a real problem.
- No filler copy: no explanatory subtitles, notes or footnotes.
- Page order: head → KPI strip → tabs → bar (search + filter chips) → table → footer.

### Code rules
- Your file is one IIFE that starts with `;(() => {` and ends with `})();`.
- Any function used in an inline `onclick` goes on `window`.
- Escape data with `esc()`.
- Today is 2026-10-27. October 2026 is open; September is closed.
- Another session may edit files in this folder. Re-read a file right before each edit and keep edits surgical.

### Verify
```bash
python3 /Users/hari/Documents/itulah/finance-7soft/build.py
```
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('/Users/hari/Documents/itulah/finance-7soft-prototype.html','utf8');const m=h.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('ok')"
```
Then open `http://localhost:5404/finance-7soft-prototype.html#<screen id>` (a static server on :5404 serves the repo root). Check every tab of every screen in your group:
- no console errors
- nothing undefined or NaN on screen
- totals still tie

### Report back (≤120 words)
- Per screen id: the counts of keep / improve / drop.
- Anything you could not build, and why.
- Anything you found that 7Soft has but the manual does not explain.
