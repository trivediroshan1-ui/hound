import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  CaretRightIcon,
  CheckIcon,
  SignOutIcon,
  TrashIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ToggleRow } from '../components/Selectable';
import { CelebrationSettings } from '../celebrate/CelebrationSettings';
import { TodaySettings } from '../home/TodaySettings';
import { TwoStepSettings } from '../components/TwoStepSettings';
import { AdPrivacyCard } from '../ads/AdPrivacyCard';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import type { AuthProviderId } from '../auth/types';
import { isSupabaseConfigured } from '../lib/supabase';
import { APP_VERSION, runningOnLabel } from '../lib/appVersion';
import { deleteMyAccount } from '../auth/deleteAccount';
import * as notifications from '../notifications/supabaseNotifications';
import { setUseUsername, setUsername, USERNAME_FORMAT, chooseUsername } from '../profiles/supabaseProfile';
import { getOrganization, leaveOrganization, redeemOrganizationInvite } from '../organizations/supabaseOrganizations';
import { getMyEquippedCosmetics, type EquippedCosmetics } from '../cosmetics/cosmeticsApi';
import type { Organization } from '../organizations/types';
import { getDiscoverable, setDiscoverable } from '../friends/discovery';
import { getFeatureNewest, setFeatureNewest } from '../challenges/todayFeature';
import { getSocialPushEnabled, setSocialPushEnabled } from '../social/social';
import {
  askForPush,
  getPushPermission,
  openPhoneSettings,
  syncPushRegistration,
  type PushPermission,
} from '../notifications/pushPermission';


const PROVIDER_LABEL: Record<AuthProviderId, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
  email: 'Email & password',
};

export function SettingsScreen() {
  const { user, signOut, updateUser } = useAuth();

  // Delete account (H8 in the security review): asks once, then deletes
  // on the server and signs this phone out.
  const [deletingAccount, setDeletingAccount] = useState(false);
  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'Your account, progress, friends, Bones and cosmetics will be permanently deleted. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await deleteMyAccount();
            } catch (e) {
              setDeletingAccount(false);
              Alert.alert('Could not delete your account', e instanceof Error ? e.message : 'Try again later.');
            }
          },
        },
      ],
    );
  };
  const { colors, text, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Seeded from the signed-in user, not a separate fetch — profiles.username
  // /use_username (0030_username.sql) already come back on sign-in (see
  // supabaseAuth.ts's userFromSession), so there's nothing else to load.
  const [usernameInput, setUsernameInput] = useState(user?.username ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingUseUsername, setSavingUseUsername] = useState(false);

  const saveUsername = async () => {
    if (!user?.id) return;
    const trimmed = usernameInput.trim();
    if (trimmed && !USERNAME_FORMAT.test(trimmed)) {
      setUsernameError('3–20 letters, numbers, or underscores.');
      return;
    }
    setUsernameError(null);
    setSavingUsername(true);
    try {
      // A first username turns itself on for challenges (chooseUsername);
      // changing an existing one leaves that switch as it was.
      const first = !!trimmed && !user.username;
      if (first) await chooseUsername(user.id, trimmed);
      else await setUsername(user.id, trimmed || null);
      // Clearing the username makes "use it in challenges" meaningless —
      // turn that back off too rather than leaving a stale true with
      // nothing left to show.
      if (!trimmed && user.useUsername) await setUseUsername(user.id, false);
      updateUser({ username: trimmed || null, useUsername: first ? true : trimmed ? user.useUsername : false });
    } catch (e) {
      setUsernameError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingUsername(false);
    }
  };

  // Whether Today features your newest challenge when none is pinned
  // (todayFeature.ts). Null until loaded.
  const [featureNewest, setFeatureNewestState] = useState<boolean | null>(null);
  useEffect(() => {
    getFeatureNewest().then(setFeatureNewestState);
  }, []);
  const toggleFeatureNewest = (next: boolean) => {
    setFeatureNewestState(next);
    setFeatureNewest(next).catch(() => setFeatureNewestState(!next));
  };

  // Whether this account shows up in Friends → Find people (0080). Null
  // until loaded, or before 0080 has run — the toggle stays hidden then.
  const [discoverable, setDiscoverableState] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    getDiscoverable(user.id).then(setDiscoverableState);
  }, [user?.id]);
  const toggleDiscoverable = (next: boolean) => {
    if (!user?.id) return;
    setDiscoverableState(next);
    setDiscoverable(user.id, next).catch(() => setDiscoverableState(!next));
  };

  const toggleUseUsername = async (next: boolean) => {
    if (!user?.id) return;
    setSavingUseUsername(true);
    try {
      await setUseUsername(user.id, next);
      updateUser({ useUsername: next });
    } catch {
      // No dedicated error UI for this toggle — same as every other
      // plain on/off preference on this screen.
    } finally {
      setSavingUseUsername(false);
    }
  };
  // Organization membership — see GitHub issue #158. No org yet shows a
  // join-by-code form (redeem_organization_invite); already in one shows
  // who and a way out (leave_organization). Managing an org you admin
  // (invite code, members, labels) lives in OrgDetailScreen instead,
  // reached via TopNav's own org icon — this card is just the individual
  // member's own join/leave, the same way the account row above is your
  // own account, not account administration.
  const [org, setOrg] = useState<Organization | null>(null);
  const [orgLoadError, setOrgLoadError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.organizationId) {
        setOrg(null);
        return;
      }
      getOrganization(user.organizationId)
        .then(setOrg)
        .catch((e) => setOrgLoadError(e instanceof Error ? e.message : 'Could not load your organization.'));
    }, [user?.organizationId]),
  );

  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const submitJoin = async () => {
    const code = inviteCodeInput.trim();
    if (!code) {
      setJoinError('Enter an invite code.');
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      const organizationId = await redeemOrganizationInvite(code);
      const joined = await getOrganization(organizationId);
      setOrg(joined);
      setInviteCodeInput('');
      updateUser({ organizationId, orgRole: 'member' });
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Could not join with that code.');
    } finally {
      setJoining(false);
    }
  };

  const [leaving, setLeaving] = useState(false);
  const confirmLeave = () => {
    Alert.alert(
      `Leave ${org?.name ?? 'this organization'}?`,
      "You'll need a new invite code to join again — challenges and friends you already have are unaffected.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveOrganization();
              setOrg(null);
              updateUser({ organizationId: null, orgRole: null });
            } catch (e) {
              Alert.alert('Could not leave', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setLeaving(false);
            }
          },
        },
      ],
    );
  };

  // Null until it resolves (or if it fails) — the
  // account row's Avatar below just renders its plain default look until
  // this actually resolves, rather than a guessed empty state.
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) {
        setEquipped(null);
        return;
      }
      getMyEquippedCosmetics(user.id)
        .then(setEquipped)
        .catch(() => setEquipped(null));
    }, [user?.id]),
  );

  // Login-reminder preferences live on the real profiles row — there's no
  // sample-fallback version of this like other screens have, since
  // without a real backend there's nothing to check someone into daily.
  // null while unresolved (mirrors HomeScreen's loadingPrimary) so the
  // toggles don't flash a default before the real values load.
  const [pushEnabled, setPushEnabledState] = useState<boolean | null>(null);
  const [emailEnabled, setEmailEnabledState] = useState<boolean | null>(null);
  const [savingChannel, setSavingChannel] = useState<'push' | 'email' | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      notifications
        .getPreferences(user.id)
        .then((prefs) => {
          setPushEnabledState(prefs.pushEnabled);
          setEmailEnabledState(prefs.emailEnabled);
        })
        .catch(() => {
          // Leave the toggles unresolved (still hidden, see the render
          // below) rather than guessing a default.
        });
    }, [user?.id]),
  );

  // The phone's own notification setting (src/notifications/
  // pushPermission.ts). The toggles below are Hound's preferences — they
  // read as on by default — but nothing reaches a phone that hasn't
  // allowed notifications, so say so. Re-checked when coming back from
  // the phone's Settings, and registers the phone if they turned it on
  // there.
  const [phonePush, setPhonePush] = useState<PushPermission | null>(null);
  const phonePushRef = useRef<PushPermission | null>(null);
  const [askingPush, setAskingPush] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const check = () =>
        getPushPermission().then((p) => {
          const prev = phonePushRef.current;
          if (p === 'granted' && prev && prev !== 'granted' && user?.id) syncPushRegistration(user.id);
          phonePushRef.current = p;
          setPhonePush(p);
        });
      check();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') check();
      });
      return () => sub.remove();
    }, [user?.id]),
  );
  const turnOnPhonePush = async () => {
    if (!user?.id) return;
    setAskingPush(true);
    const p = await askForPush(user.id);
    phonePushRef.current = p;
    setPhonePush(p);
    setAskingPush(false);
  };

  // Two of the three Alerts, each its own Push + Email pair — see
  // notifications/types.ts's own comment on why the third (proximity)
  // isn't part of this shape.
  const [staleDataPushEnabled, setStaleDataPushEnabledState] = useState<boolean | null>(null);
  const [staleDataEmailEnabled, setStaleDataEmailEnabledState] = useState<boolean | null>(null);
  const [dailyStandingsPushEnabled, setDailyStandingsPushEnabledState] = useState<boolean | null>(null);
  const [dailyStandingsEmailEnabled, setDailyStandingsEmailEnabledState] = useState<boolean | null>(null);
  const [savingAlert, setSavingAlert] = useState<
    'staleDataPush' | 'staleDataEmail' | 'dailyStandingsPush' | 'dailyStandingsEmail' | null
  >(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      notifications
        .getAlertPreferences(user.id)
        .then((prefs) => {
          setStaleDataPushEnabledState(prefs.staleDataPushEnabled);
          setStaleDataEmailEnabledState(prefs.staleDataEmailEnabled);
          setDailyStandingsPushEnabledState(prefs.dailyStandingsPushEnabled);
          setDailyStandingsEmailEnabledState(prefs.dailyStandingsEmailEnabled);
        })
        .catch(() => {
          // Same "leave it unresolved rather than guess" reasoning the
          // login-reminder fetch above uses.
        });
    }, [user?.id]),
  );

  // Nudges and reactions from friends (0082_nudges_reactions.sql). Loaded
  // on its own, so the rest of the card still shows before 0082 has run.
  const [socialPushEnabled, setSocialPushEnabledState] = useState<boolean | null>(null);
  const [savingSocialPush, setSavingSocialPush] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !user?.id) return;
      getSocialPushEnabled(user.id).then(setSocialPushEnabledState);
    }, [user?.id]),
  );
  const toggleSocialPush = async (next: boolean) => {
    if (!user?.id) return;
    setSavingSocialPush(true);
    try {
      await setSocialPushEnabled(user.id, next);
      setSocialPushEnabledState(next);
    } catch (err) {
      Alert.alert('Nudges, reactions & trash talk', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingSocialPush(false);
    }
  };

  const toggleStaleDataPush = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('staleDataPush');
    try {
      await notifications.setStaleDataPushEnabled(user.id, next);
      setStaleDataPushEnabledState(next);
    } catch (err) {
      Alert.alert('Stale data alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const toggleStaleDataEmail = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('staleDataEmail');
    try {
      await notifications.setStaleDataEmailEnabled(user.id, next);
      setStaleDataEmailEnabledState(next);
    } catch (err) {
      Alert.alert('Stale data alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const toggleDailyStandingsPush = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('dailyStandingsPush');
    try {
      await notifications.setDailyStandingsPushEnabled(user.id, next);
      setDailyStandingsPushEnabledState(next);
    } catch (err) {
      Alert.alert('Daily standings alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  const toggleDailyStandingsEmail = async (next: boolean) => {
    if (!user?.id) return;
    setSavingAlert('dailyStandingsEmail');
    try {
      await notifications.setDailyStandingsEmailEnabled(user.id, next);
      setDailyStandingsEmailEnabledState(next);
    } catch (err) {
      Alert.alert('Daily standings alert', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingAlert(null);
    }
  };

  // "Fire it now" buttons for the three cron-driven notification jobs —
  // only ever rendered for user?.isAdmin below, a real database-set flag
  // (see 0021_admin_flag.sql), same gate the Edge Functions themselves
  // enforce (see each one's own comment) alongside the cron job's own
  // service-role call. Deliberately not also gated on __DEV__: that's
  // only ever true through Metro's own dev server, not an installed
  // TestFlight/production build, which is how this app actually gets
  // tested day to day. Lets the two new Alerts toggles (and Login
  // reminders) get tested in minutes instead of waiting for tomorrow's
  // schedule.
  const [triggering, setTriggering] = useState<'login' | 'staleData' | 'dailyStandings' | null>(null);

  const runTrigger = async (
    which: 'login' | 'staleData' | 'dailyStandings',
    fn: () => Promise<Record<string, unknown>>,
  ) => {
    setTriggering(which);
    try {
      const result = await fn();
      Alert.alert('Sent', JSON.stringify(result));
    } catch (err) {
      Alert.alert('Could not trigger', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setTriggering(null);
    }
  };

  const togglePush = async (next: boolean) => {
    if (!user?.id) return;
    setSavingChannel('push');
    try {
      await notifications.setPushEnabled(user.id, next);
      setPushEnabledState(next);
    } catch (err) {
      Alert.alert('Push reminders', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingChannel(null);
    }
  };

  const toggleEmail = async (next: boolean) => {
    if (!user?.id) return;
    setSavingChannel('email');
    try {
      await notifications.setEmailEnabled(user.id, next);
      setEmailEnabledState(next);
    } catch (err) {
      Alert.alert('Email reminders', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSavingChannel(null);
    }
  };

  // The six toggles above used to show as two separate cards with no
  // single on/off switch — every user had to visit three group headers
  // just to turn push (or email) off entirely. These two "everything at
  // once" toggles drive all three category toggles together; the
  // category-level controls still exist underneath, in "Advanced", for
  // anyone who wants push for one thing but not another.
  const [notificationsAdvancedExpanded, setNotificationsAdvancedExpanded] = useState(false);
  const [masterToggling, setMasterToggling] = useState<'push' | 'email' | null>(null);
  const allPushEnabled =
    pushEnabled === true &&
    staleDataPushEnabled === true &&
    dailyStandingsPushEnabled === true &&
    socialPushEnabled !== false;
  const allEmailEnabled =
    emailEnabled === true && staleDataEmailEnabled === true && dailyStandingsEmailEnabled === true;

  const toggleMasterPush = async (next: boolean) => {
    setMasterToggling('push');
    await Promise.all([
      togglePush(next),
      toggleStaleDataPush(next),
      toggleDailyStandingsPush(next),
      socialPushEnabled !== null ? toggleSocialPush(next) : Promise.resolve(),
    ]);
    setMasterToggling(null);
  };

  const toggleMasterEmail = async (next: boolean) => {
    setMasterToggling('email');
    await Promise.all([toggleEmail(next), toggleStaleDataEmail(next), toggleDailyStandingsEmail(next)]);
    setMasterToggling(null);
  };


  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={text.h2}>Settings</Text>

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Appearance</Text>
        <ToggleRow
          label="Light mode"
          note="Use a bright background with dark text instead of Hound's usual dark theme"
          value={mode === 'light'}
          onChange={(v) => setMode(v ? 'light' : 'dark')}
        />
        {featureNewest !== null && (
          <ToggleRow
            label="Newest challenge on Today"
            note={featureNewest ? 'Featured when you haven’t pinned one' : 'Only a pinned challenge is featured'}
            value={featureNewest}
            onChange={toggleFeatureNewest}
          />
        )}
      </Card>


      {user && (
        <Card style={styles.accountRow} elevated={false}>
          <Avatar
            initials={user.initials}
            tint={colors.accent800}
            size={40}
            fontSize={14}
            frameId={equipped?.frameId}
            backgroundId={equipped?.backgroundId}
            iconId={equipped?.iconId}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.sourceName}>{user.name}</Text>
            <Text style={styles.footNote}>
              {user.email} · Signed in with {PROVIDER_LABEL[user.provider]}
            </Text>
          </View>
          <Button
            label="Log out"
            small
            icon={<SignOutIcon size={14} color={colors.text} />}
            onPress={signOut}
          />
        </Card>
      )}

      {isSupabaseConfigured && user && (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Organization</Text>
          {user.organizationId ? (
            <>
              {orgLoadError && <Text style={styles.footNoteError}>{orgLoadError}</Text>}
              {org ? (
                <Text style={styles.footNote}>
                  You&rsquo;re a {user.orgRole === 'admin' ? 'admin' : 'member'} of {org.name} (
                  {org.kind === 'school' ? 'school' : 'company'}).
                </Text>
              ) : (
                !orgLoadError && <Text style={styles.footNote}>Loading…</Text>
              )}
              <Button
                label={leaving ? 'Leaving…' : 'Leave organization'}
                small
                variant="secondary"
                disabled={leaving}
                onPress={confirmLeave}
              />
            </>
          ) : (
            <>
              <Text style={styles.footNote}>Have an invite code from a school or company? Enter it here to join.</Text>
              <TextField
                label="Invite code"
                value={inviteCodeInput}
                onChangeText={setInviteCodeInput}
                placeholder="e.g. 7K3PQMXR"
                autoCapitalize="characters"
                autoCorrect={false}
                error={joinError ?? undefined}
              />
              <Button
                label={joining ? 'Joining…' : 'Join'}
                variant="secondary"
                small
                disabled={joining || !inviteCodeInput.trim()}
                onPress={submitJoin}
              />
            </>
          )}
        </Card>
      )}

      {isSupabaseConfigured && user && (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Username</Text>
          <Text style={styles.footNote}>
            Show a username instead of your real name in challenge leaderboards and invites.
          </Text>
          <TextField
            label="Username"
            value={usernameInput}
            onChangeText={setUsernameInput}
            placeholder="NightRunner99"
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
            error={usernameError ?? undefined}
          />
          <Button
            label={savingUsername ? 'Saving…' : 'Save username'}
            variant="secondary"
            small
            disabled={savingUsername || usernameInput.trim() === (user.username ?? '')}
            onPress={saveUsername}
          />
          {user.username ? (
            <ToggleRow
              label="Use username in challenges"
              note={savingUseUsername ? 'Saving…' : 'Instead of your real name'}
              value={!!user.useUsername}
              onChange={toggleUseUsername}
            />
          ) : (
            <Text style={styles.footNote}>Set a username above to enable this.</Text>
          )}
          {discoverable !== null && (
            <ToggleRow
              label="Show me in Find people"
              note={discoverable ? 'Friends can search for you' : 'Hidden from search'}
              value={discoverable}
              onChange={toggleDiscoverable}
            />
          )}
        </Card>
      )}

      <TwoStepSettings />
      <TodaySettings />
      <CelebrationSettings />

      <AdPrivacyCard />

      {isSupabaseConfigured &&
        pushEnabled !== null &&
        emailEnabled !== null &&
        staleDataPushEnabled !== null &&
        staleDataEmailEnabled !== null &&
        dailyStandingsPushEnabled !== null &&
        dailyStandingsEmailEnabled !== null && (
          <Card style={{ gap: 16 }} elevated={false}>
            <Text style={text.h4}>Notifications</Text>
            <Text style={styles.footNote}>
              Covers Tag catch alerts, stale-data alerts, daily standings, and nudges, reactions and trash talk. Goal
              reminders are set under You → Goals.
            </Text>
            {phonePush === 'denied' && (
              <View style={styles.phonePushNote}>
                <Text style={styles.phonePushText}>
                  Notifications are turned off for Hound on this phone, so pushes can&rsquo;t reach you. Turn them on
                  in your phone&rsquo;s Settings.
                </Text>
                <Button label="Open Settings" small variant="secondary" onPress={openPhoneSettings} />
              </View>
            )}
            {phonePush === 'undetermined' && (
              <View style={styles.phonePushNote}>
                <Text style={styles.phonePushText}>
                  This phone isn&rsquo;t set up for push yet, so pushes can&rsquo;t reach you.
                </Text>
                <Button
                  label={askingPush ? 'Turning on…' : 'Turn on'}
                  small
                  variant="primary"
                  disabled={askingPush}
                  onPress={turnOnPhonePush}
                />
              </View>
            )}
            <ToggleRow
              label="Push notifications"
              note={masterToggling === 'push' ? 'Saving…' : 'Sent to this device'}
              value={allPushEnabled}
              onChange={toggleMasterPush}
            />
            <ToggleRow
              label="Email notifications"
              note={masterToggling === 'email' ? 'Saving…' : user?.email ?? ''}
              value={allEmailEnabled}
              onChange={toggleMasterEmail}
            />

            <Pressable
              style={styles.collapsibleHeader}
              onPress={() => setNotificationsAdvancedExpanded((e) => !e)}
            >
              <Text style={styles.collapsibleTitle}>Advanced</Text>
              <CaretRightIcon
                size={16}
                color={withAlpha(colors.text, 0.5)}
                style={{ transform: [{ rotate: notificationsAdvancedExpanded ? '90deg' : '0deg' }] }}
              />
            </Pressable>

            {/* One row per alert, with Push and Email side by side, instead
                of a heading and two switches for each (eleven switches in a
                long list). A third alert ("Someone closes within 2 miles of
                me") would belong here too, but needs live GPS tracking the
                app doesn't have — see notifications/types.ts. */}
            {notificationsAdvancedExpanded && (
              <View>
                <View style={styles.alertTableHead}>
                  <Text style={[styles.alertTableHeadText, { flex: 1 }]}>Alert</Text>
                  <Text style={[styles.alertTableHeadText, styles.alertCell]}>Push</Text>
                  <Text style={[styles.alertTableHeadText, styles.alertCell]}>Email</Text>
                </View>
                {[
                  {
                    key: 'login',
                    title: 'Login reminders & Tag catches',
                    sub: '9pm if you haven’t opened Hound that day, and when someone catches you in Tag',
                    push: { on: !!pushEnabled, saving: savingChannel === 'push', toggle: togglePush },
                    email: { on: !!emailEnabled, saving: savingChannel === 'email', toggle: toggleEmail },
                  },
                  {
                    key: 'stale',
                    title: 'You haven’t synced in a day',
                    sub: '6pm your time, any challenge',
                    push: { on: !!staleDataPushEnabled, saving: savingAlert === 'staleDataPush', toggle: toggleStaleDataPush },
                    email: { on: !!staleDataEmailEnabled, saving: savingAlert === 'staleDataEmail', toggle: toggleStaleDataEmail },
                  },
                  {
                    key: 'standings',
                    title: 'Daily standings',
                    sub: '8pm your time, step races',
                    push: {
                      on: !!dailyStandingsPushEnabled,
                      saving: savingAlert === 'dailyStandingsPush',
                      toggle: toggleDailyStandingsPush,
                    },
                    email: {
                      on: !!dailyStandingsEmailEnabled,
                      saving: savingAlert === 'dailyStandingsEmail',
                      toggle: toggleDailyStandingsEmail,
                    },
                  },
                  ...(socialPushEnabled !== null
                    ? [
                        {
                          key: 'social',
                          title: 'Nudges, reactions & trash talk',
                          sub: 'When someone nudges you, reacts, or talks trash',
                          push: { on: socialPushEnabled, saving: savingSocialPush, toggle: toggleSocialPush },
                          email: null,
                        },
                      ]
                    : []),
                ].map((row) => (
                  <View key={row.key} style={styles.alertTableRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.alertGroupLabel}>{row.title}</Text>
                      <Text style={styles.footNote}>{row.sub}</Text>
                    </View>
                    {[row.push, row.email].map((cell, i) => (
                      <View key={i} style={styles.alertCell}>
                        {cell ? (
                          <Pressable
                            onPress={() => cell.toggle(!cell.on)}
                            disabled={cell.saving}
                            hitSlop={8}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: cell.on }}
                            accessibilityLabel={`${row.title}, ${i === 0 ? 'push' : 'email'}`}
                            style={[styles.alertBox, cell.on && styles.alertBoxOn, cell.saving && { opacity: 0.5 }]}
                          >
                            {cell.on && <CheckIcon size={14} color="#fff" weight="bold" />}
                          </Pressable>
                        ) : (
                          <Text style={styles.footNote}>—</Text>
                        )}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}

      {isSupabaseConfigured && user?.isAdmin && (
        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Developer tools</Text>
          <Text style={styles.footNote}>
            Fire a notification job right now instead of waiting for its daily schedule.
          </Text>
          <Button
            label={triggering === 'login' ? 'Sending…' : 'Test: Login reminders'}
            small
            disabled={triggering !== null}
            onPress={() => runTrigger('login', notifications.triggerLoginReminders)}
          />
          <Button
            label={triggering === 'staleData' ? 'Sending…' : 'Test: Stale data alert'}
            small
            disabled={triggering !== null}
            onPress={() => runTrigger('staleData', notifications.triggerStaleDataAlerts)}
          />
          <Button
            label={triggering === 'dailyStandings' ? 'Sending…' : 'Test: Daily standings'}
            small
            disabled={triggering !== null}
            onPress={() => runTrigger('dailyStandings', notifications.triggerDailyStandings)}
          />
        </Card>
      )}

      {isSupabaseConfigured && user && (
        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Delete account</Text>
          <Text style={styles.footNote}>
            Permanently deletes your account, progress, friends, Bones and cosmetics. Challenges other people are in
            are handed to one of them. This can&rsquo;t be undone.
          </Text>
          <Pressable onPress={confirmDeleteAccount} disabled={deletingAccount} style={styles.deleteRow}>
            <TrashIcon size={14} color={colors.amber} />
            <Text style={styles.deleteLabel}>{deletingAccount ? 'Deleting…' : 'Delete my account'}</Text>
          </Pressable>
        </Card>
      )}

      <Text style={styles.versionNote}>Hound v{APP_VERSION}</Text>
      <Text style={styles.versionNote}>{runningOnLabel()}</Text>
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    sourceName: { fontSize: 14.5, color: colors.text },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    phonePushNote: {
      gap: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.amber, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.4),
      alignItems: 'flex-start',
    },
    phonePushText: { fontSize: 12.5, color: colors.text },
    footNoteError: { fontSize: 12.5, color: colors.amber },
    deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 4 },
    deleteLabel: { fontSize: 14, color: colors.amber, fontFamily: font.heading },
    alertGroupLabel: { fontSize: 13.5, color: colors.text, fontFamily: font.heading },
    alertTableHead: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    alertTableHeadText: { fontSize: 11.5, letterSpacing: 0.4, color: withAlpha(colors.text, 0.55) },
    alertTableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    alertCell: { width: 48, alignItems: 'center', textAlign: 'center' },
    alertBox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.text, 0.35),
      alignItems: 'center',
      justifyContent: 'center',
    },
    alertBoxOn: { backgroundColor: color.accent, borderColor: color.accent },
    collapsibleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    collapsibleTitle: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    versionNote: { fontSize: 12, color: withAlpha(colors.text, 0.4), textAlign: 'center', marginTop: 4 },
  });
}
