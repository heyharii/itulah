// The web till (pos-desktop/ui, `npm run dev:web` = `vite --mode web`) against the `agentic` rig's store-01 node.
// The till keeps its token in sessionStorage, which e2e sessions do not carry, so tests sign in
// inside the test (support/pos.ts).
//   npx e2e run --config till.config.ts --output .e2e/out/till till
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { agents, PORTS, RIG, viewports } from './support/base.ts';

export default {
  projectId: 'itulah-till',
  tests: ['till/**/*.e2e.ts'],
  timeout: 240_000,
  // One till seat (KASIR-1) on the rig: tests of this config take turns on it.
  workers: 1,
  targets: [
    {
      name: 'till',
      engine: web({ viewport: viewports.desk, timezoneId: 'Asia/Jakarta', locale: 'en-GB' }),
      app: {
        url: `http://127.0.0.1:${PORTS.till}`,
        command: {
          executable: 'node',
          args: ['node_modules/vite/bin/vite.js', '--mode', 'web', '--port', String(PORTS.till), '--strictPort', '--host', '127.0.0.1'],
          cwd: '../../pos-desktop/ui',
          // `npm run dev:web` is `vite --mode web`; VITE_API_TARGET makes /api a same-origin proxy to the node.
          env: { VITE_API_TARGET: RIG.store, NODE_OPTIONS: '--max-old-space-size=768' },
          reuseExisting: true,
          startupTimeout: 120_000,
          log: '.e2e/logs/till.log',
        },
      },
    },
  ],
  agents,
} satisfies E2EConfig;
