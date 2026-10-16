// The store app (frontend-store-new, the shop back office) against the `agentic` rig's store-01 node.
//   npx e2e run --config store.config.ts --output .e2e/out/store store
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { agents, PORTS, RIG, viewports } from './support/base.ts';

export default {
  projectId: 'itulah-store',
  tests: ['store/**/*.e2e.ts'],
  timeout: 240_000,
  workers: 2,
  targets: [
    {
      name: 'store',
      engine: web({ viewport: viewports.desk, timezoneId: 'Asia/Jakarta', locale: 'en-GB' }),
      app: {
        url: `http://127.0.0.1:${PORTS.store}`,
        command: {
          executable: 'node',
          args: ['node_modules/vite/bin/vite.js', '--port', String(PORTS.store), '--strictPort', '--host', '127.0.0.1'],
          cwd: '../../frontend-store-new',
          // The shop's own node answers /api; HR/GA/promotions relay to the cloud.
          env: { VITE_API_TARGET: RIG.store, VITE_CLOUD_TARGET: RIG.cloud, NODE_OPTIONS: '--max-old-space-size=768' },
          reuseExisting: true,
          startupTimeout: 120_000,
          log: '.e2e/logs/store.log',
        },
      },
    },
  ],
  agents,
} satisfies E2EConfig;
