import AsyncStorage from '@react-native-async-storage/async-storage';

// Where Supabase keeps the signed-in session (src/lib/supabase.ts): the
// phone's Keychain (iOS) or Keystore-encrypted storage (Android) through
// expo-secure-store, instead of plain AsyncStorage, where any backup or
// file access to the app's data could read the refresh token and sign in
// as you.
//
// SecureStore is happiest with small values, and a session (more so with
// Google's tokens in it) can pass 2 KB, so a value is split into pieces:
//   <key>.n      how many pieces
//   <key>.0 …    the pieces
// A session saved by an older version of the app in AsyncStorage is moved
// over the first time it's read, then removed from AsyncStorage.
//
// On a build without the native module (an older native build that gets
// this code in an over-the-air update, or Expo Go), it stays on
// AsyncStorage, exactly as before, so nothing breaks.

type SecureStoreModule = typeof import('expo-secure-store');

let secureStore: SecureStoreModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  secureStore = require('expo-secure-store') as SecureStoreModule;
} catch {
  secureStore = null;
}

const PIECE = 1800;
// Readable after the phone's first unlock since it started, so the
// background step sync can still use the session while the phone is
// locked (backgroundSync.ts). Still device-only: never in backups.
const options = (store: SecureStoreModule) => ({ keychainAccessible: store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
// SecureStore keys allow only letters, numbers, ".", "-" and "_".
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

async function secureGet(store: SecureStoreModule, key: string): Promise<string | null> {
  const k = safeKey(key);
  const count = Number(await store.getItemAsync(`${k}.n`, options(store)));
  if (!count) return null;
  const pieces: string[] = [];
  for (let i = 0; i < count; i++) {
    const piece = await store.getItemAsync(`${k}.${i}`, options(store));
    if (piece == null) return null;
    pieces.push(piece);
  }
  return pieces.join('');
}

async function secureRemove(store: SecureStoreModule, key: string): Promise<void> {
  const k = safeKey(key);
  const count = Number(await store.getItemAsync(`${k}.n`, options(store))) || 0;
  await store.deleteItemAsync(`${k}.n`, options(store));
  for (let i = 0; i < count; i++) await store.deleteItemAsync(`${k}.${i}`, options(store));
}

async function secureSet(store: SecureStoreModule, key: string, value: string): Promise<void> {
  await secureRemove(store, key);
  const k = safeKey(key);
  const count = Math.max(1, Math.ceil(value.length / PIECE));
  for (let i = 0; i < count; i++) {
    await store.setItemAsync(`${k}.${i}`, value.slice(i * PIECE, (i + 1) * PIECE), options(store));
  }
  // Written last, so a half-written value is never read back.
  await store.setItemAsync(`${k}.n`, String(count), options(store));
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const store = secureStore;
    if (!store) return AsyncStorage.getItem(key);
    try {
      const saved = await secureGet(store, key);
      if (saved != null) return saved;
      // Moved over from an older version of the app.
      const old = await AsyncStorage.getItem(key);
      if (old != null) {
        await secureSet(store, key, old);
        await AsyncStorage.removeItem(key);
      }
      return old;
    } catch {
      return AsyncStorage.getItem(key);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const store = secureStore;
    if (!store) return AsyncStorage.setItem(key, value);
    try {
      await secureSet(store, key, value);
      await AsyncStorage.removeItem(key);
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key).catch(() => {});
    if (secureStore) await secureRemove(secureStore, key).catch(() => {});
  },
};
