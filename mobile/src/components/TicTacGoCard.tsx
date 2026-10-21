import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import type { HealthProvider } from '../health/types';
import {
  checkGoal,
  formatTimeLeft,
  goalById,
  TICTACGO_DIFFICULTY_NAME,
  TICTACGO_TURN_HOURS,
  stepsWindowStart,
  turnDeadline,
  workoutWindowStart,
  type TurnActivity,
} from '../challenges/tictacgo';
import { claimTicTacGoSquare, type TicTacGoGame } from '../challenges/tictacgoApi';

function symbolFor(game: TicTacGoGame, userId: string | null): 'X' | 'O' | null {
  if (!userId) return null;
  if (userId === game.xUserId) return 'X';
  if (userId === game.oUserId) return 'O';
  return null;
}

// The 3x3 grid on its own — shared by the full game card below and Home's
// compact preview. `compact` drops the goal labels under claimed marks.
export function TicTacGoBoard({
  game,
  compact,
  readySquares,
  selectedSquare,
  onPressSquare,
}: {
  game: TicTacGoGame;
  compact?: boolean;
  readySquares?: Set<number>;
  selectedSquare?: number | null;
  onPressSquare?: (square: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const markColor = { X: colors.accent, O: colors.amber };

  return (
    <View style={styles.grid}>
      {game.goals.map((goalId, i) => {
        const symbol = symbolFor(game, game.marks[i]);
        const goal = goalById(goalId);
        const winning = game.winningLine?.includes(i) ?? false;
        const ready = readySquares?.has(i) ?? false;
        const selected = selectedSquare === i;
        return (
          <Pressable
            key={i}
            onPress={onPressSquare ? () => onPressSquare(i) : undefined}
            disabled={!onPressSquare}
            style={[
              styles.cell,
              compact && styles.cellCompact,
              symbol && { backgroundColor: withAlpha(markColor[symbol], 0.14) },
              ready && styles.cellReady,
              selected && styles.cellSelected,
              winning && styles.cellWinning,
            ]}
          >
            {symbol ? (
              <>
                <Text style={[styles.mark, compact && styles.markCompact, { color: markColor[symbol] }]}>{symbol}</Text>
                {!compact && (
                  <Text style={styles.cellLabelClaimed} numberOfLines={1}>
                    {goal?.label ?? 'Unknown goal'}
                  </Text>
                )}
              </>
            ) : (
              <>
                {ready && <CheckCircleIcon size={14} color={colors.green} weight="fill" />}
                <Text style={[styles.cellLabel, compact && styles.cellLabelCompact]} numberOfLines={2}>
                  {goal?.label ?? 'Unknown goal'}
                </Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function TicTacGoCard({
  game,
  participants,
  userId,
  health,
  now,
  onChanged,
}: {
  game: TicTacGoGame | null;
  participants: Participant[];
  userId: string | undefined;
  health: HealthProvider;
  now: number;
  onChanged: () => Promise<void> | void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selected, setSelected] = useState<number | null>(null);
  const [activity, setActivity] = useState<TurnActivity | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const turnStart = game?.turnStartedAt ? new Date(game.turnStartedAt) : null;
  const turnBegun = !!turnStart && turnStart.getTime() <= now;
  const myTurn = !!game && game.status === 'active' && !!userId && game.turnUserId === userId && turnBegun;

  // Activity from the game's window (12/24/48h) before this turn began
  // counts, minus what earlier claims used up: steps since this player's
  // last steps square, and any workout already claimed with (0079).
  // Refetched whenever a new turn starts for this player.
  const isX = !!game && userId === game.xUserId;
  const myStepsClaimedAt = !game ? null : isX ? game.xStepsClaimedAt : game.oStepsClaimedAt;
  const myUsedWorkouts = !game ? [] : isX ? game.xUsedWorkouts : game.oUsedWorkouts;
  const windowHours = game?.activityWindowHours ?? 24;
  const workoutsSince = myTurn && game?.turnStartedAt ? workoutWindowStart(game.turnStartedAt, windowHours) : null;
  const stepsSince =
    myTurn && game?.turnStartedAt ? stepsWindowStart(game.turnStartedAt, windowHours, myStepsClaimedAt) : null;
  const activityKey =
    workoutsSince && stepsSince ? `${workoutsSince.toISOString()}|${stepsSince.toISOString()}|${myUsedWorkouts.join(',')}` : null;
  useEffect(() => {
    if (!activityKey || !workoutsSince || !stepsSince) {
      setActivity(null);
      return;
    }
    let cancelled = false;
    const used = new Set(myUsedWorkouts);
    setLoadingActivity(true);
    // Sample data can't claim a square.
    const sample = health.platform === 'mock';
    Promise.all([
      sample ? Promise.resolve(0) : health.getStepsSince(stepsSince).catch(() => 0),
      sample ? Promise.resolve([]) : health.getRecentWorkouts(50).catch(() => []),
    ])
      .then(([steps, workouts]) => {
        if (!cancelled) {
          setActivity({ steps, workouts: workouts.filter((w) => w.when >= workoutsSince && !used.has(w.id)) });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingActivity(false);
      });
    return () => {
      cancelled = true;
    };
    // activityKey covers every input above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityKey, health]);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Tic-Tac-Go</Text>
        <Text style={styles.footNote}>This game&rsquo;s board was never set up. Delete it and start a new one.</Text>
      </Card>
    );
  }

  const nameOf = (id: string | null) => {
    if (!id) return 'Someone';
    if (id === userId) return 'You';
    return participants.find((p) => p.userId === id)?.name ?? 'Your opponent';
  };

  const readySquares = new Set<number>();
  if (myTurn && activity) {
    game.goals.forEach((goalId, i) => {
      const goal = goalById(goalId);
      if (!game.marks[i] && goal && checkGoal(goal, activity).met) readySquares.add(i);
    });
  }

  const timeLeft = turnStart ? formatTimeLeft(turnDeadline(turnStart.toISOString()), now) : '';
  let status: string;
  if (game.status === 'waiting') {
    status = 'Waiting for your opponent to accept. A coin flip decides who goes first when they join.';
  } else if (game.status === 'won') {
    status = game.winnerUserId === userId ? 'You won with three in a row!' : `${nameOf(game.winnerUserId)} won with three in a row.`;
  } else if (game.status === 'draw') {
    status = game.endedReason === 'time_up' ? 'Time ran out — it’s a draw.' : 'The board filled up — it’s a draw.';
  } else if (!turnBegun) {
    status = `The game starts ${turnStart?.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`;
  } else if (myTurn) {
    const fmt = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const stepsNote =
      stepsSince && workoutsSince && stepsSince.getTime() > workoutsSince.getTime()
        ? ` (steps since ${fmt(stepsSince)}, your last steps square)`
        : '';
    status = `Your move — ${timeLeft}. Activity since ${fmt(workoutsSince!)} counts${stepsNote} — claim one square whose goal you’ve met.`;
  } else {
    status = `${nameOf(game.turnUserId)}’s move — ${timeLeft}.`;
  }

  const claim = async (square: number) => {
    setClaiming(true);
    setClaimError(null);
    try {
      const goal = goalById(game.goals[square]);
      const used = goal && activity ? checkGoal(goal, activity).workoutId : null;
      await claimTicTacGoSquare(game, square, used);
      setSelected(null);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Could not claim that square — try again.');
    } finally {
      setClaiming(false);
      // Refresh either way: a failed claim often means the turn just
      // passed or the square was just taken.
      await onChanged();
    }
  };

  const selectedGoal = selected !== null ? goalById(game.goals[selected]) : null;
  const selectedMark = selected !== null ? game.marks[selected] : null;
  const selectedCheck = selectedGoal && activity ? checkGoal(selectedGoal, activity) : null;
  const gameOver = game.status === 'won' || game.status === 'draw';

  const players = [
    { id: game.xUserId, symbol: 'X' as const },
    { id: game.oUserId, symbol: 'O' as const },
  ];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.headerRow}>
        <Text style={text.h4}>Tic-Tac-Go</Text>
        <Text style={styles.difficulty}>{TICTACGO_DIFFICULTY_NAME[game.difficulty]}</Text>
      </View>

      {game.status !== 'waiting' && (
        <View style={styles.playersRow}>
          {players.map(({ id, symbol }) => (
            <View key={symbol} style={[styles.playerChip, game.turnUserId === id && !gameOver && styles.playerChipTurn]}>
              <Text style={[styles.playerSymbol, { color: symbol === 'X' ? colors.accent : colors.amber }]}>{symbol}</Text>
              <Text style={styles.playerName} numberOfLines={1}>
                {nameOf(id)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.status, game.status === 'won' && game.winnerUserId === userId && { color: colors.green }]}>{status}</Text>

      <TicTacGoBoard
        game={game}
        readySquares={readySquares}
        selectedSquare={selected}
        onPressSquare={(i) => {
          setClaimError(null);
          setSelected((cur) => (cur === i ? null : i));
        }}
      />

      {myTurn && loadingActivity && (
        <View style={styles.checkingRow}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.footNote}>Checking your activity since your turn started…</Text>
        </View>
      )}

      {selected !== null && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{selectedGoal?.label ?? 'Unknown goal'}</Text>
          <Text style={styles.footNote}>{selectedGoal?.detail ?? 'This square needs a newer version of Hound.'}</Text>
          {selectedMark ? (
            <Text style={styles.footNote}>
              Claimed by {nameOf(selectedMark)} ({symbolFor(game, selectedMark)}).
            </Text>
          ) : gameOver ? null : game.status === 'waiting' ? (
            <Text style={styles.footNote}>The game starts when your opponent joins.</Text>
          ) : myTurn ? (
            <>
              <Text style={[styles.footNote, selectedCheck?.met && { color: colors.green }]}>
                {selectedCheck ? selectedCheck.status : 'Checking your activity…'}
              </Text>
              {claimError && <Text style={styles.error}>{claimError}</Text>}
              <Button
                label={claiming ? 'Claiming…' : 'Claim this square'}
                variant="primary"
                block
                disabled={claiming || !selectedCheck?.met}
                onPress={() => claim(selected)}
              />
            </>
          ) : (
            <Text style={styles.footNote}>You can go for this square on your turn.</Text>
          )}
        </View>
      )}

      <Text style={styles.footNote}>
        On your turn, claim one open square whose goal you&rsquo;ve met. Activity from the {game.activityWindowHours} hours
        before your turn started counts too. Each workout can claim only one square, and a steps square uses up the
        steps behind it. Three in a row wins. You get {TICTACGO_TURN_HOURS} hours per turn, or the turn passes.
      </Text>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    difficulty: { fontSize: 12.5, fontFamily: font.heading, color: colors.accent },
    playersRow: { flexDirection: 'row', gap: 8 },
    playerChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    playerChipTurn: { borderColor: colors.accent, borderWidth: 1.5 },
    playerSymbol: { fontFamily: font.heading, fontSize: 18 },
    playerName: { flex: 1, fontSize: 14, color: colors.text },
    status: { fontSize: 14, color: colors.text, lineHeight: 20 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    cell: {
      width: '31.5%',
      aspectRatio: 1,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: withAlpha(colors.text, 0.04),
      alignItems: 'center',
      justifyContent: 'center',
      padding: 6,
      gap: 4,
    },
    cellCompact: { borderRadius: 8, padding: 3, gap: 0 },
    cellReady: { borderColor: colors.green, borderWidth: 1.5 },
    cellSelected: { borderColor: colors.accent, borderWidth: 2 },
    cellWinning: { borderColor: colors.green, borderWidth: 2.5 },
    // includeFontPadding off: Android otherwise adds space above the text,
    // which pushes a label below the middle of its square.
    cellLabel: {
      width: '100%',
      fontSize: 12.5,
      textAlign: 'center',
      textAlignVertical: 'center',
      includeFontPadding: false,
      color: colors.text,
      fontFamily: font.heading,
    },
    cellLabelCompact: { fontSize: 10.5, fontFamily: font.body },
    cellLabelClaimed: { fontSize: 10.5, textAlign: 'center', color: withAlpha(colors.text, 0.5) },
    mark: { fontFamily: font.heading, fontSize: 34, lineHeight: 38 },
    markCompact: { fontSize: 22, lineHeight: 26 },
    checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    panel: {
      gap: 8,
      padding: 12,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.accent, 0.08),
    },
    panelTitle: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    error: { fontSize: 12.5, color: colors.amber },
  });
}
