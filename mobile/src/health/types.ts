import type { DataSourcesReport } from './dataSources';

// The shape every screen reads from — platform-agnostic. Screens never
// import @kingstinct/react-native-healthkit or react-native-health-connect
// directly; they go through `useHealth()` / `getHealthProvider()` from
// ./index.ts.

export type SourceLabel = string; // e.g. "Apple Health · iPhone 15", "Health Connect · Pixel 8"

export interface DailySteps {
  date: string; // 'YYYY-MM-DD'
  steps: number;
}

// Unlike DailySteps (whose `date` is actually a weekday label like "Wed" —
// it's built for the Metrics screen's 7-day chart, not real dates), this
// carries a real ISO 'YYYY-MM-DD' per entry plus that day's distance. Used
// to backfill a challenge's progress across days the app wasn't open to
// sync (joining one that started in the past, or missing a few days), not
// for display.
export interface DailyStepsWithDate {
  date: string;
  steps: number;
  distanceMi: number;
}

export interface WorkoutSample {
  id: string;
  name: string;
  when: Date;
  source: SourceLabel;
  distanceMi?: number;
  // Whether this workout was actually GPS-capable outdoor activity, read
  // straight from the platform where that's available — true/false is a
  // real signal, not a guess. Undefined means "the platform can't say"
  // (Android's Health Connect has no equivalent flag on ExerciseSession;
  // reading real GPS route data needs the much heavier READ_EXERCISE_ROUTES
  // permission, not wired up here) — a 'gps_distance' challenge falls back
  // to guessing from the workout's name in that case (see
  // challenges/deviceSync.ts). iOS sets this from HealthKit's own
  // HKIndoorWorkout metadata (see iosProvider.ts) whenever a workout
  // actually carries it — plenty of older or manually-logged workouts
  // don't, so undefined is still the common case there too.
  isOutdoor?: boolean;
  // Typed in by hand in the Health app rather than recorded by a phone
  // or watch: HKWasUserEntered on iPhone, recording method "manual entry"
  // in Health Connect. Left out of challenges when the fair play switch
  // is on (challenges/fairPlay.ts). Undefined when the platform can't say.
  manual?: boolean;
  avgHeartRate?: number;
  // Minutes, not a Quantity/unit pair like the platforms' own duration
  // fields — src/health/readiness.ts (training-load calculation) is the
  // one thing that needs this, and it only ever wants a plain number to
  // sum. Undefined for a workout whose duration couldn't be read, same
  // "missing means missing, not zero" convention distanceMi/avgHeartRate
  // already use.
  durationMin?: number;
}

export interface HealthSnapshot {
  stepsToday: number;
  distanceTodayMi: number;
  restingHeartRateBpm: number | null;
  latestWeightLb: number | null;
  source: SourceLabel;
  lastSyncedAt: Date | null;
}

export type HealthAuthStatus = 'unavailable' | 'not-determined' | 'denied' | 'authorized';

export interface HealthProvider {
  readonly platform: 'ios' | 'android' | 'mock';
  readonly platformLabel: string; // "Apple Health" | "Health Connect" | "Sample data"

  isAvailable(): Promise<boolean>;
  getAuthorizationStatus(): Promise<HealthAuthStatus>;
  requestAuthorization(): Promise<HealthAuthStatus>;

  getSnapshot(): Promise<HealthSnapshot>;
  getWeeklySteps(): Promise<DailySteps[]>;
  getHeartRateSeries(days: number): Promise<number[]>;
  getWeightSeries(days: number): Promise<number[]>;
  getRecentWorkouts(limit: number): Promise<WorkoutSample[]>;
  // One entry per calendar day from `since` through today (inclusive) —
  // see DailyStepsWithDate. Only ever asked for a fairly small range in
  // practice (a challenge's own duration, capped at 30 days by
  // CreateScreen), not an open-ended history query.
  getDailyStepsSince(since: Date): Promise<DailyStepsWithDate[]>;
  // Total steps from an exact moment (not a day boundary) until now —
  // Tic-Tac-Go's step goals count only steps taken since your turn began.
  getStepsSince(since: Date): Promise<number>;
  // Steps typed in by hand, per local day ("YYYY-MM-DD"), from `since`
  // to now. Only real providers have it; challenges subtract these when
  // the fair play switch is on (challenges/fairPlay.ts).
  getManualStepsByDay?(since: Date): Promise<Map<string, number>>;
  // Whether health data can be read right now. Every read above returns
  // nothing instead of failing, which looks like 0 steps, so background
  // sync asks first: a locked iPhone can't read Apple Health, and Android
  // can't read Health Connect in the background without its own
  // permission.
  canReadNow?(): Promise<boolean>;
  // Android only (see dataSources.ts): which apps wrote steps and
  // workouts to Health Connect over the last `days` days.
  getDataSources?(days: number): Promise<DataSourcesReport>;
  // Android only: opens Health Connect, where sharing and the order apps
  // are counted in are changed.
  openSettings?(): void;
}
