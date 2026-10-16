// Central (frontend-hub) against the `agentic` rig.
//   npx e2e run --config hub.config.ts hub/po            (one domain)
//   npx e2e run --config hub.config.ts --output .e2e/out/po hub/po
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { agents, PORTS, RIG, viewports } from './support/base.ts';

export default {
  projectId: 'itulah-hub',
  tests: ['hub/**/*.e2e.ts'],
  timeout: 240_000,
  workers: 1,
  targets: [
    {
      name: 'hub',
      engine: web({ viewport: viewports.desk, timezoneId: 'Asia/Jakarta', locale: 'en-GB' }),
      app: {
        url: `http://127.0.0.1:${PORTS.hub}`,
        command: {
          executable: 'node',
          args: ['node_modules/vite/bin/vite.js', '--port', String(PORTS.hub), '--strictPort', '--host', '127.0.0.1'],
          cwd: '../../frontend-hub',
          // VITE_API_TARGET must always be set: the hub's default is the live cloud.
          env: { VITE_API_TARGET: RIG.cloud, VITE_EDGE_TARGET: RIG.dc, NODE_OPTIONS: '--max-old-space-size=768' },
          reuseExisting: true,
          startupTimeout: 120_000,
          log: '.e2e/logs/hub.log',
        },
      },
    },
  ],
  agents,
} satisfies E2EConfig;
