// Sends the "you've been invited to Hound" email via Resend
// (https://resend.com). This has to be server-side — the Resend API key
// authorizes sending mail on your domain's behalf, and any secret shipped
// inside the mobile app bundle can be pulled back out of it, the same
// reason no service_role key ever appears in src/.
//
// Called from the client via supabase.functions.invoke('send-invite-email',
// { body: { email } }) — see src/friends/supabaseFriends.ts's
// inviteByEmail(). The caller's own JWT (attached automatically by
// supabase-js) is what authorizes this function to look up their name;
// nothing here trusts a client-supplied inviter name.
//
// Deploy with the Supabase CLI once you have a project linked:
//   supabase functions deploy send-invite-email
//   supabase secrets set RESEND_API_KEY=re_your_key_here
// Get RESEND_API_KEY from https://resend.com/api-keys. The `from` address
// below needs a domain verified in Resend before it'll actually deliver —
// until then Resend's API will reject the send with a clear error, which
// this function surfaces rather than swallows.
//
// Not yet done: a verified sending domain, and a real link for the email
// to point to — HOUND_SIGNUP_URL below is a placeholder (just the bare
// houndchallenge.net domain) until there's an app to download or a
// hosted sign-up page. Swap it for whatever that ends up being.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ── Unsubscribe (0122_email_unsubscribe.sql, email-unsubscribe) ─────────
// The same few lines are in every function that sends email, so each one
// still deploys on its own from the dashboard. With no
// EMAIL_UNSUBSCRIBE_SECRET set, emails go out as before, without a link.
const unsubscribeAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The List-Unsubscribe headers and a footer line for one email.
async function unsubscribeParts(email: string): Promise<{ headers: Record<string, string>; footer: string }> {
  const secret = Deno.env.get('EMAIL_UNSUBSCRIBE_SECRET');
  if (!secret) return { headers: {}, footer: '' };
  const address = email.trim().toLowerCase();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address)));
  const query = `e=${b64url(new TextEncoder().encode(address))}&t=${b64url(sig)}`;
  return {
    headers: {
      'List-Unsubscribe': `<${Deno.env.get('SUPABASE_URL')}/functions/v1/email-unsubscribe?${query}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    footer:
      `<p style="color:#8a8a8a;font-size:12px">Don't want emails from Hound? ` +
      `<a href="https://houndchallenge.net/unsubscribe?${query}">Unsubscribe</a>.</p>`,
  };
}

// Whether this address asked for no more Hound email. Before 0122 has run
// the lookup fails and this says no, so nothing changes.
async function hasUnsubscribed(email: string): Promise<boolean> {
  const { data } = await unsubscribeAdmin
    .from('email_unsubscribes')
    .select('email')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  return !!data;
}

// Escaping for names people typed themselves, so a name shows up as
// text in the email, never as a link or an extra subject line. Kept in
// this file so the function deploys on its own from the dashboard.
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// One line, no control characters, capped in length. For subjects and for
// names that go into the text of an email.
function oneLine(value: unknown, max = 60): string {
  const cleaned = String(value ?? '')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned;
}

const HOUND_SIGNUP_URL = 'https://houndchallenge.net';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function isPlausibleEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length <= 254 &&
    /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(value.trim())
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { email } = await req.json();
    if (!isPlausibleEmail(email)) {
      return new Response(JSON.stringify({ error: 'A valid email is required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Scoped to the caller's own JWT (forwarded automatically by
    // supabase.functions.invoke), not the service role — this can only
    // ever read what the calling user could already read themselves.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Sign in to do that.' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const address = String(email).trim().toLowerCase();

    // The app saves the invite first (pending_invites) and only then calls
    // this function. So an email only goes out for an address the caller
    // really invited, at most once, and at most DAILY_LIMIT a day. Without
    // this, any signed-in user could send mail from your domain to any
    // address, as many times as they liked.
    const DAILY_LIMIT = 20;
    const { data: invite } = await supabase
      .from('pending_invites')
      .select('id, email_sent_at')
      .eq('inviter_id', user.id)
      .eq('email', address)
      .maybeSingle();
    if (!invite) {
      return new Response(JSON.stringify({ error: 'Invite this address in the app first.' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    if (invite.email_sent_at) {
      return new Response(JSON.stringify({ sent: false, reason: 'already sent' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('pending_invites')
      .select('id', { count: 'exact', head: true })
      .eq('inviter_id', user.id)
      .gte('email_sent_at', since);
    if ((count ?? 0) >= DAILY_LIMIT) {
      return new Response(JSON.stringify({ error: 'Daily invite limit reached. Try again tomorrow.' }), {
        status: 429,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Claim the send before sending, so two quick calls cannot both send.
    const { data: claimed } = await admin
      .from('pending_invites')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', invite.id)
      .is('email_sent_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) {
      return new Response(JSON.stringify({ sent: false, reason: 'already sent' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).single();
    const inviterName = oneLine(profile?.name ?? 'Someone');

    if (await hasUnsubscribed(address)) {
      // They asked for no Hound email; give the claim back unused.
      await admin.from('pending_invites').update({ email_sent_at: null }).eq('id', invite.id);
      return new Response(JSON.stringify({ sent: false, reason: 'unsubscribed' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const unsubscribe = await unsubscribeParts(address);

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hound <invites@houndchallenge.net>',
        to: [address],
        subject: `${inviterName} invited you to Hound`,
        headers: unsubscribe.headers,
        html:
          `<p>${escapeHtml(inviterName)} wants to race you on Hound.</p>` +
          `<p><a href="${HOUND_SIGNUP_URL}">Join Hound</a> to connect — you'll already be friends once you sign up with this address.</p>` +
          unsubscribe.footer,
      }),
    });

    if (!resendResponse.ok) {
      // Give the claim back so the person can try again, and keep
      // Resend's own error text in the logs rather than in the response.
      await admin.from('pending_invites').update({ email_sent_at: null }).eq('id', invite.id);
      console.error('Resend rejected the send', resendResponse.status, await resendResponse.text());
      return new Response(JSON.stringify({ error: 'The invite email could not be sent right now.' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unexpected error.' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
