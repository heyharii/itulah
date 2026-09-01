'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const context = vm.createContext({
  console,
  crypto: { randomUUID: () => 'test-id' },
  document: { addEventListener: () => {} },
  fetch: async () => { throw new Error('unexpected fetch'); },
  Intl,
  setTimeout: () => 0,
});
vm.runInContext(source, context, { filename: 'app.js' });

const selectedIdsJson = vm.runInContext(`
  state.pools = [
    { id: 'dc.warehouse', source_type: 'CLOUD_LEDGER', is_rollup: false },
    { id: 'store-07.floor', source_type: 'EDGE_FACT_POSITION', is_rollup: false, authority: { cloud_writable: false } },
    { id: 'dc.outbound.dispatched', source_type: 'CLOUD_LEDGER', is_rollup: true },
    { id: 'store-08.floor', source_type: 'CLOUD_LEDGER' },
    { id: 'store-09.floor', source_type: 'CLOUD_LEDGER', is_rollup: false, authority: { cloud_writable: false, write_policy: 'SHADOWED_READ_ONLY' } },
    { id: 'store-10.floor', source_type: 'CLOUD_LEDGER', is_rollup: false, authority: { cloud_writable: true } },
    { id: 'dc.outbound.picked', source_type: 'CLOUD_LEDGER', is_rollup: true, authority: { cloud_writable: false, write_policy: 'DERIVED_READ_ONLY' } }
  ];
  JSON.stringify(writablePools().map(pool => pool.id));
`, context);

assert.deepEqual(JSON.parse(selectedIdsJson), ['dc.warehouse', 'store-08.floor', 'store-10.floor']);
console.log('Cloud mutation pool policy: ok');
