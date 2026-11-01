import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import Stripe from 'npm:stripe@14.25.0';

export const env = (name, fallback) => { const v = Deno.env.get(name); if (v == null || v === '') { if (fallback !== undefined) return fallback; throw new Error(`Missing secret ${name}`); } return v; };
export const service = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
export const origins = () => env('SITE_ORIGINS').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

// Payments stay in Stripe test mode until the owner explicitly allows live keys.
export function stripe() {
  const key = env('STRIPE_SECRET_KEY');
  if (!key.startsWith('sk_test_') && env('STRIPE_ALLOW_LIVE', 'false') !== 'true') throw new Error('Live Stripe key refused: set STRIPE_ALLOW_LIVE=true when you are ready to take real payments.');
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), apiVersion: '2024-06-20' });
}

export function cors(req) {
  const list = origins(), origin = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': list.includes(origin) ? origin : list[0], 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });

// The signed-in visitor (anonymous sessions included) from the request's bearer token.
export async function caller(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await service().auth.getUser(token);
  return error ? null : data.user;
}
