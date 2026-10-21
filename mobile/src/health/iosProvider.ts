import {
  authorizationStatusFor,
  AuthorizationStatus,
  getMostRecentQuantitySample,
  isHealthDataAvailableAsync,
  queryQuantitySamples,
  queryStatisticsCollectionForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
  WorkoutActivityType,
} from '@kingstinct/react-native-healthkit';
import type {
  DailySteps,
  DailyStepsWithDate,
  HealthAuthStatus,
  HealthProvider,
  HealthSnapshot,
  WorkoutSample,
} from './types';
import { pickNonOverlapping } from './dedupeWorkouts';

// Real HealthKit integration via @kingstinct/react-native-healthkit (a Nitro
// Module — React Native's New Architecture only). Requires a custom dev
// client or a standalone build (`npx expo prebuild` + `expo run:ios`, or an
// EAS dev-client build) — HealthKit is a native module and is NOT available
// in Expo Go.
//
// This project previously used `react-native-health`, a legacy (non-Turbo)
// native module. As of React Native 0.82, Old Architecture support has been
// removed from React Native's own Podfile tooling entirely (see
// `react_native_pods.rb`'s `warn_if_new_arch_disabled` — pod install always
// forces `RCT_NEW_ARCH_ENABLED=1` now, so `newArchEnabled: false` in
// app.json is a no-op on current React Native). `react-native-health` never
// registered its native module with the JS bridge under bridgeless mode
// (every call — starting with `isAvailable()` — threw `TypeError: undefined
// is not a function`), and its last release (1.19.0) predates any fix.
// Switching to a Nitro-based library sidesteps the whole legacy-bridge
// interop problem instead of patching around it.

const READ_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierBodyMass',
  'HKWorkoutTypeIdentifier',
] as const;

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Every steps/distance figure in this file (Home's "today", Metrics' 7-day
// chart, challenge backfill) comes from these per-local-day totals, so
// they can't disagree with each other. They use HealthKit's statistics
// *collection* query — what the Health app's own day totals are built on —
// because it splits a sample that crosses a day boundary proportionally
// between the two days. A plain queryStatisticsForQuantity over one day's
// range instead counts any sample that merely overlaps the range in full,
// so a source that writes long step samples (common for third-party
// trackers) inflates every day it touches. Anchored at local midnight, so
// each bucket is a local calendar day.
async function dailyStepTotals(start: Date, end: Date): Promise<Map<string, number>> {
  const buckets = await orDefault(
    queryStatisticsCollectionForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], start, { day: 1 }, {
      filter: { date: { startDate: start, endDate: end } },
      unit: 'count',
    }),
    [],
  );
  return totalsByDay(buckets, start);
}

async function dailyDistanceTotalsMi(start: Date, end: Date): Promise<Map<string, number>> {
  const buckets = await orDefault(
    queryStatisticsCollectionForQuantity('HKQuantityTypeIdentifierDistanceWalkingRunning', ['cumulativeSum'], start, { day: 1 }, {
      filter: { date: { startDate: start, endDate: end } },
      unit: 'mi',
    }),
    [],
  );
  return totalsByDay(buckets, start);
}

// A sample straddling `start` makes HealthKit return an extra bucket for
// the day before it (the old chart's stray eighth bar) — dropped here.
function totalsByDay(
  buckets: readonly { startDate?: Date; sumQuantity?: { quantity: number } }[],
  start: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of buckets) {
    if (!b.startDate || b.startDate.getTime() < start.getTime()) continue;
    out.set(dateKey(b.startDate), b.sumQuantity?.quantity ?? 0);
  }
  return out;
}

// HealthKit throws (`Error Domain=com.apple.healthkit Code=5 "Authorization
// not determined"`) if a read is attempted before requestAuthorization has
// ever been called for that type — which happens routinely here, since
// screens query data as soon as they mount, before the user has necessarily
// visited the Connect screen. That's an expected, non-exceptional state
// (equivalent to "no data yet"), not a bug to crash over, so every read
// below is wrapped to fall back to a safe default instead of rejecting.
function orDefault<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}

export const iosHealthProvider: HealthProvider = {
  platform: 'ios',
  platformLabel: 'Apple Health',

  async isAvailable(): Promise<boolean> {
    return isHealthDataAvailableAsync();
  },

  async getAuthorizationStatus(): Promise<HealthAuthStatus> {
    // Apple's read-authorization status is deliberately unreliable by
    // design (HealthKit never tells an app whether a *read* permission was
    // granted or denied, only whether a request was ever made) — treat
    // "not determined" as the only meaningful distinct status and
    // everything else as authorized, matching requestAuthorization below.
    //
    // Guarded the same way androidProvider.ts's own version now is —
    // this is the one call RootNavigator's connect gate awaits on every
    // fresh sign-in with no catch of its own, so a throw here (e.g.
    // HealthKit genuinely unavailable) would leave that gate stuck on
    // 'checking' forever instead of just treating it as unavailable.
    try {
      const status = authorizationStatusFor('HKQuantityTypeIdentifierStepCount');
      return status === AuthorizationStatus.notDetermined ? 'not-determined' : 'authorized';
    } catch {
      return 'unavailable';
    }
  },

  async requestAuthorization(): Promise<HealthAuthStatus> {
    try {
      await requestAuthorization({ toRead: READ_TYPES, toShare: [] });
      return 'authorized';
    } catch {
      return 'denied';
    }
  },

  async getSnapshot(): Promise<HealthSnapshot> {
    const todayStart = startOfDay(new Date());
    const now = new Date();

    const [steps, distance, restingHr, weight] = await Promise.all([
      dailyStepTotals(todayStart, now),
      dailyDistanceTotalsMi(todayStart, now),
      orDefault(getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate', 'count/min'), undefined),
      orDefault(getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'lb'), undefined),
    ]);
    const todayKey = dateKey(todayStart);

    return {
      stepsToday: Math.round(steps.get(todayKey) ?? 0),
      distanceTodayMi: Math.round((distance.get(todayKey) ?? 0) * 10) / 10,
      restingHeartRateBpm: restingHr ? Math.round(restingHr.quantity) : null,
      latestWeightLb: weight ? Math.round(weight.quantity * 10) / 10 : null,
      source: 'Apple Health',
      lastSyncedAt: new Date(),
    };
  },

  async getWeeklySteps(): Promise<DailySteps[]> {
    const now = new Date();
    const today = startOfDay(now);
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    const totals = await dailyStepTotals(start, now);

    const out: DailySteps[] = [];
    for (const d = new Date(start); d.getTime() <= today.getTime(); d.setDate(d.getDate() + 1)) {
      out.push({
        date: d.toLocaleDateString(undefined, { weekday: 'short' }),
        steps: Math.round(totals.get(dateKey(d)) ?? 0),
      });
    }
    return out;
  },

  async getHeartRateSeries(days: number): Promise<number[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));

    const samples = await orDefault(
      queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate', {
        limit: 0,
        ascending: true,
        unit: 'count/min',
        filter: { date: { startDate, endDate } },
      }),
      [],
    );
    return samples.map((s) => s.quantity);
  },

  async getWeightSeries(days: number): Promise<number[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));

    const samples = await orDefault(
      queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
        limit: 0,
        ascending: true,
        unit: 'lb',
        filter: { date: { startDate, endDate } },
      }),
      [],
    );
    return samples.map((s) => s.quantity);
  },

  async getRecentWorkouts(limit: number): Promise<WorkoutSample[]> {
    // The last 30 days, newest first, same window as androidProvider.
    // Without the date range this was only "the newest `limit` records",
    // which for someone who logs a lot (and has Watch + iPhone duplicates,
    // see below) covered as little as 11 days, so readiness never saw the
    // 3+ weeks of history it needs (#232).
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 86_400_000);
    const rawWorkouts = await orDefault(
      queryWorkoutSamples({ limit, ascending: false, filter: { date: { startDate, endDate } } }),
      [],
    );
    // See dedupeWorkouts.ts's own comment — a Watch + companion-app pair
    // both writing the same session shows up here as two HKWorkout
    // records with the same activity type and overlapping start/end.
    const workouts = pickNonOverlapping(rawWorkouts, (w) => ({
      activityKey: String(w.workoutActivityType),
      startMs: w.startDate.getTime(),
      endMs: w.endDate.getTime(),
      richness: (w.totalDistance?.quantity ? 1 : 0) + (w.totalEnergyBurned?.quantity ? 1 : 0),
    }));
    return Promise.all(
      workouts.map(async (w) => {
        const distanceStat = await orDefault(
          w.getStatistic('HKQuantityTypeIdentifierDistanceWalkingRunning', 'mi'),
          undefined,
        );
        return {
          id: w.uuid,
          name: workoutActivityName(w.workoutActivityType),
          when: w.startDate,
          source: 'Apple Health',
          distanceMi: distanceStat?.sumQuantity?.quantity,
          // HKIndoorWorkout is only present when whatever logged the
          // workout actually recorded it (the Workout app does; a lot of
          // third-party apps and manual entries don't) — absent means
          // "unknown", not "outdoor", so this has to stay undefined rather
          // than defaulting to a guess; deviceSync.ts's name heuristic is
          // the fallback for that case.
          isOutdoor: w.metadata.HKIndoorWorkout == null ? undefined : !w.metadata.HKIndoorWorkout,
          manual: wasUserEntered(w.metadata) ? true : undefined,
          avgHeartRate: undefined,
          // w.duration is HKWorkout's own duration Quantity, always in
          // seconds (NSTimeInterval) — no unit param to request like the
          // getStatistic calls above take, since HealthKit hands this one
          // back pre-computed.
          durationMin: w.duration?.quantity != null ? Math.round(w.duration.quantity / 60) : undefined,
        };
      }),
    );
  },

  async getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]> {
    const now = new Date();
    const today = startOfDay(now);
    const start = startOfDay(since);
    const [steps, distance] = await Promise.all([dailyStepTotals(start, now), dailyDistanceTotalsMi(start, now)]);

    const out: DailyStepsWithDate[] = [];
    for (const d = new Date(start); d.getTime() <= today.getTime(); d.setDate(d.getDate() + 1)) {
      const key = dateKey(d);
      out.push({
        date: key,
        steps: Math.round(steps.get(key) ?? 0),
        distanceMi: Math.round((distance.get(key) ?? 0) * 10) / 10,
      });
    }
    return out;
  },

  async canReadNow(): Promise<boolean> {
    const now = new Date();
    const today = startOfDay(now);
    try {
      await queryStatisticsCollectionForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], today, { day: 1 }, {
        filter: { date: { startDate: today, endDate: now } },
        unit: 'count',
      });
      return true;
    } catch {
      return false;
    }
  },

  async getManualStepsByDay(since: Date): Promise<Map<string, number>> {
    // Raw samples, because only a sample carries HKWasUserEntered; the
    // day totals above can't tell who wrote what.
    const samples = await orDefault(
      queryQuantitySamples('HKQuantityTypeIdentifierStepCount', {
        limit: 0,
        ascending: true,
        unit: 'count',
        filter: { date: { startDate: startOfDay(since), endDate: new Date() } },
      }),
      [],
    );
    const out = new Map<string, number>();
    for (const s of samples) {
      if (!wasUserEntered(s.metadata)) continue;
      const key = dateKey(s.startDate);
      out.set(key, (out.get(key) ?? 0) + s.quantity);
    }
    return out;
  },

  async getStepsSince(since: Date): Promise<number> {
    // Same collection query as the day totals above, just anchored at
    // `since` instead of midnight, so a step sample straddling `since`
    // is split proportionally rather than counted in full.
    const totals = await dailyStepTotals(since, new Date());
    let sum = 0;
    for (const v of totals.values()) sum += v;
    return Math.round(sum);
  },
};

// HealthKit's own flag for a sample or workout someone typed in by hand.
function wasUserEntered(metadata: unknown): boolean {
  return !!metadata && (metadata as Record<string, unknown>).HKWasUserEntered === true;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function workoutActivityName(type: WorkoutActivityType): string {
  // WorkoutActivityType is a numeric enum; reverse lookup gives back its
  // already-display-ready camelCase key ("crossTraining",
  // "traditionalStrengthTraining", …) — title-case it for display.
  const key = WorkoutActivityType[type];
  if (!key) return 'Workout';
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').trim();
}
