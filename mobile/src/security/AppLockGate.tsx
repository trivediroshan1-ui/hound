import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { LockSimpleIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { RELOCK_AFTER_MS, unlock, useAppLockOn } from './appLock';

// Covers the whole app while it's locked (appLock.ts). Drawn on top of the
// app rather than instead of it, so unlocking puts you back exactly where
// you were. Also covers the app the moment it leaves the screen, so the
// phone's app switcher never shows a snapshot of it.
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // secondStepNeeded comes with two-step sign-in (auth/twoStep.ts); the
  // lock waits until that code screen is done.
  const { status, secondStepNeeded } = useAuth() as ReturnType<typeof useAuth> & { secondStepNeeded?: boolean };
  const on = useAppLockOn();
  const active = on === true && status === 'signedIn' && !secondStepNeeded;
  const [locked, setLocked] = useState(true);
  const [hidden, setHidden] = useState(false);
  const leftAt = useRef<number | null>(null);
  const prompting = useRef(false);

  const tryUnlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const ok = await unlock();
    prompting.current = false;
    if (ok) setLocked(false);
  }, []);

  // Turning the lock on in Settings has just asked for Face ID, so it
  // starts unlocked. Only a cold start with the lock already on starts
  // locked.
  const lastOn = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastOn.current === false && on === true) setLocked(false);
    if (on !== null) lastOn.current = on;
  }, [on]);

  // Cold start: locked until the first unlock.
  useEffect(() => {
    if (active && locked) tryUnlock();
  }, [active, locked, tryUnlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setHidden(false);
        if (leftAt.current !== null && Date.now() - leftAt.current > RELOCK_AFTER_MS) setLocked(true);
        leftAt.current = null;
      } else if (!prompting.current) {
        // The Face ID prompt itself makes the app "inactive"; that doesn't
        // count as leaving.
        setHidden(true);
        leftAt.current ??= Date.now();
      }
    });
    return () => sub.remove();
  }, []);

  const showCover = active && (locked || hidden);
  return (
    <View style={{ flex: 1 }}>
      {children}
      {showCover && (
        <View style={[StyleSheet.absoluteFill, styles.cover]}>
          <View style={styles.icon}>
            <LockSimpleIcon size={28} color={colors.accent} weight="fill" />
          </View>
          <Text style={text.h2}>Hound is locked</Text>
          {locked && !hidden && <Button label="Unlock" variant="primary" onPress={tryUnlock} />}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    cover: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
    icon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
  });
}
