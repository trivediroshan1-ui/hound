import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// App lock: Face ID, Touch ID or a fingerprint (or the phone's own
// passcode as a fallback) before Hound opens. Off unless the member turns
// it on in Settings, and kept on this phone only, since it's about this
// device.
//
// expo-local-authentication is a native module, so it only exists in
// builds made after it was added. An over-the-air update also reaches
// older builds, where loading it throws; there the lock simply isn't
// offered, the same pattern admin/appVersions.ts uses.

type LocalAuthModule = typeof import('expo-local-authentication');

let localAuth: LocalAuthModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  localAuth = require('expo-local-authentication') as LocalAuthModule;
} catch {
  localAuth = null;
}

const KEY = 'security:app-lock';
// How long Hound can sit in the background before it asks again.
export const RELOCK_AFTER_MS = 60_000;

let cache: boolean | null = null;
const listeners = new Set<() => void>();

// Whether this phone can do it: the module is in this build, and the
// phone has Face ID, Touch ID or a fingerprint set up.
export async function appLockAvailable(): Promise<boolean> {
  if (!localAuth) return false;
  try {
    return (await localAuth.hasHardwareAsync()) && (await localAuth.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function isAppLockOn(): Promise<boolean> {
  if (cache !== null) return cache;
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  cache = stored === 'on' && (await appLockAvailable());
  return cache;
}

// Turning it on asks once, so nobody locks themselves out with a
// fingerprint that doesn't work. Resolves to whether it's now on.
export async function setAppLockOn(on: boolean): Promise<boolean> {
  if (on && !(await unlock('Turn on app lock for Hound'))) return false;
  cache = on;
  await AsyncStorage.setItem(KEY, on ? 'on' : 'off').catch(() => {});
  listeners.forEach((l) => l());
  return on;
}

// Face ID / fingerprint, with the phone passcode as a fallback.
export async function unlock(promptMessage = 'Unlock Hound'): Promise<boolean> {
  if (!localAuth) return true;
  try {
    const result = await localAuth.authenticateAsync({ promptMessage, disableDeviceFallback: false });
    return result.success;
  } catch {
    return false;
  }
}

export function useAppLockOn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(cache);
  useEffect(() => {
    const update = () => {
      isAppLockOn().then(setOn);
    };
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return on;
}
