// Payment rules shared by the PayPal and crypto (NOWPayments) functions. No imports, so check.mjs tests it in Node.
// Prices always come from the database (plans) or these limits, never from the browser.

export const KINDS = { megaphone: 'megaphones', sponsor: 'sponsors', donation: 'donations' };
export const PROVIDERS = ['paypal', 'crypto'];
export const DONATION_MIN_CENTS = 100, DONATION_MAX_CENTS = 50000;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const https = (s) => { try { const u = new URL(String(s).trim()); return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password && u.href.length <= 300 ? u.href : null; } catch { return null; } };

// Sponsor banner: short title, an https link and an optional https image. An admin approves it before it shows.
export function checkSponsor(body) {
  const title = clean(body.title, 40), url = https(body.url), raw = String(body.image_url ?? '').trim(), image_url = raw ? https(raw) : null, errors = [];
  if (title.length < 2) errors.push('Give your sponsor banner a title (2–40 characters).');
  if (!url) errors.push('The sponsor link must be a full https:// address.');
  if (raw && !image_url) errors.push('The image must be an https:// address, or leave it empty.');
  return { title, url, image_url, errors };
}

// Donation: whole dollars between the limits; an optional name and note, shown only if the donor allows it.
export function checkDonation(body) {
  const cents = Math.round(Number(body.amount) * 100), errors = [];
  if (!Number.isFinite(cents) || cents % 100 !== 0 || cents < DONATION_MIN_CENTS || cents > DONATION_MAX_CENTS) errors.push(`Choose a whole amount from $${DONATION_MIN_CENTS / 100} to $${DONATION_MAX_CENTS / 100}.`);
  return { amount_cents: cents, name: clean(body.name, 30), message: clean(body.message, 140), public: body.public === true, errors };
}

// Order reference sent to the provider and read back from it: "<kind>:<row uuid>".
export const orderRef = (kind, id) => `${kind}:${id}`;
export function parseOrderRef(ref) {
  const m = /^(megaphone|sponsor|donation):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(String(ref ?? ''));
  return m ? { kind: m[1], id: m[2] } : null;
}

// "12.34" -> 1234, rejecting anything that is not a plain money amount.
export function toCents(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
export const fromCents = (cents) => (cents / 100).toFixed(2);

// NOWPayments signs its IPN with HMAC-SHA512 over the JSON body with keys sorted at every level.
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  return value;
}
export async function hmacSha512Hex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyNowPayments(body, signature, secret) {
  if (!secret || !/^[0-9a-f]{128}$/i.test(String(signature ?? ''))) return false;
  const want = await hmacSha512Hex(secret, JSON.stringify(sortKeys(body)));
  const got = String(signature).toLowerCase();
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

// A provider confirmation is accepted only if it is for this row, in USD, for at least the price, and fully complete.
export function paypalPaid(order, row) {
  const unit = order?.purchase_units?.[0], cap = unit?.payments?.captures?.[0];
  if (order?.status !== 'COMPLETED' || cap?.status !== 'COMPLETED') return { ok: false, pending: cap?.status === 'PENDING' };
  if (unit.custom_id !== row.ref) return { ok: false, reason: 'order belongs to another payment' };
  if (cap.amount?.currency_code !== 'USD' || toCents(cap.amount?.value) !== row.price_cents) return { ok: false, reason: 'amount mismatch' };
  return { ok: true, payment: cap.id, livemode: row.livemode };
}
export function cryptoPaid(ipn, row) {
  if (!['finished', 'confirmed'].includes(ipn?.payment_status)) return { ok: false, pending: ['waiting', 'confirming', 'sending', 'partially_paid'].includes(ipn?.payment_status) };
  if (ipn.order_id !== row.ref) return { ok: false, reason: 'order belongs to another payment' };
  if (String(ipn.price_currency).toLowerCase() !== 'usd' || Math.round(Number(ipn.price_amount) * 100) < row.price_cents) return { ok: false, reason: 'amount mismatch' };
  return { ok: true, payment: 'crypto:' + ipn.payment_id };
}
