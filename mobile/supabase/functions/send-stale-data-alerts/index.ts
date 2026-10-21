// Runs every hour on a schedule (0025_challenge_alerts.sql's pg_cron job,
// hourly since 0088_local_time_alerts.sql) — no signed-in user drives
// this, so it authenticates with the service role key, same reasoning as
// send-login-reminders.
//
// For every challenge still running whose progress is synced from the
// phone (SYNCED_KINDS), finds any participant who hasn't recorded
// progress in it for over STALE_HOURS (or never has, if the
// challenge itself has been running that long), and reminds THAT
// participant, if they have push and/or email enabled for this alert
// (0026_alert_email_channels.sql), with a "you haven't synced" nudge.
// Nobody is ever told about anyone else: until October 2026 this went to
// every other participant and named the quiet one, which in a global
// challenge meant everyone heard about everyone. Each person hears it at
// 6 PM in their own time zone (profiles.time_zone; US Eastern when
// unknown), at most once per challenge on their own calendar day —
// alert_deliveries records each send.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-stale-data-alerts

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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const STALE_MS = 24 * 60 * 60 * 1000;
// The local hour the alert goes out.
const ALERT_HOUR = 18;
const DEFAULT_TIME_ZONE = 'America/New_York';
// The kinds whose progress the app writes to progress_snapshots
// (deviceSync.ts's syncChallengeProgressFromDevice). Bingo and 75 keep
// theirs in their own tables, and Tic-Tac-Go has nothing to sync, so a
// snapshot-based check would call everyone in them stale every day.
const SYNCED_KINDS = ['steps', 'distance', 'streak', 'hunt', 'tag'];

interface ChallengeRow {
  id: string;
  name: string;
  starts_at: string;
}

interface ParticipantRow {
  user_id: string;
  profiles: {
    time_zone: string | null;
    email: string;
    alert_stale_data_push_enabled: boolean;
    alert_stale_data_email_enabled: boolean;
  } | null;
}

// The hour (0-23) and calendar day ('YYYY-MM-DD') at `at` in a time
// zone, falling back to US Eastern for a missing or unknown one. Same
// helper as send-login-reminders (each Edge Function is deployed on its
// own, so it's copied rather than shared).
function localClock(timeZone: string | null, at: Date = new Date()): { hour: number; day: string } {
  for (const zone of [timeZone, DEFAULT_TIME_ZONE]) {
    if (!zone) continue;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(at);
      const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      return { hour: Number(part('hour')) % 24, day: `${part('year')}-${part('month')}-${part('day')}` };
    } catch {
      // Unknown zone: try the default.
    }
  }
  return { hour: at.getUTCHours(), day: at.toISOString().slice(0, 10) };
}

async function sendPushBatch(tokens: string[], body: string): Promise<void> {
  if (tokens.length === 0) return;
  const messages = tokens.map((to) => ({ to, title: 'Hound', body, sound: 'default' }));
  for (let i = 0; i < messages.length; i += 100) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    }).catch(() => {
      // Same "a batch failing shouldn't stop the rest" reasoning
      // send-login-reminders' own sendPushBatch uses.
    });
  }
}

async function sendAlertEmail(resendApiKey: string, email: string, body: string): Promise<void> {
  if (await hasUnsubscribed(email)) return;
  const unsubscribe = await unsubscribeParts(email);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Hound <alerts@houndchallenge.net>',
      to: [email],
      subject: 'Hound alert',
      headers: unsubscribe.headers,
      html: `<p>${escapeHtml(body)}</p>` + unsubscribe.footer,
    }),
  }).catch(() => {
    // Same "one failed send shouldn't stop the rest" reasoning
    // send-login-reminders' own sendReminderEmail uses.
  });
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Two callers, both explicit: the cron job itself (service role — see
  // 0025_challenge_alerts.sql), or a signed-in admin manually firing this
  // early to test it (SettingsScreen's dev-only "Developer tools" card,
  // via notifications/supabaseNotifications.ts's triggerStaleDataAlerts —
  // same "check the caller's own JWT against profiles.is_admin" pattern
  // admin-delete-user uses, not a second copy of the service-role key
  // anywhere near the client). Anyone else gets 401.
  const authHeader = req.headers.get('Authorization') ?? '';
  const isServiceRole = authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (!isServiceRole) {
    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    const { data: callerProfile } = caller
      ? await supabase.from('profiles').select('is_admin').eq('id', caller.id).single()
      : { data: null };
    if (!callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }

  const now = new Date();
  const resendApiKey = Deno.env.get('RESEND_API_KEY');

  // Who it's 6 PM for right now, among those who want this alert. Most
  // hourly runs find nobody and stop here. An admin's manual test run
  // skips the hour check (null = everyone opted in).
  let dueNow: Set<string> | null = null;
  if (isServiceRole) {
    const { data: optedIn, error: optedInError } = await supabase
      .from('profiles')
      .select('id, time_zone')
      .or('alert_stale_data_push_enabled.eq.true,alert_stale_data_email_enabled.eq.true');
    if (optedInError) {
      return new Response(JSON.stringify({ error: optedInError.message }), { status: 500 });
    }
    dueNow = new Set(
      (optedIn ?? [])
        .filter((p: { time_zone: string | null }) => localClock(p.time_zone, now).hour === ALERT_HOUR)
        .map((p: { id: string }) => p.id),
    );
    if (dueNow.size === 0) {
      return new Response(JSON.stringify({ alertsSent: 0, errors: [] }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  const { data: challenges, error: challengesError } = await supabase
    .from('challenges')
    .select('id, name, starts_at')
    .gt('ends_at', now.toISOString())
    .in('kind', SYNCED_KINDS)
    .returns<ChallengeRow[]>();
  if (challengesError) {
    return new Response(JSON.stringify({ error: challengesError.message }), { status: 500 });
  }

  let alertsSent = 0;
  const errors: string[] = [];

  for (const challenge of challenges ?? []) {
    // A challenge younger than the stale window itself has nobody
    // who's had time to go stale yet — nothing to flag.
    if (now.getTime() - new Date(challenge.starts_at).getTime() < STALE_MS) continue;

    const [{ data: participants, error: participantsError }, { data: snapshots, error: snapshotsError }] =
      await Promise.all([
        supabase
          .from('challenge_participants')
          .select(
            'user_id, profiles(time_zone, email, alert_stale_data_push_enabled, alert_stale_data_email_enabled)',
          )
          .eq('challenge_id', challenge.id)
          .returns<ParticipantRow[]>(),
        supabase.from('progress_snapshots').select('user_id, recorded_at').eq('challenge_id', challenge.id),
      ]);
    // A query failure (e.g. a schema mismatch between what's deployed
    // and what's migrated) used to look identical to "no participants"
    // — silently skipped, reporting the same alertsSent: 0 as "nothing
    // to do here" would. Surfacing it instead of swallowing it.
    if (participantsError || snapshotsError) {
      errors.push(`${challenge.name}: ${participantsError?.message ?? snapshotsError?.message}`);
      continue;
    }
    if (!participants || participants.length === 0) continue;

    const lastSyncedByUser = new Map<string, string>();
    for (const s of snapshots ?? []) {
      const existing = lastSyncedByUser.get(s.user_id);
      if (!existing || s.recorded_at > existing) lastSyncedByUser.set(s.user_id, s.recorded_at);
    }

    // Quiet for over a day, opted in, and it's 6 PM where they are. Each
    // of them hears only about themselves.
    const due = participants.filter((p) => {
      const lastSynced = lastSyncedByUser.get(p.user_id);
      const staleMs = lastSynced ? now.getTime() - new Date(lastSynced).getTime() : STALE_MS;
      return (
        staleMs >= STALE_MS &&
        (p.profiles?.alert_stale_data_push_enabled || p.profiles?.alert_stale_data_email_enabled) &&
        (!dueNow || dueNow.has(p.user_id))
      );
    });
    if (due.length === 0) continue;

    // Record the sends first. Only new records come back from the insert,
    // so anyone who already had this alert today (on their own calendar)
    // is skipped.
    const { data: recorded, error: guardError } = await supabase
      .from('alert_deliveries')
      .upsert(
        due.map((p) => ({
          kind: 'stale_data',
          challenge_id: challenge.id,
          subject_id: p.user_id,
          recipient_id: p.user_id,
          day: localClock(p.profiles?.time_zone ?? null, now).day,
        })),
        { onConflict: 'kind,challenge_id,subject_id,recipient_id,day', ignoreDuplicates: true },
      )
      .select('recipient_id');
    if (guardError) {
      errors.push(`${challenge.name}: ${guardError.message}`);
      continue;
    }
    const newlyRecorded = new Set((recorded ?? []).map((r: { recipient_id: string }) => r.recipient_id));
    const recipients = due.filter((p) => newlyRecorded.has(p.user_id));
    if (recipients.length === 0) continue;

    // The same words for everyone, and they only ever name the challenge.
    const body = `You haven't synced progress in "${challenge.name}" for over a day. Open Hound to catch up.`;

    const pushRecipients = recipients.filter((r) => r.profiles?.alert_stale_data_push_enabled);
    const emailRecipients = recipients.filter((r) => r.profiles?.alert_stale_data_email_enabled);

    const sends: PromiseLike<void>[] = [];
    if (pushRecipients.length > 0) {
      sends.push(
        supabase
          .from('device_push_tokens')
          .select('expo_push_token')
          .in(
            'user_id',
            pushRecipients.map((r) => r.user_id),
          )
          .then(({ data: tokenRows }) => sendPushBatch((tokenRows ?? []).map((t) => t.expo_push_token), body)),
      );
    }
    if (resendApiKey) {
      for (const r of emailRecipients) {
        if (r.profiles?.email) sends.push(sendAlertEmail(resendApiKey, r.profiles.email, body));
      }
    }
    await Promise.all(sends);
    alertsSent += recipients.length;
  }

  // Old send records aren't needed once the day has passed.
  await supabase
    .from('alert_deliveries')
    .delete()
    .lt('day', new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10));

  return new Response(JSON.stringify({ alertsSent, errors }), { headers: { 'Content-Type': 'application/json' } });
});
