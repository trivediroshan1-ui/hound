import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { finishTwoStepSetup, isTwoStepOn, startTwoStepSetup, turnOffTwoStep, type TotpSetup } from '../auth/twoStep';

// Settings → Two-step sign-in (auth/twoStep.ts). Off: one button to start.
// Setting up: the key as a QR code (for an authenticator on another
// device), a button that hands it to an authenticator on this phone, the
// key as text, and a box for the first code. On: a button to turn it off.
export function TwoStepSettings() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [on, setOn] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    isTwoStepOn()
      .then(setOn)
      .catch(() => setOn(null));
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setSetup(await startTwoStepSetup());
      setCode('');
    });

  const finish = () =>
    run(async () => {
      if (!setup) return;
      if (code.length < 6) throw new Error('Enter the 6-digit code your authenticator app shows for Hound.');
      await finishTwoStepSetup(setup.factorId, code);
      setSetup(null);
      setOn(true);
      Alert.alert('Two-step sign-in is on', 'Next time you sign in on a phone, Hound will ask for a code from your app.');
    });

  const turnOff = () =>
    Alert.alert('Turn off two-step sign-in?', 'Signing in will only need your password or Google, Apple or Facebook again.', [
      { text: 'Keep it on', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            await turnOffTwoStep();
            setOn(false);
          }),
      },
    ]);

  if (on === null && !setup) return null;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Two-step sign-in</Text>
      {setup ? (
        <>
          <Text style={styles.note}>
            Add Hound to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy). On this
            phone, tap the button. On another device, scan the code.
          </Text>
          <Button label="Add to an authenticator app on this phone" small onPress={() => Linking.openURL(setup.uri).catch(() => {})} />
          <View style={styles.qr}>
            <QRCode value={setup.uri} size={150} color={colors.text} backgroundColor={colors.surface} />
          </View>
          <Text style={styles.note}>Or type this key into the app:</Text>
          <Text selectable style={styles.secret}>
            {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
          </Text>
          <Button label="Copy key" variant="ghost" small onPress={() => Clipboard.setStringAsync(setup.secret).catch(() => {})} />
          <TextField
            label="Code from the app"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            error={error ?? undefined}
          />
          <Button label={busy ? 'Checking…' : 'Turn on'} variant="primary" disabled={busy} onPress={finish} />
          <Button label="Cancel" variant="ghost" small onPress={() => setSetup(null)} />
        </>
      ) : on ? (
        <>
          <Text style={styles.note}>On. Signing in on a new phone asks for a code from your authenticator app.</Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Button label={busy ? 'Turning off…' : 'Turn off'} small disabled={busy} onPress={turnOff} />
        </>
      ) : (
        <>
          <Text style={styles.note}>
            Keep your account safe even if someone learns your password: signing in on a new phone also needs a code
            from an authenticator app.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Button label={busy ? 'Starting…' : 'Set up two-step sign-in'} small disabled={busy} onPress={start} />
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    error: { fontSize: 13, color: colors.amber },
    qr: { alignSelf: 'center', padding: 10, borderRadius: 12, backgroundColor: colors.surface },
    secret: { fontFamily: font.headingSemibold, fontSize: 15, letterSpacing: 1, color: colors.text, textAlign: 'center' },
  });
}
