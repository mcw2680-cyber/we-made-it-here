import { createHmac, timingSafeEqual } from 'node:crypto';

type Event = {
  id: string; type: string; created: number; livemode: boolean;
  data: { object: Record<string, any> };
};
type Secret = { value: string; live: boolean };
type StoreRecord = (key: string, record: Record<string, unknown>) => Promise<void>;

export function verifyEvent(raw: string, header: string, secrets: Secret[], now = Date.now() / 1000): Event {
  const parts = header.split(',').map(part => part.trim().split('='));
  const times = parts.filter(([key]) => key === 't').map(([, value]) => value);
  if (times.length !== 1 || !/^\d+$/.test(times[0]) || Math.abs(now - Number(times[0])) > 300) throw new Error('Invalid signature');
  const signatures = parts.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value || '')).map(([, value]) => Buffer.from(value, 'hex'));
  const secret = secrets.find(({ value }) => {
    const expected = createHmac('sha256', value).update(`${times[0]}.${raw}`).digest();
    return signatures.some(signature => timingSafeEqual(signature, expected));
  });
  if (!secret) throw new Error('Invalid signature');
  const event = JSON.parse(raw) as Event;
  if (!/^evt_[A-Za-z0-9_]+$/.test(event.id) || !Number.isSafeInteger(event.created) ||
      event.livemode !== secret.live || typeof event.type !== 'string' ||
      !event.data?.object || typeof event.data.object.id !== 'string') throw new Error('Invalid event');
  return event;
}

export function membershipRecord(event: Event): Record<string, unknown> | null {
  const accepted = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
    'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
  if (!accepted.includes(event.type)) return null;
  const object = event.data.object;
  const isCheckout = event.type.startsWith('checkout.session.');
  const isSubscription = event.type.startsWith('customer.subscription.');
  if (isCheckout && object.mode !== 'subscription') return null;
  const subscription = isSubscription ? object.id : object.subscription || object.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  const id = (value: any) => typeof value === 'string' ? value : value?.id || null;
  return {
    id: event.id, type: event.type, created: event.created, livemode: event.livemode,
    objectId: object.id, subscriptionId: id(subscription), customerId: id(object.customer),
    status: object.status || null, paymentStatus: object.payment_status || null,
    paymentConfirmed: isCheckout ? object.payment_status === 'paid' : event.type === 'invoice.paid' && object.status === 'paid',
    amount: object.amount_total ?? object.amount_paid ?? null, currency: object.currency || null,
    cancelAtPeriodEnd: isSubscription ? object.cancel_at_period_end === true : null,
    customerEmail: isCheckout ? object.customer_details?.email || null : null,
    businessName: isCheckout ? object.collected_information?.business_name || object.customer_details?.business_name || object.customer_details?.name || null : null,
    website: isCheckout ? object.custom_fields?.find((field: any) => field.key === 'businesswebsite')?.text?.value || null : null,
    // Directory publication remains a separate manual verification step.
    directoryReviewRequired: isCheckout && object.payment_status === 'paid'
  };
}

export async function handleWebhook(request: Request, secrets: Secret[], persist: StoreRecord): Promise<Response> {
  const reply = (text: string, status: number) => new Response(text, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return reply('Method not allowed', 405);
  if (!secrets.length) return reply('Webhook not configured', 503);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1024 * 1024) return reply('Payload too large', 413);
  let event: Event;
  try { event = verifyEvent(raw, request.headers.get('stripe-signature') || '', secrets); }
  catch { return reply('Invalid event signature', 400); }
  const record = membershipRecord(event);
  if (!record) return reply('Ignored', 200);
  try {
    // Event IDs make redelivery idempotent. Separate immutable event records
    // preserve out-of-order deliveries without overwriting newer status.
    await persist(`${event.livemode ? 'live' : 'test'}/events/${event.id}`, record);
  } catch { return reply('Please retry', 500); }
  return reply('Recorded', 200);
}
