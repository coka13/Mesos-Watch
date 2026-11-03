// PayPal (Orders v2) and NOWPayments (crypto invoices). Both stay in sandbox until the owner sets *_ENV=live.
import { env } from './util.js';
import { fromCents } from './pay-rules.js';

// ---- PayPal ----
const paypalLive = () => env('PAYPAL_ENV', 'sandbox') === 'live';
const paypalBase = () => paypalLive() ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
let paypalToken = null;
async function paypalAuth() {
  if (paypalToken && paypalToken.expires > Date.now() + 60e3) return paypalToken.value;
  const r = await fetch(paypalBase() + '/v1/oauth2/token', {
    method: 'POST', body: 'grant_type=client_credentials',
    headers: { Authorization: 'Basic ' + btoa(env('PAYPAL_CLIENT_ID') + ':' + env('PAYPAL_CLIENT_SECRET')), 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('PayPal sign-in failed: check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET and PAYPAL_ENV.');
  paypalToken = { value: d.access_token, expires: Date.now() + (d.expires_in || 300) * 1000 };
  return paypalToken.value;
}
async function paypal(path, init = {}) {
  const r = await fetch(paypalBase() + path, { ...init, headers: { Authorization: 'Bearer ' + await paypalAuth(), 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}
export const paypalLivemode = paypalLive;

export async function paypalCreateOrder({ ref, cents, description, returnUrl, cancelUrl, requestId }) {
  const { ok, data } = await paypal('/v2/checkout/orders', {
    method: 'POST', headers: { 'PayPal-Request-Id': requestId },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: ref, custom_id: ref, description: description.slice(0, 127), amount: { currency_code: 'USD', value: fromCents(cents) } }],
      payment_source: { paypal: { experience_context: { brand_name: 'Mesos-Watch', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: returnUrl, cancel_url: cancelUrl } } },
    }),
  });
  const approve = data.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  if (!ok || !data.id || !approve) throw new Error('PayPal could not create the order.');
  return { id: data.id, url: approve };
}

// Capture once; a repeat (page reload, double click) reads the already-captured order instead.
export async function paypalCapture(orderId, requestId) {
  const cap = await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', headers: { 'PayPal-Request-Id': requestId } });
  if (cap.ok) return cap.data;
  const issue = cap.data?.details?.[0]?.issue;
  if (issue === 'ORDER_ALREADY_CAPTURED' || cap.status === 409) return (await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}`)).data;
  if (issue === 'ORDER_NOT_APPROVED') return { status: 'NOT_APPROVED' };
  throw new Error('PayPal capture failed' + (issue ? ': ' + issue : '.'));
}

// ---- NOWPayments ----
const nowLive = () => env('NOWPAYMENTS_ENV', 'sandbox') === 'live';
const nowBase = () => nowLive() ? 'https://api.nowpayments.io' : 'https://api-sandbox.nowpayments.io';
export const cryptoLivemode = nowLive;

export async function cryptoCreateInvoice({ ref, cents, description, successUrl, cancelUrl }) {
  const r = await fetch(nowBase() + '/v1/invoice', {
    method: 'POST', headers: { 'x-api-key': env('NOWPAYMENTS_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_amount: Number(fromCents(cents)), price_currency: 'usd', order_id: ref, order_description: description.slice(0, 100),
      ipn_callback_url: env('SUPABASE_URL').replace(/\/$/, '') + '/functions/v1/nowpayments-ipn', success_url: successUrl, cancel_url: cancelUrl,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id || !d.invoice_url) throw new Error('The crypto checkout could not be created.' + (d.message ? ' ' + d.message : ''));
  return { id: String(d.id), url: d.invoice_url };
}
