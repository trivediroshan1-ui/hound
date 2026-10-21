import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingView } from '../components/LoadingView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from './types';
import { MainScreen } from '../screens/MainScreen';
import { HuntScreen } from '../screens/HuntScreen';
import { CreateScreen } from '../screens/CreateScreen';
import { ChallengeDetailScreen } from '../screens/ChallengeDetailScreen';
import { FriendDetailScreen } from '../screens/FriendDetailScreen';
import { LockerScreen } from '../screens/LockerScreen';
import { KennelScreen } from '../screens/KennelScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { AdminUserDetailScreen } from '../screens/AdminUserDetailScreen';
import { OrgManagementScreen } from '../screens/OrgManagementScreen';
import { OrgDetailScreen } from '../screens/OrgDetailScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { AchievementsScreen } from '../screens/AchievementsScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { TwoStepCodeScreen } from '../screens/auth/TwoStepCodeScreen';
import { MetricsScreen } from '../screens/MetricsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { GoalsScreen } from '../screens/GoalsScreen';
import { StackPage } from '../components/StackPage';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignUpScreen } from '../screens/auth/SignUpScreen';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';
import { useNotificationTaps } from '../notifications/notificationTaps';
import { SetupWizardScreen } from '../onboarding/SetupWizardScreen';
import { CONNECT_PROMPT_SEEN_KEY, getWelcome } from '../onboarding/welcomeApi';

const Stack = createNativeStackNavigator<RootStackParamList>();
// A separate, untyped single-screen navigator just for the connect-gate
// branch below — ConnectScreen uses useFocusEffect (see its own comment:
// it re-checks health auth status every time it's focused, not just on
// mount), which throws "Couldn't find a navigation object" without a
// real NavigationContainer/navigator ancestor. That branch renders
// ConnectScreen directly, deliberately outside the main Stack.Navigator
// below (see its own comment), so it needs its own minimal one instead
// of borrowing that one — this was a real, always-reproducing crash the
// moment connectGate ever actually reached 'show', just never hit
// before now: this was the previously-fixed connectGate hang keeping it
// permanently stuck on 'checking', so this branch never mounted at all.
const ConnectGateStack = createNativeStackNavigator();

// Once someone's dealt with this (connected, or tapped "Skip for now"),
// it never interrupts a launch again — from then on it's You → Health
// data, there to revisit whenever. Device-scoped rather than
// per-account on purpose: whether this phone's HealthKit/Health Connect
// access is granted is an OS-level fact, not something a second Hound
// account signing in on the same device needs asked again. The key
// (CONNECT_PROMPT_SEEN_KEY) lives in welcomeApi.ts, since the setup
// wizard's health step sets it too.
//
// The setup wizard (0109_welcome_wizard.sql) comes first when the
// server says this account should see it; it has its own health step,
// so the prompt above doesn't show then. Once an account is past it,
// that's remembered on the phone so later launches don't ask again.
const welcomeDoneKey = (userId: string) => `hound:welcome-done:${userId}`;

// 'checking': the AsyncStorage read + health.getAuthorizationStatus() call
// below haven't resolved yet — rendered the same as `initializing`, so a
// fresh sign-in never flashes Main before this decides. 'show': neither
// seen before nor already authorized — this is what makes ConnectScreen
// appear right after a first login instead of relying on someone finding
// it in the nav. 'hide': already seen, or health access already granted
// (e.g. restored from a previous session) — go straight to Main.
type ConnectGate = 'checking' | 'show' | 'hide';

export function RootNavigator() {
  const { status, initializing, user, secondStepNeeded } = useAuth();
  const health = useHealthProvider();
  const { colors } = useTheme();
  const [connectGate, setConnectGate] = useState<ConnectGate>('checking');
  const [showSetup, setShowSetup] = useState(false);
  // Lets a tapped push open a screen (src/notifications/notificationTaps.ts).
  // Only the main, signed-in container below carries the ref.
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navReady, setNavReady] = useState(false);
  useNotificationTaps(navigationRef, status === 'signedIn' && connectGate === 'hide', navReady);

  useEffect(() => {
    if (status !== 'signedIn') {
      // Reset so a sign-out followed by a different sign-in re-checks
      // fresh, rather than reusing whichever gate the previous session
      // last landed on.
      setConnectGate('checking');
      setShowSetup(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const userId = user?.id ?? null;
      const [seen, authStatus, welcomeDone] = await Promise.all([
        AsyncStorage.getItem(CONNECT_PROMPT_SEEN_KEY),
        health.getAuthorizationStatus(),
        userId ? AsyncStorage.getItem(welcomeDoneKey(userId)).catch(() => null) : 'true',
      ]);
      const welcome = welcomeDone === 'true' ? null : await getWelcome();
      if (cancelled) return;
      if (userId && welcome && !welcome.show) AsyncStorage.setItem(welcomeDoneKey(userId), 'true').catch(() => {});
      if (welcome?.show) {
        setShowSetup(true);
        setConnectGate('hide');
        return;
      }
      setConnectGate(seen !== 'true' && authStatus !== 'authorized' ? 'show' : 'hide');
    })().catch(() => {
      // health.getAuthorizationStatus() is now guarded not to throw on
      // both platforms (see iosProvider.ts/androidProvider.ts), but this
      // stays as a second line of defense: an unhandled rejection here
      // used to leave connectGate stuck on 'checking' forever — a
      // permanent spinner that looked like a blank screen and
      // reproduced on every relaunch. Falling back to 'hide' means the
      // worst case is skipping the connect prompt once, not being
      // locked out of the app.
      if (!cancelled) setConnectGate('hide');
    });
    return () => {
      cancelled = true;
    };
  }, [status, health, user?.id]);

  const dismissConnectPrompt = useCallback(() => {
    setConnectGate('hide');
    AsyncStorage.setItem(CONNECT_PROMPT_SEEN_KEY, 'true').catch(() => {
      // Best-effort — this session still moves on to Main either way,
      // it just might ask again next launch if this write never lands.
    });
  }, []);

  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: colors.bg,
        card: colors.bg,
        text: colors.text,
        border: colors.divider,
        primary: colors.accent,
      },
    }),
    [colors],
  );

  // Only non-instant when Supabase is configured (mock auth never
  // persists a session, so there's nothing to wait on) — restoring a
  // session from AsyncStorage is fast but still async, and briefly
  // showing Welcome before swapping to Main would be worse than a beat of
  // blank screen.
  // Two-step sign-in is on and this sign-in hasn't had the code yet:
  // nothing else of Hound shows until it has (auth/twoStep.ts).
  if (!initializing && status === 'signedIn' && secondStepNeeded) {
    return <TwoStepCodeScreen />;
  }

  if (initializing || (status === 'signedIn' && connectGate === 'checking')) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <LoadingView />
      </View>
    );
  }

  // Deliberately outside the Stack.Navigator below — a plain full-screen
  // gate, the same way the spinner above is, rather than a Stack.Screen
  // this would have to navigate to (and briefly show Main's own first
  // screen behind before redirecting). onDone is the one thing that
  // marks CONNECT_PROMPT_SEEN_KEY, so tapping "Skip for now" counts as
  // "dealt with" exactly the same as actually connecting — either way
  // this never interrupts a launch again.
  if (status === 'signedIn' && connectGate === 'show') {
    return (
      <NavigationContainer theme={navTheme}>
        <ConnectGateStack.Navigator screenOptions={{ headerShown: false }}>
          <ConnectGateStack.Screen name="ConnectGate">
            {() => (
              <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
                <ConnectScreen onDone={dismissConnectPrompt} />
              </SafeAreaView>
            )}
          </ConnectGateStack.Screen>
        </ConnectGateStack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef} onReady={() => setNavReady(true)}>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={status === 'signedOut' ? 'Welcome' : showSetup ? 'Setup' : 'Main'}
      >
        {status === 'signedOut' ? (
          // Rendering a completely different set of Stack.Screen children
          // swaps the navigator's whole state — the standard React
          // Navigation auth-flow pattern. Signing in immediately replaces
          // this group with the Main one below; there's no back button
          // into Welcome/Login/SignUp afterwards.
          <Stack.Group>
            <Stack.Screen name="Welcome">
              {({ navigation }) => (
                <WelcomeScreen
                  onContinueWithEmail={() => navigation.navigate('Login')}
                  onCreateAccount={() => navigation.navigate('SignUp')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Login" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <LoginScreen onBack={() => navigation.goBack()} onCreateAccount={() => navigation.navigate('SignUp')} />
              )}
            </Stack.Screen>
            <Stack.Screen name="SignUp" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <SignUpScreen onBack={() => navigation.goBack()} onLogIn={() => navigation.navigate('Login')} />
              )}
            </Stack.Screen>
          </Stack.Group>
        ) : (
          <Stack.Group>
            <Stack.Screen name="Main" component={MainScreen} />
            <Stack.Screen name="Hunt" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                // "All challenges" always lands on the Challenges tab, regardless
                // of whether Hunt was opened from Home, Challenges, or just-created
                // via the wizard — matching the label, not just popping the stack.
                <HuntScreen onBack={() => navigation.navigate('Main', { tab: 'challenges' })} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Create" options={{ animation: 'slide_from_bottom' }}>
              {({ navigation, route }) => (
                <CreateScreen
                  rematch={route.params?.rematch}
                  global={route.params?.global}
                  // Always lands on the Challenges tab, regardless of
                  // whether Create was opened from Home or Challenges —
                  // same "land somewhere fixed and meaningful" reasoning
                  // as Hunt's and ChallengeDetail's onBack below, rather
                  // than goBack() popping to wherever the wizard happened
                  // to be opened from. Matches onFinish below, so
                  // cancelling and finishing the wizard land in the same
                  // place.
                  // A global challenge is published from Admin, so it
                  // returns there instead.
                  kind={route.params?.kind}
                  onCancel={() =>
                    route.params?.global || route.params?.fromSetup
                      ? navigation.goBack()
                      : navigation.navigate('Main', { tab: 'challenges' })
                  }
                  // Used to always go to the static Hunt screen, regardless
                  // of what kind of challenge (or name) was actually
                  // created — every real challenge landed on the same
                  // hardcoded "Marcus is chasing you" content with no
                  // connection to what the user just made. Back to the
                  // Challenges tab instead, where ChallengesScreen's real
                  // read (src/challenges/present.ts) shows the actual new
                  // challenge.
                  onFinish={() =>
                    route.params?.global || route.params?.fromSetup
                      ? navigation.goBack()
                      : navigation.navigate('Main', { tab: 'challenges' })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="ChallengeDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <ChallengeDetailScreen
                  challengeId={route.params.challengeId}
                  initialTab={route.params.tab}
                  onRematch={(rematch) => navigation.navigate('Create', { rematch })}
                  onBack={() => navigation.navigate('Main', { tab: 'challenges' })}
                  onGoHome={() => navigation.navigate('Main', { tab: 'home' })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="FriendDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <FriendDetailScreen
                  friendshipId={route.params.friendshipId}
                  friendUserId={route.params.friendUserId}
                  friendName={route.params.friendName}
                  friendInitials={route.params.friendInitials}
                  friendFrameId={route.params.friendFrameId}
                  friendBackgroundId={route.params.friendBackgroundId}
                  friendIconId={route.params.friendIconId}
                  onBack={() => navigation.navigate('Main', { tab: 'friends' })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Locker" options={{ animation: 'slide_from_right' }}>
              {/* Opened from the You tab — goBack() returns there. */}
              {({ navigation }) => <LockerScreen onBack={() => navigation.goBack()} />}
            </Stack.Screen>
            <Stack.Screen name="Kennel" options={{ animation: 'slide_from_right' }}>
              {/* Opened from Today or the You tab — goBack() returns there. */}
              {({ navigation }) => <KennelScreen onBack={() => navigation.goBack()} />}
            </Stack.Screen>
            <Stack.Screen name="Admin" options={{ animation: 'slide_from_right' }}>
              {/* Reached from TopNav's own admin icon, visible on every
                  tab — goBack() naturally returns to whichever tab that
                  was, unlike Hunt/Create above, which deliberately land
                  on one fixed tab since they can be opened from several
                  different starting points. */}
              {({ navigation }) => (
                <AdminScreen
                  onBack={() => navigation.goBack()}
                  onNewGlobalChallenge={() => navigation.navigate('Create', { global: true })}
                  onOpenUser={(u) =>
                    navigation.navigate('AdminUserDetail', {
                      userId: u.id,
                      name: u.name,
                      initials: u.initials,
                      frameId: u.frameId,
                      backgroundId: u.backgroundId,
                      iconId: u.iconId,
                      email: u.email,
                      lastActiveAt: u.lastActiveAt,
                      createdAt: u.createdAt,
                    })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="AdminUserDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <AdminUserDetailScreen
                  userId={route.params.userId}
                  name={route.params.name}
                  initials={route.params.initials}
                  frameId={route.params.frameId}
                  backgroundId={route.params.backgroundId}
                  iconId={route.params.iconId}
                  email={route.params.email}
                  lastActiveAt={route.params.lastActiveAt}
                  createdAt={route.params.createdAt}
                  onBack={() => navigation.goBack()}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="OrgManagement" options={{ animation: 'slide_from_right' }}>
              {/* Reached from TopNav's own org icon — only for a platform
                  admin, who picks which org to manage from here. An
                  org's own (non-platform-admin) admin skips this screen
                  entirely: TopNav sends them straight to OrgDetail below
                  for their one org instead. */}
              {({ navigation }) => (
                <OrgManagementScreen
                  onBack={() => navigation.goBack()}
                  onOpenOrg={(organizationId) => navigation.navigate('OrgDetail', { organizationId })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="OrgDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <OrgDetailScreen organizationId={route.params.organizationId} onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Help" options={{ animation: 'slide_from_right' }}>
              {/* Opened from the You tab — goBack() returns there. */}
              {({ navigation }) => <HelpScreen onBack={() => navigation.goBack()} />}
            </Stack.Screen>
            {/* Stats & records, Settings and Health data used to be tabs (or
                behind your name in the top bar); now they open from You,
                and goBack() returns there. */}
            <Stack.Screen name="Stats" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage onBack={() => navigation.goBack()}>
                  <MetricsScreen />
                </StackPage>
              )}
            </Stack.Screen>
            {/* Opened from the You tab and from Today's goals card, so the
                back button just says Back. */}
            <Stack.Screen name="Goals" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage backLabel="Back" onBack={() => navigation.goBack()}>
                  <GoalsScreen />
                </StackPage>
              )}
            </Stack.Screen>
            <Stack.Screen name="Settings" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage onBack={() => navigation.goBack()}>
                  <SettingsScreen />
                </StackPage>
              )}
            </Stack.Screen>
            <Stack.Screen name="HealthData" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage onBack={() => navigation.goBack()}>
                  <ConnectScreen onDone={() => navigation.goBack()} title="Health data" doneLabel="Done" />
                </StackPage>
              )}
            </Stack.Screen>
            <Stack.Screen name="Setup" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {({ navigation, route }) => (
                <SetupWizardScreen
                  resume={route.params?.resume}
                  onOpenGoals={() => navigation.navigate('Goals')}
                  onCreateChallenge={(kind) => navigation.navigate('Create', { kind, fromSetup: true })}
                  onFinish={() => {
                    if (user?.id) AsyncStorage.setItem(welcomeDoneKey(user.id), 'true').catch(() => {});
                    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
                  }}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Achievements" options={{ animation: 'slide_from_right' }}>
              {/* Opened from Home's unlock popup or Settings — goBack()
                  returns to whichever it was. */}
              {({ navigation }) => <AchievementsScreen onBack={() => navigation.goBack()} />}
            </Stack.Screen>
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
