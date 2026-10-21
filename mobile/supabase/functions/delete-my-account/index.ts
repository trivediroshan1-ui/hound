// Deletes the signed-in person's own Hound account — Settings → Delete
// account. Apple requires apps that create accounts to offer this in the
// app (App Store Review Guideline 5.1.1(v)); H8 in Roshan Trivedi's
// security review.
//
// The account deleted is always the caller's, taken from their sign-in
// token, never from the request body. The body must say
// { "confirm": "DELETE" } so a stray call can't delete anyone.
//
// delete_account_data() (0091_security_followups.sql) runs first: it
// hands challenges other people are still in to one of them (an admin,
// for a global challenge), removes challenges nobody else is in, and
// clears the workout archive, which has no link to the user. Deleting the
// sign-in then cascades to the profile and everything else (0091 also
// fixed the links that used to block this).
//
// Deploy with the Supabase CLI:
//   supabase functions deploy delete-my-account

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Only Hound's own website may call this from a browser. The app is not a
// browser, so it is unaffected. For local web testing, set the
// HOUND_WEB_ORIGIN secret (for example http://localhost:8081) on staging.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': Deno.env.get('HOUND_WEB_ORIGIN') ?? 'https://houndchallenge.net',
  Vary: 'Origin',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== 'DELETE') return json({ error: 'Confirmation is required.' }, 400);

    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const {
      data: { user },
    } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Sign in to do that.' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { error: prepError } = await admin.rpc('delete_account_data', { p_user: user.id });
    if (prepError) {
      console.error('delete_account_data failed', prepError.message);
      return json({ error: 'Your account could not be deleted right now. Try again later.' }, 500);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('deleteUser failed', deleteError.message);
      return json({ error: 'Your account could not be deleted right now. Try again later.' }, 500);
    }

    return json({ deleted: true });
  } catch (e) {
    console.error('delete-my-account failed', e);
    return json({ error: 'Unexpected error.' }, 500);
  }
});
