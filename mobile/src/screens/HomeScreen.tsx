import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BellRingingIcon,
  BoneIcon,
  CaretRightIcon,
  CrosshairIcon,
  EnvelopeOpenIcon,
  FireIcon,
  ShieldCheckIcon,
  FlagCheckeredIcon,
  GlobeHemisphereWestIcon,
  MedalIcon,
  PawPrintIcon,
  PlusCircleIcon,
  SneakerMoveIcon,
  TargetIcon,
  TrophyIcon,
  UserPlusIcon,
  XIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { LoadingView } from '../components/LoadingView';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Tag } from '../components/Tag';
import { useTheme } from '../theme/ThemeContext';
import { color, font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { HealthSnapshot, WorkoutSample } from '../health/types';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';
import type { MainTab } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { APP_VERSION } from '../lib/appVersion';
import { supabaseChallengesProvider, hasLoggedProgressToday, loadBoardInputs } from '../challenges/supabaseChallenges';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { UpdateReadyBanner } from '../components/UpdateReadyBanner';
import { ShareSheet } from '../share/ShareSheet';
import { WidgetHound } from '../widgets/WidgetHound';
import { Confetti } from '../celebrate/Confetti';
import { CelebrationModal } from '../celebrate/CelebrationModal';
import { useCelebrations } from '../celebrate/useCelebrations';
import { UsernamePrompt } from '../profiles/UsernamePrompt';
import { wasAskedForUsername } from '../profiles/UsernameForm';
import { updateWidgets } from '../widgets/widgetData';
import { houndFields, numbersFromProgress } from '../widgets/widgetModel';
import type { ShareContent } from '../share/ShareCard';
import { getAppBanner, isBannerActive, type AppBanner } from '../banner/supabaseBanner';
import { getMyDailyStepRankChange, recordDailyStepTotal, type StepRankChange } from '../leaderboard/supabaseStepsRank';
import { recordWorkoutHistory } from '../workouts/supabaseWorkoutHistory';
import {
  buildBoard,
  hasHeadStartElapsed,
  huntEffectiveMetric,
  isChallengeFinished,
  pickPrimaryChallenge,
  withHuntCatches,
  type BoardEntry,
} from '../challenges/board';
import { getFeatureNewest } from '../challenges/todayFeature';
import { getMyEquippedCosmetics, type EquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { readTodayCache, writeTodayCache } from '../home/todayCache';
import { daysElapsedFraction } from '../challenges/botSimulation';
import {
  syncChallengeProgressFromDevice,
  syncBingoProgressFromDevice,
  syncSeventyFiveFromDevice,
  isWorthSyncing,
  sharedHealthReads,
} from '../challenges/deviceSync';
import { boardSortFor } from '../challenges/scoring';
import { huntKindName, ordinal } from '../challenges/present';
import { getTagRound } from '../challenges/tagApi';
import { computePendingActions, needsManualEntry, type PendingAction } from '../challenges/pendingActions';
import { isMySeventyFiveTodayComplete } from '../challenges/seventyFiveApi';
import { challengeDayNumber, getChallengeDays, localDayKey } from '../challenges/challengeDays';
import { computeStreakStatus, type StreakStatus } from '../challenges/streak';
import { listDailyProgress, listParticipantJoinDates } from '../challenges/streakApi';
import {
  BINGO_CATEGORY_LABEL,
  BINGO_SQUARE_COUNT,
  categoriesForCardType,
  DEFAULT_BINGO_CARD_TYPE,
  type BingoCategory,
} from '../challenges/bingo';
import { listBingoCards, listBingoProgress } from '../challenges/bingoApi';
import { isHoundCard, lineStatus, SQUARES, type BingoCardRow } from '../challenges/houndBingo';
import { formatTimeLeft, turnDeadline } from '../challenges/tictacgo';
import { getTicTacGoGame, settleTicTacGo, type TicTacGoGame } from '../challenges/tictacgoApi';
import { settleChallengeScore } from '../challenges/scoreApi';
import { claimDailyBonus, type DailyBonusResult } from '../bones/dailyBonusApi';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { DailyBonusModal } from '../components/DailyBonusModal';
import { AchievementUnlockedModal } from '../components/AchievementUnlockedModal';
import { LevelUpModal } from '../components/LevelUpModal';
import { getMyHoundScore } from '../challenges/scoreApi';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { BACKGROUNDS, FRAMES, ICONS } from '../cosmetics/catalog';
import { GetStartedCard } from '../components/GetStartedCard';
import { PushAskCard } from '../components/PushAskCard';
import { NudgesCard } from '../components/NudgesCard';
import { NewRecordModal } from '../components/NewRecordModal';
import { RECORD_TITLE, syncPersonalRecords, takePendingNewRecords, type NewRecord } from '../records/personalRecords';
import { nudgesReceived, type ReceivedNudge } from '../social/social';
import { shouldOfferPush } from '../notifications/pushPermission';
import { claimOnboardingReward, getOnboardingStatus, type OnboardingStatus } from '../onboarding/onboardingApi';
import { checkAchievements, type NewlyEarnedAchievement } from '../achievements/achievementsApi';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { WeeklyRecapCard } from '../components/WeeklyRecapCard';
import { GlobalChallengesCard } from '../components/GlobalChallengesCard';
import {
  canJoin,
  joinGlobalChallenge,
  listGlobalChallenges,
  type GlobalChallenge,
} from '../challenges/globalChallenges';
import { fetchWeeklyRecap, isRecapWindow, recapWeekKey, stepsChangePct, type WeeklyRecap } from '../home/weeklyRecap';
import {
  getLocalRemindersEnabled,
  getReminderPermission,
  scheduleDailyBonusReminder,
  schedulePendingActionsNudge,
} from '../notifications/localReminders';
import { Toast, type ToastMessage } from '../components/Toast';
import { TicTacGoBoard } from '../components/TicTacGoCard';
import type { Challenge, ChallengeInvite, TagRound } from '../challenges/types';
import { useLabels } from '../labels/LabelsContext';
import { useGoalProgress } from '../goals/useGoalProgress';
import { useGoalStreak } from '../goals/useGoalStreak';
import { buyStreakShield } from '../goals/goalStreakApi';
import { updateHound } from '../goals/hound';
import { GoalsCard } from '../components/GoalsCard';
import { KennelCard } from '../components/KennelCard';
import { getKennel, type Kennel } from '../kennel/kennelApi';
import { BoneDigCard } from '../components/BoneDigCard';
import { BoneDigModal } from '../components/BoneDigModal';
import { digBone, getBoneDig, type BoneDigResult, type BoneDigState } from '../goals/boneDigApi';
import { BountiesCard } from '../components/BountiesCard';
import { PostBountyModal } from '../components/PostBountyModal';
import { useBounties } from '../bounties/useBounties';
import { cancelBounty, canPostToday, postBounty, type Bounty } from '../bounties/bountiesApi';
import { GoalSetupCard } from '../components/GoalSetupCard';
import { GoalsTile, HoundTile, SheetLink, Tile, TileSheet, TileValue, tileGrid, tileRow } from '../home/TodayTiles';
import { useGoalsTileStyle } from '../home/todayPrefs';
import { useGoals } from '../goals/GoalsContext';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from '../labels/types';

interface PrimaryChallenge {
  challenge: Challenge;
  board: BoardEntry[];
}

interface OtherActiveChallenge {
  id: string;
  name: string;
  kind: Challenge['kind'];
  endsAt: string;
  rank: number | null;
  total: number;
}

// What Today saves of its challenge section for the next open: only
// what doesn't change with anyone's steps (names, counts, invites).
// Standings, ranks and the featured challenge's card always wait for
// fresh data, so a step count on Today is never an old one.
interface TodayChallengesCache {
  challengeCounts: { active: number; finished: number } | null;
  otherActive: OtherActiveChallenge[];
  liveInvites: ChallengeInvite[] | null;
  featured: { id: string; name: string } | null;
}

// The banner's message is a single free-text field an admin types
// (see supabaseBanner.ts) — no separate "link" field. Rather than add
// backend/admin-console surface for that, this just auto-linkifies any
// http(s) URL already inside the text (an admin who wants a tappable
// link just needs to type the full https://... form, same as they'd
// paste into a chat app that does the same thing). Deliberately no
// bare-domain matching (e.g. "houndchallenge.net" with no scheme) —
// that's a much easier way to false-positive on ordinary sentences.
const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;
const URL_TRAILING_PUNCTUATION = /[.,!?)'"]+$/;

// Lets an admin write "{version}" in the banner message (see
// AdminScreen's "Home banner" card) and have it read as this device's
// own installed app version — the same value SettingsScreen shows as
// "Hound v{APP_VERSION}" — rather than a version the admin has to
// remember to type by hand and then update again on every release.
function withVersionPlaceholder(message: string): string {
  return message.replace(/\{version\}/g, APP_VERSION);
}

// A tiny extension of the same idea: an admin can write a whole
// {if version=X}...{elseif version=Y}...{else}...{/if} block to show a
// different message per installed version — e.g. nudging anyone still
// on 0.9.0 to update, while 0.10.0 gets a "try the new Bones shop"
// message instead. version is matched by exact string equality against
// APP_VERSION (same value {version} itself interpolates), any number of
// {elseif} branches is fine, and {else} is optional — if nothing
// matches and there's no {else}, the banner resolves to nothing and
// just doesn't show for that version, same as if it were disabled.
//
// Deliberately whole-message, not embeddable mid-sentence: a message
// with no {if} block at all (the common case) is returned completely
// unchanged, so every banner written before this existed keeps working
// exactly as it did.
interface ConditionalBranch {
  version: string | null; // null = the {else} branch
  text: string;
}

function parseConditionalBranches(raw: string): ConditionalBranch[] | null {
  const match = raw.match(/\{if\s+version\s*=\s*([^}]+)\}([\s\S]*)\{\/if\}/i);
  if (!match) return null;
  const parts = match[2].split(/(\{elseif\s+version\s*=\s*[^}]+\}|\{else\})/i);
  const branches: ConditionalBranch[] = [{ version: match[1].trim(), text: parts[0] }];
  for (let i = 1; i < parts.length; i += 2) {
    const elseifVersion = parts[i].match(/\{elseif\s+version\s*=\s*([^}]+)\}/i)?.[1];
    branches.push({ version: elseifVersion ? elseifVersion.trim() : null, text: parts[i + 1] ?? '' });
  }
  return branches;
}

// The one function anything displaying the banner should call — resolves
// any {if version=...} block down to plain text (or passes a plain
// message through untouched), then applies {version} interpolation to
// whichever text actually won.
function resolveBannerMessage(raw: string): string {
  const branches = parseConditionalBranches(raw);
  if (!branches) return withVersionPlaceholder(raw);
  const matched = branches.find((b) => b.version === APP_VERSION) ?? branches.find((b) => b.version === null);
  return withVersionPlaceholder((matched?.text ?? '').trim());
}

function linkifyBannerText(resolved: string, linkColor: string): React.ReactNode[] {
  return resolved
    .split(URL_PATTERN)
    .map((part, i) => {
      if (!/^https?:\/\//i.test(part)) return <Text key={i}>{part}</Text>;
      // A URL followed directly by sentence punctuation (no space) would
      // otherwise swallow that punctuation into the link itself.
      const trailingMatch = part.match(URL_TRAILING_PUNCTUATION);
      const trailing = trailingMatch?.[0] ?? '';
      const url = trailing ? part.slice(0, -trailing.length) : part;
      return (
        <Text key={i}>
          <Text
            style={{ color: linkColor, textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL(url).catch(() => {})}
          >
            {url}
          </Text>
          {trailing}
        </Text>
      );
    });
}

// Whether a two-way hunt's lead should read in miles or steps depends on
// what it's actually scored on (see src/challenges/scoring.ts) — a
// device_steps hunt has totalDistanceMi stuck at 0 (recordProgress only
// gets real distance from HealthKit's own snapshot, which a steps-scored
// sync still writes, but a hunt's *lead* should track whatever it's
// actually racing on, not just whichever field happens to be nonzero).
//
// Uses huntEffectiveMetric, not the raw totals — once a head start has
// ended, the Hunter's side of this needs to read as "what they've closed
// since then," or this headline would flatly contradict withHuntCatches'
// own catch condition (e.g. showing "2,000 steps behind" for a Hunter
// who, credit included, still has 20,000 to go).
function huntLeadMetric(
  me: BoardEntry,
  rival: BoardEntry,
  challenge: Challenge,
): { lead: number; unit: 'mi' | 'steps'; meTotal: number; rivalTotal: number } {
  const sortBy = boardSortFor(challenge);
  const meMetric = huntEffectiveMetric(me, sortBy);
  const rivalMetric = huntEffectiveMetric(rival, sortBy);
  const unit = sortBy === 'distance' ? 'mi' : 'steps';
  return { lead: meMetric - rivalMetric, unit, meTotal: meMetric, rivalTotal: rivalMetric };
}

function formatLead(value: number, unit: 'mi' | 'steps'): string {
  return unit === 'mi' ? `${value.toFixed(1)} mi` : `${Math.round(value).toLocaleString()} steps`;
}

function ticTacGoHeadline(name: string, game: TicTacGoGame | null, userId: string | null, board: BoardEntry[]): string {
  const nameOf = (id: string | null) => board.find((r) => r.userId === id)?.name ?? 'Your opponent';
  if (!game) return `Getting ${name} ready.`;
  if (game.status === 'waiting') return `Waiting for your opponent to join ${name}.`;
  if (game.status === 'won') {
    return game.winnerUserId === userId ? `You won ${name} with three in a row!` : `${nameOf(game.winnerUserId)} won ${name}.`;
  }
  if (game.status === 'draw') return `${name} ended in a draw.`;
  if (!game.turnStartedAt || new Date(game.turnStartedAt).getTime() > Date.now()) return `${name} starts soon.`;
  const timeLeft = formatTimeLeft(turnDeadline(game.turnStartedAt));
  return game.turnUserId === userId
    ? `Your move in ${name} — ${timeLeft}.`
    : `${nameOf(game.turnUserId)}’s move in ${name} — ${timeLeft}.`;
}

// The headline sentence + eyebrow for whichever real challenge Home
// decided to lead with — "Marcus is 7.4 mi behind you" was hand-authored
// for one specific hardcoded matchup, so a real version has to cover
// however many kinds of standing a real challenge can actually be in: a
// two-way gap (hunt, in whatever unit it's scored on), a rank in a bigger
// field, or nobody having logged anything yet.
function heroCopy(
  primary: PrimaryChallenge,
  userId: string | null,
  labels: HuntLabels = DEFAULT_HUNT_LABELS,
  streakStatuses: Map<string, StreakStatus> = new Map(),
  bingoFilled: Set<BingoCategory> = new Set(),
  tttGame: TicTacGoGame | null = null,
  bingoCard: BingoCardRow | null = null,
): { eyebrow: string; headline: string } {
  const { challenge, board } = primary;
  const daysElapsed = challengeDayNumber(challenge);
  const kindLabel = challenge.kind === 'hunt' ? huntKindName() : CHALLENGE_TYPES.find((t) => t.id === challenge.kind)?.name ?? challenge.kind;
  const eyebrow = `DAY ${daysElapsed} OF ${challenge.durationDays} · ${kindLabel.toUpperCase()}`;

  // Bingo's own progress isn't steps/distance at all (board is always
  // all-zero for it — see bingoApi.ts), so it needs its own headline
  // rather than falling through to the generic rank/"no one's logged
  // anything" framing below, which would otherwise never change no
  // matter how many squares get filled.
  if (challenge.kind === 'bingo' && bingoCard) {
    const marked = new Set([...bingoFilled].filter((s) => bingoCard.squares.includes(s as never)));
    const { away } = lineStatus(bingoCard.squares, marked);
    return {
      eyebrow,
      headline: bingoCard.blackoutAt
        ? `Blackout! Every square on your card in ${challenge.name}.`
        : bingoCard.bingoAt
          ? `BINGO in ${challenge.name}! Keep going for the full card.`
          : away === 1
            ? `One square from BINGO in ${challenge.name}.`
            : `You’re ${away} squares from BINGO in ${challenge.name}.`,
    };
  }
  if (challenge.kind === 'bingo') {
    return {
      eyebrow,
      headline:
        bingoFilled.size === BINGO_SQUARE_COUNT
          ? `Blackout! You’ve filled every square in ${challenge.name}.`
          : `You’ve filled ${bingoFilled.size} of ${BINGO_SQUARE_COUNT} squares in ${challenge.name}.`,
    };
  }

  if (challenge.kind === 'tictacgo') {
    return { eyebrow, headline: ticTacGoHeadline(challenge.name, tttGame, userId, board) };
  }

  const me = userId ? board.find((r) => r.userId === userId) : undefined;
  const rival = board.find((r) => r.userId !== userId);
  const finished = isChallengeFinished(challenge, board);

  // A two-person hunt concluded by an actual catch gets its own, more
  // personal wording ("X caught you") — everything else that's finished
  // (a multi-Hunted hunt with nobody left to chase, or any challenge
  // whose clock simply ran out) falls through to the generic "who won"
  // announcement below instead of this screen's usual "your standing"
  // framing.
  if (challenge.kind === 'hunt' && board.length === 2 && me && rival) {
    if (me.role === 'zombie') {
      return { eyebrow, headline: `${rival.name} caught you. The chase is over.` };
    }
    if (rival.role === 'zombie') {
      return { eyebrow, headline: `You caught ${rival.name}! The chase is over.` };
    }
    if (!finished && !hasHeadStartElapsed(challenge)) {
      // The Hunter's real, already-logged total still exists during head
      // start — it just doesn't count toward a catch yet (see
      // withHuntCatches) — so this replaces the lead/behind framing below
      // rather than showing a number that would otherwise read as an
      // ongoing race nobody's actually allowed to close yet.
      const daysLeft = Math.max(1, Math.ceil((challenge.headStartDays ?? 0) - daysElapsedFraction(challenge)));
      const dayWord = daysLeft === 1 ? 'day' : 'days';
      if (me.role === 'hunter') {
        return { eyebrow, headline: `${rival.name} has a ${daysLeft}-${dayWord} head start left.` };
      }
      return { eyebrow, headline: `Your head start ends in ${daysLeft} ${dayWord} — log while you can.` };
    }
    if (!finished) {
      const { lead, unit, meTotal, rivalTotal } = huntLeadMetric(me, rival, challenge);
      if (meTotal === 0 && rivalTotal === 0) {
        return { eyebrow, headline: `${challenge.name} just started — no ${unit === 'mi' ? 'miles' : 'steps'} logged yet.` };
      }
      const relation = lead >= 0 ? 'behind you' : 'ahead of you';
      return { eyebrow, headline: `${rival.name} is ${formatLead(Math.abs(lead), unit)} ${relation}.` };
    }
    // A 2-person hunt whose scheduled end passed without either side
    // ever being caught — falls through to "who won" below rather than
    // repeating the lead/behind framing on something that's already over.
  }

  // The viewer's own catch, for a hunt with more than one Hunted — the
  // 2-person branch above already covers that case (there, being caught
  // and the hunt ending are the same event). Here they aren't: Blaze or
  // Micah might still be out there even though you're a Zombie, so this
  // doesn't say "the chase is over" — just what happened to *you*. Checked
  // before the generic rank/"who won" framing below, which would
  // otherwise still report a stale rank for someone who's already out of
  // the running.
  if (challenge.kind === 'hunt' && me?.role === 'zombie' && !finished) {
    return {
      eyebrow,
      headline: `You've been caught — you're ${labels.zombie} now. ${challenge.name} continues without you.`,
    };
  }

  // Game of Tag is deliberately anti-competitive (see
  // 0045_tag_game_state.sql's own "no Hunter/Hunted-style ranking" note)
  // — a finished game never gets "who won" framing, even by proxy via
  // board rank. The recap of who was It, who got tagged, and who tagged
  // someone lives on the challenge's own detail screen instead (see
  // ChallengeDetailScreen's "Tag recap" card).
  if (challenge.kind === 'tag' && finished) {
    return { eyebrow, headline: `${challenge.name} wrapped up — no winner, just a recap of how the chase went.` };
  }

  // A Distance Pool is the group against a shared target, not against
  // each other (see ChallengeDetailScreen's own "it's the whole group
  // against the goal" footnote) — the same "no winner" concern Tag
  // already had, just for a cooperative goal instead of a no-ranking
  // game. A finished pool never gets "X won" framing here either,
  // whether or not the group actually reached its target.
  if (challenge.kind === 'distance' && finished) {
    const goal = challenge.distanceGoalUnit === 'steps' ? challenge.distanceGoalSteps : challenge.distanceGoalMi;
    const total = board.reduce(
      (sum, r) => sum + (challenge.distanceGoalUnit === 'steps' ? r.totalSteps : r.totalDistanceMi),
      0,
    );
    const totalDisplay =
      challenge.distanceGoalUnit === 'steps' ? `${Math.round(total).toLocaleString()} steps` : `${total.toFixed(1)} mi`;
    const met = !!goal && total >= goal;
    return {
      eyebrow,
      headline: met
        ? `${challenge.name} wrapped up — the group hit its target!`
        : `${challenge.name} wrapped up — the group logged ${totalDisplay} together.`,
    };
  }

  // Daily Streak: "X won" by raw total is just as wrong here as it was
  // for the other two — someone eliminated early could still have
  // logged the single biggest total from one binge day, and if nobody
  // ever missed, there's no single winner at all, just co-survivors.
  // Guarded on streakStatuses actually having data (not just an empty
  // default) — same "nothing to say yet" treatment primaryTagRound
  // gets before its own fetch resolves.
  if (challenge.kind === 'streak' && finished && streakStatuses.size > 0) {
    const survivors = board.filter((r) => streakStatuses.get(r.userId)?.eliminatedOnDay == null);
    if (survivors.length === 0) {
      return { eyebrow, headline: `${challenge.name} wrapped up — everyone’s streak ended.` };
    }
    if (survivors.length === 1) {
      const only = survivors[0];
      return {
        eyebrow,
        headline: only.userId === userId ? `You won ${challenge.name} — the last one still on your streak!` : `${only.name} won ${challenge.name} — the last one still on their streak!`,
      };
    }
    return { eyebrow, headline: `${challenge.name} wrapped up — ${survivors.length} people made it the whole way.` };
  }

  // board is already sorted descending by whichever metric this
  // challenge is scored on (see buildBoard) — for a concluded hunt
  // specifically, the Hunter's total is guaranteed to be at least every
  // caught Hunted's, so board[0] is always the Hunter there too, with no
  // separate hunter-lookup needed.
  if (finished && board.some((r) => r.totalSteps > 0 || r.totalDistanceMi > 0)) {
    const winner = board[0];
    return {
      eyebrow,
      headline: winner.userId === userId ? `You won ${challenge.name}!` : `${winner.name} won ${challenge.name}.`,
    };
  }

  if (!me || board.every((r) => r.totalSteps === 0)) {
    return { eyebrow, headline: `${challenge.name} — no one's logged anything yet.` };
  }
  const rank = board.findIndex((r) => r.userId === userId) + 1;
  return { eyebrow, headline: `You're ${ordinal(rank)} of ${board.length} in ${challenge.name}.` };
}

// At most one pop-up (daily bonus, achievement or new record) per app
// open; anything after that becomes a toast. Testers found the stack of
// pop-ups on open overwhelming. Module-level so switching tabs doesn't
// reset it; coming back to the app from the background does (see the
// AppState listener below).
let popupUsedThisOpen = false;
// Kinds where "3rd of 12" means something, for Today's one-line rows.
// A Daily Streak isn't ranked by total steps (who's still in is what
// counts), so it shows its type instead.
const RANKED_KINDS = new Set<Challenge['kind']>(['steps', 'distance', 'bingo', 'hunt']);
// "6 days left", "Ends today".
function timeLeftLabel(endsAt: string, now: number = Date.now()): string {
  const days = Math.ceil((new Date(endsAt).getTime() - now) / 86_400_000);
  return days <= 1 ? 'Ends today' : `${days} days left`;
}
const NEEDS_YOU_LIMIT = 3;
function takePopup(): boolean {
  if (popupUsedThisOpen) return false;
  popupUsedThisOpen = true;
  return true;
}

// Where Today's links go: a tab, or a screen that used to be a tab and
// now opens from You.
export type HomeDestination = MainTab | 'stats' | 'healthData' | 'goals' | 'kennel' | 'setup';

export function HomeScreen({
  onOpenHunt,
  onOpenChallenge,
  onGoTab,
  onOpenAchievements,
}: {
  onOpenHunt: () => void;
  onOpenChallenge: (challengeId: string) => void;
  onGoTab: (dest: HomeDestination) => void;
  onOpenAchievements: () => void;
}) {
  const { user } = useAuth();
  const health = useHealthProvider();
  const { colors, text } = useTheme();
  const { labelsForOrg } = useLabels();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutSample[]>([]);
  // Progress on every goal, for the card at the top and for the Hound's
  // reminders, which are rescheduled whenever it changes.
  const goalProgress = useGoalProgress(snap, workouts);
  useEffect(() => {
    if (goalProgress) updateHound({ progress: goalProgress });
  }, [goalProgress]);
  // Goal setup on Today, opened from the goals card. New accounts set
  // theirs in the setup wizard (src/onboarding/SetupWizardScreen.tsx).
  const { goalsSet } = useGoals();
  const [setupOpen, setSetupOpen] = useState(false);
  // null = either no real active challenge to headline, or the fetch
  // below hasn't resolved yet — same "never break the screen, just fall
  // back" pattern ChallengesScreen uses for its own list. Distinct from
  // loadingPrimary below: this screen used to show the sample "Marcus"
  // content immediately and swap it out once the real fetch resolved,
  // which on a slow connection reads as "the app briefly shows someone
  // else's fake data" rather than "loading" — loadingPrimary lets the
  // render below tell those two states apart.
  const [primary, setPrimary] = useState<PrimaryChallenge | null>(null);
  // Only true when there's actually something async to wait for —
  // starts false when Supabase isn't configured, since the sample
  // fallback is the real, permanent content in that case, not a
  // placeholder for a fetch that's about to happen.
  const [loadingPrimary, setLoadingPrimary] = useState(isSupabaseConfigured);
  // Null until the fetch below resolves (or forever, unconfigured) —
  // the "N active · N finished" row stays hidden rather than showing a
  // misleading 0/0 while this is still loading.
  const [challengeCounts, setChallengeCounts] = useState<{ active: number; finished: number } | null>(null);
  // Every other active challenge, one line each under the main one: name,
  // where you stand, time left.
  const [otherActive, setOtherActive] = useState<OtherActiveChallenge[]>([]);

  // Same convention, independently, for challenge invites — the single
  // source of truth for both the "· N invited" badge below and the
  // actual invite cards, same shape ChallengesScreen's own liveInvites
  // already uses (down to the same provider call), so the two screens
  // can't quietly disagree about what's pending.
  const [liveInvites, setLiveInvites] = useState<ChallengeInvite[] | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // Incoming friend requests — surfaced here too (not just buried at the
  // bottom of the Friends tab, under the invite-by-email/QR/code cards)
  // since responding to one doesn't need any of that other UI. Loaded
  // independently of the primary-challenge effect below: this list has
  // nothing to do with challenges, so it shouldn't wait on (or force a
  // re-run of) that heavier fetch.
  const [friendRequests, setFriendRequests] = useState<Friend[] | null>(null);
  const [respondingFriendId, setRespondingFriendId] = useState<string | null>(null);

  const loadFriendRequests = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const friends = await supabaseFriendsProvider.listFriends();
    setFriendRequests(friends.filter((f) => f.status === 'pending' && !f.requestedByMe));
  }, []);

  useEffect(() => {
    loadFriendRequests();
  }, [loadFriendRequests]);

  const respondToFriendRequest = async (friendshipId: string, accept: boolean) => {
    setRespondingFriendId(friendshipId);
    try {
      if (accept) await supabaseFriendsProvider.acceptFriendRequest(friendshipId);
      else await supabaseFriendsProvider.removeFriendship(friendshipId);
      await loadFriendRequests();
    } catch {
      // Same "no error UI yet" convention as respondToInvite below — a
      // stale request silently stops responding rather than crashing.
    } finally {
      setRespondingFriendId(null);
    }
  };

  // The admin-controlled Home announcement — see 0050_app_banner.sql and
  // src/banner/supabaseBanner.ts for the backend half. Dismissal is
  // purely local (AsyncStorage), keyed on the banner's own updatedAt: an
  // admin editing the message/timeframe bumps that, so a banner someone
  // already dismissed comes back if it's meaningfully changed, rather
  // than staying hidden forever once dismissed once.
  const BANNER_DISMISSED_KEY = 'homeBannerDismissedUpdatedAt';
  const [banner, setBanner] = useState<AppBanner | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    getAppBanner()
      .then(async (b) => {
        setBanner(b);
        const dismissedAt = await AsyncStorage.getItem(BANNER_DISMISSED_KEY).catch(() => null);
        setBannerDismissed(dismissedAt === b.updatedAt);
      })
      .catch(() => {
        // Same "never break the screen" convention as the rest of
        // Home's own fetches — the banner just never appears.
      });
  }, []);

  const dismissBanner = () => {
    setBannerDismissed(true);
    if (banner) {
      AsyncStorage.setItem(BANNER_DISMISSED_KEY, banner.updatedAt).catch(() => {
        // Best-effort — the banner still hides for the rest of this
        // session even if the dismissal doesn't survive a restart.
      });
    }
  };

  // Resolved once here rather than inline in JSX, so both showBanner and
  // the render below agree on the same text — a conditional banner with
  // no branch matching this device's version (and no {else}) resolves to
  // '', which should hide the banner entirely rather than show an empty bar.
  const resolvedBannerMessage = banner ? resolveBannerMessage(banner.message) : '';
  const showBanner = !!banner && isBannerActive(banner) && !bannerDismissed && resolvedBannerMessage.trim().length > 0;

  const currencyName = useCurrencyName();
  // Read from inside reload() without making it a dependency — a
  // currency name arriving late shouldn't re-run every fetch.
  const currencyNameRef = useRef(currencyName);
  currencyNameRef.current = currencyName;
  // Same for the navigation props a toast's tap uses: they're new
  // functions on every render of MainScreen.
  const navRef = useRef({ onGoTab, onOpenAchievements });
  navRef.current = { onGoTab, onOpenAchievements };

  // Small news that arrives after this app open has had its one pop-up
  // (see takePopup) — shown one at a time at the bottom of the screen.
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // Toasts here are nearly all Bones news (an award, a purchase, a
  // bounty), so each one also has the top bar re-read the balance.
  const pushToast = useCallback((t: ToastMessage) => {
    setToasts((cur) => [...cur, t]);
    notifyBonesChanged();
  }, []);

  // Goal days in a row, and the Bones for hitting every daily (or
  // weekly) goal, claimed as soon as the card shows them done.
  // Streak Shield (0101_streak_shield.sql): asks, spends the Bones,
  // then shows the new count on the goals card.
  const buyShield = () => {
    if (!goalStreak) return;
    const cost = goalStreak.shieldCost;
    const currency = currencyNameRef.current;
    Alert.alert(
      'Get a Streak Shield?',
      `It costs ${cost} ${currency}. Miss a day and it covers it, so your goal streak keeps going. You can hold 2, and one covers a miss each week.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: `Spend ${cost}`,
          onPress: () => {
            buyStreakShield()
              .then(() => {
                refreshGoalStreak();
                pushToast({
                  id: `shield-${Date.now()}`,
                  text: 'Shield ready: your streak is covered for one missed day',
                  Icon: ShieldCheckIcon,
                });
              })
              .catch((e) => Alert.alert('Couldn’t get a shield', e instanceof Error ? e.message : 'Try again in a moment.'));
          },
        },
      ],
    );
  };

  const { streak: goalStreak, refresh: refreshGoalStreak } = useGoalStreak(user?.id, goalProgress, (award) => {
    const bones = `+${award.bones} ${currencyNameRef.current}`;
    pushToast({
      id: `goal-${award.kind}-${Date.now()}`,
      text:
        award.kind === 'week'
          ? `${bones}: every weekly goal done`
          : `${bones}: every daily goal done${award.streak > 1 ? ` · ${award.streak} days in a row` : ''}`,
      Icon: FireIcon,
    });
  });

  // "Needs you" shows three things until expanded.
  const [needsYouExpanded, setNeedsYouExpanded] = useState(false);

  // Set only when claim_daily_bonus actually awards today's bonus (see
  // 0070_daily_bonus.sql) — drives the one-per-day popup; every later
  // claim the same day comes back awarded: false and leaves this alone.
  const [dailyBonus, setDailyBonus] = useState<DailyBonusResult | null>(null);
  // Newly unlocked achievements waiting to be shown — appended to, since
  // two quick reloads can each unlock something. Shown only once the daily
  // bonus popup (if any) has closed, never stacked on top of it.
  const [unlocked, setUnlocked] = useState<NewlyEarnedAchievement[]>([]);
  // Set when this open finds you a level up since last time (LevelUpModal).
  const [levelUp, setLevelUp] = useState<{ from: number; to: number; unlockedNames: string[] } | null>(null);
  // New-user "Get started" checklist (0074_onboarding_checklist.sql).
  // null = not loaded (or failed) — the card just doesn't render. Hidden
  // for good once the reward's claimed, or locally if dismissed.
  const GET_STARTED_DISMISSED_KEY = 'homeGetStartedDismissed';
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [getStartedDismissed, setGetStartedDismissed] = useState(true);
  const [claimingOnboarding, setClaimingOnboarding] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(GET_STARTED_DISMISSED_KEY)
      .then((v) => setGetStartedDismissed(v === '1'))
      .catch(() => setGetStartedDismissed(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dismissGetStarted = () => {
    setGetStartedDismissed(true);
    AsyncStorage.setItem(GET_STARTED_DISMISSED_KEY, '1').catch(() => {});
  };
  // "Turn on notifications" (src/notifications/pushPermission.ts) — once
  // someone has a friend or a challenge, so there's something worth
  // being notified about. Only while the phone has never been asked.
  const [offerPush, setOfferPush] = useState(false);
  useEffect(() => {
    let cancelled = false;
    shouldOfferPush().then((offer) => {
      if (!cancelled) setOfferPush(offer);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Personal records (0084_personal_records.sql): sync on focus (at most
  // every six hours), then celebrate anything beaten — here or on Your
  // data — once the other popups are done.
  const [newRecords, setNewRecords] = useState<NewRecord[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      let cancelled = false;
      const userId = user.id;
      (async () => {
        await syncPersonalRecords(health, userId);
        const pending = await takePendingNewRecords(userId);
        if (cancelled || pending.length === 0) return;
        if (takePopup()) {
          setNewRecords((cur) => [...cur, ...pending]);
        } else {
          for (const rec of pending) {
            pushToast({
              id: `record-${rec.kind}-${rec.achievedOn}`,
              text: `New personal record: ${RECORD_TITLE[rec.kind]}`,
              Icon: MedalIcon,
              onPress: () => navRef.current.onGoTab('stats'),
            });
          }
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, health]),
  );

  // "You got a nudge" (0082_nudges_reactions.sql) — nudges from the last
  // day, until dismissed. Dismissing remembers the newest one, so a new
  // nudge brings the card back.
  const NUDGES_DISMISSED_KEY = 'homeNudgesDismissedAt';
  const [nudges, setNudges] = useState<ReceivedNudge[]>([]);
  const [nudgesDismissedAt, setNudgesDismissedAt] = useState<string | null>(null);
  // Which tile's sheet is open (TodayTiles.tsx), and how the goals tile
  // looks (Settings → Today).
  const [openTile, setOpenTile] = useState<'goals' | 'hound' | 'needs' | 'challenges' | 'week' | null>(null);
  const goalsTileStyle = useGoalsTileStyle();
  // Your rank among everyone on Hound today (0027_daily_step_totals.sql),
  // in Week in review's spot Thursday to Sunday.
  const [stepRank, setStepRank] = useState<StepRankChange | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([nudgesReceived(), AsyncStorage.getItem(NUDGES_DISMISSED_KEY).catch(() => null)])
        .then(([n, dismissedAt]) => {
          if (cancelled) return;
          setNudges(n);
          setNudgesDismissedAt(dismissedAt);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  const visibleNudges = nudges.filter((n) => !nudgesDismissedAt || n.createdAt > nudgesDismissedAt);
  const dismissNudges = () => {
    const newest = nudges[0]?.createdAt ?? new Date().toISOString();
    setNudgesDismissedAt(newest);
    AsyncStorage.setItem(NUDGES_DISMISSED_KEY, newest).catch(() => {});
  };
  const claimGetStarted = async () => {
    if (!user?.id) return;
    setClaimingOnboarding(true);
    try {
      const bones = await claimOnboardingReward();
      setOnboarding((cur) => (cur ? { ...cur, rewardClaimed: true } : cur));
      Alert.alert('Nice start!', `+${bones} ${currencyName} added to your balance.`);
    } catch (e) {
      Alert.alert('Could not claim that', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setClaimingOnboarding(false);
    }
  };
  // The latest claim, awarded or not — its streak and nextBones are what
  // tomorrow's local "your bonus is waiting" reminder is scheduled
  // against. Keyed on the two numbers, not the object, so a repeat
  // same-day claim doesn't needlessly reschedule an identical reminder.
  const [lastClaim, setLastClaim] = useState<DailyBonusResult | null>(null);
  const lastClaimStreak = lastClaim?.streak ?? null;
  const lastClaimNextBones = lastClaim?.nextBones ?? null;
  useEffect(() => {
    if (lastClaimStreak === null || lastClaimNextBones === null) return;
    scheduleDailyBonusReminder(lastClaimStreak + 1, lastClaimNextBones, currencyName);
  }, [lastClaimStreak, lastClaimNextBones, currencyName]);

  // Only ever populated when `primary` itself turns out to be a 'tag'
  // challenge — see the effect below. Null otherwise, including while
  // that fetch is still in flight, which taggedBannerActive already
  // treats the same as "nothing to say" rather than showing a stale
  // banner from a previous primary challenge.
  const [primaryTagRound, setPrimaryTagRound] = useState<TagRound | null>(null);

  // Only ever populated when `primary` is a finished 'streak' challenge
  // — see the effect below. Empty otherwise (including while the fetch
  // is in flight), which heroCopy's own streak branch already treats
  // as "nothing to say yet."
  const [primaryStreakStatuses, setPrimaryStreakStatuses] = useState<Map<string, StreakStatus>>(new Map());

  // Only ever populated when `primary` is a 'bingo' challenge — see the
  // effect below. The viewer's own filled categories, not the whole
  // group's (that full leaderboard lives on the detail screen) — Home
  // only ever needs "your own card" for its hero copy and mini preview.
  const [primaryBingoFilled, setPrimaryBingoFilled] = useState<Set<BingoCategory>>(new Set());
  // The viewer's dealt card, when `primary` is a hound Bingo.
  const [primaryBingoCard, setPrimaryBingoCard] = useState<BingoCardRow | null>(null);
  // Only populated when `primary` is a Tic-Tac-Go game.
  const [primaryTttGame, setPrimaryTttGame] = useState<TicTacGoGame | null>(null);

  // The step-free parts of the challenge section from last time
  // (todayCache.ts), shown on open until this open's own data is in.
  // Never applied once fresh data has arrived, and saved again whenever
  // fresh data changes.
  const freshChallenges = useRef(false);
  const [cachedFeatured, setCachedFeatured] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    freshChallenges.current = false;
    if (!isSupabaseConfigured || !user?.id) return;
    let cancelled = false;
    readTodayCache<TodayChallengesCache>(user.id).then((saved) => {
      if (cancelled || !saved || freshChallenges.current) return;
      setChallengeCounts(saved.challengeCounts);
      setOtherActive(saved.otherActive);
      setLiveInvites(saved.liveInvites);
      setCachedFeatured(saved.featured);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  useEffect(() => {
    if (!freshChallenges.current || !user?.id) return;
    writeTodayCache<TodayChallengesCache>(user.id, {
      challengeCounts,
      // A place in the standings is step-based, so it isn't kept.
      otherActive: otherActive.map((c) => ({ ...c, rank: null })),
      liveInvites,
      featured: primary ? { id: primary.challenge.id, name: primary.challenge.name } : null,
    });
  }, [user?.id, primary, challengeCounts, otherActive, liveInvites]);

  // "What do I need to do right now" across every active challenge, not
  // just the primary one — Tag's "you're It," Tic-Tac-Go's "your move,"
  // an unfinished 75 Day checklist, or a manual-entry challenge nobody's
  // logged today. See pendingActions.ts's own comment on why this is a
  // pure reduction over already-fetched per-kind state, computed fresh
  // in the load effect below rather than stored.
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);

  // Global Hound Challenges (0075_global_challenges.sql): only the ones
  // the viewer can still join or has already joined — one they missed
  // is just noise.
  const [globalChallenges, setGlobalChallenges] = useState<GlobalChallenge[]>([]);
  const [joiningGlobalId, setJoiningGlobalId] = useState<string | null>(null);
  const loadGlobalChallenges = useCallback(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    listGlobalChallenges()
      .then((list) => setGlobalChallenges(list.filter((c) => c.joined || canJoin(c))))
      .catch(() => {
        // Same "never break the screen" convention as the rest of
        // Home's fetches — the card just stays hidden.
      });
  }, [user?.id]);

  const reload = useCallback(() => {
    loadGlobalChallenges();
    refreshGoalStreak();
    if (isSupabaseConfigured && user?.id) {
      // Every open/focus/resume lands here, and a repeat claim the same
      // day is a server-side no-op.
      claimDailyBonus()
        .then(async (result) => {
          setLastClaim(result);
          if (!result.awarded) return;
          // The full pop-up only while it can still offer "Remind me
          // tomorrow" (reminders on, permission never asked) and nothing
          // else has popped up this open. Every other day it's a toast.
          const [remindersOn, permission] = await Promise.all([
            getLocalRemindersEnabled(),
            getReminderPermission(),
          ]).catch(() => [false, 'denied'] as const);
          if (remindersOn && permission === 'undetermined' && takePopup()) {
            setDailyBonus(result);
          } else {
            pushToast({
              id: `bonus-${result.streak}-${Date.now()}`,
              text: `+${result.bonesAwarded} ${currencyNameRef.current} daily bonus${
                result.streak > 1 ? ` · ${result.streak}-day streak` : ''
              }`,
              Icon: BoneIcon,
            });
          }
        })
        .catch(() => {})
        // After the claim, so a login-streak achievement sees today's
        // streak (0072_achievements.sql).
        .then(() => checkAchievements())
        .then((earned) => {
          if (earned.length === 0) return;
          if (takePopup()) {
            setUnlocked((cur) => [...cur, ...earned]);
          } else {
            for (const a of earned) {
              pushToast({
                id: `achievement-${a.id}`,
                text: `Achievement unlocked: ${a.name}`,
                Icon: TrophyIcon,
                onPress: () => navRef.current.onOpenAchievements(),
              });
            }
          }
        })
        .catch(() => {})
        // Your XP against what this phone saw last time: a new level gets
        // the level-up pop-up (or a toast, if this open already had one).
        // The first check on a phone just records where you are.
        .then(async () => {
          const myId = user.id;
          const { xpTotal } = await getMyHoundScore(myId);
          const key = `hound:seen-xp:${myId}`;
          const seenRaw = await AsyncStorage.getItem(key).catch(() => null);
          await AsyncStorage.setItem(key, String(xpTotal)).catch(() => {});
          if (seenRaw === null) return;
          const seenXp = Number(seenRaw);
          const from = levelProgressForXp(seenXp).level;
          const to = levelProgressForXp(xpTotal).level;
          if (to <= from) return;
          const unlockedNames = [...FRAMES, ...BACKGROUNDS, ...ICONS]
            .filter((i) => i.unlockXp != null && i.unlockXp > seenXp && i.unlockXp <= xpTotal)
            .map((i) => i.name);
          if (takePopup()) {
            setLevelUp({ from, to, unlockedNames });
          } else {
            pushToast({
              id: `level-${to}`,
              text: `Level up! You're level ${to}, ${rankForLevel(to).name}`,
              Icon: TrophyIcon,
            });
          }
        })
        .catch(() => {})
        .then(() => getOnboardingStatus())
        .then(setOnboarding)
        .catch(() => {});
    }
    health.getSnapshot().then((s) => {
      setSnap(s);
      if (!isSupabaseConfigured || !user?.id) return;
      // Today's total feeds everyone's Hound-users rank, which the Data
      // tab shows (0027_daily_step_totals.sql).
      // Then your rank among everyone today, for the step rank tile.
      recordDailyStepTotal(user.id, s.stepsToday)
        .catch(() => {
          // Same "never break the screen" convention as the rest of
          // Home's own fetches.
        })
        .then(() => getMyDailyStepRankChange())
        .then(setStepRank)
        .catch(() => {});
    });
    // Today's workout count, plus the history record. 50 most recent is
    // the same window the Data tab's readiness card uses.
    health.getRecentWorkouts(50).then((w) => {
      setWorkouts(w);
      if (isSupabaseConfigured && user?.id) {
        recordWorkoutHistory(user.id, w).catch(() => {
          // Same "never break the screen" convention as the rest of
          // Home's own fetches.
        });
      }
    });
  }, [health, user?.id, loadGlobalChallenges, pushToast, refreshGoalStreak]);

  useEffect(reload, [reload]);

  // Reusable on its own, from respondToInvite below — declining an
  // invite only ever needs this one list refreshed, not the whole
  // heavier effect below.
  const loadInvites = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLiveInvites(await supabaseChallengesProvider.listMyChallengeInvites());
  }, []);

  // Bumped after accepting an invite (see respondToInvite), regaining
  // navigation focus, or the app returning to the foreground (both
  // below) to force the effect below to re-run — a newly-accepted
  // challenge needs its own board fetched and the active/finished
  // counts and primary card recomputed to include it, not just the
  // invite itself removed from the list.
  const [refreshKey, setRefreshKey] = useState(0);

  // Start-of-week recap (Mon–Wed) — see src/home/weeklyRecap.ts. Dismissal
  // is local and per week, same shape as the banner's own dismissal above:
  // hiding this week's recap never hides next week's.
  const RECAP_DISMISSED_KEY = 'homeWeeklyRecapDismissedWeek';
  // What the share sheet is showing (Week in review or today's goals).
  const [sharing, setSharing] = useState<ShareContent | null>(null);
  const [weeklyRecap, setWeeklyRecap] = useState<WeeklyRecap | null>(null);
  // Re-checked whenever Today refreshes (refreshKey, e.g. coming back to
  // it), not only when the app starts: the app can stay open from Sunday
  // into Monday, or from Wednesday into Thursday.
  useEffect(() => {
    if (!isRecapWindow()) {
      setWeeklyRecap(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const dismissedWeek = await AsyncStorage.getItem(RECAP_DISMISSED_KEY).catch(() => null);
      if (dismissedWeek === recapWeekKey()) {
        if (!cancelled) setWeeklyRecap(null);
        return;
      }
      const recap = await fetchWeeklyRecap(health, isSupabaseConfigured ? user?.id ?? null : null).catch(() => null);
      if (!cancelled) setWeeklyRecap(recap);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refreshKey]);
  const dismissWeeklyRecap = () => {
    if (weeklyRecap) {
      AsyncStorage.setItem(RECAP_DISMISSED_KEY, weeklyRecap.weekKey).catch(() => {
        // Best-effort — still hidden for the rest of this session.
      });
    }
    setWeeklyRecap(null);
  };

  // Your bounty and your friends' (0102_bounties.sql). Reaching a
  // friend's target claims it.
  const { bounties, refresh: refreshBounties } = useBounties(user?.id, snap?.stepsToday ?? null, refreshKey, (b) => {
    pushToast({
      id: `bounty-${b.id}`,
      text: `+${b.bones} ${currencyNameRef.current}: you got ${b.posterName}'s bounty`,
      Icon: TargetIcon,
    });
  });
  const [bountyModal, setBountyModal] = useState<'closed' | 'open' | 'posting'>('closed');
  const submitBounty = (targetSteps: number, bones: number) => {
    setBountyModal('posting');
    postBounty(targetSteps, bones)
      .then(() => {
        setBountyModal('closed');
        refreshBounties();
        pushToast({ id: `bounty-posted-${Date.now()}`, text: 'Bounty posted: your friends have till midnight', Icon: TargetIcon });
      })
      .catch((e: Error) => {
        setBountyModal('open');
        Alert.alert("Couldn't post the bounty", e.message);
      });
  };
  const takeBackBounty = (b: Bounty) => {
    Alert.alert('Take back your bounty?', `Your ${b.bones} ${currencyName} come back to you.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Take it back',
        style: 'destructive',
        onPress: () =>
          cancelBounty(b.id)
            .then(refreshBounties)
            .catch((e: Error) => Alert.alert("Couldn't take it back", e.message)),
      },
    ]);
  };

  // Your Locker look, for your avatar on the goal trails. Re-read on every
  // refresh, so a change in the Locker shows when you come back.
  // Bone Dig (0103_bone_dig.sql): one free dig a day once every daily
  // goal is done. Re-read when the goal day lands, so the Dig button
  // shows right away.
  const [boneDig, setBoneDig] = useState<BoneDigState | null>(null);
  const [digging, setDigging] = useState<{ result: BoneDigResult | null } | null>(null);
  const goalDayHit = goalStreak?.hitToday ?? false;
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    getBoneDig()
      .then(setBoneDig)
      .catch(() => {});
  }, [user?.id, refreshKey, goalDayHit]);
  // Your hound (0104_kennel.sql), re-read when the goal day lands so its
  // mood updates straight away.
  const [kennel, setKennel] = useState<Kennel | null>(null);
  const reloadKennel = useCallback(() => {
    getKennel()
      .then(setKennel)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    reloadKennel();
  }, [user?.id, refreshKey, goalDayHit, reloadKennel]);

  // The home screen widgets (src/widgets) get Today's numbers whenever they
  // change: steps, each goal, the streak and how your hound is doing.
  useEffect(() => {
    if (!goalProgress || !snap) return;
    updateWidgets({
      ...numbersFromProgress(goalProgress, snap.stepsToday),
      streak: goalStreak,
      ...(kennel ? houndFields(kennel) : {}),
    });
  }, [goalProgress, snap, goalStreak, kennel]);

  // Members who set up before the wizard asked for a username get asked
  // once here (profiles/UsernamePrompt.tsx), as this open's pop-up.
  const [askUsername, setAskUsername] = useState(false);
  const hasUsername = !!user?.username;
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id || hasUsername) return;
    let cancelled = false;
    wasAskedForUsername(user.id).then((asked) => {
      if (!cancelled && !asked && takePopup()) setAskUsername(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, hasUsername]);

  // Confetti and a sound for goals done, "Oh snap…" after a missed day
  // (src/celebrate).
  const celebrations = useCelebrations({
    userId: isSupabaseConfigured ? user?.id : null,
    progress: goalsSet ? goalProgress : null,
    streak: goalStreak,
    houndName: kennel?.name ?? 'Your hound',
    takePopup,
    pushToast,
  });

  const dig = () => {
    setDigging({ result: null });
    digBone()
      .then((result) => {
        setDigging({ result });
        setBoneDig({ dugToday: true, prize: result.prize, bones: result.bones, pieces: result.pieces });
      })
      .catch((e: Error) => {
        setDigging(null);
        Alert.alert("Couldn't dig", e.message);
      });
  };

  const [myLook, setMyLook] = useState<EquippedCosmetics | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    getMyEquippedCosmetics(user.id)
      .then(setMyLook)
      .catch(() => {});
  }, [user?.id, refreshKey]);

  const refreshAll = useCallback(() => {
    reload();
    setRefreshKey((k) => k + 1);
  }, [reload]);

  // Joining opens the challenge straight away; coming back to Today
  // refreshes everything (see the focus effect below), so the row flips
  // to Joined and the challenge counts include it.
  const joinGlobal = (c: GlobalChallenge) => {
    setJoiningGlobalId(c.id);
    joinGlobalChallenge(c.id)
      .then(() => onOpenChallenge(c.id))
      .catch((e) => {
        Alert.alert('Couldn’t join', e instanceof Error ? e.message : 'Try again in a moment.');
        loadGlobalChallenges();
      })
      .finally(() => setJoiningGlobalId(null));
  };

  // Home is the one tab that also gets navigated *away from* onto a
  // pushed stack screen (ChallengeDetail, Hunt) rather than only
  // switched away from — unlike every other tab in MainScreen.tsx's own
  // conditional rendering, which unmounts and remounts on every tab
  // switch (a fresh mount already re-runs every effect below with no
  // help needed), returning from one of those pushed screens comes back
  // to this exact same, still-mounted instance. Skips its own first
  // call — that first focus is just this screen's initial mount, which
  // the effects below already handle on their own; refreshing again
  // right then would just be a redundant, instant second fetch.
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      refreshAll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // The other gap neither a tab switch nor useFocusEffect covers: the
  // whole app backgrounded (the OS switcher, the phone locked, another
  // app opened) and returning to it — nothing above fires just because
  // time passed while this screen sat mounted but not actually visible,
  // so without this, stale data from before backgrounding just sits
  // there until something else happens to trigger a refresh.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // Coming back to the app counts as a new open: it may have one
        // pop-up again.
        popupUsedThisOpen = false;
        refreshAll();
      }
    });
    return () => subscription.remove();
  }, [refreshAll]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      // pickPrimaryChallenge is the single source of truth for "which
      // challenge does Today show" — ChallengesScreen calls the exact
      // same function to mark that one in its own list, so the two
      // screens can't quietly disagree about it.
      const [highlighted, challenges, invites, featureNewest] = await Promise.all([
        supabaseChallengesProvider.getHighlightedChallenge(),
        supabaseChallengesProvider.listMyChallenges(),
        // Same list ChallengesScreen's own invite cards come from — a
        // pending invite isn't in `challenges` at all yet (see
        // supabaseChallenges.ts's listMyChallenges, fixed to no longer
        // include one just because it's visible under RLS), so this is
        // a separate count, not part of the active/finished split below.
        supabaseChallengesProvider.listMyChallengeInvites(),
        getFeatureNewest(),
      ]);
      const primaryId = pickPrimaryChallenge(challenges, highlighted, featureNewest)?.id ?? null;

      // Best-effort background sync — every device-scored challenge this
      // user has joined gets its progress backfilled here, not just
      // whichever one they happen to open next (see deviceSync.ts's own
      // comment: before this, a participant who joined a challenge but
      // never opened its own detail screen individually stayed at 0
      // forever despite their device logging real steps the whole
      // time). Fire-and-forget: never awaited, so a slow sync for one
      // challenge can't delay Home's own render, and
      // syncChallengeProgressFromDevice already swallows its own
      // failures — there's nothing here to catch.
      //
      // Only challenges still running or just ended (late steps still
      // count until settlement, a day after the end), all reading the
      // phone's health data once between them instead of once each.
      const toSync = challenges.filter(isWorthSyncing);
      const sharedHealth = sharedHealthReads(health, toSync);
      toSync.forEach((c) => {
        syncChallengeProgressFromDevice(c, sharedHealth);
        syncBingoProgressFromDevice(c, sharedHealth);
        syncSeventyFiveFromDevice(c, sharedHealth);
      });

      // One board per challenge, not just the primary one — needed for
      // the "N active · N finished" summary below the hero. Built from
      // the same isChallengeFinished ChallengesScreen's own active/
      // Finished split already uses, so this can't quietly disagree with
      // what tapping through to Challenges actually shows (a hunt
      // concluded early by a catch counts as finished here too, not just
      // one whose scheduled end passed). Every challenge's own
      // participants/leaderboard/bots is fetched exactly once here and
      // reused below for whichever one turns out to be primary, rather
      // than fetching that one a second time.
      //
      // Only a challenge that's still running needs its board: one whose
      // end has passed is finished whatever the board says (see
      // isChallengeFinished), and a featured challenge is always a
      // running one (pickPrimaryChallenge). Fetching every finished
      // challenge's board too made Today take 7-11 seconds for someone
      // with a long history.
      //
      // All the running ones' boards come in one request
      // (loadBoardInputs, 0110_challenge_boards.sql).
      const nowMs = Date.now();
      const boardInputs = await loadBoardInputs(challenges.filter((c) => new Date(c.endsAt).getTime() > nowMs));
      const results = await Promise.all(
        challenges.map(async (c) => {
          const inputs = boardInputs.get(c.id);
          if (!inputs) {
            return { challenge: c, board: [] as BoardEntry[], finished: true };
          }
          const { participants, leaderboard, bots, headStartLeaderboard } = inputs;
          const sortBy = boardSortFor(c);
          const rawBoard = buildBoard(participants, leaderboard, bots, daysElapsedFraction(c), sortBy, c, headStartLeaderboard);
          const board = c.kind === 'hunt' ? withHuntCatches(rawBoard, sortBy, c) : rawBoard;
          return { challenge: c, board, finished: isChallengeFinished(c, board) };
        }),
      );
      if (cancelled) return;
      freshChallenges.current = true;
      setChallengeCounts({
        active: results.filter((r) => !r.finished).length,
        finished: results.filter((r) => r.finished).length,
      });
      setLiveInvites(invites);
      setOtherActive(
        results
          .filter((r) => !r.finished && r.challenge.id !== primaryId)
          .map((r) => {
            const mine = user?.id ? r.board.findIndex((b) => b.userId === user.id) : -1;
            return {
              id: r.challenge.id,
              name: r.challenge.name,
              kind: r.challenge.kind,
              endsAt: r.challenge.endsAt,
              // Only where a place means something: Tag isn't ranked,
              // Tic-Tac-Go is one-on-one, 75 Day is everyone on their own.
              rank: mine >= 0 && RANKED_KINDS.has(r.challenge.kind) ? mine + 1 : null,
              total: r.board.length,
            };
          }),
      );

      const primaryResult = results.find((r) => r.challenge.id === primaryId);
      setPrimary(primaryResult ? { challenge: primaryResult.challenge, board: primaryResult.board } : null);
      // Best-effort, unawaited — same "safe to call on every load" shape
      // as ChallengesScreen/ChallengeDetailScreen's own call sites.
      if (primaryResult) settleChallengeScore(primaryResult.challenge.id).catch(() => {});
      // Whether Home's own hero card needs "you've been tagged" — only
      // ever relevant when the primary challenge itself is a Tag game,
      // so this stays null (and skips the extra fetch) for every other
      // kind, same as ChallengeDetailScreen's own needsTag guard.
      if (primaryResult?.challenge.kind === 'tag') {
        getTagRound(primaryResult.challenge.id)
          .then((round) => {
            if (!cancelled) setPrimaryTagRound(round);
          })
          .catch(() => {
            if (!cancelled) setPrimaryTagRound(null);
          });
      } else {
        setPrimaryTagRound(null);
      }

      // Same shape as the tag round fetch above, for Daily Streak's own
      // finished-headline framing — only worth fetching once the
      // challenge is actually over (heroCopy's streak branch is itself
      // gated on `finished`), so a still-running streak never pays for
      // this extra round trip.
      if (primaryResult?.challenge.kind === 'streak' && isChallengeFinished(primaryResult.challenge, primaryResult.board)) {
        Promise.all([
          listDailyProgress(primaryResult.challenge.id),
          listParticipantJoinDates(primaryResult.challenge.id),
          getChallengeDays(primaryResult.challenge),
        ])
          .then(([dailyRows, joinDates, days]) => {
            if (!cancelled) setPrimaryStreakStatuses(computeStreakStatus(primaryResult.challenge, joinDates, dailyRows, days));
          })
          .catch(() => {
            if (!cancelled) setPrimaryStreakStatuses(new Map());
          });
      } else {
        setPrimaryStreakStatuses(new Map());
      }

      // Same shape as the tag/streak fetches above, for Bingo's own hero
      // copy and mini card preview — listBingoProgress returns every
      // participant's rows, filtered down to just the viewer's own (see
      // primaryBingoFilled's own comment).
      if (primaryResult?.challenge.kind === 'bingo' && user?.id) {
        const myId = user.id;
        listBingoProgress(primaryResult.challenge.id)
          .then((rows) => {
            if (!cancelled) setPrimaryBingoFilled(new Set(rows.filter((r) => r.userId === myId).map((r) => r.category)));
          })
          .catch(() => {
            if (!cancelled) setPrimaryBingoFilled(new Set());
          });
        if (isHoundCard(primaryResult.challenge)) {
          listBingoCards(primaryResult.challenge.id)
            .then((cards) => {
              if (!cancelled) setPrimaryBingoCard(cards.find((c) => c.userId === myId) ?? null);
            })
            .catch(() => {
              if (!cancelled) setPrimaryBingoCard(null);
            });
        } else {
          setPrimaryBingoCard(null);
        }
      } else {
        setPrimaryBingoFilled(new Set());
        setPrimaryBingoCard(null);
      }
      if (primaryResult?.challenge.kind === 'tictacgo') {
        const tttId = primaryResult.challenge.id;
        settleTicTacGo(tttId)
          .catch(() => {})
          .then(() => getTicTacGoGame(tttId))
          .then((game) => {
            if (!cancelled) setPrimaryTttGame(game);
          })
          .catch(() => {
            if (!cancelled) setPrimaryTttGame(null);
          });
      } else {
        setPrimaryTttGame(null);
      }

      // The challenge section can show now. Needs you fills in below,
      // once the per-kind checks for every active challenge are back.
      setLoadingPrimary(false);

      // Every active challenge, not just primary — pendingActions.ts's
      // whole point is answering "what do I need to do" across
      // everything at once, which the primary-only fetches below can't.
      // Each per-kind fetch below only runs for the challenges of that
      // kind, same as the primary-only versions further down, just
      // fanned out over every active one instead of one.
      const activeResults = results.filter((r) => !r.finished);
      if (user?.id) {
        const myId = user.id;
        const [tagEntries, tictacgoEntries, seventyfiveEntries, manualEntries] = await Promise.all([
          Promise.all(
            activeResults
              .filter((r) => r.challenge.kind === 'tag')
              .map(async (r): Promise<readonly [string, TagRound | null]> => [
                r.challenge.id,
                await getTagRound(r.challenge.id).catch(() => null),
              ]),
          ),
          Promise.all(
            activeResults
              .filter((r) => r.challenge.kind === 'tictacgo')
              .map(async (r): Promise<readonly [string, TicTacGoGame | null]> => {
                await settleTicTacGo(r.challenge.id).catch(() => {});
                return [r.challenge.id, await getTicTacGoGame(r.challenge.id).catch(() => null)];
              }),
          ),
          Promise.all(
            activeResults
              .filter((r) => r.challenge.kind === 'seventyfive')
              .map(async (r): Promise<readonly [string, boolean]> => [
                r.challenge.id,
                // Fails toward "complete" (no action shown) rather than
                // a false "you're behind" on a network hiccup — same
                // "fail toward showing nothing" reasoning
                // pendingActions.ts documents for its own maps.
                // Before your own day 1 (west of the creator), there's
                // nothing to do yet either.
                (await getChallengeDays(r.challenge)
                  .then((d) => localDayKey(new Date()) < d.firstDay)
                  .catch(() => false)) ||
                  (await isMySeventyFiveTodayComplete(r.challenge.id, myId).catch(() => true)),
              ]),
          ),
          Promise.all(
            activeResults
              .filter((r) => needsManualEntry(r.challenge))
              .map(async (r): Promise<readonly [string, boolean]> => [
                r.challenge.id,
                await hasLoggedProgressToday(r.challenge.id, myId).catch(() => true),
              ]),
          ),
        ]);
        if (!cancelled) {
          const actions = computePendingActions({
            myUserId: myId,
            now: new Date(),
            challenges: activeResults.map((r) => r.challenge),
            tagRounds: new Map(tagEntries.filter((e): e is readonly [string, TagRound] => e[1] !== null)),
            tictacgoGames: new Map(tictacgoEntries.filter((e): e is readonly [string, TicTacGoGame] => e[1] !== null)),
            seventyfiveTodayComplete: new Map(seventyfiveEntries),
            loggedProgressToday: new Map(manualEntries),
          });
          setPendingActions(actions);
          // Tonight's local "still on your list" reminder tracks this same
          // list — rescheduled (or cancelled once it's empty) on every
          // load, so it never nags about something already done.
          schedulePendingActionsNudge(actions);
        }
      } else if (!cancelled) {
        setPendingActions([]);
        schedulePendingActionsNudge([]);
      }

    })()
      .catch(() => {
        // Stay on the sample fallback on any failure.
      })
      .finally(() => {
        if (!cancelled) setLoadingPrimary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, refreshKey]);

  // Same shape as ChallengesScreen's own respondToInvite — Join re-runs
  // the whole primary-challenge effect above (a newly-accepted challenge
  // needs its board fetched and the counts/primary card recomputed),
  // Decline only needs the invite list itself refreshed.
  const respondToInvite = async (invite: ChallengeInvite, accept: boolean) => {
    setRespondingId(invite.id);
    try {
      if (accept) {
        await supabaseChallengesProvider.acceptChallengeInvite(invite.id);
        setRefreshKey((k) => k + 1);
      } else {
        await supabaseChallengesProvider.declineChallengeInvite(invite.id);
      }
      await loadInvites();
    } catch {
      // No error UI for this yet — same as ChallengesScreen's own
      // respondToInvite: a stale invite silently stops responding
      // rather than crashing, and refocusing this tab re-fetches.
    } finally {
      setRespondingId(null);
    }
  };


  // This challenge's own words, not the viewer's — see LabelsContext's
  // own comment on why those can differ.
  const hero = primary
    ? heroCopy(
        primary,
        user?.id ?? null,
        labelsForOrg(primary.challenge.organizationId),
        primaryStreakStatuses,
        primaryBingoFilled,
        primaryTttGame,
        primaryBingoCard,
      )
    : null;
  // The one Tag-specific override of heroCopy's own headline — everyone
  // else's status (chasing someone, hasn't picked yet) already reads
  // fine as "your standing," but this specific moment (just became It,
  // with nobody picked yet) is the "you've been tagged, pick your next
  // target" home-screen message the game's own spec called for. Only
  // ever true for whichever challenge is actually primary right now —
  // same one-hero-card-at-a-time constraint every other kind already
  // has here.
  const taggedBannerActive = !!(
    primary &&
    primary.challenge.kind === 'tag' &&
    primaryTagRound &&
    user?.id &&
    primaryTagRound.itUserId === user.id &&
    !primaryTagRound.targetUserId
  );
  const heroHeadline = taggedBannerActive
    ? 'You’ve been tagged — pick your next target!'
    : (hero?.headline ?? 'Start a challenge to see your progress here.');
  // No real challenge to open yet — sends a brand-new user (or the
  // unconfigured sandbox) to where "New challenge" actually lives,
  // instead of the old fallback of opening the hardcoded Hunt demo as if
  // it were this user's own chase.
  // Everything waiting on you, for the Needs you card.
  type NeedsYouItem =
    | { key: string; type: 'action'; action: PendingAction }
    | { key: string; type: 'invite'; invite: ChallengeInvite }
    | { key: string; type: 'friend'; friend: Friend };
  const needsYou: NeedsYouItem[] = [
    ...pendingActions.map((action) => ({ key: `action-${action.challengeId}-${action.kind}`, type: 'action' as const, action })),
    ...(liveInvites ?? []).map((invite) => ({ key: `invite-${invite.id}`, type: 'invite' as const, invite })),
    ...(friendRequests ?? []).map((friend) => ({ key: `friend-${friend.friendshipId}`, type: 'friend' as const, friend })),
  ];
  const shownNeedsYou = needsYouExpanded ? needsYou : needsYou.slice(0, NEEDS_YOU_LIMIT);
  // Global challenges, split for the Your challenges card: ones you've
  // joined are already among your challenges (marked with the globe);
  // running ones you could still join get a Join row; ones that haven't
  // started (and you haven't joined) keep their own card.
  const nowMs = Date.now();
  const globalIds = new Set(globalChallenges.map((c) => c.id));
  const joinableGlobals = globalChallenges.filter((c) => !c.joined && nowMs >= new Date(c.startsAt).getTime());
  const upcomingGlobals = globalChallenges.filter((c) => !c.joined && nowMs < new Date(c.startsAt).getTime());
  const openPrimary = primary ? () => onOpenChallenge(primary.challenge.id) : () => onGoTab('challenges');

  // Leaving Today from inside a sheet closes the sheet first, so it isn't
  // still open on the way back.
  const closeTile = useCallback(() => setOpenTile(null), []);
  const sheetGoTab: typeof onGoTab = (tab) => {
    setOpenTile(null);
    onGoTab(tab);
  };
  const sheetOpenChallenge = (challengeId: string) => {
    setOpenTile(null);
    onOpenChallenge(challengeId);
  };
  const sheetOpenPrimary = () => {
    setOpenTile(null);
    openPrimary();
  };
  const trailAvatar = {
    initials: user?.initials ?? '',
    frameId: myLook?.frameId,
    backgroundId: myLook?.backgroundId,
    iconId: myLook?.iconId,
  };

  // The Needs you tile: everything waiting on you, newest kinds last.
  const digReady =
    !!boneDig && goalDayHit && !boneDig.dugToday && !!goalProgress?.some((p) => p.goal.period === 'day');
  const needsLines = [
    ...needsYou.map((item) =>
      item.type === 'action'
        ? item.action.label
        : item.type === 'invite'
          ? `${item.invite.inviterName} invited you`
          : `${item.friend.name} wants to be friends`,
    ),
    ...(digReady ? ['Bone Dig is ready'] : []),
    ...visibleNudges.map((n) => `${n.name} nudged you`),
    ...(bounties ?? []).filter((b) => !b.mine && b.status === 'open').map((b) => `${b.posterName}'s bounty`),
  ];
  const recapPct = weeklyRecap ? stepsChangePct(weeklyRecap) : null;
  // Up or down from yesterday's rank: a smaller number is better.
  const rankDelta = stepRank?.yesterdayRank != null ? stepRank.yesterdayRank - stepRank.rank : null;
  const rankMove =
    rankDelta === null
      ? null
      : rankDelta === 0
        ? { text: 'Same as yesterday' }
        : rankDelta > 0
          ? { text: `▲ ${rankDelta} from yesterday`, color: colors.green }
          : { text: `▼ ${-rankDelta} from yesterday`, color: colors.amber };
  const activeCount = challengeCounts?.active ?? (primary ? 1 : 0);

  // The small tiles, two to a row; an odd last one spans the row.
  const smallTiles: { key: string; render: (wide: boolean) => React.ReactNode }[] = [
    ...(kennel ? [{ key: 'hound', render: () => <HoundTile kennel={kennel} onPress={() => setOpenTile('hound')} /> }] : []),
    {
      key: 'needs',
      render: (wide: boolean) => (
        <Tile
          label="Needs you"
          badge={needsLines.length}
          wide={wide}
          onPress={() => setOpenTile('needs')}
          accessibilityLabel={`Needs you, ${needsLines.length} waiting. Open`}
        >
          <TileValue
            value={needsLines.length > 0 ? `${needsLines.length} waiting` : 'All caught up'}
            lines={needsLines.length > 0 ? needsLines.slice(0, 3) : ['Nothing waiting on you']}
          />
        </Tile>
      ),
    },
    {
      key: 'challenges',
      render: (wide: boolean) => (
        <Tile
          label="Challenges"
          wide={wide}
          onPress={activeCount > 0 || loadingPrimary ? () => setOpenTile('challenges') : openPrimary}
          accessibilityLabel={`Challenges, ${activeCount} running. Open`}
        >
          {loadingPrimary && !challengeCounts ? (
            <TileValue value="…" lines={['Loading your challenges']} />
          ) : activeCount > 0 ? (
            <TileValue
              value={`${activeCount} running`}
              lines={
                primary
                  ? // The standing usually names the challenge already.
                    heroHeadline.includes(primary.challenge.name)
                    ? [`📌 ${heroHeadline}`]
                    : [`📌 ${primary.challenge.name}`, heroHeadline]
                  : otherActive.slice(0, 2).map((c) => c.name)
              }
            />
          ) : (
            <TileValue value="None yet" lines={['Start one with friends ›']} />
          )}
        </Tile>
      ),
    },
    // Monday to Wednesday last week's recap, the rest of the week today's
    // step rank, so the tiles stay two by two.
    ...(!weeklyRecap
      ? [
          {
            key: 'rank',
            render: (wide: boolean) => (
              <Tile
                label="Step rank"
                wide={wide}
                onPress={() => onGoTab('stats')}
                accessibilityLabel={
                  stepRank ? `Step rank today, ${stepRank.rank} of ${stepRank.totalUsers}. Open stats` : 'Step rank. Open stats'
                }
              >
                <TileValue
                  value={stepRank ? `#${stepRank.rank.toLocaleString()}` : '—'}
                  lines={
                    stepRank
                      ? [
                          `of ${stepRank.totalUsers.toLocaleString()} on Hound today`,
                          ...(rankMove ? [rankMove] : []),
                          `${(snap?.stepsToday ?? 0).toLocaleString()} steps so far`,
                        ]
                      : ['Shows once your steps sync today']
                  }
                />
              </Tile>
            ),
          },
        ]
      : []),
    ...(weeklyRecap
      ? [
          {
            key: 'week',
            render: (wide: boolean) => (
              <Tile label="Week in review" wide={wide} onPress={() => setOpenTile('week')} accessibilityLabel="Week in review. Open">
                <TileValue
                  value={weeklyRecap.stepsLastWeek !== null ? weeklyRecap.stepsLastWeek.toLocaleString() : '—'}
                  lines={[
                    // Last week's total against the week before (weeklyRecap.ts),
                    // said plainly so it isn't read as this week so far.
                    `steps last week${recapPct !== null ? ` · ${recapPct >= 0 ? '▲' : '▼'} ${Math.abs(recapPct)}%` : ''}`,
                    `${weeklyRecap.challengesFinished} ${weeklyRecap.challengesFinished === 1 ? 'challenge' : 'challenges'} finished`,
                  ]}
                />
              </Tile>
            ),
          },
        ]
      : []),
  ];

  // While the real fetch above is still in flight, show a spinner instead
  // of the sample "Marcus" content — that content used to render first and
  // get swapped out once real data arrived, which on a slow connection
  // reads as a flash of someone else's fake progress rather than a loading
  // state.
  const announcementBar = showBanner && (
    <View style={styles.announcementBar}>
      <Text style={styles.announcementText}>{linkifyBannerText(resolvedBannerMessage, colors.accent)}</Text>
      <Pressable onPress={dismissBanner} hitSlop={8}>
        <XIcon size={16} color={colors.text} />
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {sharing && <ShareSheet content={sharing} onClose={() => setSharing(null)} />}
      {kennel && <WidgetHound kennel={kennel} />}
      <UpdateReadyBanner />
      {announcementBar}
      <ScrollView contentContainerStyle={styles.container}>
      {/* Global challenges you can still join stand apart, above the
          tiles, so they're seen without opening anything. */}
      {(upcomingGlobals.length > 0 || joinableGlobals.length > 0) && (
        <GlobalChallengesCard
          challenges={[...upcomingGlobals, ...joinableGlobals]}
          joiningId={joiningGlobalId}
          onJoin={joinGlobal}
          onOpen={(c) => onOpenChallenge(c.id)}
        />
      )}

      {setupOpen && (
        <GoalSetupCard
          canDismiss
          onDone={() => setSetupOpen(false)}
          onMoreOptions={() => {
            setSetupOpen(false);
            onGoTab('goals');
          }}
        />
      )}

      {/* Today as tiles (TodayTiles.tsx): goals across the top, then your
          hound, what needs you, your challenges and last week. Each opens
          a sheet with the full cards. Testers found the long stack of
          cards too much at once. */}
      <View style={tileGrid}>
        {!setupOpen && goalProgress && goalsTileStyle && (
          <GoalsTile
            progress={goalProgress}
            streak={goalStreak}
            tileStyle={goalsTileStyle}
            avatar={trailAvatar}
            needsSetup={!goalsSet}
            onOpen={() => setOpenTile('goals')}
            onSetGoals={() => setSetupOpen(true)}
          />
        )}
        {/* Two to a row, in rows of their own: a wrapping row let a tile
            with long text take the whole width on some phones. */}
        {smallTiles
          .filter((_, i) => i % 2 === 0)
          .map((tile, row) => {
            const partner = smallTiles[row * 2 + 1];
            return (
              // Keyed by both tiles, so a row that gains a partner is built
              // fresh rather than resized.
              <View key={`${tile.key}-${partner?.key ?? 'alone'}`} style={tileRow}>
                {tile.render(!partner)}
                {partner?.render(false)}
              </View>
            );
          })}
      </View>

      {offerPush && user?.id && onboarding && (onboarding.hasFriend || onboarding.joinedChallenge) && (
        <PushAskCard userId={user.id} onDone={() => setOfferPush(false)} />
      )}

      {onboarding && !onboarding.rewardClaimed && !getStartedDismissed && (
        <GetStartedCard
          status={onboarding}
          currencyName={currencyName}
          claiming={claimingOnboarding}
          onContinue={() => onGoTab('setup')}
          onClaim={claimGetStarted}
          onDismiss={dismissGetStarted}
        />
      )}

    </ScrollView>
    {openTile === 'goals' && goalProgress && (
      <TileSheet title="Today's goals" onClose={closeTile}>
        <GoalsCard
          progress={goalProgress}
          streak={goalStreak}
          currencyName={currencyName}
          onBuyShield={isSupabaseConfigured ? buyShield : null}
          avatar={{
            initials: user?.initials ?? '',
            frameId: myLook?.frameId,
            backgroundId: myLook?.backgroundId,
            iconId: myLook?.iconId,
          }}
          needsSetup={!goalsSet}
          onOpenGoal={() => sheetGoTab('stats')}
          onEdit={() => sheetGoTab('goals')}
          onSetGoals={() => {
            setOpenTile(null);
            setSetupOpen(true);
          }}
          onShare={goalsSet ? () => setSharing({ kind: 'goals', progress: goalProgress, streak: goalStreak }) : null}
        />
      </TileSheet>
    )}
    {openTile === 'hound' && kennel && (
      <TileSheet title={kennel.name} onClose={closeTile}>
        <KennelCard kennel={kennel} currencyName={currencyName} onOpen={() => sheetGoTab('kennel')} onChanged={reloadKennel} />
      </TileSheet>
    )}
    {openTile === 'needs' && (
      <TileSheet title="Needs you" onClose={closeTile}>
        {needsLines.length === 0 && <Text style={styles.caughtUp}>All caught up. Nothing is waiting on you.</Text>}
        {needsYou.length > 0 && (
          <Card style={styles.needsCard} elevated={false}>
            <View style={styles.needsHeader}>
              <Text style={styles.needsTitle}>Needs you</Text>
              <Text style={styles.needsCount}>{needsYou.length}</Text>
            </View>
            {shownNeedsYou.map((item, i) => (
              <View key={item.key} style={[styles.needsRow, i > 0 && styles.needsRowDivider]}>
                {item.type === 'action' ? (
                  <Pressable style={styles.needsRowMain} onPress={() => sheetOpenChallenge(item.action.challengeId)}>
                    <BellRingingIcon size={16} color={color.accent300} weight="fill" />
                    <Text style={[styles.inviteTitle, { flex: 1 }]}>{item.action.label}</Text>
                    <CaretRightIcon size={16} color={withAlpha(colors.text, 0.5)} />
                  </Pressable>
                ) : item.type === 'invite' ? (
                  <>
                    <View style={styles.needsRowMain}>
                      <EnvelopeOpenIcon size={16} color={color.accent300} weight="fill" />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.inviteTitle}>
                          {item.invite.inviterName} invited you to &ldquo;{item.invite.challengeName}&rdquo;
                        </Text>
                        <Text style={styles.inviteSub}>
                          {item.invite.challengeKind === 'hunt'
                            ? huntKindName()
                            : CHALLENGE_TYPES.find((t) => t.id === item.invite.challengeKind)?.name ??
                              item.invite.challengeKind}{' '}
                          · {item.invite.durationDays} days
                        </Text>
                      </View>
                    </View>
                    <View style={styles.needsButtons}>
                      <Button
                        label="Join"
                        variant="primary"
                        small
                        disabled={respondingId === item.invite.id}
                        onPress={() => respondToInvite(item.invite, true)}
                      />
                      <Button
                        label="Decline"
                        small
                        disabled={respondingId === item.invite.id}
                        onPress={() => respondToInvite(item.invite, false)}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.needsRowMain}>
                      <UserPlusIcon size={16} color={color.accent300} weight="fill" />
                      <Text style={[styles.inviteTitle, { flex: 1 }]}>{item.friend.name} wants to be friends</Text>
                    </View>
                    <View style={styles.needsButtons}>
                      <Button
                        label="Accept"
                        variant="primary"
                        small
                        disabled={respondingFriendId === item.friend.friendshipId}
                        onPress={() => respondToFriendRequest(item.friend.friendshipId, true)}
                      />
                      <Button
                        label="Decline"
                        small
                        disabled={respondingFriendId === item.friend.friendshipId}
                        onPress={() => respondToFriendRequest(item.friend.friendshipId, false)}
                      />
                    </View>
                  </>
                )}
              </View>
            ))}
            {needsYou.length > NEEDS_YOU_LIMIT && (
              <Pressable onPress={() => setNeedsYouExpanded((v) => !v)} hitSlop={6} style={styles.needsMore}>
                <Text style={styles.needsMoreText}>{needsYouExpanded ? 'Show less' : `See all ${needsYou.length}`}</Text>
              </Pressable>
            )}
          </Card>
        )}
        {boneDig && goalProgress?.some((p) => p.goal.period === 'day') && (
          <BoneDigCard dig={boneDig} goalsDone={goalDayHit} currencyName={currencyName} onDig={dig} />
        )}
        {visibleNudges.length > 0 && (
          <NudgesCard nudges={visibleNudges} onOpenChallenge={sheetOpenChallenge} onDismiss={dismissNudges} />
        )}
        {bounties && (bounties.length > 0 || onboarding?.hasFriend) && (
          <BountiesCard
            bounties={bounties}
            stepsToday={snap?.stepsToday ?? null}
            currencyName={currencyName}
            onPost={
              onboarding?.hasFriend && canPostToday() && !bounties.some((b) => b.mine && b.status === 'open')
                ? () => setBountyModal('open')
                : null
            }
            onCancel={takeBackBounty}
          />
        )}
      </TileSheet>
    )}
    {openTile === 'challenges' && (
      <TileSheet title="Your challenges" onClose={closeTile}>
        {/* Nothing featured though challenges are running (Settings → don't
            feature my newest challenge): they're all in the list below. */}
        {!loadingPrimary && (primary || !challengeCounts || challengeCounts.active === 0) && (
          <View style={styles.heroRow}>
            <View style={styles.heroText}>
              <Text style={text.eyebrow}>{hero?.eyebrow ?? 'GET STARTED'}</Text>
              <Text style={[text.h2, styles.heroTitle]}>{heroHeadline}</Text>
            </View>
            <Button
              label={primary ? 'View challenge' : 'New challenge'}
              variant="primary"
              icon={
                primary ? (
                  <CrosshairIcon size={15} color={color.accent} />
                ) : (
                  <PlusCircleIcon size={15} color={color.accent} />
                )
              }
              onPress={sheetOpenPrimary}
            />
          </View>
        )}

        {/* Your pinned (highlighted) challenge, then the rest. */}
        {/* Last time's featured challenge, by name only, while its
            standings load: steps on Today are never old ones. */}
        {loadingPrimary && !primary && cachedFeatured && (
          <Card style={styles.featuredLoading} elevated={false}>
            <Text style={text.h4} numberOfLines={1}>
              {cachedFeatured.name}
            </Text>
            <LoadingView style={styles.challengesLoading} />
          </Card>
        )}

        {primary && (
          <View style={styles.cardsRow}>
            {primary.challenge.kind === 'hunt' && primary.board.length === 2 ? (
              <LiveHuntCard primary={primary} userId={user?.id ?? null} onOpen={sheetOpenPrimary} styles={styles} />
            ) : primary.challenge.kind === 'hunt' ? (
              <LiveMultiHuntCard primary={primary} userId={user?.id ?? null} onOpen={sheetOpenPrimary} styles={styles} />
            ) : primary.challenge.kind === 'bingo' ? (
              <BingoCardPreview
                primary={primary}
                filled={primaryBingoFilled}
                card={primaryBingoCard}
                onOpen={sheetOpenPrimary}
                styles={styles}
              />
            ) : primary.challenge.kind === 'tictacgo' ? (
              <TicTacGoPreview primary={primary} game={primaryTttGame} onOpen={sheetOpenPrimary} styles={styles} />
            ) : (
              <LiveLeaderboardCard primary={primary} userId={user?.id ?? null} onOpen={sheetOpenPrimary} styles={styles} colors={colors} />
            )}
          </View>
        )}
        {loadingPrimary && !challengeCounts && (
          <Card style={styles.yoursCard} elevated={false}>
            <LoadingView style={styles.challengesLoading} />
          </Card>
        )}
        {(otherActive.length > 0 ||
          (challengeCounts && challengeCounts.active + challengeCounts.finished + (liveInvites?.length ?? 0) > 0)) && (
          <Card style={styles.yoursCard} elevated={false}>
            <Pressable
              style={({ pressed }) => [styles.yoursHeader, pressed && { opacity: 0.7 }]}
              onPress={() => sheetGoTab('challenges')}
              accessibilityRole="button"
              accessibilityLabel="All challenges"
            >
              <FlagCheckeredIcon size={15} color={color.accent} />
              <Text style={styles.yoursHeaderText}>
                {challengeCounts
                  ? `${challengeCounts.active} active ${challengeCounts.active === 1 ? 'challenge' : 'challenges'} · ${challengeCounts.finished} finished`
                  : 'Your challenges'}
                {(liveInvites?.length ?? 0) > 0 && (
                  <Text style={styles.countsInvited}> · {liveInvites!.length} invited</Text>
                )}
              </Text>
              <Text style={styles.yoursSeeAll}>See all</Text>
              <CaretRightIcon size={13} color={withAlpha(colors.text, 0.4)} />
            </Pressable>
            {otherActive.map((c) => {
              const isGlobal = globalIds.has(c.id);
              const KindIcon = isGlobal ? GlobeHemisphereWestIcon : CHALLENGE_KIND_ICON[c.kind] ?? DEFAULT_CHALLENGE_ICON;
              const typeName =
                c.kind === 'hunt' ? huntKindName() : CHALLENGE_TYPES.find((t) => t.id === c.kind)?.name ?? 'Challenge';
              return (
                <Pressable
                  key={c.id}
                  style={({ pressed }) => [styles.yoursRow, pressed && { opacity: 0.7 }]}
                  onPress={() => sheetOpenChallenge(c.id)}
                  accessibilityRole="button"
                >
                  <KindIcon size={16} color={colors.accentActive} />
                  <Text style={styles.otherText} numberOfLines={1}>
                    <Text style={styles.otherName}>{c.name}</Text>
                    {' · '}
                    {c.rank ? `${ordinal(c.rank)} of ${c.total}` : typeName} · {timeLeftLabel(c.endsAt)}
                  </Text>
                  <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
                </Pressable>
              );
            })}
          </Card>
        )}
        <SheetLink label="All challenges" onPress={() => sheetGoTab('challenges')} />
      </TileSheet>
    )}
    {openTile === 'week' && weeklyRecap && (
      <TileSheet title="Your week" onClose={closeTile}>
        {weeklyRecap && (
          <WeeklyRecapCard
            recap={weeklyRecap}
            currencyName={currencyName}
            onDismiss={dismissWeeklyRecap}
            onShare={() => setSharing({ kind: 'week', recap: weeklyRecap })}
          />
        )}
      </TileSheet>
    )}
    {bountyModal !== 'closed' && (
      <PostBountyModal
        currencyName={currencyName}
        posting={bountyModal === 'posting'}
        onPost={submitBounty}
        onClose={() => setBountyModal('closed')}
      />
    )}
    {digging && (
      <BoneDigModal
        result={digging.result}
        avatar={{
          initials: user?.initials ?? '',
          frameId: myLook?.frameId,
          backgroundId: myLook?.backgroundId,
          iconId: myLook?.iconId,
        }}
        currencyName={currencyName}
        onClose={() => {
          setDigging(null);
          notifyBonesChanged();
        }}
      />
    )}
    {dailyBonus && (
      <DailyBonusModal
        bonesAwarded={dailyBonus.bonesAwarded}
        streak={dailyBonus.streak}
        nextBonus={dailyBonus.nextBones}
        weeklyBonus={dailyBonus.weeklyBones}
        currencyName={currencyName}
        onClose={() => {
          setDailyBonus(null);
          notifyBonesChanged();
        }}
      />
    )}
    {!dailyBonus && unlocked.length === 0 && newRecords.length > 0 && (
      <NewRecordModal
        records={newRecords}
        onViewAll={() => {
          setNewRecords([]);
          onGoTab('stats');
        }}
        onClose={() => setNewRecords([])}
      />
    )}
    {!dailyBonus && unlocked.length > 0 && (
      <AchievementUnlockedModal
        achievements={unlocked}
        currencyName={currencyName}
        onViewAll={() => {
          setUnlocked([]);
          onOpenAchievements();
        }}
        onClose={() => setUnlocked([])}
      />
    )}
    {levelUp && !dailyBonus && unlocked.length === 0 && (
      <LevelUpModal
        fromLevel={levelUp.from}
        toLevel={levelUp.to}
        avatar={{
          initials: user?.initials ?? '',
          frameId: myLook?.frameId,
          backgroundId: myLook?.backgroundId,
          iconId: myLook?.iconId,
        }}
        unlockedNames={levelUp.unlockedNames}
        onClose={() => {
          setLevelUp(null);
          notifyBonesChanged();
        }}
      />
    )}
    {askUsername && <UsernamePrompt onClose={() => setAskUsername(false)} />}
    {celebrations.card && (
      <CelebrationModal
        kind={celebrations.card.kind}
        title={celebrations.card.title}
        body={celebrations.card.body}
        kennel={kennel}
        onShare={
          celebrations.card.kind === 'allDone' && goalProgress
            ? () => {
                celebrations.closeCard();
                setSharing({ kind: 'goals', progress: goalProgress, streak: goalStreak });
              }
            : undefined
        }
        onClose={celebrations.closeCard}
        confetti={
          celebrations.confetti && (
            <Confetti key={celebrations.confetti.key} big={celebrations.confetti.big} onDone={celebrations.clearConfetti} />
          )
        }
      />
    )}
    {celebrations.confetti && !celebrations.card && (
      <Confetti key={celebrations.confetti.key} big={celebrations.confetti.big} onDone={celebrations.clearConfetti} />
    )}
    {toasts.length > 0 && (
      <Toast key={toasts[0].id} message={toasts[0]} onDone={() => setToasts((cur) => cur.slice(1))} />
    )}
    </View>
  );
}

// A real two-way hunt, laid out the same as the sample card: a track with
// both racers' positions and a lead/behind readout. Positions are a
// proportional stand-in for "who's ahead by how much" (clamped so the gap
// stays readable), not a literal distance-to-pixel mapping.
function LiveHuntCard({
  primary,
  userId,
  onOpen,
  styles,
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
  styles: HomeStyles;
}) {
  const { challenge, board } = primary;
  const me = board.find((r) => r.userId === userId);
  const rival = board.find((r) => r.userId !== userId);
  if (!me || !rival) return null;

  const daysElapsed = challengeDayNumber(challenge);
  // Once either side is 'zombie' the chase is over — the marker gap and
  // lead/behind readout below stop meaning anything the moment that's
  // true, so both collapse to "caught" instead of stale numbers.
  const caught = me.role === 'zombie' || rival.role === 'zombie';
  const { lead, unit, rivalTotal } = huntLeadMetric(me, rival, challenge);
  // Same "readable gap, not a literal scale" idea in either unit — 1 mi
  // moves the marker 2 points, 250 steps moves it 1 point, both clamped
  // to the same readable range.
  const gapPct = caught ? 0 : Math.min(40, Math.max(4, Math.abs(lead) * (unit === 'mi' ? 2 : 1 / 250)));
  const meLeft = lead >= 0 ? 78 : 78 - gapPct;
  const rivalLeft = lead >= 0 ? 78 - gapPct : 78;

  return (
    <Card style={styles.huntCard} elevated={false}>
      <View style={styles.huntHeader}>
        <PawPrintIcon size={15} color={color.accent300} weight="fill" />
        <Text style={styles.huntTitle}>{challenge.name}</Text>
        <Tag label={caught ? 'Caught' : `day ${daysElapsed} / ${challenge.durationDays}`} variant="outline" />
      </View>
      <View style={styles.huntTrack}>
        <View style={styles.huntTrackLine} />
        <View style={[styles.huntMarker, styles.hunterMarker, { left: `${rivalLeft}%` }]}>
          <SneakerMoveIcon size={14} color={color.neutral200} />
        </View>
        <View style={[styles.huntMarker, styles.huntedMarker, { left: `${meLeft}%` }]}>
          <SneakerMoveIcon size={14} color={color.accent100} weight="fill" />
        </View>
      </View>
      <View style={styles.huntStatsRow}>
        {caught ? (
          <>
            <Text style={styles.huntLead}>{me.role === 'zombie' ? 'Caught' : 'Got them!'}</Text>
            <Text style={styles.huntNote}>
              {me.role === 'zombie'
                ? `${rival.name} caught you — the chase is over.`
                : `You caught ${rival.name} — the chase is over.`}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.huntLead}>
              {formatLead(Math.abs(lead), unit)}
              <Text style={styles.huntLeadSuffix}> {lead >= 0 ? 'lead' : 'behind'}</Text>
            </Text>
            <Text style={styles.huntNote}>
              {rival.name} has logged {formatLead(rivalTotal, unit)} so far.
            </Text>
          </>
        )}
      </View>
      <Button label="See the tally" variant="primary" small onPress={onOpen} />
    </Card>
  );
}

// A hunt with more than one Hunted (bots, multiple friends, or both) —
// LiveHuntCard's own two-person "open road between you" framing doesn't
// generalize to more than one rival on a fixed scale, so this puts
// every Hunted/Zombie participant on one shared 0-100% track instead,
// each positioned by how much of their own gap the Hunter's real
// effective progress (huntEffectiveMetric — the same number
// ChallengeDetailScreen's own "Chase progress" card already computes,
// condensed for Home) has actually closed. 100% always means caught,
// regardless of that person's own total, so pucks stay comparable to
// each other even though they're each being chased toward a different
// number.
function LiveMultiHuntCard({
  primary,
  userId,
  onOpen,
  styles,
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
  styles: HomeStyles;
}) {
  const { labelsForOrg } = useLabels();
  const { challenge, board } = primary;
  // This challenge's own words, not the viewer's — see LabelsContext's
  // own comment on why those can differ.
  const labels = labelsForOrg(challenge.organizationId);
  const hunter = board.find((r) => r.role === 'hunter');
  if (!hunter) return null;

  const sortBy = boardSortFor(challenge);
  const unit: 'mi' | 'steps' = sortBy === 'distance' ? 'mi' : 'steps';
  const hunterMetric = huntEffectiveMetric(hunter, sortBy);
  const targets = board
    .filter((r) => r.role === 'hunted' || r.role === 'zombie')
    .map((row) => {
      const total = sortBy === 'distance' ? row.totalDistanceMi : row.totalSteps;
      const pct = row.role === 'zombie' ? 100 : total > 0 ? Math.min(100, (hunterMetric / total) * 100) : 0;
      return { row, total, pct, gap: Math.max(0, total - hunterMetric) };
    });
  // The headline and the spotlighted puck both feature whoever's
  // genuinely closest to being caught — a Zombie is never "closest," it
  // already happened, so this only ever looks at who's still Hunted.
  const stillOut = targets.filter((t) => t.row.role === 'hunted').sort((a, b) => b.pct - a.pct);
  const closest = stillOut[0];
  const closestName = closest?.row.userId === userId ? 'you' : closest?.row.name;
  const hunterIsMe = hunter.userId === userId;
  const hunterName = hunterIsMe ? 'You' : hunter.name;
  const caughtCount = targets.length - stillOut.length;

  const daysElapsed = challengeDayNumber(challenge);
  const concluded = targets.length > 0 && stillOut.length === 0;

  // Most people read left to right, and the Hunter is the one *behind*,
  // doing the chasing — so it anchors the left edge (HUNTER_POS), not
  // the finish line on the right. A still-Hunted target's own pct (0 =
  // hasn't been touched, approaching 100 = about to be caught) maps
  // backward from there: the safest sits out near the right edge, and
  // closing the gap pulls their puck leftward, toward the Hunter — but
  // never quite reaching or passing it, since that position would read
  // as "about to be caught," not "already caught." A Zombie isn't on
  // that gradient at all: it jumps to a fixed spot *behind* the Hunter
  // (CAUGHT_POS, left of HUNTER_POS) the instant withHuntCatches flips
  // them, the same way the Hunter has visibly already passed them by in
  // a real chase, rather than sitting just short of the Hunter forever.
  const HUNTER_POS = 8;
  const CAUGHT_POS = 2;
  const trackPosFor = (pct: number) => 90 - (Math.min(100, Math.max(0, pct)) / 100) * 76;

  return (
    <Card style={styles.huntCard} elevated={false}>
      <View style={styles.huntHeader}>
        <PawPrintIcon size={15} color={color.accent300} weight="fill" />
        <Text style={styles.huntTitle}>{challenge.name}</Text>
        <Tag label={concluded ? 'Caught everyone' : `day ${daysElapsed} / ${challenge.durationDays}`} variant="outline" />
      </View>

      {!closest ? (
        <Text style={styles.huntNote}>
          {concluded
            ? `The ${labels.hunter}'s caught everyone — the chase is over.`
            : 'No one to chase yet.'}
        </Text>
      ) : (
        <>
          <View style={styles.huntStatsRow}>
            <Text style={styles.huntLead}>
              <Text style={styles.huntLeadSuffix}>{hunterName} {hunterIsMe ? 'need' : 'needs'} </Text>
              {formatLead(closest.gap, unit)}
              <Text style={styles.huntLeadSuffix}> left to catch {closestName}</Text>
            </Text>
            <Text style={styles.huntNote}>
              {caughtCount > 0
                ? `${caughtCount} of ${targets.length} already caught.`
                : `${targets.length} still out there.`}
            </Text>
          </View>
          <View style={styles.multiTrack}>
            <View style={styles.multiTrackDots}>
              {Array.from({ length: 18 }).map((_, i) => (
                <View key={i} style={styles.multiTrackDot} />
              ))}
            </View>
            {targets.map((t) => {
              const caught = t.row.role === 'zombie';
              return (
                <View
                  key={t.row.userId}
                  style={[
                    styles.multiPuck,
                    caught ? styles.multiPuckCaught : t.row.userId === closest.row.userId && styles.multiPuckSpotlight,
                    { left: `${caught ? CAUGHT_POS : trackPosFor(t.pct)}%` },
                  ]}
                >
                  <Avatar
                    initials={t.row.initials}
                    tint={caught ? color.neutral800 : TINT_N}
                    size={22}
                    fontSize={9}
                    frameId={t.row.frameId}
                    backgroundId={t.row.backgroundId}
                    iconId={t.row.iconId}
                  />
                  {/* A literal strikethrough, not just the dimmed
                      opacity above — "caught" should read at a glance,
                      not just as a slightly-fainter avatar next to
                      everyone else's. */}
                  {caught && <View style={styles.multiPuckStrike} />}
                </View>
              );
            })}
            {/* Amber + paw print, not the same neutral gray a caught
                Zombie's puck already uses — the Hunter needs its own
                unmistakable color so it doesn't read as just another
                (caught) participant. Fixed at the left edge, ahead of
                every Zombie's own fixed CAUGHT_POS — see trackPosFor's
                own comment for why. */}
            <View style={[styles.multiPuck, styles.multiHunterPuck, { left: `${HUNTER_POS}%` }]}>
              <PawPrintIcon size={14} color="#232a54" weight="fill" />
            </View>
          </View>
        </>
      )}
      <Button label="See the tally" variant="primary" small onPress={onOpen} />
    </Card>
  );
}

// Any real challenge that isn't a hunt at all (a step race, streak, or
// distance pool) — a ranked list scaled to whoever's currently leading,
// same shape as the sample race card.
function LiveLeaderboardCard({
  primary,
  userId,
  onOpen,
  styles,
  colors,
}: {
  primary: PrimaryChallenge;
  userId: string | null;
  onOpen: () => void;
  styles: HomeStyles;
  colors: Palette;
}) {
  const { challenge, board } = primary;
  const top = board.slice(0, 4);
  const scoredByDistance = boardSortFor(challenge) === 'distance';
  const metric = (r: BoardEntry) => (scoredByDistance ? r.totalDistanceMi : r.totalSteps);
  const maxMetric = Math.max(1, ...board.map(metric));
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.endsAt).getTime() - Date.now()) / 86_400_000));

  return (
    <Card style={styles.raceCard} elevated={false}>
      <View style={styles.raceHeader}>
        <TrophyIcon size={15} color={color.accent} />
        <Text style={styles.raceTitle}>{challenge.name}</Text>
        <Text style={styles.raceMeta}>
          {board.length} {board.length === 1 ? 'person' : 'people'} · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </Text>
      </View>
      {top.map((row, i) => {
        const isMe = row.userId === userId;
        return (
          <View key={row.userId} style={styles.raceRow}>
            <Text style={styles.raceRank}>{i + 1}</Text>
            <Avatar
              initials={row.initials}
              tint={isMe ? TINT_A : TINT_N}
              size={24}
              fontSize={10}
              frameId={row.frameId}
              backgroundId={row.backgroundId}
              iconId={row.iconId}
            />
            <Text style={styles.raceName} numberOfLines={1}>
              {isMe ? 'You' : row.name}
            </Text>
            <View style={styles.raceBarWrap}>
              <ProgressBar
                pct={(metric(row) / maxMetric) * 100}
                fillColor={isMe ? colors.accentActive : '#796cbf'}
                height={3}
              />
            </View>
            <Text style={[styles.raceSteps, isMe && { color: colors.accentActive }]}>
              {scoredByDistance ? `${row.totalDistanceMi.toFixed(1)} mi` : row.totalSteps.toLocaleString()}
            </Text>
          </View>
        );
      })}
      {top.length === 0 && <Text style={styles.tileSub}>No one&rsquo;s logged anything yet.</Text>}
      <Button label="Full leaderboard" variant="ghost" small onPress={onOpen} />
    </Card>
  );
}

// A compact version of ChallengeDetailScreen's own "Your bingo card" grid
// — the viewer's own 9 squares, not the whole group's (that ranked
// leaderboard, and everyone else's cards, live on the detail screen; Home
// only ever shows "your own standing" for every other kind too).
function BingoCardPreview({
  primary,
  filled,
  card,
  onOpen,
  styles,
}: {
  primary: PrimaryChallenge;
  filled: Set<BingoCategory>;
  // A hound card (houndBingo.ts): drawn as its own small grid instead.
  card: BingoCardRow | null;
  onOpen: () => void;
  styles: HomeStyles;
}) {
  const { challenge, board } = primary;
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.endsAt).getTime() - Date.now()) / 86_400_000));
  if (card) {
    const size = Math.round(Math.sqrt(card.squares.length));
    const { done } = lineStatus(card.squares, filled);
    const inLine = new Set(done.flat());
    const count = card.squares.filter((s) => s !== 'free' && filled.has(s)).length;
    return (
      <Card style={styles.raceCard} elevated={false}>
        <View style={styles.raceHeader}>
          <TrophyIcon size={15} color={color.accent} />
          <Text style={styles.raceTitle}>{challenge.name}</Text>
          <Text style={styles.raceMeta}>
            {board.length} {board.length === 1 ? 'person' : 'people'} · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
          </Text>
        </View>
        <View style={{ gap: 4 }}>
          {Array.from({ length: size }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 4 }}>
              {card.squares.slice(r * size, r * size + size).map((cell, c) => {
                const i = r * size + c;
                const on = cell === 'free' || filled.has(cell);
                return (
                  <View
                    key={i}
                    style={[styles.houndMiniCell, on && styles.houndMiniOn, inLine.has(i) && styles.houndMiniLine]}
                  >
                    <Text style={styles.houndMiniEmoji}>{cell === 'free' ? '★' : SQUARES[cell].emoji}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
        <Text style={styles.tileSub}>
          {card.bingoAt ? 'BINGO! ' : ''}
          {count} of {card.squares.filter((s) => s !== 'free').length} squares.
        </Text>
        <Button label="Your card" variant="ghost" small onPress={onOpen} />
      </Card>
    );
  }
  const bingoCategories = categoriesForCardType(challenge.bingoCardType ?? DEFAULT_BINGO_CARD_TYPE);

  return (
    <Card style={styles.raceCard} elevated={false}>
      <View style={styles.raceHeader}>
        <TrophyIcon size={15} color={color.accent} />
        <Text style={styles.raceTitle}>{challenge.name}</Text>
        <Text style={styles.raceMeta}>
          {board.length} {board.length === 1 ? 'person' : 'people'} · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </Text>
      </View>
      <View style={styles.bingoMiniGrid}>
        {bingoCategories.map((category) => {
          const isFilled = filled.has(category);
          return (
            <View key={category} style={[styles.bingoMiniSquare, isFilled && styles.bingoMiniSquareFilled]}>
              <Text style={[styles.bingoMiniLabel, isFilled && styles.bingoMiniLabelFilled]} numberOfLines={2}>
                {BINGO_CATEGORY_LABEL[category]}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.tileSub}>
        {filled.size} of {BINGO_SQUARE_COUNT} squares filled.
      </Text>
      <Button label="Full leaderboard" variant="ghost" small onPress={onOpen} />
    </Card>
  );
}

// Home's compact view of a Tic-Tac-Go game — the live board, no goal
// labels under claimed marks; the full game (and claiming) lives on the
// detail screen.
function TicTacGoPreview({
  primary,
  game,
  onOpen,
  styles,
}: {
  primary: PrimaryChallenge;
  game: TicTacGoGame | null;
  onOpen: () => void;
  styles: HomeStyles;
}) {
  const { challenge } = primary;
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.endsAt).getTime() - Date.now()) / 86_400_000));

  return (
    <Card style={styles.raceCard} elevated={false}>
      <View style={styles.raceHeader}>
        <TrophyIcon size={15} color={color.accent} />
        <Text style={styles.raceTitle}>{challenge.name}</Text>
        <Text style={styles.raceMeta}>
          1v1 · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </Text>
      </View>
      {game ? <TicTacGoBoard game={game} compact /> : <Text style={styles.tileSub}>Loading the board…</Text>}
      <Button label="Open game" variant="ghost" small onPress={onOpen} />
    </Card>
  );
}

// The hunt card's own background used to be a fixed, hand-tuned dark navy
// regardless of theme, so it'd keep reading as a branded highlight
// instead of turning white like every other card in Light mode — but a
// permanently-dark card sitting in an otherwise-light screen just read as
// broken, not "branded." An accent wash over this theme's own `colors.bg`
// keeps the same "this card is special" pop in both themes (a muted
// purple-navy tint in Dark mode, a pale lavender in Light mode) without
// abandoning the theme, and its own text/divider styles below
// (huntTitle through multiTrackDot) go back to the theme-following
// `colors` param to match — HuntScreen's progressCard and
// ChallengesScreen's inviteCard get the same treatment, for the same
// reason.
function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 20, paddingBottom: 48 },
    caughtUp: { fontSize: 14, color: withAlpha(colors.text, 0.65), textAlign: 'center', paddingVertical: 8 },
    challengesLoading: { paddingVertical: 18 },
    featuredLoading: { gap: 4 },
    announcementBar: {
      flexDirection: 'row',
      // flex-start, not center — now that the message can wrap to as
      // many lines as it needs (see announcementText), a growing block
      // would otherwise carry the dismiss "x" down to its vertical
      // middle instead of keeping it pinned to the top corner.
      alignItems: 'flex-start',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: withAlpha(colors.accent, 0.16),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.accent, 0.4),
    },
    announcementText: { flex: 1, fontSize: 13, color: colors.text },
    heroRow: { gap: 14 },
    heroText: { gap: 6 },
    heroTitle: { fontSize: 28 },
    yoursCard: { gap: 0, paddingVertical: 4 },
    yoursHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
    yoursHeaderText: { flex: 1, fontFamily: font.heading, fontSize: 14, color: colors.text },
    yoursSeeAll: { fontSize: 13, color: colors.accentActive, fontFamily: font.heading },
    yoursRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    countsInvited: { color: colors.accentActive },
    // Same shape as ChallengesScreen's own inviteCard/inviteTitle/inviteSub.
    // Same accent-wash look the separate invite cards had, now one card.
    otherText: { flex: 1, fontSize: 13.5, color: withAlpha(colors.text, 0.7) },
    otherName: { fontFamily: font.heading, color: colors.text },
    needsCard: {
      gap: 0,
      paddingVertical: 6,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    needsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 4 },
    needsTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    needsCount: { fontFamily: font.heading, fontSize: 12, color: colors.accentActive },
    needsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
    needsRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.accent, 0.35) },
    needsRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    needsButtons: { flexDirection: 'row', gap: 6 },
    needsMore: { alignSelf: 'flex-start', paddingTop: 4, paddingBottom: 8 },
    needsMoreText: { fontFamily: font.heading, fontSize: 13, color: colors.accentActive },
    inviteTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    inviteSub: { fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
    tileSub: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    cardsRow: { gap: 12 },
    // Fixed, hand-tuned dark background regardless of theme — the same
    // "always-dark spotlight card" reasoning as HuntScreen's progressCard
    // (see that file's own comment). Everything drawn on top of it below
    // (huntTitle through multiTrackDot) uses the fixed dark `color` import
    // rather than this theme-following `colors` param, for the same
    // reason: in Light mode, `colors.text`/`colors.divider` flip to their
    // near-black light-mode values, which would read as invisible against
    // this card's permanently-dark navy.
    huntCard: {
      backgroundColor: withAlpha(colors.accent, 0.14),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
      gap: 12,
      padding: 16,
    },
    huntHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    huntTitle: { fontFamily: font.heading, fontSize: 16, color: colors.text, flex: 1 },
    huntTrack: { height: 44, borderRadius: 8, justifyContent: 'center' },
    huntTrackLine: { height: 1, backgroundColor: colors.divider },
    huntMarker: {
      position: 'absolute',
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      top: 7,
    },
    hunterMarker: { backgroundColor: colors.neutral800 },
    huntedMarker: { backgroundColor: colors.accent800, borderWidth: 1, borderColor: colors.accent },
    huntStatsRow: { gap: 4 },
    huntLead: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    huntLeadSuffix: { fontSize: 13, color: withAlpha(colors.text, 0.65), fontFamily: font.body },
    huntNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    multiTrack: { height: 36, justifyContent: 'center' },
    multiTrackDots: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    multiTrackDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.divider },
    multiPuck: { position: 'absolute', top: 3 },
    multiPuckSpotlight: { borderRadius: 15, borderWidth: 1.5, borderColor: colors.accent, padding: 1.5 },
    multiPuckCaught: { opacity: 0.6 },
    multiPuckStrike: {
      position: 'absolute',
      top: 10,
      left: 0,
      width: 22,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.amber,
    },
    multiHunterPuck: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.amber,
      alignItems: 'center',
      justifyContent: 'center',
    },
    raceCard: { padding: 16, gap: 10 },
    raceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    raceTitle: { fontFamily: font.heading, fontSize: 16, color: colors.text, flex: 1 },
    raceMeta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    bingoMiniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    bingoMiniSquare: {
      width: '31%',
      aspectRatio: 1,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withAlpha(colors.text, 0.15),
      alignItems: 'center',
      justifyContent: 'center',
      padding: 4,
    },
    bingoMiniSquareFilled: { backgroundColor: withAlpha(colors.green, 0.15), borderColor: colors.green },
    bingoMiniLabel: { fontSize: 9.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    bingoMiniLabelFilled: { color: colors.text, fontFamily: font.heading },
    houndMiniCell: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: 7,
      backgroundColor: withAlpha(colors.text, 0.06),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    houndMiniOn: { backgroundColor: withAlpha(colors.accent, 0.35) },
    houndMiniLine: { backgroundColor: withAlpha(colors.gold, 0.35), borderColor: colors.gold },
    houndMiniEmoji: { fontSize: 13 },
    raceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    raceRank: { width: 14, fontSize: 12, color: withAlpha(colors.text, 0.55) },
    raceName: { fontSize: 13.5, color: colors.text, width: 62 },
    raceBarWrap: { flex: 1, minWidth: 0 },
    raceSteps: { fontSize: 12.5, color: colors.text, width: 56, textAlign: 'right' },
  });
}

type HomeStyles = ReturnType<typeof makeStyles>;
