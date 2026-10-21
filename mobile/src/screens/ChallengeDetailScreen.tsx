import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CheckCircleIcon,
  GlobeHemisphereWestIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  RobotIcon,
  ShareNetworkIcon,
  TrashIcon,
  TrophyIcon,
  XIcon,
} from 'phosphor-react-native';
import { AddFriendChip, type AddFriendChipState } from '../components/AddFriendChip';
import { PersonActions } from '../components/PersonActions';
import { TrashTalkCard } from '../components/TrashTalkCard';
import type { Standing, TauntUnit } from '../social/trashTalk';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LoadingView } from '../components/LoadingView';
import { ProgressBar } from '../components/ProgressBar';
import { Tag } from '../components/Tag';
import { TagRadar, type TagRadarMember } from '../components/TagRadar';
import { TicTacGoCard } from '../components/TicTacGoCard';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/Selectable';
import { SegmentedControl } from '../components/SegmentedControl';
import type { ChallengeTab } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import {
  buildBoard,
  headStartDaysLeft as computeHeadStartDaysLeft,
  headStartBaselineDayKey,
  huntEffectiveMetric,
  inviteWindowClosed,
  isChallengeFinished,
  isHuntConcluded,
  withHuntCatches,
} from '../challenges/board';
import { daysElapsedFraction } from '../challenges/botSimulation';
import { syncChallengeProgressFromDevice, syncBingoProgressFromDevice, syncSeventyFiveFromDevice } from '../challenges/deviceSync';
import { challengeDayNumber, getChallengeDays, workoutCounts, type ChallengeDays } from '../challenges/challengeDays';
import {
  BINGO_CARD_TYPE_NAME,
  BINGO_CATEGORY_LABEL,
  BINGO_SQUARE_COUNT,
  categoriesForCardType,
  computeBingoCards,
  DEFAULT_BINGO_CARD_TYPE,
  type BingoCard,
  type BingoCategory,
  type BingoProgressRow,
} from '../challenges/bingo';
import { listBingoCards, listBingoProgress, recordBingoProgress, unlinkBingoProgress } from '../challenges/bingoApi';
import {
  houndStandings,
  isHoundCard,
  squareLabel,
  type BingoCardRow,
  type HoundCardState,
  type HoundSquare,
} from '../challenges/houndBingo';
import { HoundBingoCard } from '../components/HoundBingoCard';
import { getTicTacGoGame, settleTicTacGo, type TicTacGoGame } from '../challenges/tictacgoApi';
import { settleChallengeScore } from '../challenges/scoreApi';
import { getChallengeSponsor, isGlobalChallenge, type ChallengeSponsor } from '../challenges/globalChallenges';
import { SponsorBanner } from '../components/SponsorLine';
import { ChallengePotCard } from '../components/ChallengePotCard';
import { useCurrencyName } from '../organizations/useCurrencyName';
import type { WorkoutSample } from '../health/types';
import { boardSortFor, usesDeviceSteps, usesDistanceRanking, usesWorkoutDistance } from '../challenges/scoring';
import { formatStartsLabel, hasStarted, huntKindName, huntRoleLabel, HUNT_ROLE_TAG_VARIANT } from '../challenges/present';
import type { Challenge, ChallengeBot, Participant, LeaderboardEntry, TagRound } from '../challenges/types';
import {
  checkTagCatch,
  computeTagStats,
  getTagRound,
  listTagEvents,
  listTagMembers,
  selectTagTarget,
  settleTagTimeout,
  TAG_TIME_LIMIT_MINUTES,
  type TagEvent,
  type TagMember,
} from '../challenges/tagApi';
import { computeStreakStatus, streakConcluded, type StreakStatus } from '../challenges/streak';
import { listDailyProgress, listParticipantJoinDates } from '../challenges/streakApi';
import { computeSeventyFiveStatus, isSeventyFiveDayComplete, type SeventyFiveCheckin, type SeventyFiveStatus } from '../challenges/seventyFive';
import {
  listSeventyFiveCheckins,
  listSeventyFiveJoinDates,
  setSelfReportCheckin,
  type SelfReportItem,
} from '../challenges/seventyFiveApi';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { buildRematchDraft, type RematchDraft } from '../challenges/rematch';
import { ordinal, resultLine, type ResultOutcome } from '../challenges/shareResult';
import { ShareSheet } from '../share/ShareSheet';
import { friendEligible } from '../friends/eligibility';
import { useAuth } from '../auth/AuthContext';
import {
  applyToggle,
  myRecentNudges,
  nudgeAgainLabel,
  reactionsForDay,
  sendNudge,
  summarize,
  toggleReaction,
  type Reaction,
  type ReactionEmoji,
} from '../social/social';
import { useHealthProvider } from '../health/HealthContext';
import { useLabels } from '../labels/LabelsContext';

// The generic detail view for a real, Supabase-backed challenge of any
// kind — there's no per-kind template yet (HuntScreen is one specific
// hardcoded storyline, not reusable), so this renders the same for every
// kind: who's in it, who's logged what, and a way to log your own
// progress. A 'steps' challenge, a 'hunt' scored on device steps or
// workout distance, and a 'distance' pool (once its group target has a
// unit — see usesDeviceSteps/usesWorkoutDistance in scoring.ts) are the
// exceptions — they have a real, unambiguous device number to draw from,
// so they auto-sync from HealthKit/Health Connect instead of showing the
// manual form. Fetches by id itself rather than taking pre-loaded data as
// props, so it works from any entry point.
export function ChallengeDetailScreen({
  challengeId,
  onBack,
  onGoHome,
  onRematch,
  initialTab,
}: {
  challengeId: string;
  // Which tab to open on; a trash-talk notification opens Talk.
  initialTab?: ChallengeTab;
  onBack: () => void;
  onGoHome: () => void;
  // Opens Create prefilled from this (finished) challenge.
  onRematch: (draft: RematchDraft) => void;
}) {
  const { user } = useAuth();
  const currencyName = useCurrencyName();
  const health = useHealthProvider();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { labelsForOrg } = useLabels();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  // The finished challenge's Share result sheet is open.
  const [sharingResult, setSharingResult] = useState(false);
  // Which calendar days count on this phone (challengeDays.ts) — for
  // Bingo's workout picker and the 75 Day checklist.
  const [challengeDays, setChallengeDays] = useState<ChallengeDays | null>(null);
  // This challenge's own words, not the viewer's — see LabelsContext's
  // own comment on why those can differ (a platform admin viewing
  // someone else's org's challenge, or a global challenge for someone
  // who happens to be in an org).
  const labels = labelsForOrg(challenge?.organizationId);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [bots, setBots] = useState<ChallengeBot[]>([]);
  // Everyone's total as of the day the Hunted's head start ended — only
  // ever populated for a hunt with one (see load()); stays [] otherwise,
  // which buildBoard already treats as "nothing to credit."
  const [headStartLeaderboard, setHeadStartLeaderboard] = useState<LeaderboardEntry[]>([]);
  // Everyone's total as of the end of yesterday — only fetched for the
  // ranked kinds (Step Race, Chase) once they've been running since
  // before today; drives the leaderboard's ▲/▼ movement. null otherwise.
  const [yesterdayLeaderboard, setYesterdayLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Only exists to make formatEndsLabel's countdown actually tick once a
  // challenge is in its last 24 hours — every 30s is plenty of
  // resolution for a minutes-level countdown, and doesn't need to be
  // running at all the rest of the time this screen is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [stepsInput, setStepsInput] = useState('');
  const [distanceInput, setDistanceInput] = useState('');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState(false);

  // Game of Tag's own live state — both stay empty for any other kind.
  // tagRound is null until load() resolves for a 'tag' challenge, or if
  // this isn't one at all.
  const [tagRound, setTagRound] = useState<TagRound | null>(null);
  const [tagMembers, setTagMembers] = useState<TagMember[]>([]);
  const [tagEvents, setTagEvents] = useState<TagEvent[]>([]);
  const [selectingTargetId, setSelectingTargetId] = useState<string | null>(null);
  const [tagActionError, setTagActionError] = useState<string | null>(null);

  // A first-time explainer for Game of Tag's own rules — shown once,
  // ever, the first time anyone opens any 'tag' challenge (not once
  // per challenge — the mechanic doesn't change between them). Starts
  // false so it never flashes on for a returning player while the
  // AsyncStorage check below is still in flight.
  const TAG_EXPLAINER_SEEN_KEY = 'tagExplainerSeen';
  const [showTagExplainer, setShowTagExplainer] = useState(false);

  useEffect(() => {
    if (challenge?.kind !== 'tag') return;
    let cancelled = false;
    AsyncStorage.getItem(TAG_EXPLAINER_SEEN_KEY)
      .then((seen) => {
        if (!cancelled && seen !== 'true') setShowTagExplainer(true);
      })
      .catch(() => {
        // Best-effort — if this can't be read, just don't show the
        // explainer rather than risk showing it every single time.
      });
    return () => {
      cancelled = true;
    };
  }, [challenge?.kind]);

  const dismissTagExplainer = () => {
    setShowTagExplainer(false);
    AsyncStorage.setItem(TAG_EXPLAINER_SEEN_KEY, 'true').catch(() => {
      // Best-effort — worst case it shows again next time.
    });
  };

  // Same one-time explainer pattern as Tag's, for Chase (challenge.kind
  // === 'hunt' — 'hunt' is the internal identifier; see huntKindName).
  // A separate key from Tag's since they're unrelated mechanics a player
  // may not have encountered both of yet.
  const CHASE_EXPLAINER_SEEN_KEY = 'chaseExplainerSeen';
  const [showChaseExplainer, setShowChaseExplainer] = useState(false);

  useEffect(() => {
    if (challenge?.kind !== 'hunt') return;
    let cancelled = false;
    AsyncStorage.getItem(CHASE_EXPLAINER_SEEN_KEY)
      .then((seen) => {
        if (!cancelled && seen !== 'true') setShowChaseExplainer(true);
      })
      .catch(() => {
        // Best-effort — if this can't be read, just don't show the
        // explainer rather than risk showing it every single time.
      });
    return () => {
      cancelled = true;
    };
  }, [challenge?.kind]);

  const dismissChaseExplainer = () => {
    setShowChaseExplainer(false);
    AsyncStorage.setItem(CHASE_EXPLAINER_SEEN_KEY, 'true').catch(() => {
      // Best-effort — worst case it shows again next time.
    });
  };

  // Board (where everyone stands), Talk (trash talk) and Details (rules,
  // dates, pinning, inviting, deleting). Testers found one long scroll
  // mixing all of it hard to read.
  const [tab, setTab] = useState<ChallengeTab>(initialTab ?? 'board');
  // A notification tap can re-open this screen with a different tab while
  // it's already showing.
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, challengeId]);

  // Daily Streak's own elimination state — empty for any other kind.
  // Keyed by userId; see computeStreakStatus (src/challenges/streak.ts)
  // for how this is derived fresh on every load rather than stored.
  const [streakStatuses, setStreakStatuses] = useState<Map<string, StreakStatus>>(new Map());

  // Variety Bingo's own progress rows — empty for any other kind. Folded
  // into per-participant BingoCards below (see computeBingoCards), same
  // "fetch flat rows, compute fresh on every load" shape as Daily Streak.
  const [bingoRows, setBingoRows] = useState<BingoProgressRow[]>([]);
  // A hound Bingo's dealt cards (0117_hound_bingo.sql), everyone's.
  const [bingoCardRows, setBingoCardRows] = useState<BingoCardRow[]>([]);

  // 75 Day Challenge's own checklist rows and derived streak state —
  // empty/blank for any other kind. Same "fetch flat rows, compute fresh
  // on every load" shape as Daily Streak's streakStatuses above, just
  // with a reset-not-eliminate streak instead (see
  // computeSeventyFiveStatus's own comment).
  const [seventyFiveCheckins, setSeventyFiveCheckins] = useState<SeventyFiveCheckin[]>([]);
  const [seventyFiveStatuses, setSeventyFiveStatuses] = useState<Map<string, SeventyFiveStatus>>(new Map());
  const [seventyFiveSaving, setSeventyFiveSaving] = useState<SelfReportItem | null>(null);

  // Tic-Tac-Go's board — null for any other kind, or a game whose board
  // was never set up.
  const [tttGame, setTttGame] = useState<TicTacGoGame | null>(null);

  // Which square (if any) is currently showing its "pick a workout to
  // link" panel — see the effect below and the "Your bingo card" render.
  // Null means the panel is closed.
  const [linkingCategory, setLinkingCategory] = useState<BingoCategory | null>(null);
  const [todaysWorkouts, setTodaysWorkouts] = useState<WorkoutSample[]>([]);
  const [loadingTodaysWorkouts, setLoadingTodaysWorkouts] = useState(false);
  const [linkingWorkoutId, setLinkingWorkoutId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Fetched fresh every time a square is tapped, rather than kept around —
  // "today" only ever needs to be right at the moment someone opens the
  // picker, and a stale list from minutes ago risks missing a workout
  // they just finished logging.
  useEffect(() => {
    if (!linkingCategory || !challenge) return;
    let cancelled = false;
    setLoadingTodaysWorkouts(true);
    setLinkError(null);
    const todayKey = dateKey(new Date());
    // A hound card takes a workout from any day of the challenge.
    const anyDay = isHoundCard(challenge);
    Promise.all([getChallengeDays(challenge), health.getRecentWorkouts(anyDay ? 200 : 50)])
      .then(([days, workouts]) => {
        if (cancelled) return;
        setTodaysWorkouts(
          workouts.filter((w) => (anyDay || dateKey(w.when) === todayKey) && workoutCounts(days, w.when)),
        );
      })
      .catch(() => {
        if (!cancelled) setTodaysWorkouts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTodaysWorkouts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkingCategory, challenge, health]);

  // Links one of today's real workouts to a square — a 'manual' fill, so
  // it overwrites whatever was there before (an earlier manual pick, or
  // an auto-classified guess) rather than being refused as a duplicate.
  // See recordBingoProgress's own comment for why 'manual' behaves this
  // way and 'auto' doesn't.
  const linkWorkout = async (category: BingoCategory, workout: WorkoutSample) => {
    if (!challenge) return;
    setLinkingWorkoutId(workout.id);
    setLinkError(null);
    try {
      await recordBingoProgress(challenge.id, category, 'manual', {
        id: workout.id,
        name: workout.name,
        when: workout.when,
        day: dateKey(workout.when),
      });
      setLinkingCategory(null);
      await load();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Could not link that workout — try again.');
    } finally {
      setLinkingWorkoutId(null);
    }
  };

  const [removingLink, setRemovingLink] = useState(false);

  // Undoes an accidental manual link — only ever offered for a 'manual'
  // row (see the render below); the RLS policy backing this refuses an
  // 'auto' one anyway (unlinkBingoProgress's own comment).
  const removeLink = async (category: BingoCategory) => {
    if (!challenge) return;
    setRemovingLink(true);
    setLinkError(null);
    try {
      await unlinkBingoProgress(challenge.id, category);
      setLinkingCategory(null);
      await load();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Could not remove that link — try again.');
    } finally {
      setRemovingLink(false);
    }
  };

  const [friends, setFriends] = useState<Friend[]>([]);
  // Which leaderboard row's add-friend chip is mid-request, if any.
  const [friendRequestBusyId, setFriendRequestBusyId] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  // Every friend with a pending invite to this challenge — hydrated from
  // listSentChallengeInvites() on every load() (see below), not just
  // flipped locally after tapping "Invite" in this session, so a friend
  // invited at creation time reads "Remind" from the very first render.
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  // A Global Hound Challenge (0075_global_challenges.sql) takes no
  // invites — anyone can join it from Today instead.
  const [isGlobal, setIsGlobal] = useState(false);
  // Its sponsor (0111_sponsored_challenges.sql), shown under the name.
  const [sponsor, setSponsor] = useState<ChallengeSponsor | null>(null);
  useEffect(() => {
    isGlobalChallenge(challengeId).then((global) => {
      setIsGlobal(global);
      if (global) getChallengeSponsor(challengeId).then(setSponsor).catch(() => {});
    });
  }, [challengeId]);
  const [friendSearch, setFriendSearch] = useState('');

  // Where the viewer stands with someone on this challenge's board — null
  // means no chip at all: it's the viewer, a bot, or already a friend.
  const friendChipStateFor = (userId: string, isBot?: boolean): AddFriendChipState | null => {
    if (isBot || !user?.id || userId === user.id) return null;
    const f = friends.find((x) => x.userId === userId);
    if (!f) return 'add';
    if (f.status === 'accepted') return null;
    return f.requestedByMe ? 'requested' : 'accept';
  };

  // Just re-reads the friend list afterwards, not the whole challenge —
  // nothing else on this screen changes when a friendship does.
  const addFriendFromBoard = async (userId: string) => {
    setFriendRequestBusyId(userId);
    try {
      await supabaseFriendsProvider.sendFriendRequest(userId);
    } catch (e) {
      Alert.alert('Could not add friend', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      try {
        setFriends(await supabaseFriendsProvider.listFriends());
      } catch {
        // Keep the old list — the chip just stays as it was.
      }
      setFriendRequestBusyId(null);
    }
  };

  const renderFriendChip = (userId: string, isBot?: boolean) => {
    const state = friendChipStateFor(userId, isBot);
    if (!state) return null;
    return (
      <AddFriendChip
        state={state}
        busy={friendRequestBusyId === userId}
        onPress={() => addFriendFromBoard(userId)}
      />
    );
  };

  // Nudges and reactions (0082_nudges_reactions.sql): tap someone on the
  // board to react to their progress today, or nudge them. Loaded on its
  // own — a failure here never affects the rest of the screen.
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [recentNudges, setRecentNudges] = useState<Map<string, string>>(new Map());
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const [nudgeNotes, setNudgeNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    reactionsForDay(challengeId).then(setReactions).catch(() => {});
    myRecentNudges().then(setRecentNudges).catch(() => {});
  }, [challengeId]);

  const canInteractWith = (userId: string, isBot?: boolean) => !isBot && !!user?.id && userId !== user.id;
  const togglePerson = (userId: string) => setExpandedPersonId((cur) => (cur === userId ? null : userId));

  const react = async (userId: string, emoji: ReactionEmoji) => {
    if (!user?.id) return;
    const me = { id: user.id, name: user.name };
    const wasOn = reactions.some((r) => r.fromUserId === user.id && r.toUserId === userId && r.emoji === emoji);
    setReactions((cur) => applyToggle(cur, me, userId, emoji, !wasOn));
    try {
      const on = await toggleReaction(challengeId, userId, emoji);
      if (on === wasOn) setReactions((cur) => applyToggle(cur, me, userId, emoji, on));
    } catch (e) {
      setReactions((cur) => applyToggle(cur, me, userId, emoji, wasOn));
      Alert.alert('Could not react', e instanceof Error ? e.message : 'Try again in a moment.');
    }
  };

  const nudge = async (userId: string, name: string) => {
    setNudgingId(userId);
    try {
      const { pushed } = await sendNudge(userId, challengeId);
      setRecentNudges((cur) => new Map(cur).set(userId, new Date().toISOString()));
      setNudgeNotes((cur) => ({
        ...cur,
        [userId]: pushed
          ? `Nudged ${name} 👋`
          : `Nudged ${name} — they can’t get notifications yet, so they’ll see it next time they open Hound.`,
      }));
    } catch (e) {
      Alert.alert('Could not nudge', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setNudgingId(null);
    }
  };

  const renderPersonActions = (userId: string, name: string, isBot: boolean | undefined, indent: number) => {
    if (isBot) return null;
    const interactive = canInteractWith(userId);
    // Global challenges are full of strangers: nudges there are for
    // friends only (send_nudge enforces the same). Nobody nudges in a
    // challenge that's over.
    const isFriend = friends.some((f) => f.userId === userId && f.status === 'accepted');
    const offerNudge = interactive && !finished && (!isGlobal || isFriend);
    return (
      <PersonActions
        summary={summarize(reactions, userId, user?.id)}
        canReact={interactive}
        expanded={expandedPersonId === userId}
        nudge={
          offerNudge
            ? { waitLabel: nudgeAgainLabel(recentNudges.get(userId)), busy: nudgingId === userId }
            : undefined
        }
        note={nudgeNotes[userId]}
        onReact={(emoji) => react(userId, emoji)}
        onNudge={() => nudge(userId, name)}
        indent={indent}
      />
    );
  };

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // The challenge itself has to resolve first — whether a
      // head-start-baseline fetch is even worth making depends on its
      // own kind/headStartDays, which isn't known until this returns.
      const c = await supabaseChallengesProvider.getChallenge(challengeId);
      // Best-effort, unawaited — see ChallengesScreen's own call site for
      // why this is safe to fire on every load regardless of whether this
      // challenge has actually concluded.
      settleChallengeScore(challengeId).catch(() => {});
      const needsHeadStart = c.kind === 'hunt' && !!c.headStartDays;
      const needsTag = c.kind === 'tag';
      const needsStreak = c.kind === 'streak';
      const needsBingo = c.kind === 'bingo';
      const needsTicTacGo = c.kind === 'tictacgo';
      const needsSeventyFive = c.kind === 'seventyfive';
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const needsMovement =
        (c.kind === 'steps' || c.kind === 'hunt') && new Date(c.startsAt).getTime() < startOfToday.getTime();
      const yesterdayKey = dateKey(new Date(startOfToday.getTime() - 12 * 3_600_000));
      // Settled before the round itself is fetched, not after — so a
      // stalled turn (15 real minutes with no catch) has already moved
      // on by the time this same load() reads who's IT, rather than
      // showing a round that's about to change out from under it.
      if (needsTag) await settleTagTimeout(challengeId).catch(() => {});
      // Same idea for Tic-Tac-Go: pass a turn that's run past 24 hours
      // (or end a game whose time is up) before reading the board.
      if (needsTicTacGo) await settleTicTacGo(challengeId).catch(() => {});
      const [
        p,
        l,
        b,
        f,
        hs,
        sentInvites,
        tagRoundResult,
        tagMembersResult,
        tagEventsResult,
        dailyRows,
        joinDates,
        bingoRowsResult,
        tttGameResult,
        seventyFiveCheckinsResult,
        seventyFiveJoinDates,
        yesterdayBoard,
      ] = await Promise.all([
        supabaseChallengesProvider.listParticipants(challengeId),
        supabaseChallengesProvider.getLeaderboard(challengeId),
        supabaseChallengesProvider.listBots(challengeId),
        supabaseFriendsProvider.listFriends(),
        needsHeadStart
          ? supabaseChallengesProvider.getLeaderboard(challengeId, headStartBaselineDayKey(c))
          : Promise.resolve<LeaderboardEntry[]>([]),
        supabaseChallengesProvider.listSentChallengeInvites(challengeId),
        needsTag ? getTagRound(challengeId) : Promise.resolve(null),
        needsTag ? listTagMembers(challengeId) : Promise.resolve([]),
        needsTag ? listTagEvents(challengeId) : Promise.resolve([]),
        needsStreak ? listDailyProgress(challengeId) : Promise.resolve([]),
        needsStreak ? listParticipantJoinDates(challengeId) : Promise.resolve(new Map<string, Date>()),
        needsBingo ? listBingoProgress(challengeId) : Promise.resolve<BingoProgressRow[]>([]),
        needsTicTacGo ? getTicTacGoGame(challengeId) : Promise.resolve(null),
        needsSeventyFive ? listSeventyFiveCheckins(challengeId) : Promise.resolve<SeventyFiveCheckin[]>([]),
        needsSeventyFive ? listSeventyFiveJoinDates(challengeId) : Promise.resolve(new Map<string, Date>()),
        // Best-effort: missing movement arrows never block the screen.
        needsMovement
          ? supabaseChallengesProvider.getLeaderboard(challengeId, yesterdayKey).catch(() => null)
          : Promise.resolve(null),
      ]);
      setChallenge(c);
      setParticipants(p);
      setLeaderboard(l);
      setBots(b);
      setFriends(f);
      setHeadStartLeaderboard(hs);
      setYesterdayLeaderboard(yesterdayBoard);
      setInvitedIds(new Set(sentInvites));
      setTagRound(tagRoundResult);
      setTagMembers(tagMembersResult);
      setTagEvents(tagEventsResult);
      // The challenge's own calendar days (never throws; falls back to
      // the old per-phone rule).
      const days = needsStreak || needsSeventyFive ? await getChallengeDays(c) : null;
      setStreakStatuses(needsStreak && days ? computeStreakStatus(c, joinDates, dailyRows, days) : new Map());
      setBingoRows(bingoRowsResult);
      setBingoCardRows(isHoundCard(c) ? await listBingoCards(challengeId).catch(() => []) : []);
      setTttGame(tttGameResult);
      setSeventyFiveCheckins(seventyFiveCheckinsResult);
      setSeventyFiveStatuses(
        needsSeventyFive && days
          ? computeSeventyFiveStatus(c, seventyFiveJoinDates, seventyFiveCheckinsResult, days)
          : new Map(),
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this challenge.');
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Notices a catch on this board that isn't stored yet and has the
  // server record it (hunt_apply_catches, 0119_hunt_catches_on_server.sql),
  // which checks the numbers itself and never trusts this screen. Anyone in
  // the chase can trigger it, so a catch no longer waits for the caught
  // person to open the app. Before 0119 has run, a caught Hunted person
  // writes their own catch as before (ChallengesProvider.markCaught).
  // Runs on every load; once the catch is stored and load() re-fetches,
  // nobody's stored role is 'hunted' while the board says 'zombie', so
  // this goes quiet.
  useEffect(() => {
    if (!challenge || challenge.kind !== 'hunt' || !user?.id) return;
    const mine = participants.find((p) => p.userId === user.id);
    if (mine?.role !== 'hunted' && mine?.role !== 'hunter') return;
    const sortBy = boardSortFor(challenge);
    const rawBoard = buildBoard(
      participants,
      leaderboard,
      bots,
      daysElapsedFraction(challenge),
      sortBy,
      challenge,
      headStartLeaderboard,
    );
    const stillHunted = new Set(participants.filter((p) => p.role === 'hunted').map((p) => p.userId));
    const newlyCaught = withHuntCatches(rawBoard, sortBy, challenge).filter(
      (r) => r.role === 'zombie' && stillHunted.has(r.userId),
    );
    if (newlyCaught.length === 0) return;
    const meCaught = newlyCaught.some((r) => r.userId === user.id);
    supabaseChallengesProvider
      .applyHuntCatches(challenge.id)
      .then((recorded) => {
        if (recorded !== null) return recorded;
        return meCaught ? supabaseChallengesProvider.markCaught(challenge.id).then(() => 1) : 0;
      })
      .then((recorded) => {
        if (recorded > 0) load();
      })
      .catch(() => {});
  }, [challenge, participants, leaderboard, bots, headStartLeaderboard, user?.id, load]);

  // Notices "I've closed the gap" while IT — mirrors the hunt
  // catch-detection effect above, just server-verified instead of
  // computed client-side: tag_check_catch itself re-checks IT's own
  // current total against the target's snapshot from scratch (see
  // tagApi.ts), so this never trusts anything read here. Runs on every
  // load, harmless either way — once a catch actually lands, load()
  // re-fetches a round where this user is no longer IT, and this
  // effect's own guard below stops doing anything further.
  useEffect(() => {
    if (!challenge || challenge.kind !== 'tag' || !user?.id) return;
    if (!tagRound || tagRound.itUserId !== user.id || !tagRound.targetUserId) return;
    checkTagCatch(challenge.id)
      .then((caught) => {
        if (caught) load();
      })
      .catch(() => {});
  }, [challenge, tagRound, user?.id, load]);

  const [deleting, setDeleting] = useState(false);
  const [togglingHighlight, setTogglingHighlight] = useState(false);

  const toggleHighlight = async (next: boolean) => {
    setTogglingHighlight(true);
    try {
      await supabaseChallengesProvider.setHighlighted(challengeId, next);
      await load();
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setTogglingHighlight(false);
    }
  };

  const inviteFriend = async (friend: Friend) => {
    setInvitingId(friend.userId);
    try {
      // A hunt's Hunter is fixed at creation (CreateScreen's own
      // roleFor) and never changes later — anyone invited after that
      // joins as Hunted. Without this, a friend added post-creation got
      // role: null, which reads as no tag at all rather than "Runner",
      // and (via huntEffectiveMetric/withHuntCatches) never counts as
      // someone the Hunter can actually catch.
      const role = challenge?.kind === 'hunt' ? 'hunted' : undefined;
      await supabaseChallengesProvider.inviteFriendToChallenge(challengeId, friend.userId, role);
      setInvitedIds((cur) => new Set(cur).add(friend.userId));
    } catch (e) {
      // "Already invited" isn't really a failure from here — still mark
      // it, so the button reads the same either way.
      if (e instanceof Error && e.message === 'Already invited.') {
        setInvitedIds((cur) => new Set(cur).add(friend.userId));
      } else {
        Alert.alert('Could not invite', e instanceof Error ? e.message : 'Try again.');
      }
    } finally {
      setInvitingId(null);
    }
  };

  const remindFriend = async (friend: Friend) => {
    setInvitingId(friend.userId);
    try {
      await supabaseChallengesProvider.remindChallengeInvite(challengeId, friend.userId);
    } catch (e) {
      Alert.alert('Could not send reminder', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setInvitingId(null);
    }
  };

  const pickTagTarget = async (targetUserId: string) => {
    setTagActionError(null);
    setSelectingTargetId(targetUserId);
    try {
      await selectTagTarget(challengeId, targetUserId);
    } catch (e) {
      setTagActionError(e instanceof Error ? e.message : 'Could not pick that person — try again.');
    } finally {
      // Reload even on failure: the board may be stale (e.g. the target
      // was no longer actually ahead), and a rejected pick should drop
      // them from the tappable list rather than leave a dead button.
      await load();
      setSelectingTargetId(null);
    }
  };

  const confirmDelete = () => {
    if (!challenge) return;
    Alert.alert(
      'Delete this challenge?',
      `This removes "${challenge.name}" and everyone's progress in it for good. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await supabaseChallengesProvider.deleteChallenge(challengeId);
              onBack();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.');
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  // Backfills this challenge's entire progress from real device history —
  // see deviceSync.ts's own comment for what/why. Re-running this on
  // every sync is deliberate and harmless (it's an upsert): it catches
  // up a challenge someone joined after it started, or picks back up
  // correctly after a few days of not opening the app, without a
  // separate "first ever sync" code path.
  const syncFromDevice = useCallback(async () => {
    if (!challenge) return;
    await syncChallengeProgressFromDevice(challenge, health);
    await load();
  }, [challenge, health, load]);

  // Auto-sync once whenever a challenge that draws from the device
  // finishes loading — keyed on id/kind/scoringMethod (not the whole
  // `challenge` object, which is a fresh reference every reload) so
  // syncFromDevice's own load() call doesn't re-trigger this.
  useEffect(() => {
    if (challenge && (usesDeviceSteps(challenge) || usesWorkoutDistance(challenge))) {
      syncFromDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.kind, challenge?.scoringMethod]);

  // Variety Bingo's own device sync — separate from syncFromDevice above
  // since it's neither steps- nor distance-scored (see
  // syncBingoProgressFromDevice's own comment in deviceSync.ts).
  const syncBingoFromDevice = useCallback(async () => {
    if (!challenge) return;
    await syncBingoProgressFromDevice(challenge, health);
    await load();
  }, [challenge, health, load]);

  useEffect(() => {
    if (challenge && challenge.kind === 'bingo') {
      syncBingoFromDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.kind]);

  // 75 Day Challenge's own device sync — separate from syncFromDevice
  // above for the same reason Bingo's is: it's a per-day presence check
  // (did a workout happen today, was a second one outdoor), not a single
  // steps-or-distance total (see syncSeventyFiveFromDevice's own comment
  // in deviceSync.ts).
  const syncSeventyFiveDevice = useCallback(async () => {
    if (!challenge) return;
    await syncSeventyFiveFromDevice(challenge, health);
    await load();
  }, [challenge, health, load]);

  useEffect(() => {
    if (challenge && challenge.kind === 'seventyfive') {
      syncSeventyFiveDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.kind]);

  useEffect(() => {
    if (!challenge || challenge.kind !== 'seventyfive') return;
    let cancelled = false;
    getChallengeDays(challenge).then((d) => {
      if (!cancelled) setChallengeDays(d);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.kind]);

  // Today's own self-report toggle — diet/water/reading/photo only; the
  // two workout items are read-only here, filled by
  // syncSeventyFiveFromDevice above. A past day's checklist isn't
  // editable at all (this only ever writes today's row — see
  // setSelfReportCheckin's own default-to-today parameter).
  const toggleSeventyFiveItem = async (item: SelfReportItem, next: boolean) => {
    if (!challenge) return;
    setSeventyFiveSaving(item);
    try {
      await setSelfReportCheckin(challenge.id, item, next);
      await load();
    } catch (e) {
      Alert.alert('Could not save that', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSeventyFiveSaving(null);
    }
  };

  const logProgress = async () => {
    const steps = Number(stepsInput);
    if (!Number.isFinite(steps) || steps < 0) {
      setLogError('Enter a whole number of steps.');
      return;
    }
    const distanceMi = distanceInput.trim() ? Number(distanceInput) : 0;
    if (!Number.isFinite(distanceMi) || distanceMi < 0) {
      setLogError('Enter a valid distance, or leave it blank.');
      return;
    }
    setLogError(null);
    setLogSuccess(false);
    setLogging(true);
    try {
      await supabaseChallengesProvider.recordProgress(challengeId, Math.round(steps), distanceMi);
      setLogSuccess(true);
      setStepsInput('');
      setDistanceInput('');
      await load();
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setLogging(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, styles.centered]}>
        <LoadingView />
      </SafeAreaView>
    );
  }

  if (loadError || !challenge) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container}>
          <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
          <Text style={styles.loadError}>{loadError ?? 'This challenge could not be found.'}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const typeDef = CHALLENGE_TYPES.find((t) => t.id === challenge.kind);
  // challenge.kind is real server data, not this build's own
  // CHALLENGE_TYPES list — see DEFAULT_CHALLENGE_ICON's own comment for
  // why a kind newer than this build falls back rather than crashing.
  const Icon = CHALLENGE_KIND_ICON[challenge.kind] ?? DEFAULT_CHALLENGE_ICON;
  const started = hasStarted(challenge, now);
  const daysElapsed = challengeDayNumber(challenge, new Date(now));
  const endsLabel = formatEndsLabel(challenge.endsAt, now);
  // Before the challenge actually begins (CreateScreen's 'tomorrow' start
  // option, or any other future starts_at), "Day 1 of N" would read as
  // if it had already started — see hasStarted's own comment.
  const dayLabel = started ? `Day ${daysElapsed} of ${challenge.durationDays}` : formatStartsLabel(challenge.startsAt, now);

  const myHighlighted = participants.find((p) => p.userId === user?.id)?.highlighted ?? false;

  const bingoCardType = challenge.bingoCardType ?? DEFAULT_BINGO_CARD_TYPE;
  const bingoCategories = categoriesForCardType(bingoCardType);

  const scoredByDistance = usesDistanceRanking(challenge);
  const sortBy = boardSortFor(challenge);
  const rawBoard = buildBoard(
    participants,
    leaderboard,
    bots,
    daysElapsedFraction(challenge),
    sortBy,
    challenge,
    headStartLeaderboard,
  );
  const board = (challenge.kind === 'hunt' ? withHuntCatches(rawBoard, sortBy, challenge) : rawBoard).map((row) => ({
    ...row,
    name: row.userId === user?.id ? 'You' : row.name,
  }));

  // Only for display — board itself (and board[0] elsewhere on this
  // screen) stays sorted by raw total, same as every other kind. A
  // Daily Streak ranked that way would put someone eliminated on day
  // one, who happened to binge-log a huge total that same day, above
  // someone still alive on a modest but unbroken streak — exactly the
  // consistency-over-volume point of the whole mechanic. Alive rows
  // first (longer current streak first), then eliminated rows (whoever
  // lasted longest first).
  const streakBoard =
    challenge.kind === 'streak'
      ? [...board].sort((a, b) => {
          const sa = streakStatuses.get(a.userId);
          const sb = streakStatuses.get(b.userId);
          const aAlive = !sa || sa.eliminatedOnDay === null;
          const bAlive = !sb || sb.eliminatedOnDay === null;
          if (aAlive !== bAlive) return aAlive ? -1 : 1;
          return (sb?.streakDays ?? 0) - (sa?.streakDays ?? 0);
        })
      : board;

  // How many places each row has moved since yesterday ended (positive =
  // up) — the same board rebuilt from yesterday's totals, bots included
  // (simulated as of the start of today). Only rows that actually had a
  // place yesterday get an entry, and only while the challenge is live.
  const rankMoves = new Map<string, number>();
  if (yesterdayLeaderboard && (challenge.kind === 'steps' || challenge.kind === 'hunt') && !isChallengeFinished(challenge, board)) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const prevRaw = buildBoard(
      participants,
      yesterdayLeaderboard,
      bots,
      daysElapsedFraction(challenge, startOfToday),
      sortBy,
      challenge,
      headStartLeaderboard,
    );
    const prev = challenge.kind === 'hunt' ? withHuntCatches(prevRaw, sortBy, challenge) : prevRaw;
    const hadPlace = new Set(yesterdayLeaderboard.map((l) => l.userId));
    const prevRank = new Map(prev.map((r, i) => [r.userId, i]));
    board.forEach((r, i) => {
      const before = prevRank.get(r.userId);
      if (before === undefined || before === i || (!r.isBot && !hadPlace.has(r.userId))) return;
      rankMoves.set(r.userId, before - i);
    });
  }

  // Variety Bingo isn't steps/distance-ranked at all (board above is
  // always all-zero for it — see bingoApi.ts) — this is its own
  // leaderboard, ranked by squares filled instead. Bots are naturally
  // excluded: computeBingoCards only ever looks at real participants.
  const bingoCards: Map<string, BingoCard> = challenge.kind === 'bingo' ? computeBingoCards(participants, bingoRows) : new Map();
  const bingoBoardRows = Array.from(bingoCards.values()).sort((a, b) => b.squaresFilled - a.squaresFilled);
  const myBingoCard = user?.id ? bingoCards.get(user.id) : undefined;
  // A hound card's standings instead: BINGOs first, in the order they
  // came in, then fewest squares away.
  const isHound = isHoundCard(challenge);
  const houndBoard: HoundCardState[] = isHound ? houndStandings(bingoCardRows, bingoRows) : [];
  const myHound = houndBoard.find((h) => h.userId === user?.id);
  const personFor = (userId: string) => participants.find((p) => p.userId === userId);
  const houndAwayLine = (h: HoundCardState) =>
    h.blackout
      ? `Blackout · ${h.squaresMarked} squares`
      : h.place
        ? `${h.squaresMarked} squares`
        : `${h.lines.away} away · ${h.squaresMarked} squares`;

  // 75 Day Challenge isn't steps/distance-ranked either (and isn't
  // ranked at all — personal accountability, not head-to-head) — its own
  // checklist and streaks live in their own dedicated cards below rather
  // than the shared Leaderboard.
  const seventyFiveTodayKey = dateKey(new Date());
  const mySeventyFiveToday = seventyFiveCheckins.find((c) => c.userId === user?.id && c.day === seventyFiveTodayKey);
  // Someone west of the creator can open the challenge before their own
  // first day has begun (an Oct 1 challenge created in Eastern time is
  // already running at 11 PM Sep 30 in Central) — nothing to check off
  // until it does.
  const seventyFiveBeforeFirstDay = !!challengeDays && seventyFiveTodayKey < challengeDays.firstDay;
  const seventyFiveAfterLastDay = !!challengeDays && seventyFiveTodayKey > challengeDays.lastDay;
  const seventyFiveTogglesOpen = !seventyFiveBeforeFirstDay && !seventyFiveAfterLastDay;
  const mySeventyFiveStatus = user?.id ? seventyFiveStatuses.get(user.id) : undefined;
  // Sorted by current streak, longest as a tiebreak — a ranking-looking
  // order for what's still meant to read as "how's everyone doing," not
  // a competition; there's no place/medal shown, just each person's own
  // two numbers.
  const seventyFiveBoard = participants
    .map((p) => ({ ...p, status: seventyFiveStatuses.get(p.userId) }))
    .sort((a, b) => {
      const streakDiff = (b.status?.currentStreak ?? 0) - (a.status?.currentStreak ?? 0);
      return streakDiff !== 0 ? streakDiff : (b.status?.longestStreak ?? 0) - (a.status?.longestStreak ?? 0);
    });

  // Where everyone stands, for the trash-talk taunts with numbers in them
  // ("I'm 4,200 steps ahead of Casey"). Tic-Tac-Go has no single number.
  const trashTalkBoard: { standings: Standing[] | null; unit: TauntUnit | null } =
    challenge.kind === 'tictacgo'
      ? { standings: null, unit: null }
      : challenge.kind === 'bingo'
        ? isHound
          ? {
              standings: houndBoard.map((h) => ({ userId: h.userId, name: personFor(h.userId)?.name ?? 'Someone', value: h.squaresMarked })),
              unit: 'squares',
            }
          : { standings: bingoBoardRows.map((r) => ({ userId: r.userId, name: r.name, value: r.squaresFilled })), unit: 'squares' }
        : challenge.kind === 'seventyfive'
          ? {
              standings: seventyFiveBoard.map((r) => ({ userId: r.userId, name: r.name, value: r.status?.currentStreak ?? 0 })),
              unit: 'days',
            }
          : {
              standings: board
                .filter((r) => !r.isBot)
                .map((r) => ({ userId: r.userId, name: r.name, value: scoredByDistance ? r.totalDistanceMi : r.totalSteps })),
              unit: scoredByDistance ? 'mi' : 'steps',
            };

  // Days left in the Hunted's head start, for the leaderboard note below
  // — 0 once it's run out or this hunt never had one.
  const headStartDaysLeft = computeHeadStartDaysLeft(challenge);

  // Once the head start has run out, whatever the Hunter logged during
  // it stops counting toward catching up (see huntEffectiveMetric) —
  // the Hunter's own leaderboard row already shows that credited number
  // now, not their raw total (see board.map below), so this doesn't
  // need to spell out a second, bigger number nobody on this screen can
  // actually see anymore — just why the Hunter's own number might read
  // lower than they'd expect from their real day.
  const hunterRow = board.find((r) => r.role === 'hunter');
  const formatMetric = (value: number) =>
    scoredByDistance ? `${value.toFixed(1)} mi` : `${Math.round(value).toLocaleString()} steps`;
  const hunterEffectiveNote =
    challenge.kind === 'hunt' && !!challenge.headStartDays && headStartDaysLeft === 0 && hunterRow
      ? `Head start credit applied — steps the ${labels.hunter} logged before it ended don't count toward catching up.`
      : null;
  // One progress bar per Hunted/Zombie participant, showing how much of
  // the *gap* the Hunter's effective progress (huntEffectiveMetric, not
  // their raw total — same reasoning as the leaderboard's own sort order
  // above) has actually closed. A Zombie always reads as fully caught
  // (100%), matching withHuntCatches' own catch condition exactly rather
  // than recomputing something that could drift from it.
  const chaseRows =
    challenge.kind === 'hunt' && hunterRow
      ? board
          .filter((r) => r.role === 'hunted' || r.role === 'zombie')
          .map((r) => {
            const theirTotal = scoredByDistance ? r.totalDistanceMi : r.totalSteps;
            const hunterMetric = huntEffectiveMetric(hunterRow, sortBy);
            const pct = r.role === 'zombie' ? 100 : theirTotal > 0 ? Math.min(100, (hunterMetric / theirTotal) * 100) : 0;
            return { row: r, pct, hunterMetric, theirTotal };
          })
      : [];

  // Same org-vs-global partition CreateScreen's own friend picker
  // applies at creation time (see friends/eligibility.ts) — an org
  // challenge only ever gets more of that org's own members invited
  // into it later, and a global one only ever gets people outside
  // whichever org is relevant here. That "relevant org" is the
  // challenge's own for an org challenge (whoever's inviting, it stays
  // that org's challenge), or the inviter's own org for a global one
  // (matching CreateScreen's own "global excludes my org" rule) —
  // falling back to no restriction at all when neither exists, same as
  // someone with no org sees in the wizard.
  const challengeOrgId = challenge?.organizationId ?? null;
  const orgIdForEligibility = challengeOrgId ?? user?.organizationId ?? null;
  const invitableFriends = friends.filter(
    (f) =>
      f.status === 'accepted' &&
      !participants.some((p) => p.userId === f.userId) &&
      (!orgIdForEligibility || friendEligible(f, challengeOrgId ? 'org' : 'global', orgIdForEligibility)),
  );
  // Case-insensitive substring match, applied after the eligibility
  // filter above — this narrows an already-invitable list down further,
  // it never brings back someone who's already in the challenge.
  const searchedFriends = friendSearch.trim()
    ? invitableFriends.filter((f) => f.name.toLowerCase().includes(friendSearch.trim().toLowerCase()))
    : invitableFriends;
  // Same window inviteFriendToChallenge/acceptChallengeInvite enforce
  // server-side (see supabaseChallenges.ts and inviteWindowClosed's own
  // comment) — this is just what keeps the inviter from sending a doomed
  // invite in the first place.
  const inviteLocked = inviteWindowClosed(challenge);

  // A distance pool isn't ranked at all — everyone's steps or miles
  // (whichever unit its creator picked — see CreateScreen.tsx's "Group
  // target" picker) add up toward one shared target, so this reads as
  // the group's combined progress rather than who's ahead of whom. A
  // 'tag' game reuses this exact same field for its own shared target
  // (see 0045_tag_game_state.sql) — unlike a distance pool, reaching it
  // actually ends the game (isChallengeFinished/tagGroupGoalMet in
  // board.ts), not just a cosmetic badge.
  const distanceGoal =
    challenge.kind === 'distance' || challenge.kind === 'tag'
      ? challenge.distanceGoalUnit === 'steps'
        ? challenge.distanceGoalSteps
        : challenge.distanceGoalMi
      : null;
  const groupTotal = board.reduce(
    (sum, r) => sum + (challenge.distanceGoalUnit === 'steps' ? r.totalSteps : r.totalDistanceMi),
    0,
  );
  const goalMet = !!distanceGoal && groupTotal >= distanceGoal;
  const finished = isChallengeFinished(challenge, board);
  // Tic-Tac-Go can end well before its clock does — three in a row, or a
  // full board — so "over" for the wrap-up card below also reads the
  // game's own status.
  const wrappedUp =
    finished || (challenge.kind === 'tictacgo' && (tttGame?.status === 'won' || tttGame?.status === 'draw'));

  // How this challenge went for the viewer, for the wrap-up card's line
  // and the Share message — each kind reads its own outcome (see
  // shareResult.ts). null when there's nothing honest to say (the viewer
  // isn't on the board at all).
  const myOutcome = ((): ResultOutcome | null => {
    const me = user?.id;
    if (!me) return null;
    switch (challenge.kind) {
      case 'steps':
      case 'hunt': {
        const idx = board.findIndex((r) => r.userId === me);
        if (idx < 0) return null;
        const mine = board[idx];
        if (challenge.kind === 'hunt') {
          const hunted = board.filter((r) => r.role === 'hunted' || r.role === 'zombie');
          if (mine.role === 'hunter') {
            return { type: 'hunter', caught: hunted.filter((r) => r.role === 'zombie').length, of: hunted.length };
          }
          return { type: 'hunted', caught: mine.role === 'zombie' };
        }
        const metric = scoredByDistance
          ? `${mine.totalDistanceMi.toFixed(1)} mi`
          : `${mine.totalSteps.toLocaleString()} steps`;
        return { type: 'ranked', rank: idx + 1, of: board.length, metric };
      }
      case 'streak': {
        const st = streakStatuses.get(me);
        if (!st) return null;
        return { type: 'streak', survived: st.eliminatedOnDay === null, days: st.streakDays };
      }
      case 'bingo': {
        if (isHound) {
          const h = houndBoard.find((x) => x.userId === me);
          if (!h) return null;
          return {
            type: 'bingo',
            filled: h.squaresMarked,
            total: h.card.filter((c) => c !== 'free').length,
            blackout: h.blackout,
            place: h.place,
          };
        }
        const card = bingoCards.get(me);
        if (!card) return null;
        return { type: 'bingo', filled: card.squaresFilled, total: BINGO_SQUARE_COUNT, blackout: card.blackout };
      }
      case 'distance':
        return {
          type: 'pool',
          total: challenge.distanceGoalUnit === 'steps' ? `${groupTotal.toLocaleString()} steps` : `${groupTotal.toFixed(1)} mi`,
          goalMet,
        };
      case 'tag':
        return { type: 'tag', goalMet };
      case 'seventyfive':
        return {
          type: 'seventyfive',
          longestStreak: seventyFiveStatuses.get(me)?.longestStreak ?? 0,
          days: challenge.durationDays,
        };
      case 'tictacgo':
        if (!tttGame || (tttGame.status !== 'won' && tttGame.status !== 'draw')) return null;
        return {
          type: 'tictacgo',
          result: tttGame.status === 'draw' ? 'draw' : tttGame.winnerUserId === me ? 'won' : 'lost',
        };
      default:
        return null;
    }
  })();
  const myResultLine = myOutcome ? resultLine(challenge.name, myOutcome, labels) : null;

  // Shares the result as a picture (ShareSheet), with the same line.
  const shareResult = () => {
    if (myResultLine) setSharingResult(true);
  };

  const startRematch = () => {
    if (!user?.id) return;
    onRematch(buildRematchDraft({ challenge, participants, bots, friends, myUserId: user.id }));
  };

  // Game of Tag's own status. tagMinutesLeft floors at 0 rather than
  // going negative once a round's genuinely stalled past its limit —
  // load()'s own settleTagTimeout call already resolves that on the
  // very next load, so this only ever reads low-but-not-negative for
  // the brief window between the clock running out and this screen
  // next refreshing.
  const tagMinutesLeft = tagRound
    ? Math.max(0, Math.ceil(TAG_TIME_LIMIT_MINUTES - (now - new Date(tagRound.roundStartedAt).getTime()) / 60_000))
    : 0;
  // Same green/amber urgency threshold TagRadar's own countdown ring
  // uses (under a fifth of the round left reads as urgent) — kept here
  // too since the card header shows this as plain text, not the ring.
  const tagClockColor = tagMinutesLeft / TAG_TIME_LIMIT_MINUTES > 0.2 ? colors.green : colors.amber;
  const iAmTagIt = !!tagRound && tagRound.itUserId === user?.id;
  // The one person I can't pick — whoever tagged me last (no
  // tag-backs). Doesn't matter at all unless I'm actually IT with
  // nobody picked yet, but harmless to compute either way.
  const myLastTaggedBy = tagMembers.find((m) => m.userId === user?.id)?.lastTaggedBy ?? null;
  // A given userId's own current total, in whichever unit this
  // challenge's own distanceGoalUnit says matters — the same lookup
  // tag_select_target itself does server-side (see 0047's own
  // instant-catch fix), just read from the board already loaded here
  // instead of a fresh RPC call.
  const tagMemberTotal = (userId: string) => {
    const row = board.find((r) => r.userId === userId);
    if (!row) return 0;
    return challenge.distanceGoalUnit === 'steps' ? row.totalSteps : row.totalDistanceMi;
  };
  const myTagMetricValue = user?.id ? tagMemberTotal(user.id) : 0;
  // tag_select_target itself refuses a pick that isn't strictly ahead
  // of It's own current total (0047_tag_fix_instant_catch.sql) — a
  // "target" who's already tied or behind would either be rejected
  // outright, or (worse) close a real gap of zero the instant they're
  // picked. Filtering them out here means a real tap never has to round
  // -trip to that error at all.
  const tagTargetableMembers = tagMembers.filter(
    (m) => m.userId !== user?.id && m.userId !== myLastTaggedBy && tagMemberTotal(m.userId) > myTagMetricValue,
  );
  const tagItMember = tagRound ? tagMembers.find((m) => m.userId === tagRound.itUserId) : undefined;
  const tagTargetMember = tagRound?.targetUserId ? tagMembers.find((m) => m.userId === tagRound.targetUserId) : undefined;
  const tagCatchPct =
    tagRound?.targetSnapshotMetric && tagRound.targetSnapshotMetric > 0
      ? Math.min(100, (myTagMetricValue / tagRound.targetSnapshotMetric) * 100)
      : 0;

  // A finished tag game's recap — no ranking (see 0045_tag_game_state.sql's
  // own "deliberately anti-competitive" note), just each participant's own
  // three counts. Kept in tagMembers' own order rather than sorted by any
  // of these numbers, so this doesn't read as a leaderboard by another name.
  const tagStatsById = computeTagStats(tagEvents);
  const tagRecapRows = tagMembers.map((m) => ({
    userId: m.userId,
    name: m.name,
    initials: m.initials,
    frameId: m.frameId,
    backgroundId: m.backgroundId,
    iconId: m.iconId,
    stats: tagStatsById.get(m.userId) ?? { timesIt: 0, timesTagged: 0, tagsMade: 0 },
  }));

  // It's own current total, for every non-It member's radar distance
  // below — the actual target's ring uses the frozen snapshot instead
  // (the real number tag_check_catch is comparing against), everyone
  // else is just today's live gap, recomputed on every load like the
  // rest of this board.
  const tagItBoardRow = tagRound ? board.find((r) => r.userId === tagRound.itUserId) : undefined;
  const tagItTotal = tagItBoardRow
    ? challenge.distanceGoalUnit === 'steps'
      ? tagItBoardRow.totalSteps
      : tagItBoardRow.totalDistanceMi
    : 0;
  const tagRadarMembers: TagRadarMember[] = tagRound
    ? tagMembers
        .filter((m) => m.userId !== tagRound.itUserId)
        .map((m) => {
          const row = board.find((r) => r.userId === m.userId);
          const theirTotal = row ? (challenge.distanceGoalUnit === 'steps' ? row.totalSteps : row.totalDistanceMi) : 0;
          const isTarget = tagRound.targetUserId === m.userId;
          const distance =
            isTarget && tagRound.targetSnapshotMetric != null
              ? Math.max(0, tagRound.targetSnapshotMetric - tagItTotal)
              : Math.abs(theirTotal - tagItTotal);
          return {
            userId: m.userId,
            initials: m.initials,
            name: m.userId === user?.id ? 'You' : m.name,
            distance,
            isTarget,
            isMe: m.userId === user?.id,
            frameId: m.frameId,
            backgroundId: m.backgroundId,
            iconId: m.iconId,
          };
        })
    : [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
    {sharingResult && myOutcome && myResultLine && (
      <ShareSheet
        content={{ kind: 'challenge', name: challenge.name, outcome: myOutcome, line: myResultLine }}
        onClose={() => setSharingResult(false)}
      />
    )}
    {/* Talk's message box sits at the bottom of the page: on iOS this
        makes room for the keyboard and scrolls whatever field you're
        typing in back above it, instead of leaving it underneath. */}
    <ScrollView
      contentContainerStyle={styles.container}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

      <View style={styles.headerRow}>
        <Pressable
          style={[styles.headerIcon, { backgroundColor: typeDef?.tint ?? TINT_N }]}
          onPress={onGoHome}
          hitSlop={8}
        >
          <Icon size={22} color={typeDef?.iconColor ?? '#e9e9ed'} weight={challenge.kind === 'hunt' ? 'fill' : 'regular'} />
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[text.h2, { fontSize: 24 }]}>{challenge.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag
              label={challenge.kind === 'hunt' ? huntKindName() : (typeDef?.name ?? challenge.kind)}
              variant={challenge.kind === 'hunt' ? 'accent' : 'neutral'}
            />
            <Text style={styles.headerMeta}>
              {dayLabel} · {endsLabel}
            </Text>
          </View>
        </View>
        <Pressable onPress={() => setTab('details')} hitSlop={10} accessibilityLabel="Details">
          <InfoIcon size={22} color={colors.accent} />
        </Pressable>
      </View>

      {sponsor && <SponsorBanner challengeId={challengeId} sponsor={sponsor} />}

      <SegmentedControl
        options={[
          { value: 'board', label: 'Board' },
          { value: 'talk', label: 'Talk' },
          { value: 'details', label: 'Details' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'board' && (
        <>
          {/* First visit to a Tag or Chase: a one-line pointer to the rules in
              Details, instead of a card above the board. */}
          {((showTagExplainer && challenge.kind === 'tag') || (showChaseExplainer && challenge.kind === 'hunt')) && (
            <Pressable
              style={styles.rulesHint}
              onPress={() => {
                if (challenge.kind === 'tag') dismissTagExplainer();
                else dismissChaseExplainer();
                setTab('details');
              }}
            >
              <InfoIcon size={16} color={colors.accent} weight="fill" />
              <Text style={styles.rulesHintText}>
                New to {challenge.kind === 'tag' ? 'Game of Tag' : huntKindName()}? See how it works
              </Text>
              <CaretRightIcon size={14} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          )}

          {wrappedUp && (
            <Card style={styles.wrapCard} elevated={false}>
              <Text style={text.h4}>That&rsquo;s a wrap</Text>
              {myResultLine && <Text style={styles.wrapLine}>{myResultLine}</Text>}
              <View style={styles.wrapActions}>
                <Button
                  label="Rematch"
                  variant="primary"
                  small
                  icon={<ArrowsClockwiseIcon size={14} color={colors.accent} />}
                  onPress={startRematch}
                />
                {myResultLine && (
                  <Button
                    label="Share result"
                    small
                    icon={<ShareNetworkIcon size={14} color={colors.text} />}
                    onPress={shareResult}
                  />
                )}
              </View>
            </Card>
          )}

          <ChallengePotCard
            challengeId={challengeId}
            isGlobal={isGlobal}
            names={new Map(participants.map((p) => [p.userId, p.name]))}
            myUserId={user?.id ?? null}
            currencyName={currencyName}
          />

          {distanceGoal && (
            <Card style={[{ gap: 10 }, goalMet ? styles.goalMetCard : {}]} elevated={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={text.h4}>Group progress</Text>
                {goalMet && (
                  <View style={styles.goalMetBadge}>
                    <CheckCircleIcon size={14} color={colors.green} weight="fill" />
                    <Text style={styles.goalMetLabel}>Goal reached</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={styles.groupTotal}>
                  {challenge.distanceGoalUnit === 'steps' ? groupTotal.toLocaleString() : groupTotal.toFixed(1) + ' mi'}
                </Text>
                <Text style={styles.footNote}>
                  of {challenge.distanceGoalUnit === 'steps' ? distanceGoal.toLocaleString() : `${distanceGoal} mi`} goal
                </Text>
              </View>
              <ProgressBar
                pct={Math.min(100, (groupTotal / distanceGoal) * 100)}
                fillColor={goalMet ? colors.green : colors.accent}
                height={6}
              />
              <Text style={styles.footNote}>
                {goalMet
                  ? challenge.kind === 'tag'
                    ? 'The group hit its target. This game is over.'
                    : 'The group hit its target.'
                  : 'Everyone’s total counts toward this goal.'}
              </Text>
            </Card>
          )}

          {challenge.kind === 'tag' && finished && (
            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Tag recap</Text>
              <Text style={styles.footNote}>
                Game of Tag isn&rsquo;t ranked. Here&rsquo;s how it went.
              </Text>
              {tagRecapRows.map((r) => (
                <View key={r.userId} style={[styles.inviteFriendRow, { alignItems: 'flex-start' }]}>
                  <Avatar
                    initials={r.initials}
                    tint={TINT_N}
                    size={30}
                    fontSize={11}
                    frameId={r.frameId}
                    backgroundId={r.backgroundId}
                    iconId={r.iconId}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.friendName}>{r.name}</Text>
                    <Text style={styles.footNote}>
                      <Text style={styles.tagRecapLabel}>IT</Text> {r.stats.timesIt}× ·{' '}
                      <Text style={styles.tagRecapLabel}>Tagged</Text> {r.stats.timesTagged}× ·{' '}
                      <Text style={styles.tagRecapLabel}>Caught</Text> {r.stats.tagsMade}×
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}

          {challenge.kind === 'tag' && tagRound && !finished && (
            <Card style={{ gap: 12 }} elevated={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={text.h4}>Tag status</Text>
                <Text style={[styles.footNote, { color: tagClockColor, fontFamily: font.heading }]}>
                  {tagMinutesLeft > 0 ? `${tagMinutesLeft}m left` : 'time’s up'}
                </Text>
              </View>
              <TagRadar
                itInitials={tagItMember?.initials ?? '?'}
                itName={tagItMember?.name ?? 'Someone'}
                itFrameId={tagItMember?.frameId}
                itBackgroundId={tagItMember?.backgroundId}
                itIconId={tagItMember?.iconId}
                isMeIt={iAmTagIt}
                members={tagRadarMembers}
                colors={colors}
                formatDistance={formatMetric}
                minutesLeft={tagMinutesLeft}
                timeLimitMinutes={TAG_TIME_LIMIT_MINUTES}
              />
              {iAmTagIt && !tagRound.targetUserId ? (
                <>
                  <Text style={styles.footNote}>
                    You&rsquo;re It — pick who to tag. {tagMinutesLeft > 0 ? `${tagMinutesLeft} min left to pick and catch them.` : 'Time’s almost up.'}
                  </Text>
                  {tagActionError && <Text style={styles.loadError}>{tagActionError}</Text>}
                  {tagTargetableMembers.length === 0 ? (
                    <Text style={styles.footNote}>
                      {tagMembers.length <= 1
                        ? 'Nobody eligible to tag yet — wait for more people to join.'
                        : tagMinutesLeft > 0
                          ? `Nobody’s ahead of you yet — you can only tag someone who’s logged more than you have. If nobody catches up, It passes to someone else automatically in ${tagMinutesLeft} min.`
                          : 'Nobody’s ahead of you yet — It is about to pass to someone else automatically.'}
                    </Text>
                  ) : (
                    tagTargetableMembers.map((m) => (
                      <View key={m.userId} style={styles.inviteFriendRow}>
                        <Avatar
                          initials={m.initials}
                          tint={TINT_N}
                          size={30}
                          fontSize={11}
                          frameId={m.frameId}
                          backgroundId={m.backgroundId}
                          iconId={m.iconId}
                        />
                        <Text style={[styles.friendName, { flex: 1 }]}>{m.name}</Text>
                        <Button
                          label={selectingTargetId === m.userId ? 'Picking…' : 'Tag'}
                          small
                          disabled={selectingTargetId !== null}
                          onPress={() => pickTagTarget(m.userId)}
                        />
                      </View>
                    ))
                  )}
                </>
              ) : iAmTagIt && tagRound.targetUserId ? (
                <>
                  <Text style={styles.footNote}>
                    Chasing {tagTargetMember?.name ?? 'someone'} —{' '}
                    {tagMinutesLeft > 0 ? `${tagMinutesLeft} min left to catch them.` : 'time’s almost up.'}
                  </Text>
                  <ProgressBar pct={tagCatchPct} fillColor={colors.accent} height={6} />
                  <Text style={styles.footNote}>
                    {formatMetric(myTagMetricValue)} of {formatMetric(tagRound.targetSnapshotMetric ?? 0)} needed to catch them.
                  </Text>
                </>
              ) : (
                <Text style={styles.footNote}>
                  {tagItMember?.name ?? 'Someone'} is It
                  {tagRound.targetUserId
                    ? `, chasing ${tagTargetMember?.userId === user?.id ? 'you' : tagTargetMember?.name ?? 'someone'}.`
                    : ' and hasn’t picked a target yet.'}
                </Text>
              )}
            </Card>
          )}

          {challenge.kind === 'tictacgo' && (
            <TicTacGoCard
              game={tttGame}
              participants={participants}
              userId={user?.id}
              health={health}
              now={now}
              onChanged={load}
            />
          )}

          {isHound && myHound && (
            <HoundBingoCard
              me={myHound}
              entries={new Map(bingoRows.filter((r) => r.userId === user?.id).map((r) => [r.category, r]))}
              selected={linkingCategory as HoundSquare | null}
              onSelect={setLinkingCategory}
              workouts={loadingTodaysWorkouts ? null : todaysWorkouts}
              usedBy={
                new Map(
                  bingoRows
                    .filter((r) => r.userId === user?.id && r.workoutKey)
                    .map((r) => [r.workoutKey as string, r.category]),
                )
              }
              linkingId={linkingWorkoutId}
              removing={removingLink}
              error={linkError}
              onLink={linkWorkout}
              onUnlink={removeLink}
              formatWhen={formatWorkoutDayTime}
            />
          )}

          {challenge.kind === 'bingo' && !isHound && (
            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Your {BINGO_CARD_TYPE_NAME[bingoCardType]} card</Text>
              <Text style={styles.footNote}>
                Fills itself from a matching workout, or tap a square to link one yourself — handy for a workout the
                app can&rsquo;t guess a category for on its own.
              </Text>
              <View style={styles.bingoGrid}>
                {bingoCategories.map((category) => {
                  const filled = myBingoCard?.filled.has(category) ?? false;
                  return (
                    <Pressable
                      key={category}
                      onPress={() => setLinkingCategory(category)}
                      style={[styles.bingoSquare, filled && styles.bingoSquareFilled]}
                    >
                      {filled && <CheckCircleIcon size={16} color={colors.green} weight="fill" />}
                      <Text style={[styles.bingoSquareLabel, filled && styles.bingoSquareLabelFilled]}>
                        {BINGO_CATEGORY_LABEL[category]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.footNote}>
                {myBingoCard?.blackout
                  ? 'Blackout! You’ve filled every square.'
                  : `${myBingoCard?.squaresFilled ?? 0} of ${BINGO_SQUARE_COUNT} squares filled.`}
              </Text>

              {linkingCategory && (
                <View style={styles.bingoLinkPanel}>
                  <View style={styles.bingoLinkHeader}>
                    <Text style={styles.bingoLinkTitle}>Link a workout to {squareLabel(linkingCategory)}</Text>
                    <Pressable onPress={() => setLinkingCategory(null)} hitSlop={8}>
                      <XIcon size={16} color={withAlpha(colors.text, 0.5)} />
                    </Pressable>
                  </View>
                  {myBingoCard?.entries.get(linkingCategory)?.workoutName && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={styles.footNote}>
                        Currently linked to {myBingoCard.entries.get(linkingCategory)?.workoutName}.
                      </Text>
                      {myBingoCard.entries.get(linkingCategory)?.source === 'manual' && (
                        <Pressable onPress={() => removeLink(linkingCategory)} disabled={removingLink} hitSlop={4}>
                          <Text style={[styles.footNote, { color: colors.amber, fontFamily: font.heading }]}>
                            {removingLink ? 'Removing…' : 'Remove link'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                  {linkError && <Text style={styles.loadError}>{linkError}</Text>}
                  {loadingTodaysWorkouts ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : todaysWorkouts.length === 0 ? (
                    <Text style={styles.footNote}>No workouts logged today yet — log one on your device, then come back.</Text>
                  ) : (
                    todaysWorkouts.map((w) => (
                      <Pressable
                        key={w.id}
                        onPress={() => linkWorkout(linkingCategory, w)}
                        disabled={linkingWorkoutId !== null}
                        style={styles.bingoWorkoutRow}
                      >
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={styles.boardName}>{w.name}</Text>
                          <Text style={styles.footNote}>
                            {formatWorkoutTime(w.when)}
                            {w.distanceMi ? ` · ${w.distanceMi.toFixed(1)} mi` : ''}
                          </Text>
                        </View>
                        {linkingWorkoutId === w.id ? (
                          <ActivityIndicator color={colors.accent} />
                        ) : (
                          <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
                        )}
                      </Pressable>
                    ))
                  )}
                </View>
              )}
            </Card>
          )}

          {challenge.kind === 'seventyfive' && (
            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Today&rsquo;s checklist</Text>
              <View style={{ gap: 2 }}>
                <SeventyFiveRow
                  label="Workout 1"
                  done={mySeventyFiveToday?.workout1Done ?? false}
                  readOnly
                  styles={styles}
                  colors={colors}
                />
                <SeventyFiveRow
                  label="Workout 2 (outdoors)"
                  done={mySeventyFiveToday?.workout2OutdoorDone ?? false}
                  readOnly
                  styles={styles}
                  colors={colors}
                />
                <SeventyFiveRow
                  label="Followed your diet"
                  done={mySeventyFiveToday?.dietDone ?? false}
                  busy={seventyFiveSaving === 'diet'}
                  onToggle={seventyFiveTogglesOpen ? (next) => toggleSeventyFiveItem('diet', next) : undefined}
                  styles={styles}
                  colors={colors}
                />
                <SeventyFiveRow
                  label="Drank a gallon of water"
                  done={mySeventyFiveToday?.waterDone ?? false}
                  busy={seventyFiveSaving === 'water'}
                  onToggle={seventyFiveTogglesOpen ? (next) => toggleSeventyFiveItem('water', next) : undefined}
                  styles={styles}
                  colors={colors}
                />
                <SeventyFiveRow
                  label="Read 10 pages"
                  done={mySeventyFiveToday?.readingDone ?? false}
                  busy={seventyFiveSaving === 'reading'}
                  onToggle={seventyFiveTogglesOpen ? (next) => toggleSeventyFiveItem('reading', next) : undefined}
                  styles={styles}
                  colors={colors}
                />
                <SeventyFiveRow
                  label="Progress photo"
                  done={mySeventyFiveToday?.photoDone ?? false}
                  busy={seventyFiveSaving === 'photo'}
                  onToggle={seventyFiveTogglesOpen ? (next) => toggleSeventyFiveItem('photo', next) : undefined}
                  styles={styles}
                  colors={colors}
                />
              </View>
              <Text style={styles.footNote}>
                {seventyFiveBeforeFirstDay && challengeDays
                  ? `Your day 1 is ${formatDayKey(challengeDays.firstDay)} — the checklist opens at midnight your time.`
                  : seventyFiveAfterLastDay
                    ? 'The last day has ended.'
                    : mySeventyFiveToday && isSeventyFiveDayComplete(mySeventyFiveToday)
                      ? 'All done for today!'
                      : 'The two workouts fill in on their own once logged on your device.'}
              </Text>
              <View style={styles.leaderboardHeader}>
                <Text style={styles.footNote}>
                  Current streak: {mySeventyFiveStatus?.currentStreak ?? 0} day
                  {mySeventyFiveStatus?.currentStreak === 1 ? '' : 's'} · Longest:{' '}
                  {mySeventyFiveStatus?.longestStreak ?? 0} day{mySeventyFiveStatus?.longestStreak === 1 ? '' : 's'}
                </Text>
              </View>
            </Card>
          )}

          {challenge.kind === 'seventyfive' && (
            <Card style={{ gap: 10 }} elevated={false}>
              <View style={styles.leaderboardHeader}>
                <TrophyIcon size={16} color={colors.accent} />
                <Text style={text.h4}>Everyone&rsquo;s streak</Text>
              </View>
              {seventyFiveBoard.some((r) => canInteractWith(r.userId)) && (
                <Text style={styles.footNote}>Tap someone to cheer them on or nudge them.</Text>
              )}
              {seventyFiveBoard.map((row) => (
                <Pressable
                  key={row.userId}
                  style={styles.boardItem}
                  onPress={() => togglePerson(row.userId)}
                  disabled={!canInteractWith(row.userId)}
                >
                  <View style={styles.boardRowInner}>
                  <Avatar
                    initials={row.initials}
                    tint={row.userId === user?.id ? TINT_A : TINT_N}
                    size={30}
                    fontSize={11}
                    frameId={row.frameId}
                    backgroundId={row.backgroundId}
                    iconId={row.iconId}
                    level={row.level}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.boardName}>{row.userId === user?.id ? 'You' : row.name}</Text>
                  </View>
                  {renderFriendChip(row.userId)}
                  <Tag
                    label={`${row.status?.currentStreak ?? 0}-day streak`}
                    variant={(row.status?.currentStreak ?? 0) > 0 ? 'accent' : 'outline'}
                  />
                  </View>
                  {renderPersonActions(row.userId, row.name, false, 30 + 12)}
                </Pressable>
              ))}
            </Card>
          )}

          {challenge.kind !== 'tictacgo' && challenge.kind !== 'seventyfive' && (
            <Card style={{ gap: 12 }} elevated={false}>
              <View style={styles.leaderboardHeader}>
                <TrophyIcon size={16} color={colors.accent} />
                <Text style={text.h4}>Leaderboard</Text>
              </View>
              {!finished && board.some((r) => canInteractWith(r.userId, r.isBot)) && (
                <Text style={styles.footNote}>Tap someone to cheer them on or nudge them.</Text>
              )}
              {/* A finished-challenge acknowledgment — Tag gets its own recap
                  card above instead (never "won" — see that card's own
                  comment), and this Leaderboard already looks the same live
                  or finished otherwise, with nothing marking that it's over. */}
              {finished && challenge.kind !== 'tag' && (
                <Text style={styles.footNote}>
                  {challenge.kind === 'hunt'
                    ? isHuntConcluded(board)
                      ? 'The chase is over — nobody’s left to catch.'
                      : 'The chase’s clock ran out.'
                    : challenge.kind === 'distance'
                      ? goalMet
                        ? 'The group hit its target — this pool is complete.'
                        : 'This pool has wrapped up without reaching its target.'
                      : challenge.kind === 'streak'
                        ? (() => {
                            const survivors = board.filter((r) => streakStatuses.get(r.userId)?.eliminatedOnDay == null);
                            if (survivors.length === 0) return 'Everyone’s streak ended before this one wrapped up.';
                            if (survivors.length === 1) {
                              const only = survivors[0];
                              return `${only.userId === user?.id ? 'You' : only.name} won — the last one still on their streak!`;
                            }
                            return `${survivors.length} people made it the whole way without missing a day.`;
                          })()
                        : isHound
                          ? (() => {
                              const top = houndBoard[0];
                              const label = top?.userId === user?.id ? 'You' : (personFor(top?.userId ?? '')?.name ?? 'Someone');
                              if (!top || top.squaresMarked === 0) return 'Nobody marked a square before time ran out.';
                              return top.place
                                ? `${label} got the first BINGO!`
                                : `No BINGO this time. ${label} got closest, ${top.lines.away} away.`;
                            })()
                        : challenge.kind === 'bingo'
                          ? (() => {
                              const top = bingoBoardRows[0];
                              if (!top || top.squaresFilled === 0) return 'Nobody filled a square before time ran out.';
                              const label = top.userId === user?.id ? 'You' : top.name;
                              return top.blackout
                                ? `${label} filled the whole card — blackout!`
                                : `${label} led with ${top.squaresFilled} of ${BINGO_SQUARE_COUNT} squares.`;
                            })()
                          : `${board[0]?.userId === user?.id ? 'You' : board[0]?.name ?? 'Someone'} won with ${formatMetric(
                              scoredByDistance ? board[0]?.totalDistanceMi ?? 0 : board[0]?.totalSteps ?? 0,
                            )}.`}
                </Text>
              )}
              {headStartDaysLeft > 0 && (
                <Text style={styles.footNote}>
                  Head start: the {labels.hunter}&rsquo;s total won&rsquo;t count toward a catch for{' '}
                  {headStartDaysLeft} more {headStartDaysLeft === 1 ? 'day' : 'days'}.
                </Text>
              )}
              {hunterEffectiveNote && <Text style={styles.footNote}>{hunterEffectiveNote}</Text>}
              {isHound
                ? houndBoard.map((h, i) => {
                    const person = personFor(h.userId);
                    return (
                      <Pressable
                        key={h.userId}
                        style={styles.boardItem}
                        onPress={() => togglePerson(h.userId)}
                        disabled={!canInteractWith(h.userId)}
                      >
                        <View style={styles.boardRowInner}>
                          <Text style={styles.boardRank}>{h.place ?? i + 1}</Text>
                          <Avatar
                            initials={person?.initials ?? '?'}
                            tint={h.userId === user?.id ? TINT_A : TINT_N}
                            size={30}
                            fontSize={11}
                            frameId={person?.frameId ?? null}
                            backgroundId={person?.backgroundId ?? null}
                            iconId={person?.iconId ?? null}
                          />
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <Text style={styles.boardName}>{h.userId === user?.id ? 'You' : (person?.name ?? 'Someone')}</Text>
                            {h.place !== null && <Tag label={h.place <= 3 ? `${ordinal(h.place)} BINGO` : 'BINGO'} variant="accent" />}
                            {renderFriendChip(h.userId)}
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={styles.footNote}>{houndAwayLine(h)}</Text>
                          </View>
                        </View>
                        {renderPersonActions(h.userId, person?.name ?? 'Someone', false, 16 + 12 + 30 + 12)}
                      </Pressable>
                    );
                  })
                : challenge.kind === 'bingo'
                ? bingoBoardRows.map((card, i) => (
                    <Pressable
                      key={card.userId}
                      style={styles.boardItem}
                      onPress={() => togglePerson(card.userId)}
                      disabled={!canInteractWith(card.userId)}
                    >
                      <View style={styles.boardRowInner}>
                      <Text style={styles.boardRank}>{i + 1}</Text>
                      <Avatar
                        initials={card.initials}
                        tint={card.userId === user?.id ? TINT_A : TINT_N}
                        size={30}
                        fontSize={11}
                        frameId={card.frameId}
                        backgroundId={card.backgroundId}
                        iconId={card.iconId}
                      />
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <Text style={styles.boardName}>{card.userId === user?.id ? 'You' : card.name}</Text>
                        {card.blackout && <Tag label="Blackout" variant="accent" />}
                        {renderFriendChip(card.userId)}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.boardSteps}>
                          {card.squaresFilled} of {BINGO_SQUARE_COUNT}
                        </Text>
                      </View>
                      </View>
                      {renderPersonActions(card.userId, card.name, false, 16 + 12 + 30 + 12)}
                    </Pressable>
                  ))
                : streakBoard.map((row, i) => {
                    // The Hunter's row shows their credited progress
                    // (huntEffectiveMetric), not their raw total — showing
                    // 50,610 here while the Chase progress card below says
                    // only 34,895 of it counts is confusing on its own
                    // screen: two different numbers for the same person,
                    // only one of which means anything toward a catch.
                    // huntEffectiveMetric already no-ops for every
                    // non-Hunter role, so this is exactly the raw total for
                    // everyone else on the board.
                    const displaySteps = challenge.kind === 'hunt' ? huntEffectiveMetric(row, 'steps') : row.totalSteps;
                    const displayMi = challenge.kind === 'hunt' ? huntEffectiveMetric(row, 'distance') : row.totalDistanceMi;
                    const streakStatus = challenge.kind === 'streak' ? streakStatuses.get(row.userId) : undefined;
                    const move = rankMoves.get(row.userId);
                    return (
                      <Pressable
                        key={row.userId}
                        style={styles.boardItem}
                        onPress={() => togglePerson(row.userId)}
                        disabled={!canInteractWith(row.userId, row.isBot)}
                      >
                        <View style={styles.boardRowInner}>
                        <View style={styles.rankCol}>
                          <Text style={styles.boardRank}>{i + 1}</Text>
                          {move !== undefined && (
                            <Text
                              style={[styles.rankMove, { color: move > 0 ? colors.green : colors.amber }]}
                              accessibilityLabel={`${move > 0 ? 'Up' : 'Down'} ${Math.abs(move)} since yesterday`}
                            >
                              {move > 0 ? '▲' : '▼'}
                              {Math.abs(move)}
                            </Text>
                          )}
                        </View>
                        <Avatar
                          initials={row.initials}
                          tint={row.userId === user?.id ? TINT_A : TINT_N}
                          size={30}
                          fontSize={11}
                          frameId={row.frameId}
                          backgroundId={row.backgroundId}
                          iconId={row.iconId}
                          level={row.level}
                        />
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                          <Text style={styles.boardName}>{row.name}</Text>
                          {row.isBot && <RobotIcon size={13} color={withAlpha(colors.text, 0.55)} />}
                          {row.role && <Tag label={huntRoleLabel(row.role, labels)} variant={HUNT_ROLE_TAG_VARIANT[row.role]} />}
                          {streakStatus && (
                            <Tag
                              label={streakStatus.eliminatedOnDay == null ? `${streakStatus.streakDays}‑day streak` : 'Out'}
                              variant={streakStatus.eliminatedOnDay == null ? 'accent' : 'outline'}
                            />
                          )}
                          {renderFriendChip(row.userId, row.isBot)}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          {scoredByDistance ? (
                            <Text style={styles.boardSteps}>{displayMi.toFixed(1)} mi</Text>
                          ) : (
                            <>
                              <Text style={styles.boardSteps}>{displaySteps.toLocaleString()} steps</Text>
                              {displayMi > 0 && <Text style={styles.boardDistance}>{displayMi.toFixed(1)} mi</Text>}
                            </>
                          )}
                        </View>
                        </View>
                        {renderPersonActions(row.userId, row.name, row.isBot, 22 + 12 + 30 + 12)}
                      </Pressable>
                    );
                  })}
              {board.length === 0 && <Text style={styles.footNote}>No participants found.</Text>}
            </Card>
          )}

          {chaseRows.length > 0 && (
            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Chase progress</Text>
              <Text style={styles.footNote}>
                How much of each gap the {labels.hunter} has closed since the head start ended.
              </Text>
              {chaseRows.map(({ row, pct, hunterMetric, theirTotal }) => (
                <View key={row.userId} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={styles.friendName}>{row.name}</Text>
                    <Text style={styles.footNote}>
                      {row.role === 'zombie' ? 'Caught' : `${formatMetric(hunterMetric)} of ${formatMetric(theirTotal)}`}
                    </Text>
                  </View>
                  <ProgressBar
                    pct={pct}
                    fillColor={row.role === 'zombie' ? colors.amber : colors.accent}
                    height={6}
                  />
                </View>
              ))}
            </Card>
          )}

          {/* A device-synced challenge (usesDeviceSteps/usesWorkoutDistance)
              gets no card here at all — syncFromDevice already runs
              automatically in the background (see the auto-sync effect
              above) once Health Connect/HealthKit is connected, so there's
              nothing for this screen to show or for the person to trigger
              manually. Neither does Bingo: it's scored purely by filled
              squares (bingo_progress, see src/challenges/bingoApi.ts), so
              steps logged here would never show up anywhere for it. */}
          {!usesDeviceSteps(challenge) &&
            !usesWorkoutDistance(challenge) &&
            challenge.kind !== 'tictacgo' &&
            challenge.kind !== 'bingo' &&
            challenge.kind !== 'seventyfive' && (
            <Card style={{ gap: 14 }} elevated={false}>
              <Text style={text.h4}>Log your progress</Text>
              <Text style={styles.footNote}>
                This challenge doesn&rsquo;t sync from your phone yet, so enter today&rsquo;s totals here.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextField
                  label="Steps today"
                  value={stepsInput}
                  onChangeText={setStepsInput}
                  placeholder="8,432"
                  keyboardType="number-pad"
                  style={{ flex: 1 }}
                />
                <TextField
                  label="Distance (mi)"
                  value={distanceInput}
                  onChangeText={setDistanceInput}
                  placeholder="optional"
                  keyboardType="decimal-pad"
                  style={{ flex: 1 }}
                />
              </View>
              {logError && <Text style={styles.loadError}>{logError}</Text>}
              {logSuccess && !logError && <Text style={styles.successNote}>Saved.</Text>}
              <Button
                label={logging ? 'Saving…' : 'Save'}
                variant="primary"
                block
                disabled={logging || !stepsInput.trim()}
                onPress={logProgress}
              />
            </Card>
          )}
        </>
      )}

      {tab === 'talk' && (
        <TrashTalkCard
          challengeId={challenge.id}
          myId={user?.id}
          standings={trashTalkBoard.standings}
          unit={trashTalkBoard.unit}
          participantIds={participants.map((p) => p.userId)}
        />
      )}

      {tab === 'details' && (
        <>
          <Card style={{ gap: 10 }} elevated={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <InfoIcon size={18} color={colors.accent} weight="fill" />
              <Text style={text.h4}>
                How {challenge.kind === 'hunt' ? huntKindName() : (typeDef?.name ?? 'this challenge')} works
              </Text>
            </View>
            {challenge.kind === 'tag' ? (
              <>
                <Text style={styles.footNote}>
                  One player is "IT". IT picks a target who's currently ahead of them, and catches
                  them by reaching that target's total. Whoever gets caught becomes the new IT — no
                  tagging back the person who just tagged you.
                </Text>
                <Text style={styles.footNote}>
                  IT has {TAG_TIME_LIMIT_MINUTES} minutes to pick and catch a target, or IT passes to
                  someone else at random. There's no overall ranking or winner — the game ends once
                  the whole group's combined total hits the shared goal.
                </Text>
              </>
            ) : challenge.kind === 'hunt' ? (
              <>
                <Text style={styles.footNote}>
                  One {labels.hunter} chases one or more {labels.hunted}. If the {labels.hunted} got
                  a head start, the {labels.hunter}&rsquo;s own progress during it doesn&rsquo;t
                  count — it starts from zero once the head start ends.
                </Text>
                <Text style={styles.footNote}>
                  A {labels.hunted} is caught once the {labels.hunter}&rsquo;s progress reaches their
                  total, becoming &ldquo;{labels.zombie}&rdquo;. The chase ends once everyone&rsquo;s
                  been caught, or the clock runs out — whichever comes first.
                </Text>
              </>
            ) : (
              <Text style={styles.footNote}>{typeDef?.desc}</Text>
            )}
          </Card>

          <Card style={{ gap: 8 }} elevated={false}>
            <Text style={text.h4}>Dates</Text>
            <Text style={styles.detailsLine}>
              {formatShortDate(challenge.startsAt)} – {formatShortDate(challenge.endsAt)} · {challenge.durationDays}{' '}
              {challenge.durationDays === 1 ? 'day' : 'days'}
            </Text>
            <Text style={styles.footNote}>{dayLabel} · {endsLabel}</Text>
            {/* Time-based challenges settle 24 hours after they end (0095), so
                late syncs still count. Game-event kinds settle when the game ends. */}
            {challenge.kind !== 'hunt' && challenge.kind !== 'tag' && challenge.kind !== 'tictacgo' && (
              <Text style={styles.footNote}>Results are final 24 hours after the end, so late syncs still count.</Text>
            )}
          </Card>

          <ToggleRow
            label="Pin to Today"
            note="Feature this challenge on Today"
            value={myHighlighted}
            onChange={togglingHighlight ? () => {} : toggleHighlight}
          />

          {/* Tic-Tac-Go is strictly 1v1 (CreateScreen's own toggleFriend already
              enforces this at creation) — participants.length >= 2 alone only
              closes this once someone has actually accepted, leaving a window
              where a second, then a third, invite could go out while the first
              is still pending and unanswered. invitedIds.size > 0 closes it the
              moment even one invite is outstanding, so at most one ever exists
              at a time; it reopens on its own once that invite is declined or
              expires (see load()'s own invitedIds refresh, sourced from
              listSentChallengeInvites — a no-longer-pending invite just drops
              out of that list). */}
          {!wrappedUp && isGlobal && (
            <Card style={{ gap: 6 }} elevated={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <GlobeHemisphereWestIcon size={17} color={colors.accent} />
                <Text style={text.h4}>Global Hound Challenge</Text>
              </View>
              <Text style={styles.footNote}>
                Open to everyone on Hound — friends can join it from Global Hound Challenges on their Today screen
                until joining closes.
              </Text>
            </Card>
          )}

          {!wrappedUp && !isGlobal && !(challenge.kind === 'tictacgo' && (participants.length >= 2 || invitedIds.size > 0)) && (
            <Card style={{ gap: 10 }} elevated={false}>
              <Text style={text.h4}>{challenge.kind === 'tictacgo' ? 'Invite your opponent' : 'Invite a friend'}</Text>
              {inviteLocked ? (
                <Text style={styles.footNote}>
                  {challenge.kind === 'hunt' && challenge.headStartDays
                    ? `This chase’s head start has already ended — a newly invited friend would join with no head start of their own, so new invites are closed for the rest of this chase.`
                    : `It’s been more than 24 hours since this challenge started, so new invites are closed — joining this late would give someone an unfair read on where everyone else already stands.`}
                </Text>
              ) : invitableFriends.length === 0 ? (
                <Text style={styles.footNote}>
                  {friends.length === 0
                    ? 'Add friends from the Friends tab, then invite them here.'
                    : 'Everyone you’re friends with is already in this challenge.'}
                </Text>
              ) : (
                <>
                  <TextField
                    label="Search friends"
                    value={friendSearch}
                    onChangeText={setFriendSearch}
                    placeholder="Search by name"
                    icon={<MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />}
                    autoCapitalize="none"
                  />
                  {searchedFriends.length === 0 ? (
                    <Text style={styles.footNote}>No friends match “{friendSearch.trim()}”.</Text>
                  ) : (
                    searchedFriends.map((f) => {
                      const invited = invitedIds.has(f.userId);
                      const busy = invitingId === f.userId;
                      return (
                        <View key={f.userId} style={styles.inviteFriendRow}>
                          <Avatar
                            initials={f.initials}
                            tint={TINT_N}
                            size={30}
                            fontSize={11}
                            frameId={f.frameId}
                            backgroundId={f.backgroundId}
                            iconId={f.iconId}
                          />
                          <Text style={[styles.friendName, { flex: 1 }]}>{f.name}</Text>
                          <Button
                            label={busy ? (invited ? 'Reminding…' : 'Inviting…') : invited ? 'Remind' : 'Invite'}
                            variant={invited ? 'ghost' : 'secondary'}
                            small
                            disabled={busy}
                            onPress={() => (invited ? remindFriend(f) : inviteFriend(f))}
                          />
                        </View>
                      );
                    })
                  )}
                </>
              )}
            </Card>
          )}

          {challenge.createdBy === user?.id && (
            <Pressable onPress={confirmDelete} disabled={deleting} style={styles.deleteRow}>
              <TrashIcon size={14} color={colors.amber} />
              <Text style={styles.deleteLabel}>{deleting ? 'Deleting…' : 'Delete challenge'}</Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

// "ends Sep 19" reads fine when that's tomorrow, but is genuinely
// ambiguous the day a challenge ends *today* — nothing about a bare
// date says whether there are 30 minutes or 20 hours left. Once a
// challenge is inside its last 24 hours, this switches to a live
// countdown instead ("Ends in 3h 12m"), ticking down via the caller's
// own `now` (see the component's 30s-interval effect) rather than
// freezing at whatever value it had on the last full reload.
function formatEndsLabel(endsAt: string, now: number): string {
  const msLeft = new Date(endsAt).getTime() - now;
  if (msLeft > 24 * 3_600_000) {
    return `ends ${new Date(endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  if (msLeft <= 0) return 'ended';
  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  return hours > 0 ? `ends in ${hours}h ${minutes}m` : `ends in ${Math.max(1, minutes)}m`;
}

// Local-calendar day key, same convention as deviceSync.ts's own —
// "today's workouts" for linking has to agree with what someone's phone
// itself calls today, not a UTC day that can be off by one near midnight.
// "Oct 1", for the Details tab's date range.
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' → "Thu, Oct 1"
function formatDayKey(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatWorkoutTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// "Mon 6:15 PM", for a workout from any day of the challenge.
function formatWorkoutDayTime(d: Date): string {
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${formatWorkoutTime(d)}`;
}

// One row of the "Today's checklist" card — a plain checkbox for the 4
// self-report items, or a read-only indicator (no onPress at all) for
// the 2 device-tracked ones, which only ever change via
// syncSeventyFiveFromDevice, never a tap.
function SeventyFiveRow({
  label,
  done,
  readOnly,
  busy,
  onToggle,
  styles,
  colors,
}: {
  label: string;
  done: boolean;
  readOnly?: boolean;
  busy?: boolean;
  onToggle?: (next: boolean) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
}) {
  const content = (
    <View style={styles.seventyFiveRow}>
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <View style={[styles.seventyFiveCheckbox, done && styles.seventyFiveCheckboxOn]}>
          {done && <CheckCircleIcon size={13} color="#fff" weight="fill" />}
        </View>
      )}
      <Text style={styles.seventyFiveLabel}>{label}</Text>
      {readOnly && <Text style={styles.footNote}>Auto</Text>}
    </View>
  );
  if (readOnly || !onToggle) return content;
  return (
    <Pressable disabled={busy} onPress={() => onToggle(!done)}>
      {content}
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
    headerIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    headerMeta: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    detailsLine: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    rulesHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
    rulesHintText: { flex: 1, fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    leaderboardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // Same accent-wash spotlight as Home's hunt card — the first thing a
    // finished challenge shows is what to do next.
    wrapCard: {
      gap: 10,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    wrapLine: { fontSize: 14.5, lineHeight: 21, color: colors.text },
    wrapActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    groupTotal: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    goalMetCard: {
      borderWidth: 1,
      borderColor: withAlpha(colors.green, 0.5),
      backgroundColor: withAlpha(colors.green, 0.1),
    },
    goalMetBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    goalMetLabel: { fontSize: 12, fontFamily: font.heading, color: colors.green },
    // A leaderboard entry: the row itself, plus reactions and the
    // react/nudge bar under it (PersonActions).
    boardItem: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    boardRowInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    boardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    boardRank: { width: 16, fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    // Rank on top, movement since yesterday (if any) just under it —
    // wide enough for "▲10" without nudging the avatar column.
    rankCol: { width: 22, alignItems: 'flex-start', gap: 1 },
    rankMove: { fontSize: 9.5, fontFamily: font.heading, letterSpacing: -0.2 },
    boardName: { flex: 1, fontSize: 14, color: colors.text, fontFamily: font.body },
    boardSteps: { fontSize: 14, color: colors.text, fontFamily: font.heading },
    boardDistance: { fontSize: 11, color: withAlpha(colors.text, 0.55) },
    seventyFiveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 7,
    },
    seventyFiveCheckbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seventyFiveCheckboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    seventyFiveLabel: { flex: 1, fontSize: 14, color: colors.text, fontFamily: font.body },
    bingoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    bingoSquare: {
      width: '31%',
      aspectRatio: 1,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withAlpha(colors.text, 0.15),
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      padding: 6,
    },
    bingoSquareFilled: { backgroundColor: withAlpha(colors.green, 0.15), borderColor: colors.green },
    bingoSquareLabel: { fontSize: 11, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    bingoSquareLabelFilled: { color: colors.text, fontFamily: font.heading },
    bingoLinkPanel: {
      gap: 10,
      marginTop: 4,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.1),
    },
    bingoLinkHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    bingoLinkTitle: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    bingoWorkoutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    tagRecapLabel: { fontFamily: font.heading, color: colors.accent },
    inviteFriendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    friendName: { fontSize: 14, color: colors.text, fontFamily: font.body },
    loadError: { fontSize: 12.5, color: colors.amber, textAlign: 'center' },
    successNote: { fontSize: 12.5, color: colors.green, textAlign: 'center' },
    deleteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      marginTop: 4,
    },
    deleteLabel: { fontSize: 13, color: colors.amber, fontFamily: font.heading },
  });
}
