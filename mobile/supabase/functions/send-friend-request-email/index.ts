// Sends a "so-and-so wants to be your friend" email via Resend, reusing
// the same setup as send-invite-email and send-challenge-invite-email —
// this one covers the one remaining gap those two didn't: inviteByEmail
// (src/friends/supabaseFriends.ts) only ever emails anyone when the
// address it looked up has *no* matching profile yet (the
// pending_invites/send-invite-email path). The moment a profile *is*
// found, it just inserts a `friendships` row and stops — silently, with
// no email at all, even though the recipient is a real Hound user who'd
// otherwise only ever notice the request by opening the Friends tab on
// their own. This is the same gap send-challenge-invite-email closed
// for challenge invites, just on the friend-request side.
//
// Called from the client via supabase.functions.invoke(
//   'send-friend-request-email', { body: { friendshipId } }
// ) right after that insert succeeds — see inviteByEmail's "found a
// matching profile" branch. Best-effort, same reasoning as the other
// two: a failed send here never blocks or surfaces as an error, since
// the friendship row is already durably written either way.
//
// Authenticates with the caller's own JWT, not the service role — same
// as the other two, and safe for the same reason: every row this needs
// to read (the friendship itself, both profiles) is already something
// the requester's own RLS lets them see — "Users can view their own
// friendships" (0007, since requester_id = auth.uid()) and "Profiles
// are viewable by any signed-in user" (0001, which is also where the
// recipient's email comes from).
//
// Deploy with the Supabase CLI once you have a project linked:
//   supabase functions deploy send-friend-request-email
// Reuses the same RESEND_API_KEY secret the other two need — nothing
// new to configure if either of those is already set up.
//
// Not yet done, same as the other two: a verified sending domain, and a
// real deep link into the Friends tab rather than just Hound's front
// door.

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

interface FriendshipRow {
  id: string;
  requester_id: string;
  recipient_id: string;
  requester: { name: string } | null;
  recipient: { name: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { friendshipId } = await req.json();
    if (typeof friendshipId !== 'string' || !friendshipId) {
      return new Response(JSON.stringify({ error: 'friendshipId is required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Scoped to the caller's own JWT (forwarded automatically by
    // supabase.functions.invoke) — see the file comment for why every
    // row this reads is already something the requester's own RLS lets
    // them see.
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

    const { data, error } = await supabase
      .from('friendships')
      .select(
        'id, requester_id, recipient_id, ' +
          'requester:profiles!friendships_requester_id_fkey(name), ' +
          'recipient:profiles!friendships_recipient_id_fkey(name)',
      )
      .eq('id', friendshipId)
      .single<FriendshipRow>();
    // Only the person who sent the request can have it emailed.
    if (error || !data || !data.recipient || data.requester_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Friendship not found.' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Other people's email addresses aren't readable by signed-in users
    // (0092_hide_private_profile_columns.sql), so the address itself is
    // looked up with the service role — only after the check above.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: recipientRow } = await admin.from('profiles').select('email').eq('id', data.recipient_id).single();
    if (!recipientRow?.email) {
      return new Response(JSON.stringify({ error: 'Friendship not found.' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const requesterName = data.requester?.name ?? 'Someone';

    if (await hasUnsubscribed(recipientRow.email)) {
      return new Response(JSON.stringify({ sent: false, reason: 'unsubscribed' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const unsubscribe = await unsubscribeParts(recipientRow.email);

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hound <invites@houndchallenge.net>',
        to: [recipientRow.email],
        subject: `${oneLine(requesterName)} wants to be your friend on Hound`,
        headers: unsubscribe.headers,
        html:
          `<p>Hey ${escapeHtml(oneLine(data.recipient.name))},</p>` +
          `<p>${escapeHtml(oneLine(requesterName))} wants to be your friend on Hound.</p>` +
          `<p><a href="${HOUND_SIGNUP_URL}">Open Hound</a> and look for the request on the Friends tab.</p>` +
          unsubscribe.footer,
      }),
    });

    if (!resendResponse.ok) {
      console.error('Resend rejected the send', resendResponse.status, await resendResponse.text());
      return new Response(JSON.stringify({ error: 'The email could not be sent right now.' }), {
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
