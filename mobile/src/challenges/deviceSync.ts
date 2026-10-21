import { supabaseChallengesProvider } from './supabaseChallenges';
import { usesDeviceSteps, usesWorkoutDistance } from './scoring';
import { classifyWorkout, DEFAULT_BINGO_CARD_TYPE, type BingoCategory } from './bingo';
import { recordBingoProgress } from './bingoApi';
import { recordSeventyFiveWorkouts } from './seventyFiveApi';
import { getChallengeDays, localDayKey as dateKey, workoutCounts } from './challengeDays';
import type { Challenge } from './types';
import type { DailyStepsWithDate, HealthProvider, WorkoutSample } from '../health/types';

const DAY_MS = 86_400_000;
// Late steps still count until a challenge settles, a day after it ends
// (0095_settlement_rules.sql); one more day covers time zones.
const SYNC_AFTER_END_MS = 2 * DAY_MS;

// Whether a sync can still change anything: the challenge is running or
// ended in the last two days. Today used to re-sync every challenge you'd
// ever been in on every open.
export function isWorthSyncing(challenge: Challenge, now: number = Date.now()): boolean {
  return new Date(challenge.endsAt).getTime() > now - SYNC_AFTER_END_MS;
}

// A health provider for syncing several challenges at once: the phone's
// daily steps (back to the earliest start among them) and recent
// workouts are read once and shared, instead of once per challenge. Each
// sync below already keeps only the days and workouts inside its own
// challenge, so the extra earlier days are harmless.
export function sharedHealthReads(health: HealthProvider, challenges: Challenge[]): HealthProvider {
  const earliest = challenges.reduce(
    (min, c) => Math.min(min, new Date(c.startsAt).getTime()),
    Number.POSITIVE_INFINITY,
  );
  // Two days early: a challenge's first day can be the day before it
  // starts in this phone's time zone (challengeDays.ts).
  const since = new Date(Number.isFinite(earliest) ? earliest - 2 * DAY_MS : Date.now());
  since.setHours(0, 0, 0, 0);
  let days: Promise<DailyStepsWithDate[]> | null = null;
  let workouts: Promise<WorkoutSample[]> | null = null;
  const shared = Object.create(health) as HealthProvider;
  shared.getDailyStepsSince = (from: Date) =>
    from.getTime() >= since.getTime()
      ? (days ??= health.getDailyStepsSince(since))
      : health.getDailyStepsSince(from);
  shared.getRecentWorkouts = (limit: number) =>
    limit <= 200 ? (workouts ??= health.getRecentWorkouts(200)).then((w) => w.slice(0, limit)) : health.getRecentWorkouts(limit);
  return shared;
}

// Backfills one challenge's entire progress from real device history —
// every calendar day from when it started through today, not just
// today — using the same upsert-by-day recordProgress() the manual form
// uses, just filled in from the device instead of typed in. Re-running
// this on every sync is deliberate and harmless (it's an upsert): it
// catches up a challenge someone joined after it started, or picks back
// up correctly after a few days of not opening the app, without a
// separate "first ever sync" code path. Which number depends on what
// this challenge is scored on: a plain step count, or distance summed
// from logged workouts. 'gps_distance' trusts WorkoutSample.isOutdoor
// when a platform provides it (iOS, from HealthKit's own workout
// metadata) and only falls back to guessing from the workout's name
// when it doesn't (Android, or an iOS workout with no indoor/outdoor
// metadata at all) — that fallback still means a treadmill session or a
// phone-in-a-drawer walk can slip through if its name happens to match,
// a real limitation on the platforms/workouts that don't carry the real
// signal, not a hidden bug.
//
// Shared by ChallengeDetailScreen (syncs the one challenge currently
// open) and HomeScreen (syncs every active device-scored challenge on
// every load) — see HomeScreen's own comment on why the latter exists:
// progress used to only ever reach the server as a side effect of
// opening that exact challenge's own detail screen, so a participant
// who joined but never opened it individually stayed at 0 forever
// despite their device logging real steps the whole time.
export async function syncChallengeProgressFromDevice(challenge: Challenge, health: HealthProvider): Promise<void> {
  // Sample data isn't real activity (the same rule backgroundSync.ts
  // follows): it must never reach a challenge's scores.
  if (health.platform === 'mock') return;
  if (!usesDeviceSteps(challenge) && !usesWorkoutDistance(challenge)) return;
  try {
    // The challenge's calendar days, the same for everyone in their own
    // time zone (challengeDays.ts). Local day keys throughout, compared
    // the same way todayKey is.
    const days = await getChallengeDays(challenge);
    const startDayKey = days.firstDay;
    const endCap = days.lastDay;
    const todayKey = dateKey(new Date());
    if (todayKey < startDayKey) return;

    if (usesWorkoutDistance(challenge)) {
      // Enough of a lookback to plausibly cover the whole challenge —
      // getRecentWorkouts() takes a count, not a date range, so this
      // over-fetches slightly and filters client-side instead.
      const workouts = await health.getRecentWorkouts(200);
      // By calendar day, plus — for a challenge started "Now" — the exact
      // moment on the first day, since a workout carries its own start
      // time (see workoutCounts).
      const inRange = workouts.filter((w) => workoutCounts(days, w.when));
      // isOutdoor is a real per-workout signal where the platform can give
      // one (currently iOS only, from HealthKit's own indoor/outdoor
      // metadata — see health/types.ts) — trust it definitively, true or
      // false, over the name guess. `??` is exactly right here: it only
      // falls through to the name check when isOutdoor is undefined
      // ("platform doesn't know"), not when it's false ("platform knows
      // this was indoor").
      const relevant =
        challenge.scoringMethod === 'gps_distance'
          ? inRange.filter((w) => w.isOutdoor ?? /run|walk|jog|hik/i.test(w.name))
          : inRange;

      const byDay = new Map<string, number>();
      for (const w of relevant) {
        const key = dateKey(w.when);
        byDay.set(key, (byDay.get(key) ?? 0) + (w.distanceMi ?? 0));
      }
      // Today always gets an explicit (possibly zero) row, same as
      // before this backfilled past days too — otherwise a day with no
      // matching workout yet would just never get synced at all.
      if (!byDay.has(todayKey) && todayKey <= endCap) byDay.set(todayKey, 0);

      await supabaseChallengesProvider.recordProgressDays(
        challenge.id,
        Array.from(byDay.entries()).map(([day, distanceMi]) => ({ day, steps: 0, distanceMi })),
      );
    } else {
      // getDailyStepsSince is asked for history back to the
      // challenge's start, but still gets clamped to
      // [startDayKey, endCap] here rather than trusted as-is — a
      // provider can hand back a bucket just outside that range (a
      // day before the challenge existed, one past its end) and
      // that's never real progress for it. A past day with no actual
      // device data (0 steps and 0 distance) is dropped rather than
      // written as an explicit zero — that's "nothing recorded", not
      // "recorded a zero" — except today, which always gets a row so
      // the screen doesn't look unsynced before you've taken a step.
      const [sy, sm, sd] = startDayKey.split('-').map(Number);
      const daily = (await health.getDailyStepsSince(new Date(sy, sm - 1, sd))).filter(
        (d) =>
          d.date >= startDayKey &&
          d.date <= endCap &&
          (d.date === todayKey || d.steps > 0 || d.distanceMi > 0),
      );
      await supabaseChallengesProvider.recordProgressDays(
        challenge.id,
        daily.map((d) => ({ day: d.date, steps: d.steps, distanceMi: d.distanceMi })),
      );
    }
  } catch {
    // Best-effort — every caller of this already treats a sync failure
    // as silent (ChallengeDetailScreen's own screen has no "Your
    // progress" card left to surface an error on; HomeScreen's own load
    // already swallows failures the same way for its other fetches).
  }
}

// Bingo's own sync path — deliberately separate from
// syncChallengeProgressFromDevice above rather than folded into
// usesWorkoutDistance: a bingo challenge isn't steps- or
// distance-ranked at all (see scoring.ts), it just needs to know which
// of its 9 categories (bingo.ts's BINGO_CARD_CATEGORIES, keyed by the
// challenge's own bingoCardType) each recent workout classifies into.
// Shared by the same two call sites as the function above
// (ChallengeDetailScreen's syncFromDevice, HomeScreen's per-active-
// challenge sync loop).
export async function syncBingoProgressFromDevice(challenge: Challenge, health: HealthProvider): Promise<void> {
  // Sample data isn't real activity (the same rule backgroundSync.ts
  // follows): it must never reach a challenge's scores.
  if (health.platform === 'mock') return;
  if (challenge.kind !== 'bingo') return;
  try {
    const cardType = challenge.bingoCardType ?? DEFAULT_BINGO_CARD_TYPE;
    const days = await getChallengeDays(challenge);
    const workouts = await health.getRecentWorkouts(200);
    const inRange = workouts.filter((w) => workoutCounts(days, w.when));
    // First match per category wins — which specific workout gets
    // credited only matters for the "linked to <name>" caption a filled
    // square shows (see BingoProgressRow), not for whether the square is
    // filled at all.
    const byCategory = new Map<BingoCategory, WorkoutSample>();
    for (const w of inRange) {
      const category = classifyWorkout(w.name, cardType);
      if (!byCategory.has(category)) byCategory.set(category, w);
    }
    // Re-attempts every category found in this window on every sync, even
    // ones already filled — recordBingoProgress's own upsert makes an
    // already-filled square a cheap no-op (and, critically, never
    // overwrites a manual link — see that function's own comment), same
    // "re-running this is deliberate and harmless" reasoning the
    // steps/distance sync above already relies on, rather than tracking
    // which categories this device has already reported.
    //
    // allSettled, not all — one category's workout already belonging to a
    // different square (0054_bingo_workout_key.sql's own unique index)
    // rejects that one write, and Promise.all would otherwise cancel every
    // other category's write in this same pass over one already-known,
    // recoverable conflict. There's nothing to surface for an individual
    // rejection here (this whole function is best-effort, see the catch
    // below) — the next sync tries again regardless.
    await Promise.allSettled(
      Array.from(byCategory.entries()).map(([category, w]) =>
        recordBingoProgress(challenge.id, category, 'auto', { id: w.id, name: w.name, when: w.when, day: dateKey(w.when) }),
      ),
    );
  } catch {
    // Best-effort, same reasoning as syncChallengeProgressFromDevice's own
    // catch above.
  }
}

// A 75 Day Challenge's own two device-tracked checklist items —
// deliberately separate from syncChallengeProgressFromDevice above, same
// reasoning syncBingoProgressFromDevice's own comment gives: this isn't a
// single steps-or-distance total for the whole challenge, it's "did at
// least one/two workouts happen on this specific day," a per-day
// presence check rather than an aggregate. workout1Done just needs any
// workout that day; workout2Outdoor additionally needs a second workout
// AND at least one of the day's workouts flagged (or guessed) outdoor —
// same isOutdoor-or-name-heuristic signal a 'gps_distance' challenge
// already relies on (see syncChallengeProgressFromDevice's own comment).
// The four self-report items (diet/water/reading/photo) have no device
// signal at all and are never touched here — only
// setSelfReportCheckin (seventyFiveApi.ts) ever writes those columns, so
// this function's upserts can never clobber them.
export async function syncSeventyFiveFromDevice(challenge: Challenge, health: HealthProvider): Promise<void> {
  // Sample data isn't real activity (the same rule backgroundSync.ts
  // follows): it must never reach a challenge's scores.
  if (health.platform === 'mock') return;
  if (challenge.kind !== 'seventyfive') return;
  try {
    const days = await getChallengeDays(challenge);
    const todayKey = dateKey(new Date());
    // Before your own first day (you're west of whoever created it):
    // nothing to record yet.
    if (todayKey < days.firstDay) return;

    const workouts = await health.getRecentWorkouts(200);
    const inRange = workouts.filter((w) => workoutCounts(days, w.when));

    const byDay = new Map<string, WorkoutSample[]>();
    for (const w of inRange) {
      const key = dateKey(w.when);
      const existing = byDay.get(key);
      if (existing) existing.push(w);
      else byDay.set(key, [w]);
    }
    // Today always gets an explicit (possibly all-false) row, same as
    // syncChallengeProgressFromDevice's own todayKey handling — otherwise
    // a day with no workout logged yet would just never sync at all.
    if (!byDay.has(todayKey) && todayKey <= days.lastDay) byDay.set(todayKey, []);

    await Promise.all(
      Array.from(byDay.entries()).map(([day, dayWorkouts]) => {
        const workout1Done = dayWorkouts.length >= 1;
        const workout2OutdoorDone =
          dayWorkouts.length >= 2 && dayWorkouts.some((w) => w.isOutdoor ?? /run|walk|jog|hik/i.test(w.name));
        return recordSeventyFiveWorkouts(challenge.id, day, workout1Done, workout2OutdoorDone);
      }),
    );
  } catch {
    // Best-effort, same reasoning as syncChallengeProgressFromDevice's own
    // catch above.
  }
}
