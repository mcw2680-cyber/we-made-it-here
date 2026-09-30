import { getStore, getDeployStore } from '@netlify/blobs';
import type { Context, Config } from '@netlify/functions';
import { handleWebhook } from './_shared/membership-events.mts';

export default async (request: Request, context: Context) => {
  const liveSecret = Netlify.env.get('STRIPE_MEMBERSHIP_WEBHOOK_SECRET_LIVE');
  const testSecret = Netlify.env.get('STRIPE_MEMBERSHIP_WEBHOOK_SECRET_TEST');
  const secrets = [];
  if (liveSecret && context.deploy.context === 'production') secrets.push({ value: liveSecret, live: true });
  if (testSecret) secrets.push({ value: testSecret, live: false });
  return handleWebhook(request, secrets, async (key, record) => {
    const store = context.deploy.context === 'production'
      ? getStore('membership-events') : getDeployStore('membership-events');
    await store.setJSON(key, record);
  });
};

export const config: Config = { path: '/api/stripe-membership-events' };
