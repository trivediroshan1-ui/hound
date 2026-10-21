import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { secureSessionStorage } from './secureSessionStorage';

// Expo inlines EXPO_PUBLIC_* env vars into the JS bundle at build time (see
// .env.example) — there's no server involved, so this is the same
// publishable key a web app would ship to the browser. It's safe to
// expose because every table it can reach is behind Row Level Security
// (see supabase/migrations/0001_challenges_schema.sql); it grants no
// access on its own. Supabase calls this the "publishable" key now
// (`sb_publishable_...`) — projects created before ~Nov 2025 may still
// show it as the "anon" key in their dashboard (an older, JWT-shaped
// value); createClient() accepts either, this project just standardizes
// on the current name.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

// null until a project is wired up — every caller in src/auth and
// src/challenges checks isSupabaseConfigured (or gets a thrown error from
// requireClient()) and falls back to mock data instead of crashing, the
// same pattern src/health uses for a native module that isn't linked.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, publishableKey as string, {
      auth: {
        // Keychain / Keystore, not plain AsyncStorage (secureSessionStorage.ts).
        storage: secureSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      // What this app can handle, so the server can keep older apps out
      // of things they'd crash on (0118_bingo_join_guard.sql).
      global: { headers: { 'x-hound-features': 'hound-bingo' } },
    })
  : null;

// The signed-in user's id, from the session already stored on the phone.
// auth.getUser() asks the server every time, and Today's load calls this
// once per challenge and list, so that was a few dozen requests per open.
// The server still checks who's asking on every query (Row Level
// Security), so the stored session is enough here.
export async function signedInUserId(): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Sign in to do that.');
  return id;
}
