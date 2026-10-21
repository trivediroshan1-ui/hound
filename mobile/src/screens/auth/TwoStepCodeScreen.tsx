import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheckIcon } from 'phosphor-react-native';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { useTheme } from '../../theme/ThemeContext';
import { withAlpha, type Palette } from '../../theme/tokens';
import { useAuth } from '../../auth/AuthContext';

// Shown instead of the whole app when two-step sign-in is on for this
// account and this sign-in hasn't had the code yet (RootNavigator,
// AuthContext's secondStepNeeded).
export function TwoStepCodeScreen() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { completeSecondStep, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeSecondStep(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't work. Try the newest one.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.icon}>
            <ShieldCheckIcon size={28} color={colors.accent} weight="fill" />
          </View>
          <Text style={text.h2}>Enter your code</Text>
          <Text style={styles.sub}>
            Two-step sign-in is on for this account. Open your authenticator app and type the 6-digit code for Hound.
          </Text>
          <TextField
            label="Code"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            error={error ?? undefined}
            onSubmitEditing={submit}
          />
          <Button label={busy ? 'Checking…' : 'Continue'} variant="primary" block disabled={busy} onPress={submit} />
          <Button label="Sign out" variant="ghost" small onPress={() => signOut().catch(() => {})} />
          <Text style={styles.help}>
            Lost your authenticator? Email the Hound team from the address on your account and we&rsquo;ll help you back in.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
    icon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
    sub: { fontSize: 15, lineHeight: 21, color: withAlpha(colors.text, 0.7) },
    help: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.55), textAlign: 'center' },
  });
}
