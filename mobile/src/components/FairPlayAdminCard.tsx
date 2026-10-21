import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { getFairPlayRules, setFairPlayRules, type FairPlayRules } from '../challenges/fairPlay';

// Admin → Fair play (0123_fair_play_manual_entries.sql). Saves the moment
// it's flipped; phones pick it up within ten minutes (fairPlay.ts).
export function FairPlayAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rules, setRules] = useState<FairPlayRules | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getFairPlayRules().then(setRules);
    }, []),
  );

  const toggle = async (excludeManualEntries: boolean) => {
    if (!rules) return;
    const before = rules;
    setRules({ excludeManualEntries });
    setError(null);
    try {
      await setFairPlayRules({ excludeManualEntries });
    } catch (e) {
      setRules(before);
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Fair play</Text>
      <Text style={styles.note}>
        Apple Health and Health Connect let anyone type in steps or a workout by hand. With this on, those don&rsquo;t
        count in challenges. People&rsquo;s own charts still show everything.
      </Text>
      {rules && (
        <ToggleRow
          label="Leave out steps and workouts typed in by hand"
          note="For everyone, in every challenge"
          value={rules.excludeManualEntries}
          onChange={toggle}
        />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    error: { fontSize: 13, color: colors.amber },
  });
}
