// What every suite shares: where the `agentic` rig listens, who signs in, and
// the model behind the agent steps. The configs (hub/store/till) import this.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { anthropic } from '@ai-sdk/anthropic';

// ANTHROPIC_API_KEY lives in e2e/agentic/.env (gitignored); e2e loads no .env
// of its own, and every worker re-imports the config, so it is loaded here.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Where the Gudang runs. The owner's choice for this rig (10 Oct 2026) is the
 * cloud, like the demo and the sandbox: the DC's routes (`/api/v1/dc/…`) are
 * served by the cloud itself. `edge` is the older shape, a DC node on :8581.
 * Set here so every worker and every `test.skip(RIG_DC_HOSTING …)` sees it.
 */
process.env.RIG_DC_HOSTING ??= 'cloud';
export const DC_HOSTING = process.env.RIG_DC_HOSTING === 'edge' ? 'edge' : 'cloud';

/** The `agentic` rig (e2e/agentic/provision.sh) — never the pos-e2e rig on 848x. */
const cloudUrl = process.env.RIG_CLOUD ?? 'http://127.0.0.1:8580';
export const RIG = {
  cloud: cloudUrl,
  dc: process.env.RIG_DC ?? (DC_HOSTING === 'cloud' ? cloudUrl : 'http://127.0.0.1:8581'),
  store: process.env.RIG_STORE ?? 'http://127.0.0.1:8582',
};

/** Every demo person signs in with this on the rig. */
export const PASSWORD = process.env.RIG_PASSWORD ?? 'Password01';

/** The Vite servers in front of the rig: hub (Central), store app, web till. */
export const PORTS = {
  hub: Number(process.env.RIG_HUB_PORT ?? 5580),
  store: Number(process.env.RIG_STORE_PORT ?? 5582),
  till: Number(process.env.RIG_TILL_PORT ?? 5584),
};

/**
 * The demo people (scripts/demo-seed.sh):
 *  rina  — head office, ADMIN: buyer, raises POs, reviews counts, MD, marketing
 *  nina  — DC, OPERATIONS: counts deliveries (the checker)
 *  yusuf — DC, OPERATIONS: head of the DC, invoices, dispatch
 *  maya  — store-01 manager (store app)
 *  dian  — store-01 cashier (till)
 *  admin — bootstrap administrator
 */
export const PEOPLE = ['rina', 'nina', 'yusuf', 'maya', 'dian', 'admin'] as const;
export type Person = (typeof PEOPLE)[number];

const CONTEXT = [
  'The app is Central, the head-office system of an Indonesian fashion retailer with 16 stores and one DC (distribution centre, "Gudang").',
  'Money is Indonesian Rupiah, written "Rp 1.234.567" (dots group thousands). Dates are written with the year.',
  'PO = purchase order to a supplier. Receiving = the DC counts a delivery blind; the buyer then reviews the count on the PO.',
  'Return PO = goods sent back to the supplier (excess or Not as Ordered pieces). Allotment = sending DC stock to stores.',
  'Use the labels exactly as the screen shows them. Never sign out. Never change settings that the goal does not name.',
].join(' ');

export const agents = {
  default: {
    // Haiku first (Hari, 9 Oct); E2E_MODEL=claude-sonnet-5-5 for flows Haiku cannot drive.
    model: anthropic(process.env.E2E_MODEL ?? 'claude-haiku-5-5'),
    judge: anthropic(process.env.E2E_JUDGE ?? 'claude-haiku-5-5'),
    context: CONTEXT,
  },
};

export const viewports = {
  desk: { width: 1440, height: 900 },
  // Hari's phone baseline (iPhone XR).
  phone: { width: 414, height: 896 },
};
