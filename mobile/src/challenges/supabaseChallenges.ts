import { supabase, signedInUserId } from '../lib/supabase';
import { isMissingFunction } from '../lib/rpcFallback';
import { levelForXp } from './ranks';
import { displayInitials, displayName, type DisplayableProfile } from '../profiles/displayName';
import { fetchAll } from '../lib/fetchAll';
import { headStartBaselineDayKey, inviteWindowClosed } from './board';
import type {
  Challenge,
  ChallengeBot,
  ChallengeInvite,
  ChallengesProvider,
  CreateChallengeInput,
  HuntRole,
  LeaderboardEntry,
  Participant,
} from './types';

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A profiles(...) join's raw shape (name, initials, username, use_username
// — see 0030_username.sql) wherever this file needs to show another
// participant's identity. Kept snake_case at the boundary, mapped to
// displayName.ts's own camelCase DisplayableProfile right where it's
// used, same as every other profiles column this file already reads.
interface ProfileRow {
  name: string;
  initials: string;
  username: string | null;
  use_username: boolean;
}

// Same profiles(...) join, plus the two equipped-cosmetics columns —
// separate from ProfileRow since only listParticipants (Participant
// needs these for Avatar) reads them; getLeaderboard's own join stays
// unchanged (nothing renders an Avatar off a raw LeaderboardEntry, see
// buildBoard's own comment).
interface ParticipantProfileRow extends ProfileRow {
  equipped_frame_id: string | null;
  equipped_background_id: string | null;
  equipped_icon_id: string | null;
  xp_total?: number | null;
}

function toDisplayable(p: ProfileRow): DisplayableProfile & { initials: string } {
  return { name: p.name, initials: p.initials, username: p.username, useUsername: p.use_username };
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function requireUserId(): Promise<string> {
  return signedInUserId();
}

// inviteWindowClosed (src/challenges/board.ts) only ever reads these four
// fields, but wants them as a Challenge — both call sites below only ever
// have this much of one (a bare `challenges` row, or the invite-select's
// joined subset), so this is the one place that shape gets cast rather
// than duplicating the same `as unknown as {...} as Challenge` twice.
function challengeRowToInviteWindowInput(row: {
  kind: Challenge['kind'];
  head_start_days: number | null;
  starts_at: string;
  created_at: string;
  duration_days: number;
}): Challenge {
  return {
    kind: row.kind,
    headStartDays: row.head_start_days,
    startsAt: row.starts_at,
    createdAt: row.created_at,
    durationDays: row.duration_days,
  } as Challenge;
}

const CHALLENGE_COLUMNS =
  'id, name, kind, created_by, duration_days, starts_at, start_day, created_at, ends_at, daily_goal_steps, scoring_method, head_start_days, distance_goal_mi, distance_goal_steps, distance_goal_unit, bingo_card_type, organization_id';

interface ChallengeRow {
  id: string;
  name: string;
  kind: Challenge['kind'];
  created_by: string;
  duration_days: number;
  starts_at: string;
  start_day: string | null;
  created_at: string;
  ends_at: string;
  daily_goal_steps: number | null;
  scoring_method: Challenge['scoringMethod'];
  head_start_days: number | null;
  distance_goal_mi: number | null;
  distance_goal_steps: number | null;
  distance_goal_unit: Challenge['distanceGoalUnit'];
  bingo_card_type: Challenge['bingoCardType'];
  organization_id: string | null;
}

interface ChallengeInviteRow {
  id: string;
  challenges: {
    id: string;
    name: string;
    kind: Challenge['kind'];
    duration_days: number;
    head_start_days: number | null;
    starts_at: string;
    created_at: string;
  } | null;
  inviter: { name: string; username: string | null; use_username: boolean } | null;
  role: HuntRole | null;
}

function rowToChallenge(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdBy: row.created_by,
    durationDays: row.duration_days,
    startsAt: row.starts_at,
    startDay: row.start_day,
    createdAt: row.created_at,
    endsAt: row.ends_at,
    dailyGoalSteps: row.daily_goal_steps,
    scoringMethod: row.scoring_method,
    headStartDays: row.head_start_days,
    distanceGoalMi: row.distance_goal_mi,
    distanceGoalSteps: row.distance_goal_steps,
    // Every pool created before 0013_distance_pool_unit.sql set
    // distance_goal_mi with no unit at all, in miles — read that
    // exactly as it already meant, rather than as "no goal."
    distanceGoalUnit: row.distance_goal_unit ?? (row.distance_goal_mi != null ? 'miles' : null),
    bingoCardType: row.bingo_card_type,
    organizationId: row.organization_id,
  };
}

export const supabaseChallengesProvider: ChallengesProvider = {
  async listMyChallenges(): Promise<Challenge[]> {
    const client = requireClient();
    const userId = await requireUserId();
    // An explicit inner-join filter, not a bare `select *` trusting RLS
    // alone to define "my challenges" — 0009_challenge_invites.sql's own
    // "Invitees can view challenges they're invited to" policy is a
    // second, independently permissive SELECT policy (Postgres ORs every
    // permissive policy for the same command together), added so the
    // invite card can read a challenge's name/kind/duration before it's
    // accepted. A bare `select *` here would return exactly those rows
    // too, showing a challenge someone's only been invited to — never
    // actually joined — as if it were already theirs. This join only
    // ever returns rows where the caller has a real
    // challenge_participants row: every creator gets one immediately
    // (see createChallenge below), and so does anyone who's accepted.
    const { data, error } = await client
      .from('challenges')
      .select(`${CHALLENGE_COLUMNS}, challenge_participants!inner(user_id)`)
      .eq('challenge_participants.user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToChallenge);
  },

  async getChallenge(challengeId: string): Promise<Challenge> {
    const client = requireClient();
    const { data, error } = await client
      .from('challenges')
      .select(CHALLENGE_COLUMNS)
      .eq('id', challengeId)
      .single();
    if (error) throw new Error(error.message);
    return rowToChallenge(data);
  },

  async listParticipants(challengeId: string): Promise<Participant[]> {
    const client = requireClient();
    const { data, error } = await client
      .from('challenge_participants')
      // profiles!user_id, not a bare profiles(...) embed — 0045 gave
      // challenge_participants a second FK to profiles (last_tagged_by),
      // so PostgREST can no longer auto-pick which relationship this
      // embed means and returns a 300 "multiple relationships" error on
      // every challenge, not just a 'tag' one, without this hint.
      .select(
        'user_id, role, highlighted, profiles!user_id(name, initials, username, use_username, equipped_frame_id, equipped_background_id, equipped_icon_id, xp_total)',
      )
      .eq('challenge_id', challengeId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const profile = row.profiles as unknown as ParticipantProfileRow | null;
      return {
        userId: row.user_id,
        name: profile ? displayName(toDisplayable(profile)) : 'Someone',
        initials: profile ? displayInitials(toDisplayable(profile)) : '?',
        role: (row.role as HuntRole | null) ?? null,
        highlighted: row.highlighted,
        frameId: profile?.equipped_frame_id ?? null,
        backgroundId: profile?.equipped_background_id ?? null,
        iconId: profile?.equipped_icon_id ?? null,
        level: levelForXp(profile?.xp_total),
      };
    });
  },

  async listBots(challengeId: string): Promise<ChallengeBot[]> {
    const client = requireClient();
    const { data, error } = await client
      .from('challenge_bots')
      .select('id, challenge_id, name, fitness_level, role')
      .eq('challenge_id', challengeId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      challengeId: row.challenge_id,
      name: row.name,
      fitnessLevel: row.fitness_level,
      role: (row.role as HuntRole | null) ?? null,
    }));
  },

  async getLeaderboard(challengeId: string, asOfDay?: string): Promise<LeaderboardEntry[]> {
    const client = requireClient();
    // Aggregated client-side rather than via a Postgres view/RPC — the
    // The rows are read a page at a time (see fetchAll) because a long
    // challenge goes past the 1000-row cap on a single read. Keeping the
    // aggregation in JS means the schema stays plain tables, nothing to
    // keep in sync on top of it.
    const data = await fetchAll((from, to) => {
      let query = client
        .from('progress_snapshots')
        .select('user_id, steps, distance_mi, profiles(name, initials, username, use_username)')
        .eq('challenge_id', challengeId);
      if (asOfDay) query = query.lte('day', asOfDay);
      return query.order('day').order('user_id').range(from, to);
    });

    const totals = new Map<string, LeaderboardEntry>();
    for (const row of data) {
      const profile = row.profiles as unknown as ProfileRow | null;
      const existing = totals.get(row.user_id);
      if (existing) {
        existing.totalSteps += row.steps;
        existing.totalDistanceMi += Number(row.distance_mi);
      } else {
        totals.set(row.user_id, {
          userId: row.user_id,
          name: profile ? displayName(toDisplayable(profile)) : 'Someone',
          initials: profile ? displayInitials(toDisplayable(profile)) : '?',
          totalSteps: row.steps,
          totalDistanceMi: Number(row.distance_mi),
        });
      }
    }
    return Array.from(totals.values()).sort((a, b) => b.totalSteps - a.totalSteps);
  },

  async createChallenge({
    name,
    kind,
    durationDays,
    dailyGoalSteps,
    scoringMethod,
    creatorRole,
    bots,
    headStartDays,
    distanceGoalMi,
    distanceGoalSteps,
    distanceGoalUnit,
    bingoCardType,
    startsAt: startsAtInput,
    organizationId,
  }: CreateChallengeInput): Promise<Challenge> {
    const client = requireClient();
    const userId = await requireUserId();
    const startsAt = startsAtInput ? new Date(startsAtInput) : new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 86_400_000);

    const { data, error } = await client
      .from('challenges')
      .insert({
        name,
        kind,
        created_by: userId,
        duration_days: durationDays,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        daily_goal_steps: dailyGoalSteps ?? null,
        scoring_method: scoringMethod ?? null,
        head_start_days: headStartDays ?? null,
        distance_goal_mi: distanceGoalMi ?? null,
        distance_goal_steps: distanceGoalSteps ?? null,
        distance_goal_unit: distanceGoalUnit ?? null,
        bingo_card_type: bingoCardType ?? null,
        organization_id: organizationId ?? null,
      })
      .select(CHALLENGE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    // The creator is a participant too — nothing else adds this row
    // automatically.
    const { error: joinError } = await client
      .from('challenge_participants')
      .insert({ challenge_id: data.id, user_id: userId, role: creatorRole ?? null });
    if (joinError) throw new Error(joinError.message);

    if (bots && bots.length > 0) {
      const { error: botsError } = await client.from('challenge_bots').insert(
        bots.map((b) => ({
          challenge_id: data.id,
          name: b.name,
          fitness_level: b.fitnessLevel,
          role: b.role ?? null,
        })),
      );
      if (botsError) throw new Error(botsError.message);
    }

    // Record the challenge's first calendar day as the creator sees it,
    // so every participant counts from that same day in their own time
    // zone (0085_challenge_start_day.sql). Best-effort: before 0085 has
    // run there's nothing to set, and the server's default still works
    // for creators in US Eastern time.
    await client
      .rpc('set_challenge_start_day', { p_challenge_id: data.id, p_day: localDateKey(startsAt) })
      .then(
        () => {},
        () => {},
      );

    return rowToChallenge(data);
  },

  async recordProgress(challengeId: string, steps: number, distanceMi: number, day?: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    // Local calendar day, not `.toISOString().slice(0, 10)` — that's UTC,
    // and ChallengeDetailScreen's device-sync backfill keys every day by
    // the *local* calendar (matching HealthKit/Health Connect's own
    // day-bucketing). A UTC default here would silently write a second,
    // differently-keyed row for "today" whenever local and UTC dates
    // differ, and getLeaderboard() sums every row with no dedup by real
    // calendar day — so the two would double-count the same day's steps.
    const resolvedDay = day ?? localDateKey(new Date());
    const { error } = await client
      .from('progress_snapshots')
      .upsert(
        { challenge_id: challengeId, user_id: userId, day: resolvedDay, steps, distance_mi: distanceMi },
        { onConflict: 'challenge_id,user_id,day' },
      );
    if (error) throw new Error(error.message);
  },

  async recordProgressDays(challengeId, days) {
    if (days.length === 0) return;
    const client = requireClient();
    const userId = await requireUserId();
    const { error } = await client.from('progress_snapshots').upsert(
      days.map((d) => ({ challenge_id: challengeId, user_id: userId, day: d.day, steps: d.steps, distance_mi: d.distanceMi })),
      { onConflict: 'challenge_id,user_id,day' },
    );
    if (!error) return;
    // One request is all or nothing: if any day is refused (say, the
    // server thinks it's outside the challenge), fall back to a request
    // per day so the rest still land, the way this always worked.
    await Promise.allSettled(
      days.map((d) => supabaseChallengesProvider.recordProgress(challengeId, d.steps, d.distanceMi, d.day)),
    );
  },

  async deleteChallenge(challengeId: string): Promise<void> {
    const client = requireClient();
    const { error } = await client.from('challenges').delete().eq('id', challengeId);
    if (error) throw new Error(error.message);
  },

  async getHighlightedChallenge(): Promise<Challenge | null> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data, error } = await client
      .from('challenge_participants')
      .select(`challenges!inner(${CHALLENGE_COLUMNS})`)
      .eq('user_id', userId)
      .eq('highlighted', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return rowToChallenge(data.challenges as unknown as ChallengeRow);
  },

  async setHighlighted(challengeId: string, highlighted: boolean): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    if (highlighted) {
      // Only one challenge can be highlighted at a time — clear whatever
      // this user had highlighted before (if anything) first.
      const { error: clearError } = await client
        .from('challenge_participants')
        .update({ highlighted: false })
        .eq('user_id', userId)
        .eq('highlighted', true);
      if (clearError) throw new Error(clearError.message);
    }
    const { error } = await client
      .from('challenge_participants')
      .update({ highlighted })
      .eq('challenge_id', challengeId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  },

  async listMyChallengeInvites(): Promise<ChallengeInvite[]> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data, error } = await client
      .from('challenge_invites')
      .select(
        'id, challenges(id, name, kind, duration_days, head_start_days, starts_at, created_at), ' +
          'inviter:profiles!challenge_invites_inviter_id_fkey(name, username, use_username), role',
      )
      .eq('invitee_id', userId);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as ChallengeInviteRow[]).filter((row) => row.challenges);

    // Same "found it stale, delete it" shape acceptChallengeInvite
    // already uses when someone actually taps Join on one of these —
    // done proactively here too, so a lapsed invite disappears from the
    // list instead of sitting there indefinitely with dead Join/Decline
    // buttons until someone taps one and gets an error.
    const expiredIds = rows.filter((row) => inviteWindowClosed(challengeRowToInviteWindowInput(row.challenges!))).map((row) => row.id);
    if (expiredIds.length > 0) {
      client
        .from('challenge_invites')
        .delete()
        .in('id', expiredIds)
        .then(() => {}, () => {});
    }

    return rows
      .filter((row) => !expiredIds.includes(row.id))
      .map((row) => ({
        id: row.id,
        challengeId: row.challenges!.id,
        challengeName: row.challenges!.name,
        challengeKind: row.challenges!.kind,
        durationDays: row.challenges!.duration_days,
        inviterName: row.inviter
          ? displayName({ name: row.inviter.name, username: row.inviter.username, useUsername: row.inviter.use_username })
          : 'Someone',
        role: row.role,
      }));
  },

  async inviteFriendToChallenge(challengeId: string, friendUserId: string, role?: HuntRole): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();

    // Mirrors acceptChallengeInvite's own check below — this is what
    // keeps the inviter from sending an invite that's just going to get
    // refused (and cleaned up) the moment anyone tries to accept it.
    const { data: c, error: challengeError } = await client
      .from('challenges')
      .select('kind, head_start_days, starts_at, created_at, duration_days')
      .eq('id', challengeId)
      .single();
    if (challengeError) throw new Error(challengeError.message);
    if (inviteWindowClosed(challengeRowToInviteWindowInput(c))) {
      throw new Error("It's been more than 24 hours since this challenge started — new invites are closed.");
    }

    const { data, error } = await client
      .from('challenge_invites')
      .insert({ challenge_id: challengeId, inviter_id: userId, invitee_id: friendUserId, role: role ?? null })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('Already invited.');
      throw new Error(error.message);
    }
    // Best-effort, same reasoning CreateScreen's own invite calls use
    // Promise.allSettled for: the invite itself already saved
    // successfully by this point, so a failed email (no RESEND_API_KEY
    // set, Resend rejecting an unverified domain, whatever) shouldn't
    // read as "could not invite that friend" — the in-app invite card
    // still works regardless of whether this email ever arrives.
    client.functions.invoke('send-challenge-invite-email', { body: { inviteId: data.id } }).catch(() => {});
  },

  async listSentChallengeInvites(challengeId: string): Promise<string[]> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data, error } = await client
      .from('challenge_invites')
      .select('invitee_id')
      .eq('challenge_id', challengeId)
      .eq('inviter_id', userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.invitee_id);
  },

  async remindChallengeInvite(challengeId: string, friendUserId: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data: invite, error: fetchError } = await client
      .from('challenge_invites')
      .select('id')
      .eq('challenge_id', challengeId)
      .eq('inviter_id', userId)
      .eq('invitee_id', friendUserId)
      .maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!invite) throw new Error('That invite is no longer pending.');
    const { error: sendError } = await client.functions.invoke('send-challenge-invite-email', {
      body: { inviteId: invite.id },
    });
    if (sendError) throw new Error('Could not send the reminder — try again.');
  },

  async acceptChallengeInvite(inviteId: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    const { data: invite, error: fetchError } = await client
      .from('challenge_invites')
      .select('challenge_id, role, challenges(kind, head_start_days, starts_at, created_at, duration_days)')
      .eq('id', inviteId)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    // Once the invite window's closed (a hunt's own head start, or the
    // flat 24h-from-start fallback everything else uses — see
    // inviteWindowClosed's own comment), accepting now would let someone
    // join with a clean read on where everyone else already stands
    // instead of facing the same clock as everyone else. The invite row
    // itself is deleted here too, not just refused — otherwise it sits
    // there forever as a pending invite its recipient can never actually
    // act on.
    const c = invite.challenges as unknown as {
      kind: Challenge['kind'];
      head_start_days: number | null;
      starts_at: string;
      created_at: string;
      duration_days: number;
    } | null;
    if (c && inviteWindowClosed(challengeRowToInviteWindowInput(c))) {
      await client.from('challenge_invites').delete().eq('id', inviteId);
      throw new Error(
        c.kind === 'hunt' && c.head_start_days
          ? "This chase's head start has already ended — this invite has expired."
          : "It's been more than 24 hours since this challenge started — this invite has expired.",
      );
    }

    // A plain insert, not an upsert: `.upsert(..., { ignoreDuplicates })`
    // compiles to `INSERT ... ON CONFLICT DO NOTHING`, and Postgres RLS
    // requires the executing role to satisfy the table's SELECT policy
    // for the conflict-arbiter check itself — even when no conflict
    // actually exists. The invitee accepting for the first time isn't a
    // participant yet (that's exactly what this insert is trying to
    // make them), so "Participants can view each other" always returns
    // false for them, and the whole statement gets rejected as an RLS
    // violation before it ever gets to check for a real conflict. A
    // plain insert has no such requirement. A retry after a failed
    // delete below (already joined, invite row still there) instead
    // hits challenge_participants' own unique(challenge_id, user_id)
    // constraint (Postgres code 23505) — caught and treated as success,
    // same reasoning inviteFriendToChallenge already uses for "Already
    // invited."
    const { error: joinError } = await client
      .from('challenge_participants')
      .insert({ challenge_id: invite.challenge_id, user_id: userId, role: invite.role ?? null });
    if (joinError && joinError.code !== '23505') throw new Error(joinError.message);

    const { error: deleteError } = await client.from('challenge_invites').delete().eq('id', inviteId);
    if (deleteError) throw new Error(deleteError.message);
  },

  async declineChallengeInvite(inviteId: string): Promise<void> {
    const client = requireClient();
    const { error } = await client.from('challenge_invites').delete().eq('id', inviteId);
    if (error) throw new Error(error.message);
  },

  async markCaught(challengeId: string): Promise<void> {
    const client = requireClient();
    const userId = await requireUserId();
    // No `.eq('role', 'hunted')` guard here — going from 'zombie' to
    // 'zombie' is a no-op write either way, and the caller
    // (ChallengeDetailScreen) already only calls this once it's seen
    // the board compute 'zombie' for this exact user.
    const { error } = await client
      .from('challenge_participants')
      .update({ role: 'zombie' })
      .eq('challenge_id', challengeId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  },

  async applyHuntCatches(challengeId: string): Promise<number | null> {
    const client = requireClient();
    const { data, error } = await client.rpc('hunt_apply_catches', { p_challenge_id: challengeId });
    if (error) {
      // The function isn't there yet (0119 hasn't run).
      if (isMissingFunction(error)) return null;
      throw new Error(error.message);
    }
    return typeof data === 'number' ? data : 0;
  },
};

// A single-row existence check for "have I logged progress today" —
// standalone rather than part of ChallengesProvider above, same shape as
// seventyFiveApi.ts's isMySeventyFiveTodayComplete: built for the Home
// screen's pending-actions aggregator, which only needs a yes/no per
// manual-entry challenge, not a full leaderboard read. No row for today
// reads as "not logged" — recordProgress always upserts a real row
// (including an explicit zero), so presence alone is the right signal,
// not the values inside it.
export async function hasLoggedProgressToday(challengeId: string, userId: string): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client
    .from('progress_snapshots')
    .select('challenge_id')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .eq('day', localDateKey(new Date()))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

// What buildBoard (board.ts) needs for one challenge.
export interface BoardInputs {
  participants: Participant[];
  leaderboard: LeaderboardEntry[];
  bots: ChallengeBot[];
  // Everyone's totals as of a hunt's head start ending; empty otherwise.
  headStartLeaderboard: LeaderboardEntry[];
}

interface BoardParticipantRow extends ProfileRow {
  xp_total: number | null;
  user_id: string;
  role: string | null;
  highlighted: boolean;
  frame_id: string | null;
  background_id: string | null;
  icon_id: string | null;
  steps: number | null;
  distance_mi: number | string | null;
  as_of_steps: number | null;
  as_of_distance_mi: number | string | null;
}

function needsHeadStart(c: Challenge): boolean {
  return c.kind === 'hunt' && !!c.headStartDays;
}

// challenge_boards (0110_challenge_boards.sql): every challenge's board
// inputs in one request, added up in Postgres. Null when it can't (before
// 0110 has run); a challenge the caller isn't in is left out.
async function fetchChallengeBoards(challenges: Challenge[]): Promise<Map<string, BoardInputs> | null> {
  const client = requireClient();
  const { data, error } = await client.rpc('challenge_boards', {
    p_challenge_ids: challenges.map((c) => c.id),
    p_as_of_days: challenges.map((c) => (needsHeadStart(c) ? headStartBaselineDayKey(c) : null)),
  });
  if (error) return null;
  const boards = new Map<string, BoardInputs>();
  for (const row of (data ?? []) as { challenge_id: string; participants: BoardParticipantRow[]; bots: any[] }[]) {
    const participants: Participant[] = [];
    const leaderboard: LeaderboardEntry[] = [];
    const headStartLeaderboard: LeaderboardEntry[] = [];
    for (const p of row.participants ?? []) {
      const known = p.name != null;
      const profile = { name: p.name, initials: p.initials, username: p.username, use_username: p.use_username };
      const name = known ? displayName(toDisplayable(profile)) : 'Someone';
      const initials = known ? displayInitials(toDisplayable(profile)) : '?';
      participants.push({
        userId: p.user_id,
        name,
        initials,
        role: (p.role as HuntRole | null) ?? null,
        highlighted: p.highlighted,
        frameId: p.frame_id ?? null,
        backgroundId: p.background_id ?? null,
        iconId: p.icon_id ?? null,
        level: levelForXp(p.xp_total),
      });
      // Like getLeaderboard: only people with logged progress have a row.
      if (p.steps != null) {
        leaderboard.push({ userId: p.user_id, name, initials, totalSteps: Number(p.steps), totalDistanceMi: Number(p.distance_mi ?? 0) });
      }
      if (p.as_of_steps != null) {
        headStartLeaderboard.push({
          userId: p.user_id,
          name,
          initials,
          totalSteps: Number(p.as_of_steps),
          totalDistanceMi: Number(p.as_of_distance_mi ?? 0),
        });
      }
    }
    leaderboard.sort((a, b) => b.totalSteps - a.totalSteps);
    headStartLeaderboard.sort((a, b) => b.totalSteps - a.totalSteps);
    const bots: ChallengeBot[] = (row.bots ?? []).map((b) => ({
      id: b.id,
      challengeId: row.challenge_id,
      name: b.name,
      fitnessLevel: b.fitness_level,
      role: (b.role as HuntRole | null) ?? null,
    }));
    boards.set(row.challenge_id, { participants, leaderboard, bots, headStartLeaderboard });
  }
  return boards;
}

// One challenge the old way: three or four requests.
async function loadBoardInputsSeparately(c: Challenge): Promise<BoardInputs> {
  const [participants, leaderboard, bots, headStartLeaderboard] = await Promise.all([
    supabaseChallengesProvider.listParticipants(c.id),
    supabaseChallengesProvider.getLeaderboard(c.id),
    supabaseChallengesProvider.listBots(c.id),
    needsHeadStart(c) ? supabaseChallengesProvider.getLeaderboard(c.id, headStartBaselineDayKey(c)) : Promise.resolve([]),
  ]);
  return { participants, leaderboard, bots, headStartLeaderboard };
}

// Board inputs for many challenges at once (Today, the Challenges tab):
// one challenge_boards request, and the old per-challenge requests only
// for whatever it didn't return.
export async function loadBoardInputs(challenges: Challenge[]): Promise<Map<string, BoardInputs>> {
  const boards = new Map<string, BoardInputs>();
  if (challenges.length === 0) return boards;
  const fetched = await fetchChallengeBoards(challenges).catch(() => null);
  await Promise.all(
    challenges.map(async (c) => {
      boards.set(c.id, fetched?.get(c.id) ?? (await loadBoardInputsSeparately(c)));
    }),
  );
  return boards;
}
