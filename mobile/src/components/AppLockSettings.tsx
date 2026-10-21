import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { Card } from './Card';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { appLockAvailable, RELOCK_AFTER_MS, setAppLockOn, useAppLockOn } from '../security/appLock';

// Settings → App lock (security/appLock.ts). Only shown on a phone that
// can do it: a build with the module, and Face ID, Touch ID or a
// fingerprint set up.
export function AppLockSettings() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const on = useAppLockOn();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    appLockAvailable().then(setAvailable);
  }, []);

  if (!available || on === null) return null;
  const method = Platform.OS === 'ios' ? 'Face ID or Touch ID' : 'your fingerprint or face';
  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>App lock</Text>
      <ToggleRow
        label={`Unlock Hound with ${method}`}
        note={`When Hound opens, and after ${Math.round(RELOCK_AFTER_MS / 60_000)} minute away`}
        value={on}
        onChange={(next) => {
          setAppLockOn(next).catch(() => {});
        }}
      />
      <Text style={styles.note}>Your phone&rsquo;s passcode works too if the scan fails. This setting stays on this phone.</Text>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
  });
}
