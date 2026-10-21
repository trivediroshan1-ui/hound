import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { DailyStepsWithDate, HealthProvider, WorkoutSample } from '../health/types';

// Personal records (0084_personal_records.sql): best step day, longest
// 10k streak, longest workout and farthest day. Worked out on the phone
// from the same health data challenges use; the server keeps the best of
// everything ever sent.

export type RecordKind = 'best_day_steps' | 'longest_streak_days' | 'longest_workout_min' | 'farthest_day_mi';

export const RECORD_KINDS: RecordKind[] = ['best_day_steps', 'longest_streak_days', 'farthest_day_mi', 'longest_workout_min'];

// A streak day: at least this many steps. Fixed rather than each person's
// own goal, so friends' streaks mean the same thing.
export const STREAK_DAY_STEPS = 10_000;

export interface PersonalRecord {
  kind: RecordKind;
  value: number;
  // 'YYYY-MM-DD'
  achievedOn: string;
  detail: string | null;
  updatedAt?: string;
}

export interface NewRecord extends PersonalRecord {
  previousValue: number;
}

export const RECORD_TITLE: Record<RecordKind, string> = {
  best_day_steps: 'Best day',
  longest_streak_days: '10k streak',
  farthest_day_mi: 'Farthest day',
  longest_workout_min: 'Longest workout',
};

export function formatRecordValue(kind: RecordKind, value: number): string {
  switch (kind) {
    case 'best_day_steps':
      return `${Math.round(value).toLocaleString('en-US')} steps`;
    case 'longest_streak_days':
      return `${Math.round(value)} ${Math.round(value) === 1 ? 'day' : 'days'}`;
    case 'farthest_day_mi':
      return `${value.toFixed(1)} mi`;
    case 'longest_workout_min': {
      const mins = Math.round(value);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
    }
  }
}

// "18,402 steps in a day" — for the friend feed and the celebration.
export function recordPhrase(kind: RecordKind, value: number): string {
  switch (kind) {
    case 'best_day_steps':
      return `${formatRecordValue(kind, value)} in a day`;
    case 'longest_streak_days':
      return `${formatRecordValue(kind, value)} in a row over 10k steps`;
    case 'farthest_day_mi':
      return `${formatRecordValue(kind, value)} in a day`;
    case 'longest_workout_min':
      return `a ${formatRecordValue(kind, value)} workout`;
  }
}

export function formatRecordDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Working them out ─────────────────────────────────────────────────

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The longest run of consecutive 10k days, and where it ended. `days` is
// oldest first, one entry per calendar day.
export function longestStreak(days: DailyStepsWithDate[]): { length: number; endDate: string | null; startsAtFirstDay: boolean } {
  let best = 0;
  let bestEnd: string | null = null;
  let bestStart = -1;
  let run = 0;
  days.forEach((d, i) => {
    if (d.steps >= STREAK_DAY_STEPS) {
      run += 1;
      if (run > best) {
        best = run;
        bestEnd = d.date;
        bestStart = i - run + 1;
      }
    } else {
      run = 0;
    }
  });
  return { length: best, endDate: bestEnd, startsAtFirstDay: best > 0 && bestStart === 0 };
}

export function computeRecords(days: DailyStepsWithDate[], workouts: WorkoutSample[]): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  let bestSteps: DailyStepsWithDate | null = null;
  let farthest: DailyStepsWithDate | null = null;
  for (const d of days) {
    if (d.steps > 0 && (!bestSteps || d.steps > bestSteps.steps)) bestSteps = d;
    if (d.distanceMi > 0 && (!farthest || d.distanceMi > farthest.distanceMi)) farthest = d;
  }
  if (bestSteps) out.push({ kind: 'best_day_steps', value: bestSteps.steps, achievedOn: bestSteps.date, detail: null });
  if (farthest) out.push({ kind: 'farthest_day_mi', value: farthest.distanceMi, achievedOn: farthest.date, detail: null });

  const streak = longestStreak(days);
  if (streak.length > 0 && streak.endDate) {
    out.push({ kind: 'longest_streak_days', value: streak.length, achievedOn: streak.endDate, detail: null });
  }

  let longest: WorkoutSample | null = null;
  for (const w of workouts) {
    if ((w.durationMin ?? 0) > 0 && (!longest || (w.durationMin ?? 0) > (longest.durationMin ?? 0))) longest = w;
  }
  if (longest?.durationMin) {
    out.push({ kind: 'longest_workout_min', value: longest.durationMin, achievedOn: localDayKey(longest.when), detail: longest.name });
  }
  return out;
}

// ── Server ───────────────────────────────────────────────────────────

export async function getMyRecords(userId: string): Promise<PersonalRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('personal_records')
    .select('kind, value, achieved_on, detail, updated_at')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    kind: r.kind,
    value: Number(r.value),
    achievedOn: r.achieved_on,
    detail: r.detail,
    updatedAt: r.updated_at,
  }));
}

async function submitRecords(records: PersonalRecord[]): Promise<NewRecord[]> {
  if (!supabase || records.length === 0) return [];
  const { data, error } = await supabase.rpc('submit_personal_records', {
    p_records: records.map((r) => ({ kind: r.kind, value: r.value, achieved_on: r.achievedOn, detail: r.detail })),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[])
    .filter((r) => r.is_new_record)
    .map((r) => ({
      kind: r.kind,
      value: Number(r.value),
      previousValue: Number(r.previous_value),
      achievedOn: r.achieved_on,
      detail: r.detail,
    }));
}

// ── Syncing ──────────────────────────────────────────────────────────

// How far back to look: a longer first look sets a real starting point;
// after that, recent weeks are enough since the server keeps the bests.
const FIRST_SYNC_DAYS = 120;
const SYNC_DAYS = 45;
// A streak still going at the start of the window may be longer; look
// back this far to find its real start.
const MAX_STREAK_LOOKBACK_DAYS = 200;
const SYNC_EVERY_MS = 6 * 3_600_000;

const lastSyncKey = (userId: string) => `personalRecordsSyncedAt:${userId}`;
const firstSyncKey = (userId: string) => `personalRecordsFirstSync:${userId}`;

// Records beaten but not yet celebrated. Your data can run the sync too,
// so whatever it finds waits here for Home's popup.
const pendingKey = (userId: string) => `personalRecordsPending:${userId}`;

async function addPending(userId: string, records: NewRecord[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(pendingKey(userId));
    const cur: NewRecord[] = raw ? JSON.parse(raw) : [];
    const byKind = new Map(cur.map((r) => [r.kind, r]));
    for (const r of records) {
      const prev = byKind.get(r.kind);
      // Beaten twice before being seen: keep the newest value and the
      // oldest "previous" so the popup shows the whole jump.
      byKind.set(r.kind, prev ? { ...r, previousValue: prev.previousValue } : r);
    }
    await AsyncStorage.setItem(pendingKey(userId), JSON.stringify([...byKind.values()]));
  } catch {
    // Worst case the popup is skipped; the card still shows the record.
  }
}

// Returns the records waiting to be celebrated and clears them.
export async function takePendingNewRecords(userId: string): Promise<NewRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(pendingKey(userId));
    if (!raw) return [];
    await AsyncStorage.removeItem(pendingKey(userId));
    return JSON.parse(raw) as NewRecord[];
  } catch {
    return [];
  }
}

// Reads the phone's recent data and sends any bests up. At most every six
// hours unless `force`. Returns records just beaten (never a first-time
// starting point), for the celebration. Never throws.
export async function syncPersonalRecords(
  health: HealthProvider,
  userId: string,
  { force = false }: { force?: boolean } = {},
): Promise<NewRecord[]> {
  try {
    if (!supabase) return [];
    // Sample data isn't real activity, so it never sets a record.
    if (health.platform === 'mock') return [];
    if (!force) {
      const last = Number(await AsyncStorage.getItem(lastSyncKey(userId)).catch(() => null));
      if (last && Date.now() - last < SYNC_EVERY_MS) return [];
    }
    if ((await health.getAuthorizationStatus()) !== 'authorized') return [];

    const firstDone = (await AsyncStorage.getItem(firstSyncKey(userId)).catch(() => null)) === '1';
    const windowDays = firstDone ? SYNC_DAYS : FIRST_SYNC_DAYS;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (windowDays - 1));

    let [days, workouts] = await Promise.all([health.getDailyStepsSince(since), health.getRecentWorkouts(200)]);
    if (longestStreak(days).startsAtFirstDay) {
      const further = new Date(since);
      further.setDate(further.getDate() - (MAX_STREAK_LOOKBACK_DAYS - windowDays));
      days = await health.getDailyStepsSince(further);
    }

    const beaten = await submitRecords(computeRecords(days, workouts));
    await AsyncStorage.setItem(lastSyncKey(userId), String(Date.now())).catch(() => {});
    await AsyncStorage.setItem(firstSyncKey(userId), '1').catch(() => {});
    if (beaten.length > 0) await addPending(userId, beaten);
    return beaten;
  } catch {
    return [];
  }
}
