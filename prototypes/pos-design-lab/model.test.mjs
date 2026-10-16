import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, totals, addTag, takePayment, products } from './model.mjs';
test('fixture total, eligible coupon, bag and minimum spend',()=>{
 const s=makeState();assert.equal(totals(s).total,677000);s.coupon=true;s.bag=true;assert.equal(totals(s).total,630000);s.items=[products[0]];assert.equal(totals(s).discount,0);assert.equal(totals(s).total,132000);
});
test('a tag can only be counted once and unknown tags never enter basket',()=>{
 const s=makeState(false);assert.equal(addTag(s,products[0].tag),null);assert.ok(addTag(s,products[0].tag));assert.ok(addTag(s,'E200UNKNOWN'));assert.equal(s.items.length,1);
});
test('split tender retains first payment and only cash produces change',()=>{
 const s=makeState();s.method='Debit';s.amount='300000';assert.ok(takePayment(s));assert.equal(s.payments.length,0);s.reference='DEMO-EDC';assert.equal(takePayment(s),null);assert.equal(totals(s).due,377000);s.amount='400000';s.reference='DEMO-2';assert.ok(takePayment(s));assert.equal(s.payments.length,1);s.method='Tunai';assert.equal(takePayment(s),null);assert.equal(totals(s).due,0);assert.equal(totals(s).change,23000);assert.ok(takePayment(s));assert.equal(s.payments.length,2);
});
test('invalid and empty-cart payments are rejected',()=>{
 const s=makeState();for(const amount of ['','0','-1','1.5','NaN','Infinity']){s.amount=amount;assert.ok(takePayment(s));}assert.equal(s.payments.length,0);s.items=[];s.amount='20000';assert.ok(takePayment(s));
});
