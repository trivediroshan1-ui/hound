import { supabase } from '../lib/supabase';

// Two-step sign-in with an authenticator app (Google Authenticator,
// 1Password, Authy…), using Supabase's own TOTP support. Optional for
// every member: Settings → Two-step sign-in turns it on. Once it's on, a
// new sign-in on any phone asks for the 6-digit code before Hound opens
// (RootNavigator's gate, AuthContext's secondStepNeeded).

export interface TotpSetup {
  factorId: string;
  // otpauth:// link: shown as a QR code for another device, and opened
  // directly on this one so an authenticator app on the phone picks it up.
  uri: string;
  // The same key as text, for typing in by hand.
  secret: string;
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Whether this session still needs the code: signed in with a password
// or Google/Apple/Facebook (aal1) while a verified authenticator is set up
// (next level aal2). False when it can't tell, so a failed read never
// locks anyone out of the app; the server still checks on its own once
// 0124 has run.
export async function secondStepNeeded(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return false;
    return data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
  } catch {
    return false;
  }
}

async function verifiedFactorId(): Promise<string | null> {
  const { data, error } = await client().auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return data?.totp?.[0]?.id ?? null;
}

export async function isTwoStepOn(): Promise<boolean> {
  return (await verifiedFactorId()) !== null;
}

// The 6-digit code at sign-in.
export async function verifySecondStep(code: string): Promise<void> {
  const factorId = await verifiedFactorId();
  if (!factorId) throw new Error('Two-step sign-in is not set up on this account.');
  const { error } = await client().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw new Error(friendly(error.message));
}

// Settings, step 1: a new authenticator key. Any half-finished one from an
// earlier try is removed first, so they don't pile up.
export async function startTwoStepSetup(): Promise<TotpSetup> {
  const auth = client().auth;
  const { data: factors } = await auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === 'totp' && f.status === 'unverified') await auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Hound' });
  if (error || !data) throw new Error(error?.message ?? 'Could not start two-step sign-in.');
  return { factorId: data.id, uri: data.totp.uri, secret: data.totp.secret };
}

// Settings, step 2: the first code from the authenticator app proves it's
// set up, and turns two-step sign-in on.
export async function finishTwoStepSetup(factorId: string, code: string): Promise<void> {
  const { error } = await client().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw new Error(friendly(error.message));
}

// Settings → Turn off. Supabase only allows this from a session that has
// already passed the code, which is every session past the gate.
export async function turnOffTwoStep(): Promise<void> {
  const factorId = await verifiedFactorId();
  if (!factorId) return;
  const { error } = await client().auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}

function friendly(message: string): string {
  return /invalid|expired|code/i.test(message) ? "That code didn't work. Check the time on your phone and try the newest code." : message;
}
