export type ChallengeKind = 'hunt' | 'steps' | 'streak' | 'distance' | 'tag' | 'bingo' | 'tictacgo' | 'seventyfive';

// A hunt has exactly one Hunter and one or more Hunted — never set for
// any other challenge kind. 'zombie' is a one-way transition a Hunted
// participant makes once the Hunter catches them (see
// src/challenges/board.ts's withHuntCatches) — there's no path back to
// 'hunted' once caught.
export type HuntRole = 'hunter' | 'hunted' | 'zombie';

// Only meaningful for kind 'hunt': which real-world signal decides who's
// ahead. 'device_steps' auto-syncs from useHealthProvider() the same way
// a 'steps'-kind challenge does; 'gps_distance' and 'any_workout'
// auto-sync from today's logged workouts (see deviceSync.ts's
// syncChallengeProgressFromDevice for exactly what distinguishes the two).
// 'gps_distance' prefers a real indoor/outdoor signal where the platform
// has one (iOS, via HealthKit's own workout metadata) and falls back to
// approximating it from the workout's name (a run/walk/jog/hike) when it
// doesn't — Android's Health Connect has no such flag today.
export type ScoringMethod = 'gps_distance' | 'any_workout' | 'device_steps';

// Only meaningful for kind 'distance': which number the group's shared
// target is measured in — see Challenge.distanceGoalMi/distanceGoalSteps
// and CreateScreen.tsx's unit picker.
export type DistanceGoalUnit = 'miles' | 'steps';

// Only meaningful for kind 'bingo' — see src/challenges/bingo.ts for what
// this actually changes (which 9 categories the card has, and how its
// classifier works) and CreateScreen.tsx's card-type picker. Lives here
// rather than in bingo.ts itself so that file can import it back from
// types.ts (which every challenges/ file already does) without the two
// importing each other.
export type BingoCardType = 'variety' | 'strength' | 'sports' | 'hound';

export interface Challenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  createdBy: string;
  durationDays: number;
  // The real moment this row was inserted — distinct from startsAt, which
  // the default "Today" create option deliberately backdates to midnight
  // so that day's earlier activity counts (see CreateScreen.tsx's
  // startsAtFor). inviteWindowClosed (board.ts) measures its flat 24h
  // window from this instead, so "24 hours to invite" means 24 real
  // hours from creation regardless of which start option was picked.
  createdAt: string;
  startsAt: string;
  // The challenge's first calendar day ('YYYY-MM-DD'), the same for
  // everyone in their own time zone (0085_challenge_start_day.sql).
  // Optional: rows built without it fall back to startsAt's local day.
  startDay?: string | null;
  endsAt: string;
  dailyGoalSteps: number | null;
  scoringMethod: ScoringMethod | null;
  // Only meaningful for kind 'hunt': how many days the Hunted gets to log
  // alone before the Hunter's own total starts counting toward a catch
  // (see src/challenges/board.ts's withHuntCatches) — null for every
  // other kind, and for a hunt created before this existed.
  headStartDays: number | null;
  // Only meaningful for kind 'distance': the shared target the whole
  // group is trying to cover together, and which unit it's measured in
  // — see toChallengeCard's group-progress stat and
  // ChallengeDetailScreen's "Group progress" card. `distanceGoalUnit`
  // null means "miles" (every pool created before the unit picker
  // existed only ever set distanceGoalMi, in miles); exactly one of
  // distanceGoalMi/distanceGoalSteps is ever set for a given pool.
  distanceGoalMi: number | null;
  distanceGoalSteps: number | null;
  distanceGoalUnit: DistanceGoalUnit | null;
  // Only meaningful for kind 'bingo' — see BingoCardType's own comment.
  // Null means 'variety', the only type that existed before the picker
  // did.
  bingoCardType: BingoCardType | null;
  // Null (every challenge today) means a global/individual challenge,
  // open to any friend regardless of org — see
  // 0037_challenge_org_scope.sql / GitHub issue #158. No screen sets or
  // reads this yet; it exists so a future Create-wizard org/global
  // choice and friend picker have a real column to write to and filter
  // on, not something to fake with client-side-only state.
  organizationId: string | null;
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  initials: string;
  totalSteps: number;
  totalDistanceMi: number;
}

export interface Participant {
  userId: string;
  name: string;
  initials: string;
  role: HuntRole | null;
  // Whether *this* participant has picked this challenge to headline
  // their own Home screen — per-participant, not per-challenge, so two
  // people in the same challenge can highlight different ones.
  highlighted: boolean;
  // This participant's own equipped cosmetics (profiles.equipped_frame_id
  // /equipped_background_id — 0059_cosmetics.sql), straight through to
  // Avatar's own frameId/backgroundId props. Previously only ever read
  // for the signed-in viewer's own avatar (cosmeticsApi.ts) — every other
  // participant rendered with the plain default look regardless of what
  // they actually had equipped (see GitHub issue #229's first fast-follow).
  frameId: string | null;
  backgroundId: string | null;
  // Same as frameId/backgroundId above, for the equipped-icon slot
  // (profiles.equipped_icon_id — 0069_avatar_icon_cosmetics.sql).
  iconId: string | null;
  // Their level, from profiles.xp_total (ranks.ts), for the badge on
  // their avatar.
  level?: number | null;
}

// A bot never signs in and never calls recordProgress() — its steps are
// simulated on read from its id and level (see
// src/challenges/botSimulation.ts), not stored day by day.
export type BotFitnessLevel = 'casual' | 'active' | 'athletic' | 'elite';

export interface ChallengeBot {
  id: string;
  challengeId: string;
  name: string;
  fitnessLevel: BotFitnessLevel;
  role: HuntRole | null;
}

// Game of Tag's own live state — see 0045_tag_game_state.sql. Unlike
// HuntRole, "who's IT" isn't a per-participant flag on Participant
// itself: it's a single rotating pointer for the whole challenge, so
// this is its own type rather than another Participant.role value.
export interface TagRound {
  challengeId: string;
  itUserId: string;
  // Both null until IT actually picks someone — see
  // tagApi.ts's own comment on why only the target's snapshot needs
  // storing, not IT's own.
  targetUserId: string | null;
  targetSnapshotMetric: number | null;
  // When this IT's turn began — TAG_TIME_LIMIT_MINUTES (tagApi.ts)
  // after this, with no catch yet, IT passes to a random other
  // participant regardless of whether a target had even been picked.
  roundStartedAt: string;
}

// An invite to join an existing challenge — separate from friendships:
// there's no durable "connected" state to keep once you're a
// challenge_participants row, unlike a friendship. See
// 0009_challenge_invites.sql.
export interface ChallengeInvite {
  id: string;
  challengeId: string;
  challengeName: string;
  challengeKind: ChallengeKind;
  durationDays: number;
  inviterName: string;
  // Only meaningful for challengeKind 'hunt' — the role the inviter
  // picked for this friend in CreateScreen's "Who's the Hunter?" step
  // (or ChallengeDetailScreen's own "Invite a friend" card, which never
  // offers a role and always leaves this null). Copied onto the new
  // challenge_participants row when accepted — see
  // acceptChallengeInvite.
  role: HuntRole | null;
}

export interface CreateChallengeInput {
  // At least 4 trimmed characters, for every kind — CreateScreen.tsx's
  // own validateName() is what actually stops a caller from getting here
  // with less, backed by a matching check constraint in
  // 0016_challenge_name_min_length.sql for anything that isn't this
  // provider's own client.
  name: string;
  kind: ChallengeKind;
  durationDays: number;
  dailyGoalSteps?: number;
  scoringMethod?: ScoringMethod;
  // Only meaningful for kind 'hunt' — the creator's own role. Exactly one
  // participant across creator + bots should be 'hunter'; the rest that
  // are assigned a role at all should be 'hunted'.
  creatorRole?: HuntRole;
  bots?: { name: string; fitnessLevel: BotFitnessLevel; role?: HuntRole }[];
  // Only meaningful for kind 'hunt' — see Challenge.headStartDays.
  headStartDays?: number;
  // Only meaningful for kind 'distance' — see Challenge.distanceGoalMi /
  // distanceGoalSteps / distanceGoalUnit. Set exactly one of
  // distanceGoalMi/distanceGoalSteps, matching distanceGoalUnit.
  distanceGoalMi?: number;
  distanceGoalSteps?: number;
  distanceGoalUnit?: DistanceGoalUnit;
  // Only meaningful for kind 'bingo' — see Challenge.bingoCardType.
  bingoCardType?: BingoCardType;
  // ISO timestamp for when this challenge actually starts counting real
  // device data from — see CreateScreen.tsx's "Starts" picker for the
  // three choices this ever gets set to (start of today / this exact
  // moment / start of tomorrow) and why each matters differently for a
  // workout-distance challenge (real per-session timestamps to filter
  // on) than a step-count one (the OS only ever reports one cumulative
  // total per calendar day, so "today" and "now" end up identical
  // there). Omitted means "now" — supabaseChallenges.ts's own default,
  // unchanged for any caller that doesn't pass this.
  startsAt?: string;
  // Omitted means a global/individual challenge (today's only behavior)
  // — see Challenge.organizationId. No caller passes this yet.
  organizationId?: string;
}

export interface ChallengesProvider {
  // Raw rows only — screens that need display strings (colors, "day 9 of
  // 21", tint per person) compute them from these via
  // src/challenges/present.ts rather than the provider doing it, so a
  // real backend and the sample-data fallback can share one formatter.
  listMyChallenges(): Promise<Challenge[]>;
  getChallenge(challengeId: string): Promise<Challenge>;
  // Every participant, regardless of whether they've recorded any
  // progress yet — a freshly created challenge has participants (at
  // least its creator) but an empty leaderboard, since nothing calls
  // recordProgress() yet (see README "What's not implemented").
  listParticipants(challengeId: string): Promise<Participant[]>;
  listBots(challengeId: string): Promise<ChallengeBot[]>;
  // `asOfDay` ('YYYY-MM-DD'), when given, sums only progress_snapshots
  // rows on or before that day instead of every row — used to find a
  // Hunter's own total at the exact moment a head start ended (see
  // src/challenges/board.ts's headStartBaselineDayKey/buildBoard), not just
  // their current running total.
  getLeaderboard(challengeId: string, asOfDay?: string): Promise<LeaderboardEntry[]>;
  createChallenge(input: CreateChallengeInput): Promise<Challenge>;
  // `day` ('YYYY-MM-DD') defaults to today when omitted — pass it
  // explicitly to backfill a past day (see ChallengeDetailScreen's
  // syncFromDevice, which backfills every day since the challenge
  // started using real device history instead of only ever writing
  // today's row).
  recordProgress(challengeId: string, steps: number, distanceMi: number, day?: string): Promise<void>;
  // Several days of one challenge in one request (device sync).
  recordProgressDays(challengeId: string, days: { day: string; steps: number; distanceMi: number }[]): Promise<void>;
  // Only the creator can do this — see 0005_challenges_delete_policy.sql.
  // Cascades to that challenge's participants, bots, and progress.
  deleteChallenge(challengeId: string): Promise<void>;
  // The current user's own highlighted challenge (see
  // 0006_challenge_highlight.sql), or null if they haven't highlighted
  // one. HomeScreen uses this instead of always defaulting to whichever
  // challenge was created most recently.
  getHighlightedChallenge(): Promise<Challenge | null>;
  // Only one challenge can be highlighted per user at a time — setting
  // `true` clears any other challenge the current user had highlighted.
  setHighlighted(challengeId: string, highlighted: boolean): Promise<void>;
  // Pending invites addressed to the current user, across every
  // challenge — ChallengesScreen renders one card per invite.
  listMyChallengeInvites(): Promise<ChallengeInvite[]>;
  // Only a current participant of challengeId can call this (see
  // 0009_challenge_invites.sql's insert policy) — inviting someone
  // who isn't your friend still works, this doesn't check friendships.
  // `role` is only meaningful for a 'hunt' challenge — see
  // CreateScreen's "Who's the Hunter?" step, which is the only caller
  // that ever passes one; ChallengeDetailScreen's own "Invite a friend"
  // card omits it, leaving the invite (and the participant row it
  // becomes) roleless, same as before this existed.
  inviteFriendToChallenge(challengeId: string, friendUserId: string, role?: HuntRole): Promise<void>;
  // Every friend the caller has already invited to challengeId who
  // hasn't accepted or declined yet — used to hydrate
  // ChallengeDetailScreen's "Invite a friend" card on load, so a friend
  // invited at creation time (via CreateScreen's "Bring friends" step)
  // or on an earlier visit reads "Remind" from the very first render,
  // not just after tapping "Invite" in this same session.
  listSentChallengeInvites(challengeId: string): Promise<string[]>;
  // Re-sends the invite email for a friend who already has a pending
  // invite — same underlying send-challenge-invite-email call
  // inviteFriendToChallenge's own insert triggers, just fired explicitly
  // instead of right after creating the invite. Unlike that best-effort
  // send, this throws on failure (no pending invite found, or the send
  // itself fails): it's a deliberate "remind them" tap, so silently
  // doing nothing would read as "it worked" when it didn't.
  remindChallengeInvite(challengeId: string, friendUserId: string): Promise<void>;
  // Joins as a real challenge_participants row and removes the invite —
  // there's nothing left to represent once you're a participant.
  acceptChallengeInvite(inviteId: string): Promise<void>;
  declineChallengeInvite(inviteId: string): Promise<void>;
  // Flips the caller's own participant row from 'hunted' to 'zombie' —
  // called automatically once the board shows they've been caught (see
  // withHuntCatches), not something a screen exposes as a button. Only
  // ever touches the caller's own row (see the RLS policy this relies on
  // in 0006_challenge_highlight.sql), so there's no way for the Hunter to
  // catch anyone but themselves through this call — the client only ever
  // calls it for its own signed-in user.
  markCaught(challengeId: string): Promise<void>;
  // Asks the server to record every catch in a hunt
  // (0119_hunt_catches_on_server.sql), so a catch no longer depends on the
  // caught person opening the app. Resolves to how many it recorded, or
  // null when the server can't yet (before 0119 has run).
  applyHuntCatches(challengeId: string): Promise<number | null>;
}
