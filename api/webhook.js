import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = 'https://nzccxsbhzovkqojyelxw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SIGNING_SECRET = process.env.LEMONSQUEEZY_SIGNING_SECRET;

const VARIANT_PLANS = {
  // Numeric variant IDs (used in webhook payloads)
  '1708952': 'pro',
  '1708954': 'pro',
  '1708960': 'premium',
  '1708963': 'premium',
  // UUID slugs (fallback)
  'de0b9747-7d10-4550-8954-3acc01b1b02c': 'pro',
  'bad8fd48-0b29-4799-b448-df4b89b2f48a': 'pro',
  '70ef4754-97a1-4746-8bf8-441081c85a11': 'premium',
  '509242ea-9bbf-4299-9460-3ee86024fd28': 'premium',
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function upsertPlan(email, plan) {
  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await r.json();
  const userId = data?.users?.[0]?.id;
  if (!userId) return;

  await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: userId, plan }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);

  // Verify Lemon Squeezy signature if secret is configured
  if (SIGNING_SECRET) {
    const sig = req.headers['x-signature'];
    const digest = crypto.createHmac('sha256', SIGNING_SECRET).update(rawBody).digest('hex');
    if (sig !== digest) return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const event = payload.meta?.event_name;
  const attrs = payload.data?.attributes;
  const email = attrs?.user_email || attrs?.customer_email;
  const variantId = String(
    attrs?.variant_id || attrs?.first_order_item?.variant_id || ''
  );

  if (!email) return res.status(200).json({ ok: true });

  if (['order_created', 'subscription_created', 'subscription_updated'].includes(event)) {
    const plan = VARIANT_PLANS[variantId] || 'pro';
    await upsertPlan(email, plan);
  } else if (['subscription_cancelled', 'subscription_expired'].includes(event)) {
    await upsertPlan(email, 'free');
  }

  return res.status(200).json({ ok: true });
}
