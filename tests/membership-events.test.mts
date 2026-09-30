import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { handleWebhook, verifyEvent } from '../netlify/functions/_shared/membership-events.mts';

const secret = randomBytes(32).toString('hex');
const secrets = [{ value: secret, live: false }];
const sample = (overrides = {}) => ({ id: 'evt_test', type: 'checkout.session.completed', created: Math.floor(Date.now()/1000), livemode: false,
  data: { object: { id: 'cs_test', mode: 'subscription', subscription: 'sub_test', payment_status: 'paid' } }, ...overrides });
const sign = (raw: string, now = Math.floor(Date.now()/1000)) => `t=${now},v1=${createHmac('sha256', secret).update(`${now}.${raw}`).digest('hex')}`;
const req = (event: any) => { const raw = JSON.stringify(event); return new Request('https://example.test/api/stripe-membership-events', { method: 'POST', body: raw, headers: { 'stripe-signature': sign(raw) } }); };

test('rejects tampering, expired signatures, missing signatures, and test/live mismatch', () => {
  const raw = JSON.stringify(sample());
  assert.throws(() => verifyEvent(raw + ' ', sign(raw), secrets));
  assert.throws(() => verifyEvent(raw, sign(raw, Math.floor(Date.now()/1000)-301), secrets));
  assert.throws(() => verifyEvent(raw, '', secrets));
  const live = JSON.stringify(sample({ livemode: true }));
  assert.throws(() => verifyEvent(live, sign(live), secrets));
});
test('records verified paid checkout and deduplicates redelivery', async () => {
  const records = new Map<string, any>();
  const persist = async (key: string, value: any) => { records.set(key, value); };
  assert.equal((await handleWebhook(req(sample()), secrets, persist)).status, 200);
  assert.equal((await handleWebhook(req(sample()), secrets, persist)).status, 200);
  assert.equal(records.size, 1);
  assert.equal(records.get('test/events/evt_test').paymentConfirmed, true);
});
test('unpaid checkout does not qualify for publication review, delayed success does', async () => {
  const records: any[] = [];
  const persist = async (_: string, value: any) => { records.push(value); };
  const unpaid = sample(); unpaid.data.object.payment_status = 'unpaid';
  await handleWebhook(req(unpaid), secrets, persist);
  await handleWebhook(req(sample({id:'evt_later',type:'checkout.session.async_payment_succeeded'})), secrets, persist);
  assert.equal(records[0].directoryReviewRequired, false);
  assert.equal(records[1].directoryReviewRequired, true);
});
test('renewal, failed payment and cancellation records preserve out-of-order history', async () => {
  const records = new Map<string, any>();
  const persist = async (key: string, value: any) => { records.set(key, value); };
  for (const [i, type] of ['customer.subscription.deleted','invoice.paid','invoice.payment_failed'].entries()) {
    const event = sample({id:`evt_${i}`,type,data:{object:{id:'sub_test',status:type==='invoice.paid'?'paid':'canceled',parent:{subscription_details:{subscription:'sub_test'}}}}});
    assert.equal((await handleWebhook(req(event), secrets, persist)).status, 200);
  }
  assert.equal(records.size, 3);
});
test('returns a retryable error when durable storage fails', async () => {
  assert.equal((await handleWebhook(req(sample()), secrets, async () => { throw new Error('unavailable'); })).status, 500);
});
test('fails closed when no signing secret is configured', async () => {
  assert.equal((await handleWebhook(req(sample()), [], async () => assert.fail())).status, 503);
});
