// Deletes a Hound account — used by the Admin screen's user directory
// (src/admin/adminApi.ts's deleteUser()), guarded by its own
// confirmation dialog in AdminUserDetailScreen.
//
// This can't be a plain client call: auth.admin.deleteUser() only works
// with the service role key, which must never reach the app bundle (see
// send-login-reminders' own comment on why that key stays server-side).
// So this function authenticates the caller with their own JWT first —
// same as send-friend-request-email — checks profiles.is_admin for that
// caller, and only then switches to a service-role client to do the
// actual delete. The is_admin check here is real enforcement, not the
// belt-and-braces AdminScreen/AdminUserDetailScreen already do — nothing
// about invoking this function requires isAdmin client-side.
//
// profiles.id references auth.users(id) on delete cascade
// (0001_challenges_schema.sql), and everything else that references
// profiles.id cascades too (friendships, kudos, progress_snapshots,
// challenge_participants, pending_invites, challenge_invites,
// device_push_tokens) — deleting the auth user is enough. The one
// exception is challenges.created_by, which has no cascade (see
// 0005_challenges_delete_policy.sql's own comment on what does and
// doesn't cascade off challenges): deleting someone who created a
// challenge other people are still in would either fail outright or
// require silently deleting that shared challenge out from under its
// other participants, so this surfaces it as a clear error instead of
// guessing which behavior the admin wants.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy admin-delete-user

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Only Hound's own website may call this from a browser. The app is not a
// browser, so it is unaffected. For local web testing, set the
// HOUND_WEB_ORIGIN secret (for example http://localhost:8081) on staging.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': Deno.env.get('HOUND_WEB_ORIGIN') ?? 'https://houndchallenge.net',
  Vary: 'Origin',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { userId } = await req.json();
    if (typeof userId !== 'string' || !userId) {
      return jsonError('userId is required.', 400);
    }

    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) return jsonError('Sign in to do that.', 401);

    const { data: callerProfile, error: callerProfileError } = await callerClient
      .from('profiles')
      .select('is_admin')
      .eq('id', caller.id)
      .single();
    if (callerProfileError || !callerProfile?.is_admin) {
      return jsonError('Only admins can do that.', 403);
    }

    if (userId === caller.id) {
      return jsonError("You can't delete your own account from here.", 400);
    }

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Hands shared challenges to another player and clears what doesn't
    // cascade (0091_security_followups.sql). Before 0091 has run the
    // function doesn't exist; the delete below then behaves as it used to.
    await adminClient.rpc('delete_account_data', { p_user: userId });
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      // Postgres FK-violation code — the created-challenges case the
      // file comment above describes.
      const blocked = (deleteError as { code?: string }).code === '23503' || /foreign key/i.test(deleteError.message);
      return jsonError(
        blocked
          ? 'This account created challenges other people are still in — delete or reassign those first.'
          : deleteError.message,
        blocked ? 409 : 500,
      );
    }

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Unexpected error.', 500);
  }
});
