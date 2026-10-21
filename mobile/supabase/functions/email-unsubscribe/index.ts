// The unsubscribe link at the bottom of every Hound email
// (0122_email_unsubscribe.sql).
//
// Two callers, both POST:
//   * the page at https://houndchallenge.net/unsubscribe, when someone
//     presses "Stop Hound emails" (JSON body { e, t });
//   * the mail app itself, for one-click unsubscribe (RFC 8058): Gmail,
//     Yahoo and Apple Mail POST "List-Unsubscribe=One-Click" to the link in
//     the email's List-Unsubscribe header, with e and t in the query.
// A plain GET does nothing, so link scanners that open every link in an
// email can't unsubscribe anyone.
//
// e is the address (base64url) and t its signature: HMAC-SHA256 with the
// EMAIL_UNSUBSCRIBE_SECRET secret, made by the function that sent the
// email. Nobody can unsubscribe an address they didn't receive mail at.
//
// Called with no Supabase sign-in, so JWT checks are off for it
// (config.toml). Deploying from the dashboard: turn off "Enforce JWT
// verification" for this function.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy email-unsubscribe

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': Deno.env.get('HOUND_WEB_ORIGIN') ?? 'https://houndchallenge.net',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function fromB64url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

async function signatureFor(address: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address)));
}

// Same length and every byte equal, without stopping at the first
// difference.
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return reply({ error: 'Use the button on the unsubscribe page.' }, 405);

  const secret = Deno.env.get('EMAIL_UNSUBSCRIBE_SECRET');
  if (!secret) return reply({ error: 'Unsubscribe is not set up yet.' }, 503);

  const url = new URL(req.url);
  let e = url.searchParams.get('e');
  let t = url.searchParams.get('t');
  if ((!e || !t) && (req.headers.get('Content-Type') ?? '').includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    e = typeof body?.e === 'string' ? body.e : null;
    t = typeof body?.t === 'string' ? body.t : null;
  }
  if (!e || !t || e.length > 400 || t.length > 100) return reply({ error: 'This link is not complete.' }, 400);

  let address: string;
  let given: Uint8Array;
  try {
    address = new TextDecoder().decode(fromB64url(e)).trim().toLowerCase();
    given = fromB64url(t);
  } catch {
    return reply({ error: 'This link is not valid.' }, 400);
  }
  if (!address.includes('@') || !sameBytes(given, await signatureFor(address, secret))) {
    return reply({ error: 'This link is not valid.' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await admin.rpc('email_unsubscribe', { p_email: address });
  if (error) {
    console.error('email_unsubscribe failed', error.message);
    return reply({ error: 'Something went wrong. Please try again in a minute.' }, 500);
  }
  return reply({ unsubscribed: true });
});
