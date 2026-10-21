import {
  aggregateRecord,
  ExerciseType,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import type {
  DailySteps,
  DailyStepsWithDate,
  HealthAuthStatus,
  HealthProvider,
  HealthSnapshot,
  WorkoutSample,
} from './types';
import { pickNonOverlapping } from './dedupeWorkouts';
import { appName, SAMSUNG_HEALTH_PACKAGES, type DataSourcesReport, type DataSourceSummary } from './dataSources';

// Real Health Connect integration. Requires a custom dev client or a
// standalone build (`npx expo prebuild` + `expo run:android`, or an EAS
// dev-client build) — Health Connect is a native module and is NOT
// available in Expo Go. Also needs the `android.permission.health.READ_*`
// entries in app.json's `android.permissions` and the Health Connect app
// installed on the test device/emulator (Android 14+ ships it in-box;
// earlier versions install it from Play).

// Health Connect's recording method for a record someone typed in by
// hand (Metadata.RECORDING_METHOD_MANUAL_ENTRY).
const RECORDING_METHOD_MANUAL_ENTRY = 3;

function isManualEntry(metadata: unknown): boolean {
  return !!metadata && (metadata as { recordingMethod?: number }).recordingMethod === RECORDING_METHOD_MANUAL_ENTRY;
}

const PERMISSIONS = [
  { accessType: 'read' as const, recordType: 'Steps' as const },
  { accessType: 'read' as const, recordType: 'Distance' as const },
  { accessType: 'read' as const, recordType: 'HeartRate' as const },
  { accessType: 'read' as const, recordType: 'Weight' as const },
  { accessType: 'read' as const, recordType: 'ExerciseSession' as const },
];

let initialized = false;
async function ensureInitialized(): Promise<boolean> {
  if (initialized) return true;
  initialized = await initialize();
  return initialized;
}

function metersToMiles(m: number): number {
  return m / 1609.344;
}
function kgToLb(kg: number): number {
  return kg * 2.20462;
}
function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// readRecords throws if the permission for that record type hasn't been
// granted yet — an expected state (screens query data as soon as they
// mount, before the user necessarily visited the Connect screen), not a
// bug to crash over. Every read below falls back to an empty result
// instead of rejecting.
function orEmpty<T>(promise: Promise<{ records: T[] }>): Promise<{ records: T[] }> {
  return promise.catch(() => ({ records: [] as T[] }));
}

// Steps (and Distance) totals go through Health Connect's own
// aggregateRecord API rather than summing readRecords(...) ourselves.
// Unlike HealthKit's cumulativeSum, a plain readRecords sum is NOT safe
// for these two types: when more than one source writes to Health
// Connect for the same real activity (e.g. a paired watch's app AND the
// phone's own sensor both auto-logging steps), readRecords returns every
// source's raw records with no de-duplication, so a manual sum
// double-counts. aggregateRecord is Health Connect's documented,
// source-aware equivalent — it reconciles overlapping contributions from
// multiple dataOrigins into one true total.
type BetweenFilter = { operator: 'between'; startTime: string; endTime: string };

async function healthConnectSteps(timeRangeFilter: BetweenFilter, dataOriginFilter?: string[]): Promise<number> {
  try {
    const result = await aggregateRecord({ recordType: 'Steps', timeRangeFilter, dataOriginFilter });
    return result.COUNT_TOTAL ?? 0;
  } catch {
    return 0;
  }
}

// Health Connect's total keeps only the highest-priority app for the same
// minutes, and on Samsung phones that's often the phone's own step
// counter, which drops Samsung Health's count (phone plus Galaxy Watch)
// even when it's far higher. The setting is hard to find, so Hound takes
// the larger of the two totals: Health Connect's, or Samsung Health's
// alone. Still one source for the range, never the two added together.
async function stepTotals(timeRangeFilter: BetweenFilter): Promise<{ all: number; samsung: number }> {
  const [all, samsung] = await Promise.all([
    healthConnectSteps(timeRangeFilter),
    healthConnectSteps(timeRangeFilter, SAMSUNG_HEALTH_PACKAGES),
  ]);
  return { all, samsung };
}

async function aggregateStepsTotal(timeRangeFilter: BetweenFilter): Promise<number> {
  const { all, samsung } = await stepTotals(timeRangeFilter);
  return Math.max(all, samsung);
}
async function aggregateDistanceMi(timeRangeFilter: BetweenFilter): Promise<number> {
  try {
    const result = await aggregateRecord({ recordType: 'Distance', timeRangeFilter });
    return metersToMiles(result.DISTANCE?.inMeters ?? 0);
  } catch {
    return 0;
  }
}

export const androidHealthProvider: HealthProvider = {
  platform: 'android',
  platformLabel: 'Health Connect',

  async isAvailable(): Promise<boolean> {
    // 3 === SDK_AVAILABLE in the native enum; a non-throwing call this
    // early also confirms the native module actually linked.
    try {
      const status = await getSdkStatus();
      return status === 3;
    } catch {
      return false;
    }
  },

  async getAuthorizationStatus(): Promise<HealthAuthStatus> {
    // Same "never throws" discipline as isAvailable() above — this
    // didn't have it, and it's the one call RootNavigator's connect
    // gate awaits on every fresh sign-in with no catch of its own
    // (see that file's own comment). ensureInitialized() calling the
    // native initialize() can throw on a device that's never touched
    // Health Connect before (e.g. the app isn't installed at all), and
    // an unhandled rejection here left connectGate stuck on 'checking'
    // forever — a permanent spinner that reproduced on every relaunch,
    // reported as "blank screen after login" on more than one Android
    // device.
    try {
      if (!(await ensureInitialized())) return 'unavailable';
      const granted = await getGrantedPermissions();
      const haveAll = PERMISSIONS.every((p) =>
        granted.some((g) => 'recordType' in g && g.recordType === p.recordType),
      );
      return haveAll ? 'authorized' : 'not-determined';
    } catch {
      return 'unavailable';
    }
  },

  async requestAuthorization(): Promise<HealthAuthStatus> {
    try {
      if (!(await ensureInitialized())) return 'unavailable';
      const granted = await requestPermission(PERMISSIONS);
      const haveAll = PERMISSIONS.every((p) =>
        granted.some((g) => 'recordType' in g && g.recordType === p.recordType),
      );
      return haveAll ? 'authorized' : 'denied';
    } catch {
      return 'denied';
    }
  },

  async getSnapshot(): Promise<HealthSnapshot> {
    await ensureInitialized();
    const todayFilter = { operator: 'between' as const, startTime: startOfDayIso(), endTime: new Date().toISOString() };

    const [totalSteps, totalDistanceMi, heartRate, weight] = await Promise.all([
      aggregateStepsTotal(todayFilter),
      aggregateDistanceMi(todayFilter),
      orEmpty(readRecords('HeartRate', { timeRangeFilter: todayFilter })),
      orEmpty(readRecords('Weight', { timeRangeFilter: { operator: 'before', endTime: new Date().toISOString() } })),
    ]);

    const restingSamples = heartRate.records.flatMap((r) => r.samples.map((s) => s.beatsPerMinute));
    const latestWeightKg = weight.records.at(-1)?.weight.inKilograms;

    return {
      stepsToday: Math.round(totalSteps),
      distanceTodayMi: Math.round(totalDistanceMi * 10) / 10,
      restingHeartRateBpm: restingSamples.length
        ? Math.round(restingSamples.reduce((a, b) => a + b, 0) / restingSamples.length)
        : null,
      latestWeightLb: latestWeightKg != null ? Math.round(kgToLb(latestWeightKg) * 10) / 10 : null,
      source: 'Health Connect',
      lastSyncedAt: new Date(),
    };
  },

  async getWeeklySteps(): Promise<DailySteps[]> {
    await ensureInitialized();
    const out: DailySteps[] = [];
    for (let i = 6; i >= 0; i--) {
      const start = daysAgoIso(i);
      const endDate = new Date(start);
      endDate.setDate(endDate.getDate() + 1);
      const total = await aggregateStepsTotal({ operator: 'between', startTime: start, endTime: endDate.toISOString() });
      out.push({
        date: new Date(start).toLocaleDateString(undefined, { weekday: 'short' }),
        steps: Math.round(total),
      });
    }
    return out;
  },

  async getHeartRateSeries(days: number): Promise<number[]> {
    await ensureInitialized();
    const { records } = await orEmpty(readRecords('HeartRate', {
      timeRangeFilter: { operator: 'between', startTime: daysAgoIso(days - 1), endTime: new Date().toISOString() },
    }));
    return records.flatMap((r) => r.samples.map((s) => s.beatsPerMinute));
  },

  async getWeightSeries(days: number): Promise<number[]> {
    await ensureInitialized();
    const { records } = await orEmpty(readRecords('Weight', {
      timeRangeFilter: { operator: 'between', startTime: daysAgoIso(days - 1), endTime: new Date().toISOString() },
    }));
    return records.map((r) => Math.round(kgToLb(r.weight.inKilograms) * 10) / 10);
  },

  async getRecentWorkouts(limit: number): Promise<WorkoutSample[]> {
    await ensureInitialized();
    const { records } = await orEmpty(readRecords('ExerciseSession', {
      timeRangeFilter: { operator: 'between', startTime: daysAgoIso(30), endTime: new Date().toISOString() },
      ascendingOrder: false,
      pageSize: limit,
    }));
    const sessions = records.slice(0, limit);
    // ExerciseSession has no distance of its own (unlike HealthKit's
    // HKWorkout, which carries its own distance statistic) — Health
    // Connect keeps distance as a separate record type, so a workout's
    // distance is whatever 'Distance' records fall inside its own
    // [startTime, endTime] window, same idea as iosProvider's per-workout
    // getStatistic call just against a different API shape.
    const withDistance = await Promise.all(
      sessions.map(async (r) => {
        const distanceMi = await aggregateDistanceMi({ operator: 'between', startTime: r.startTime, endTime: r.endTime });
        return { session: r, distanceMi };
      }),
    );

    // See dedupeWorkouts.ts's own comment — a paired Wear OS watch and
    // its phone-side companion app can each write their own
    // ExerciseSession for the same real workout. Done after the distance
    // fetch above (not before) since richness needs it as a tiebreaker.
    const deduped = pickNonOverlapping(withDistance, ({ session, distanceMi }) => ({
      activityKey: String(session.exerciseType ?? 'unknown'),
      startMs: new Date(session.startTime).getTime(),
      endMs: new Date(session.endTime).getTime(),
      richness: distanceMi > 0 ? 1 : 0,
    }));

    return deduped.map(({ session: r, distanceMi }) => ({
      // r.metadata?.id should always be set in practice (Health
      // Connect assigns one on insert) — the fallback is defensive,
      // and needs to be stable across fetches on its own: String(i)
      // (this session's position in *this* page) used to shift
      // every time an older/newer session entered the same page,
      // silently changing a workout's own id from one sync to the
      // next. startTime + exerciseType can't do that — two sessions
      // starting at the same instant of different types is the only
      // (unrealistic) collision.
      id: r.metadata?.id ?? `${r.startTime}_${r.exerciseType ?? 'unknown'}`,
      name: exerciseName(r.title, r.exerciseType),
      when: new Date(r.startTime),
      source: 'Health Connect',
      manual: isManualEntry(r.metadata) ? true : undefined,
      distanceMi: distanceMi > 0 ? Math.round(distanceMi * 10) / 10 : undefined,
      // ExerciseSession carries its own [startTime, endTime] window
      // (unlike distance, there's no separate duration record type to
      // read here) — same reasoning as the distance lookup above, just
      // arithmetic instead of a second query.
      durationMin: Math.round((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60_000),
    }));
  },

  async getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]> {
    await ensureInitialized();
    const start = dateOnly(since);
    const today = dateOnly(new Date());
    const out: DailyStepsWithDate[] = [];

    for (let cursor = start; cursor.getTime() <= today.getTime(); cursor.setDate(cursor.getDate() + 1)) {
      const dayStart = cursor.toISOString();
      const dayEnd = new Date(cursor);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const filter = { operator: 'between' as const, startTime: dayStart, endTime: dayEnd.toISOString() };

      const [totalSteps, totalDistanceMi] = await Promise.all([
        aggregateStepsTotal(filter),
        aggregateDistanceMi(filter),
      ]);

      out.push({
        date: dateKey(cursor),
        steps: Math.round(totalSteps),
        distanceMi: Math.round(totalDistanceMi * 10) / 10,
      });
    }
    return out;
  },

  async canReadNow(): Promise<boolean> {
    try {
      if (!(await ensureInitialized())) return false;
      await aggregateRecord({
        recordType: 'Steps',
        timeRangeFilter: { operator: 'between', startTime: startOfDayIso(), endTime: new Date().toISOString() },
      });
      return true;
    } catch {
      return false;
    }
  },

  openSettings() {
    try {
      openHealthConnectSettings();
    } catch {
      // Health Connect missing — nothing to open.
    }
  },

  async getManualStepsByDay(since: Date): Promise<Map<string, number>> {
    await ensureInitialized();
    const filter = { operator: 'between' as const, startTime: dateOnly(since).toISOString(), endTime: new Date().toISOString() };
    const out = new Map<string, number>();
    // Raw records, because only a record carries its recording method.
    // Same paging and ceiling as getDataSources below.
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await readRecords('Steps', { timeRangeFilter: filter, pageSize: 5000, pageToken }).catch(() => null);
      if (!result) break;
      for (const r of result.records) {
        if (!isManualEntry(r.metadata)) continue;
        const key = dateKey(new Date(r.startTime));
        out.set(key, (out.get(key) ?? 0) + (r.count ?? 0));
      }
      pageToken = result.pageToken || undefined;
      if (!pageToken) break;
    }
    return out;
  },

  // Who wrote what, from the raw records (readRecords doesn't merge
  // overlaps, so per-app step counts are what each app actually wrote),
  // plus which apps Health Connect's own total drew on.
  async getDataSources(days: number): Promise<DataSourcesReport> {
    await ensureInitialized();
    const filter = { operator: 'between' as const, startTime: daysAgoIso(days - 1), endTime: new Date().toISOString() };
    const byApp = new Map<string, DataSourceSummary>();
    const entry = (pkg: string): DataSourceSummary => {
      let e = byApp.get(pkg);
      if (!e) {
        e = { packageName: pkg, name: appName(pkg), steps: 0, workouts: 0, countedForSteps: false, lastAt: null };
        byApp.set(pkg, e);
      }
      return e;
    };
    const seen = (e: DataSourceSummary, at: string) => {
      if (!e.lastAt || at > e.lastAt) e.lastAt = at;
    };

    // Steps can run to thousands of records a week; read page by page,
    // with a ceiling so a huge history can't stall the screen.
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await readRecords('Steps', { timeRangeFilter: filter, pageSize: 5000, pageToken }).catch(() => null);
      if (!result) break;
      for (const r of result.records) {
        const e = entry(r.metadata?.dataOrigin ?? 'unknown');
        e.steps += r.count ?? 0;
        seen(e, r.endTime);
      }
      pageToken = result.pageToken || undefined;
      if (!pageToken) break;
    }

    const { records: sessions } = await orEmpty(readRecords('ExerciseSession', { timeRangeFilter: filter, pageSize: 1000 }));
    for (const r of sessions) {
      const e = entry(r.metadata?.dataOrigin ?? 'unknown');
      e.workouts += 1;
      seen(e, r.endTime);
    }

    let countedSteps = 0;
    let usingSamsungHealth = false;
    try {
      const agg = await aggregateRecord({ recordType: 'Steps', timeRangeFilter: filter });
      countedSteps = Math.round(agg.COUNT_TOTAL ?? 0);
      for (const pkg of agg.dataOrigins ?? []) {
        const e = byApp.get(pkg);
        if (e) e.countedForSteps = true;
      }
    } catch {
      // Leave the counted total at 0 — the per-app list still helps.
    }
    // Same rule as every step total Hound reads (stepTotals above).
    const samsungSteps = Math.round(await healthConnectSteps(filter, SAMSUNG_HEALTH_PACKAGES));
    if (samsungSteps > countedSteps) {
      countedSteps = samsungSteps;
      usingSamsungHealth = true;
      for (const e of byApp.values()) e.countedForSteps = SAMSUNG_HEALTH_PACKAGES.includes(e.packageName);
    }

    const sources = [...byApp.values()]
      .map((e) => ({ ...e, steps: Math.round(e.steps) }))
      .sort((a, b) => b.steps - a.steps || b.workouts - a.workouts);
    return { days, countedSteps, usingSamsungHealth, sources };
  },

  async getStepsSince(since: Date): Promise<number> {
    await ensureInitialized();
    const total = await aggregateStepsTotal({
      operator: 'between',
      startTime: since.toISOString(),
      endTime: new Date().toISOString(),
    });
    return Math.round(total);
  },
};

function dateOnly(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Health Connect sends an exercise type as a bare number (37 for hiking)
// and a title only if the recording app set one — so without this, an
// untitled hike reached the rest of the app as the name "37" and nothing
// could tell it was a hike (Tic-Tac-Go walk squares, Bingo). Turns the
// number into its constant's name ("HIKING" → "Hiking"), keeping a
// custom title alongside it when it doesn't already say the type.
const EXERCISE_TYPE_NAMES = new Map<number, string>(
  Object.entries(ExerciseType as Record<string, number>).map(([key, value]) => [
    value,
    key
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  ]),
);

function exerciseName(title: string | undefined | null, exerciseType: number | undefined | null): string {
  const typeName = exerciseType != null ? EXERCISE_TYPE_NAMES.get(exerciseType) : undefined;
  if (title && typeName && !title.toLowerCase().includes(typeName.toLowerCase())) return `${title} · ${typeName}`;
  return title || typeName || 'Workout';
}
