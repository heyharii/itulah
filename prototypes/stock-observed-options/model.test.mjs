import assert from 'node:assert/strict';
import test from 'node:test';
import { seed, value, total, status, transfer } from './model.mjs';

test('Belum dicek differs from a verified zero; unknown location prevents a misleading total', () => {
  const products = seed();
  assert.equal(value(products[3], 'warehouse', 'observed'), null);
  assert.equal(value(products[4], 'warehouse', 'observed'), 0);
  assert.equal(total(products[4], 'observed'), 0);
  assert.equal(total(products[5], 'observed'), null);
});
test('Legitimate movement after checking is distinct from discrepancy at checking time', () => {
  const products = seed();
  assert.equal(status(products[0]), 'difference');
  assert.equal(status(products[1]), 'changed');
  assert.equal(status(products[2]), 'match');
  assert.equal(status(products[3]), 'unchecked');
  assert.equal(status(products[5]), 'partial');
});
test('Manual movement conserves system total and preserves last observed counts', () => {
  const products = seed(), before = structuredClone(products[2].observed), initial = total(products[2], 'system');
  assert.equal(transfer(products, { hoodie: 3 }, 'warehouse', 'floor'), 3);
  assert.equal(products[2].system.warehouse, 6);
  assert.equal(products[2].system.floor, 8);
  assert.equal(total(products[2], 'system'), initial);
  assert.deepEqual(products[2].observed, before);
  assert.equal(status(products[2]), 'changed');
});
test('Invalid movement is atomic and cannot exceed system availability, accept fractions, or use same location', () => {
  const products = seed(), before = structuredClone(products);
  assert.throws(() => transfer(products, { tee: 2, hoodie: 99 }, 'warehouse', 'floor'));
  assert.throws(() => transfer(products, { tee: 0.5 }, 'warehouse', 'floor'));
  assert.throws(() => transfer(products, { tee: 1 }, 'warehouse', 'warehouse'));
  assert.throws(() => transfer(products, {}, 'warehouse', 'floor'));
  assert.deepEqual(products, before);
});
test('Movement out and back still invalidates the last observation even if final balances match', () => {
  const products = seed();
  transfer(products, { hoodie: 2 }, 'warehouse', 'floor');
  transfer(products, { hoodie: 2 }, 'floor', 'warehouse');
  assert.equal(products[2].system.warehouse, 9);
  assert.equal(status(products[2]), 'changed');
});
