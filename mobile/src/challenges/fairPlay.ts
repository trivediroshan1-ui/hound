import { supabase } from '../lib/supabase';

// The fair play switch (0123_fair_play_manual_entries.sql): whether steps
// and workouts typed in by hand count in challenges. Off unless an admin
// turns it on, and off whenever it can't be read (no connection, or
// before 0123 has run), so a failed read never takes anyone's steps away.

export interface FairPlayRules {
  excludeManualEntries: boolean;
}

const OFF: FairPlayRules = { excludeManualEntries: false };
// Read at most every ten minutes: every sync on Today asks.
const CACHE_MS = 10 * 60_000;
let cached: { rules: FairPlayRules; at: number } | null = null;

export async function getFairPlayRules(): Promise<FairPlayRules> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rules;
  if (!supabase) return OFF;
  try {
    const { data, error } = await supabase
      .from('fair_play_settings')
      .select('exclude_manual_entries')
      .maybeSingle();
    const rules = error || !data ? OFF : { excludeManualEntries: data.exclude_manual_entries === true };
    cached = { rules, at: Date.now() };
    return rules;
  } catch {
    return OFF;
  }
}

// Admin → Fair play. Clears the cache so this phone uses it straight away.
export async function setFairPlayRules(rules: FairPlayRules): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('set_fair_play_settings', {
    p_exclude_manual_entries: rules.excludeManualEntries,
  });
  if (error) throw new Error(error.message);
  cached = { rules, at: Date.now() };
}
