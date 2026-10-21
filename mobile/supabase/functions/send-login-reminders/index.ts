// Runs every hour on a schedule (0010_login_reminders.sql's pg_cron job,
// hourly since 0088_local_time_alerts.sql) — no signed-in user drives
// this, so unlike send-invite-email it authenticates with the service
// role key, not a caller's JWT.
//
// The Hound's backup (0097_goals.sql). Each run reaches the people for
// whom it's 9 PM right now in their own time zone (profiles.time_zone; US
// Eastern when unknown) and who haven't opened the app yet today (their
// own calendar day). It names their daily goals: "Hound hasn't seen you
// today. 10,000 steps and 3 mi are still on the table."
//
// It stays quiet for anyone whose hounding is off, and for anyone whose
// phone has already scheduled its own reminders for today
// (hound_settings.scheduled_through), so nobody gets both. Channels are
// the same as before:
//   - a push notification, via Expo's push API, to every device token
//     registered for that user (see device_push_tokens / src/notifications)
//   - an email, via Resend, reusing the same setup as send-invite-email
//
// last_login_reminder_sent_at guards against sending twice on the same
// local day (a retry after a transient failure, for instance) — it's set
// right after a user is processed, and anyone already reminded today is
// skipped.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-login-reminders
// The service role key is itself a signed JWT, so it passes the
// platform's default verification like any other caller — the explicit
// check below on top of that is what actually restricts this to the
// scheduled job rather than any signed-in user's own JWT.

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
const HOUND_SIGNUP_URL = 'https://houndchallenge.net';
// The local hour the reminder goes out.
const REMINDER_HOUR = 21;
const DEFAULT_TIME_ZONE = 'America/New_York';

interface ProfileRow {
  id: string;
  name: string;
  email: string;
  notify_push_enabled: boolean;
  notify_email_enabled: boolean;
  time_zone: string | null;
  last_active_at: string | null;
  last_login_reminder_sent_at: string | null;
}

interface HoundRow {
  user_id: string;
  level: string;
  scheduled_through: string | null;
}

interface GoalRow {
  user_id: string;
  metric: string;
  period: string;
  target: number;
  label: string | null;
}

interface PushTokenRow {
  user_id: string;
  expo_push_token: string;
}

// The hour (0-23) and calendar day ('YYYY-MM-DD') at `at` in a time
// zone, falling back to US Eastern for a missing or unknown one. Same
// helper as send-stale-data-alerts and send-daily-standings (each Edge
// Function is deployed on its own, so it's copied rather than shared).
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

// "10,000 steps", "3 mi", or the goal's own name.
function goalPhrase(g: GoalRow): string {
  if (g.label) return oneLine(g.label, 40);
  const n = Number(g.target);
  if (g.metric === 'steps') return `${Math.round(n).toLocaleString('en-US')} steps`;
  if (g.metric === 'distance_mi') return `${Math.round(n * 10) / 10} mi`;
  if (g.metric === 'workout_minutes') return `${Math.round(n)} workout minutes`;
  return `${Math.round(n)} ${n === 1 ? 'workout' : 'workouts'}`;
}

function reminderBody(goals: GoalRow[]): string {
  const daily = goals.filter((g) => g.period === 'day').slice(0, 3).map(goalPhrase);
  if (daily.length === 0) return "Hound hasn't seen you today. Check in before the day's over.";
  const list = daily.length === 1 ? daily[0] : `${daily.slice(0, -1).join(', ')} and ${daily[daily.length - 1]}`;
  return `Hound hasn't seen you today. ${list} ${daily.length === 1 && !/s$/.test(list) ? 'is' : 'are'} still on the table.`;
}

async function sendPushBatch(messages: { to: string; body: string }[]): Promise<void> {
  if (messages.length === 0) return;
  const payload = messages.map(({ to, body }) => ({ to, title: 'Hound', body, sound: 'default' }));
  // Expo's push API accepts up to 100 messages per request.
  for (let i = 0; i < payload.length; i += 100) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload.slice(i, i + 100)),
    }).catch(() => {
      // A batch failing shouldn't stop the rest, and there's no per-user
      // UI to report a push failure to anyway — same "never break,
      // quietly skip" fallback the rest of the app uses.
    });
  }
}

async function sendReminderEmail(resendApiKey: string, name: string, email: string, body: string): Promise<void> {
  if (await hasUnsubscribed(email)) return;
  const unsubscribe = await unsubscribeParts(email);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Hound <reminders@houndchallenge.net>',
      to: [email],
      subject: "Hound hasn't seen you today",
      headers: unsubscribe.headers,
      html:
        `<p>Hey ${escapeHtml(oneLine(name))},</p>` +
        `<p>${escapeHtml(body)}</p>` +
        `<p><a href="${HOUND_SIGNUP_URL}">Open Hound</a></p>` +
        unsubscribe.footer,
    }),
  }).catch(() => {
    // Same reasoning as sendPushBatch — one failed email shouldn't stop
    // the rest of the run.
  });
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Two callers, both explicit: the cron job itself (service role — see
  // 0010_login_reminders.sql), or a signed-in admin manually firing this
  // early to test it (SettingsScreen's dev-only "Developer tools" card,
  // via notifications/supabaseNotifications.ts's triggerLoginReminders —
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

  const { data: optedIn, error: profilesError } = await supabase
    .from('profiles')
    .select(
      'id, name, email, notify_push_enabled, notify_email_enabled, time_zone, last_active_at, last_login_reminder_sent_at',
    )
    .or('notify_push_enabled.eq.true,notify_email_enabled.eq.true')
    .returns<ProfileRow[]>();

  if (profilesError) {
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }

  // An admin's manual test run skips the hour check: everyone not yet
  // active (or reminded) today gets it now.
  const now = new Date();
  const candidates = (optedIn ?? []).filter((p) => {
    const clock = localClock(p.time_zone, now);
    if (isServiceRole && clock.hour !== REMINDER_HOUR) return false;
    const sameDay = (at: string | null) => !!at && localClock(p.time_zone, new Date(at)).day === clock.day;
    return !sameDay(p.last_active_at) && !sameDay(p.last_login_reminder_sent_at);
  });
  if (candidates.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Hounding off, or the phone already has today covered: skip. No row
  // means the default, gentle, with nothing scheduled.
  const ids = candidates.map((p) => p.id);
  const [{ data: houndRows }, { data: goalRows }] = await Promise.all([
    supabase.from('hound_settings').select('user_id, level, scheduled_through').in('user_id', ids).returns<HoundRow[]>(),
    supabase
      .from('goals')
      .select('user_id, metric, period, target, label')
      .in('user_id', ids)
      .is('archived_at', null)
      .order('sort')
      .returns<GoalRow[]>(),
  ]);
  const houndByUser = new Map((houndRows ?? []).map((h) => [h.user_id, h]));
  const goalsByUser = new Map<string, GoalRow[]>();
  for (const g of goalRows ?? []) {
    const list = goalsByUser.get(g.user_id) ?? [];
    list.push(g);
    goalsByUser.set(g.user_id, list);
  }
  const profiles = candidates.filter((p) => {
    const hound = houndByUser.get(p.id);
    if (hound?.level === 'off') return false;
    const today = localClock(p.time_zone, now).day;
    return !(hound?.scheduled_through && hound.scheduled_through >= today);
  });
  if (profiles.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  const pushRecipients = profiles.filter((p) => p.notify_push_enabled);
  let tokensByUser = new Map<string, string[]>();
  if (pushRecipients.length > 0) {
    const { data: tokenRows } = await supabase
      .from('device_push_tokens')
      .select('user_id, expo_push_token')
      .in('user_id', pushRecipients.map((p) => p.id))
      .returns<PushTokenRow[]>();
    for (const row of tokenRows ?? []) {
      const existing = tokensByUser.get(row.user_id) ?? [];
      existing.push(row.expo_push_token);
      tokensByUser.set(row.user_id, existing);
    }
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const pushes: { to: string; body: string }[] = [];
  const emailSends: Promise<void>[] = [];

  for (const profile of profiles) {
    const body = reminderBody(goalsByUser.get(profile.id) ?? []);
    if (profile.notify_push_enabled) {
      for (const to of tokensByUser.get(profile.id) ?? []) pushes.push({ to, body });
    }
    if (profile.notify_email_enabled && resendApiKey) {
      emailSends.push(sendReminderEmail(resendApiKey, profile.name, profile.email, body));
    }
  }

  await Promise.all([sendPushBatch(pushes), ...emailSends]);

  await supabase
    .from('profiles')
    .update({ last_login_reminder_sent_at: new Date().toISOString() })
    .in('id', profiles.map((p) => p.id));

  return new Response(JSON.stringify({ processed: profiles.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
