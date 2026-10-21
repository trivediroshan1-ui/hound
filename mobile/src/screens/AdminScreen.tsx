import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeftIcon,
  CaretRightIcon,
  GlobeHemisphereWestIcon,
  HandshakeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RadioPill, ToggleRow } from '../components/Selectable';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useLabels } from '../labels/LabelsContext';
import { getHuntLabels, setHuntLabels } from '../labels/supabaseLabels';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from '../labels/types';
import { getTotalUserCount, searchUsers, type AdminUserSummary } from '../admin/adminApi';
import { getAppBanner, setAppBanner, type AppBanner } from '../banner/supabaseBanner';
import { CHALLENGE_TYPES, type ChallengeKind } from '../data/sampleData';
import { huntKindName } from '../challenges/present';
import { AppVersionsCard } from '../components/AppVersionsCard';
import { GoalsAdminCard } from '../components/GoalsAdminCard';
import { EngagementAdminCard } from '../components/EngagementAdminCard';
import { AdsAdminCard } from '../components/AdsAdminCard';
import { PushReachCard } from '../components/PushReachCard';
import { SignupAlertsCard } from '../components/SignupAlertsCard';
import { FindPeopleAdminCard } from '../components/FindPeopleAdminCard';
import { TrashTalkAdminCard } from '../components/TrashTalkAdminCard';
import { FairPlayAdminCard } from '../components/FairPlayAdminCard';
import {
  listChallengeUnlockGates,
  removeChallengeUnlockGate,
  setChallengeUnlockGate,
  type ChallengeUnlockGates,
} from '../challenges/unlockGatesApi';
import { getDailyBonusConfig, setDailyBonusConfig } from '../bones/dailyBonusApi';
import { getGoalRewardConfig, setGoalRewardConfig } from '../goals/goalStreakApi';
import {
  deleteGlobalChallenge,
  globalTimingLine,
  getSponsorClickCounts,
  listGlobalChallenges,
  setChallengeSponsor,
  type GlobalChallenge,
  type SponsorClicks,
} from '../challenges/globalChallenges';
import { CHALLENGE_KIND_ICON, DEFAULT_CHALLENGE_ICON } from '../data/challengeIcons';

// Reachable only via TopNav's own admin icon, which is itself only
// rendered for user?.isAdmin — but that's a UI convenience, not real
// enforcement (0021_admin_flag.sql's own column-level revoke is), so
// this still checks for itself rather than trusting it never gets
// navigated to some other way. Every card this screen grows should be
// backed by its own admin-gated RLS policy the same way Chase labels is
// (0022_admin_gate_app_labels.sql) — this check is belt, that's braces.
export function AdminScreen({
  onBack,
  onOpenUser,
  onNewGlobalChallenge,
}: {
  onBack: () => void;
  onOpenUser: (user: AdminUserSummary) => void;
  onNewGlobalChallenge: () => void;
}) {
  const { user } = useAuth();
  const { text, colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The raw app-wide default, fetched and saved directly rather than via
  // useLabels() — that context's own labelsForOrg() resolves a SPECIFIC
  // challenge's own words (org override if that challenge has one, see
  // LabelsContext.tsx), which isn't what this card edits. This still
  // calls that context's refresh() after saving, which clears its
  // cached org lookups too, so any screen showing a global challenge
  // picks up the change without restarting the app.
  const { refresh: refreshEffectiveLabels } = useLabels();
  const [globalLabels, setGlobalLabels] = useState<HuntLabels>(DEFAULT_HUNT_LABELS);

  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUserSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runSearch = useCallback((q: string) => {
    setSearching(true);
    setSearchError(null);
    searchUsers(q)
      .then(setResults)
      .catch((e) => setSearchError(e instanceof Error ? e.message : 'Could not load users.'))
      .finally(() => setSearching(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      getTotalUserCount().then(setTotalUsers).catch(() => {});
      runSearch(query);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.isAdmin]),
  );

  // Debounced rather than firing on every keystroke — profiles.select is
  // open to any signed-in user, but there's no reason to hit it that
  // often while someone's still typing a name.
  useEffect(() => {
    if (!user?.isAdmin) return;
    const t = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Global Hound Challenges (0075_global_challenges.sql) — every one
  // ever published, newest first, reloaded on focus so one just
  // published from the Create wizard shows up on return.
  const [globalChallenges, setGlobalChallenges] = useState<GlobalChallenge[] | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  // Taps on each sponsored one's link (0111_sponsored_challenges.sql).
  const [sponsorClicks, setSponsorClicks] = useState<Map<string, SponsorClicks>>(new Map());
  const loadGlobal = useCallback(() => {
    listGlobalChallenges(true)
      .then((list) => {
        setGlobalChallenges(list);
        setGlobalError(null);
        return getSponsorClickCounts(list.filter((c) => c.sponsor).map((c) => c.id)).then(setSponsorClicks);
      })
      .catch((e) => setGlobalError(e instanceof Error ? e.message : 'Could not load global challenges.'));
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      loadGlobal();
    }, [user?.isAdmin, loadGlobal]),
  );
  // Its sponsor (0111_sponsored_challenges.sql), edited in place: one
  // challenge at a time. A blank name takes the sponsor off.
  const [sponsorFor, setSponsorFor] = useState<string | null>(null);
  const [sponsorDraft, setSponsorDraft] = useState({ name: '', message: '', url: '' });
  const [savingSponsor, setSavingSponsor] = useState(false);
  const editSponsor = (c: GlobalChallenge) => {
    setSponsorFor(c.id);
    setSponsorDraft({ name: c.sponsor?.name ?? '', message: c.sponsor?.message ?? '', url: c.sponsor?.url ?? '' });
  };
  const saveSponsor = (c: GlobalChallenge) => {
    const name = sponsorDraft.name.trim();
    setSavingSponsor(true);
    setChallengeSponsor(
      c.id,
      name ? { name, message: sponsorDraft.message.trim() || null, url: sponsorDraft.url.trim() || null } : null,
    )
      .then(() => {
        setSponsorFor(null);
        loadGlobal();
      })
      .catch((e) => Alert.alert('Couldn’t save the sponsor', e instanceof Error ? e.message : 'Try again.'))
      .finally(() => setSavingSponsor(false));
  };
  const confirmTakeDown = (c: GlobalChallenge) => {
    Alert.alert(
      `Take down “${c.name}”?`,
      c.participantCount > 0
        ? `It disappears for everyone, along with the progress of the ${c.participantCount} ${c.participantCount === 1 ? 'person' : 'people'} in it. This can’t be undone.`
        : 'It disappears from everyone’s Today screen. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Take down',
          style: 'destructive',
          onPress: () => {
            deleteGlobalChallenge(c.id)
              .then(loadGlobal)
              .catch((e) => setGlobalError(e instanceof Error ? e.message : 'Could not take that down.'));
          },
        },
      ],
    );
  };

  const [hunterInput, setHunterInput] = useState(globalLabels.hunter);
  const [huntedInput, setHuntedInput] = useState(globalLabels.hunted);
  const [zombieInput, setZombieInput] = useState(globalLabels.zombie);
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsSaved, setLabelsSaved] = useState(false);

  useEffect(() => {
    setHunterInput(globalLabels.hunter);
    setHuntedInput(globalLabels.hunted);
    setZombieInput(globalLabels.zombie);
  }, [globalLabels]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      getHuntLabels()
        .then(setGlobalLabels)
        .catch(() => {
          // Same "quietly stay on whatever's already showing" convention
          // as LabelsContext's own refresh().
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.isAdmin]),
  );

  // How long a saved banner stays up from the moment it's saved — not a
  // scheduling tool (see 0050_app_banner.sql's own comment), just "for
  // this long from now." null means no expiry at all.
  const BANNER_DURATIONS: { label: string; ms: number | null }[] = [
    { label: '1 hour', ms: 60 * 60 * 1000 },
    { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
    { label: '1 day', ms: 24 * 60 * 60 * 1000 },
    { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
    { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
    { label: 'No expiry', ms: null },
  ];

  const [currentBanner, setCurrentBanner] = useState<AppBanner | null>(null);
  const [bannerMessage, setBannerMessage] = useState('');
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerDurationIdx, setBannerDurationIdx] = useState(2); // '1 day'
  const [savingBanner, setSavingBanner] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSaved, setBannerSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      getAppBanner()
        .then((b) => {
          setCurrentBanner(b);
          setBannerMessage(b.message);
          setBannerEnabled(b.enabled);
        })
        .catch(() => {
          // Same "quietly stay on whatever's already showing" convention
          // as this screen's own Chase labels load.
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.isAdmin]),
  );

  const saveBanner = async () => {
    const message = bannerMessage.trim();
    if (!message) {
      setBannerError('The banner needs some text.');
      return;
    }
    setBannerError(null);
    setBannerSaved(false);
    setSavingBanner(true);
    try {
      const ms = BANNER_DURATIONS[bannerDurationIdx].ms;
      const expiresAt = ms === null ? null : new Date(Date.now() + ms).toISOString();
      await setAppBanner({ message, enabled: bannerEnabled, expiresAt });
      const updated = await getAppBanner();
      setCurrentBanner(updated);
      setBannerSaved(true);
    } catch (e) {
      setBannerError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingBanner(false);
    }
  };

  const submitLabels = async (next: { hunter: string; hunted: string; zombie: string }) => {
    const hunter = next.hunter.trim();
    const hunted = next.hunted.trim();
    const zombie = next.zombie.trim();
    if (!hunter || !hunted || !zombie) {
      setLabelsError('All three labels need at least one character.');
      return;
    }
    setLabelsError(null);
    setLabelsSaved(false);
    setSavingLabels(true);
    try {
      await setHuntLabels({ hunter, hunted, zombie });
      setGlobalLabels({ hunter, hunted, zombie });
      await refreshEffectiveLabels();
      setLabelsSaved(true);
    } catch (e) {
      setLabelsError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingLabels(false);
    }
  };

  // Which challenge kinds require Bones earned through play to unlock in
  // CreateScreen's picker, and how much (challenge_unlock_gates,
  // 0067_challenge_unlock_gates.sql). savedGates is what the server last
  // confirmed; gatedKinds/gateBonesInput are this card's own draft,
  // diffed against savedGates on Save rather than writing on every
  // toggle — same "edit freely, one Save button" shape as Chase labels
  // and the banner above.
  const [savedGates, setSavedGates] = useState<ChallengeUnlockGates>({});
  const [gatedKinds, setGatedKinds] = useState<Set<ChallengeKind>>(new Set());
  const [gateBonesInput, setGateBonesInput] = useState<Record<ChallengeKind, string>>(
    () => Object.fromEntries(CHALLENGE_TYPES.map((t) => [t.id, ''])) as Record<ChallengeKind, string>,
  );
  const [savingGates, setSavingGates] = useState(false);
  const [gatesError, setGatesError] = useState<string | null>(null);
  const [gatesSaved, setGatesSaved] = useState(false);

  const applyLoadedGates = (gates: ChallengeUnlockGates) => {
    setSavedGates(gates);
    setGatedKinds(new Set(Object.keys(gates) as ChallengeKind[]));
    setGateBonesInput(
      Object.fromEntries(
        CHALLENGE_TYPES.map((t) => [t.id, gates[t.id] !== undefined ? String(gates[t.id]) : '']),
      ) as Record<ChallengeKind, string>,
    );
  };

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      listChallengeUnlockGates()
        .then(applyLoadedGates)
        .catch(() => {
          // Same "quietly stay on whatever's already showing" convention
          // as this screen's other real-data fetches.
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.isAdmin]),
  );

  const toggleGateKind = (kind: ChallengeKind) => {
    setGatesSaved(false);
    setGatedKinds((cur) => {
      const next = new Set(cur);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const saveGates = async () => {
    setGatesError(null);
    setGatesSaved(false);
    const toSet: [ChallengeKind, number][] = [];
    const toRemove: ChallengeKind[] = [];
    for (const t of CHALLENGE_TYPES) {
      const isGated = gatedKinds.has(t.id);
      const wasGated = savedGates[t.id] !== undefined;
      if (isGated) {
        const n = Number(gateBonesInput[t.id]);
        if (!Number.isFinite(n) || n <= 0) {
          setGatesError(`Enter a positive Bones amount for ${t.id === 'hunt' ? huntKindName() : t.name}.`);
          return;
        }
        if (!wasGated || savedGates[t.id] !== n) toSet.push([t.id, n]);
      } else if (wasGated) {
        toRemove.push(t.id);
      }
    }
    setSavingGates(true);
    try {
      await Promise.all([
        ...toSet.map(([kind, bones]) => setChallengeUnlockGate(kind, bones)),
        ...toRemove.map((kind) => removeChallengeUnlockGate(kind)),
      ]);
      const updated = await listChallengeUnlockGates();
      applyLoadedGates(updated);
      setGatesSaved(true);
    } catch (e) {
      setGatesError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingGates(false);
    }
  };

  // The daily open bonus amounts (daily_bonus_config, 0070_daily_bonus.sql)
  // — takes effect on everyone's next claim, no code change or OTA.
  const [bonusDailyInput, setBonusDailyInput] = useState('');
  const [bonusWeeklyInput, setBonusWeeklyInput] = useState('');
  const [savingBonus, setSavingBonus] = useState(false);
  const [bonusError, setBonusError] = useState<string | null>(null);
  const [bonusSaved, setBonusSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      getDailyBonusConfig()
        .then((c) => {
          setBonusDailyInput(String(c.dailyBones));
          setBonusWeeklyInput(String(c.weeklyBones));
        })
        .catch(() => {
          // Same "quietly stay on whatever's already showing" convention
          // as this screen's other real-data fetches.
        });
    }, [user?.isAdmin]),
  );

  const saveBonus = async () => {
    const dailyBones = Number(bonusDailyInput);
    const weeklyBones = Number(bonusWeeklyInput);
    if (!Number.isInteger(dailyBones) || dailyBones < 1 || !Number.isInteger(weeklyBones) || weeklyBones < 1) {
      setBonusError('Both amounts need to be whole numbers of at least 1.');
      return;
    }
    setBonusError(null);
    setBonusSaved(false);
    setSavingBonus(true);
    try {
      await setDailyBonusConfig({ dailyBones, weeklyBones });
      setBonusSaved(true);
    } catch (e) {
      setBonusError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingBonus(false);
    }
  };

  // What hitting your goals pays (goal_reward_config,
  // 0099_goal_streaks.sql): the same kind of form as the daily bonus.
  const [goalDayInput, setGoalDayInput] = useState('');
  const [goalStreakInput, setGoalStreakInput] = useState('');
  const [goalWeekInput, setGoalWeekInput] = useState('');
  const [shieldInput, setShieldInput] = useState('');
  const [savingGoalRewards, setSavingGoalRewards] = useState(false);
  const [goalRewardsError, setGoalRewardsError] = useState<string | null>(null);
  const [goalRewardsSaved, setGoalRewardsSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user?.isAdmin) return;
      getGoalRewardConfig()
        .then((c) => {
          setGoalDayInput(String(c.dayBones));
          setGoalStreakInput(String(c.streakBones));
          setGoalWeekInput(String(c.weekBones));
          setShieldInput(String(c.shieldBones));
        })
        .catch(() => {});
    }, [user?.isAdmin]),
  );

  const saveGoalRewards = async () => {
    const amounts = [goalDayInput, goalStreakInput, goalWeekInput, shieldInput].map(Number);
    if (amounts.some((n) => !Number.isInteger(n) || n < 1)) {
      setGoalRewardsError('All four amounts need to be whole numbers of at least 1.');
      return;
    }
    const [dayBones, streakBones, weekBones, shieldBones] = amounts;
    setGoalRewardsError(null);
    setGoalRewardsSaved(false);
    setSavingGoalRewards(true);
    try {
      await setGoalRewardConfig({ dayBones, streakBones, weekBones, shieldBones });
      setGoalRewardsSaved(true);
    } catch (e) {
      setGoalRewardsError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSavingGoalRewards(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <Text style={text.h2}>Admin</Text>

        {!user?.isAdmin ? (
          <Text style={styles.footNote}>This page is for admins only.</Text>
        ) : (
          <>
            <Card style={{ gap: 12 }} elevated={false}>
              <View style={styles.directoryHeader}>
                <Text style={text.h4}>Global challenges</Text>
                <GlobeHemisphereWestIcon size={18} color={colors.accent} />
              </View>
              <Text style={styles.footNote}>
                Challenges open to everyone, shown on Today under Global Hound Challenges. Anyone can join until
                joining closes.
              </Text>
              {globalChallenges === null && !globalError ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                (globalChallenges ?? []).map((c) => {
                  const KindIcon = CHALLENGE_KIND_ICON[c.kind] ?? DEFAULT_CHALLENGE_ICON;
                  const ended = Date.now() >= new Date(c.endsAt).getTime();
                  return (
                    <View key={c.id} style={{ gap: 8 }}>
                      <View style={styles.userRow}>
                        <KindIcon size={18} color={withAlpha(colors.text, ended ? 0.4 : 0.8)} />
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={[styles.userName, ended && { color: withAlpha(colors.text, 0.5) }]} numberOfLines={1}>
                            {c.name}
                          </Text>
                          <Text style={styles.footNote}>
                            {globalTimingLine(c)} · {c.durationDays} days · {c.participantCount} joined
                          </Text>
                          {c.sponsor && <Text style={styles.footNote}>Sponsored by {c.sponsor.name}</Text>}
                          {c.sponsor?.url && <Text style={styles.footNote}>{sponsorClicksLine(sponsorClicks.get(c.id))}</Text>}
                        </View>
                        {!ended && (
                          <Pressable
                            onPress={() => (sponsorFor === c.id ? setSponsorFor(null) : editSponsor(c))}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Sponsor for ${c.name}`}
                          >
                            <HandshakeIcon size={17} color={c.sponsor ? colors.accent : withAlpha(colors.text, 0.5)} />
                          </Pressable>
                        )}
                        <Pressable
                          onPress={() => confirmTakeDown(c)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Take down ${c.name}`}
                        >
                          <TrashIcon size={17} color={withAlpha(colors.text, 0.5)} />
                        </Pressable>
                      </View>
                      {sponsorFor === c.id && (
                        <View style={{ gap: 8 }}>
                          <TextField
                            label="Sponsor name"
                            value={sponsorDraft.name}
                            onChangeText={(name) => setSponsorDraft((d) => ({ ...d, name }))}
                            placeholder="Blank takes the sponsor off"
                            maxLength={40}
                          />
                          <TextField
                            label="Message"
                            value={sponsorDraft.message}
                            onChangeText={(message) => setSponsorDraft((d) => ({ ...d, message }))}
                            placeholder="e.g. Winner gets a $50 gift card"
                            maxLength={100}
                          />
                          <TextField
                            label="Link"
                            value={sponsorDraft.url}
                            onChangeText={(url) => setSponsorDraft((d) => ({ ...d, url }))}
                            placeholder="https://"
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            maxLength={200}
                          />
                          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                            <Button label="Cancel" variant="ghost" small onPress={() => setSponsorFor(null)} />
                            <Button
                              label={savingSponsor ? 'Saving…' : 'Save sponsor'}
                              variant="primary"
                              small
                              disabled={savingSponsor}
                              onPress={() => saveSponsor(c)}
                            />
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
              {globalChallenges?.length === 0 && <Text style={styles.footNote}>None published yet.</Text>}
              {globalError && <Text style={styles.loadError}>{globalError}</Text>}
              <Button
                label="New global challenge"
                variant="primary"
                icon={<PlusIcon size={13} color={colors.accent} />}
                onPress={onNewGlobalChallenge}
              />
            </Card>

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Home banner</Text>
              <Text style={styles.footNote}>
                An announcement shown at the top of everyone&rsquo;s Home screen &mdash; dismissible with the small
                &times; there, or it clears itself once its timeframe runs out. Use {'{version}'} anywhere to
                interpolate the reader&rsquo;s own installed version, or wrap the whole message in{' '}
                {'{if version=X}...{elseif version=Y}...{else}...{/if}'} to show a different message per version
                (any number of {'{elseif}'} branches, {'{else}'} optional).
              </Text>
              <TextField
                label="Message"
                value={bannerMessage}
                onChangeText={setBannerMessage}
                placeholder="e.g. Scheduled maintenance Sunday 2-4pm"
                multiline
                numberOfLines={3}
              />
              <ToggleRow
                label="Show this banner"
                note="Visible to every signed-in user"
                value={bannerEnabled}
                onChange={setBannerEnabled}
              />
              <Text style={styles.footNote}>Visible for, starting now</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {BANNER_DURATIONS.map((d, i) => (
                  <RadioPill key={d.label} label={d.label} selected={bannerDurationIdx === i} onPress={() => setBannerDurationIdx(i)} />
                ))}
              </View>
              {currentBanner?.enabled && (
                <Text style={styles.footNote}>
                  Currently live
                  {currentBanner.expiresAt ? ` until ${new Date(currentBanner.expiresAt).toLocaleString()}` : ' (no expiry)'}.
                </Text>
              )}
              {bannerError && <Text style={styles.loadError}>{bannerError}</Text>}
              {bannerSaved && !bannerError && <Text style={styles.successNote}>Saved.</Text>}
              <Button
                label={savingBanner ? 'Saving…' : 'Save'}
                variant="primary"
                disabled={savingBanner || !bannerMessage.trim()}
                onPress={saveBanner}
              />
            </Card>

            <Card style={{ gap: 12 }} elevated={false}>
              <View style={styles.directoryHeader}>
                <Text style={text.h4}>User directory</Text>
                {totalUsers !== null && <Text style={styles.footNote}>{totalUsers} registered</Text>}
              </View>
              <TextField
                label="Search"
                value={query}
                onChangeText={setQuery}
                placeholder="Name or email"
                icon={<MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />}
                autoCapitalize="none"
              />
              {searchError && <Text style={styles.loadError}>{searchError}</Text>}
              {searching && results.length === 0 ? (
                <ActivityIndicator color={colors.accent} />
              ) : results.length === 0 ? (
                <Text style={styles.footNote}>No users match that search.</Text>
              ) : (
                // Fixed to roughly 10 rows tall so a long directory (up
                // to searchUsers' own 25-row server cap) doesn't push
                // the rest of this screen's cards further and further
                // down — scroll within the box to see the rest instead.
                <ScrollView style={styles.directoryScroll} nestedScrollEnabled>
                  {results.map((u) => (
                    <Pressable key={u.id} onPress={() => onOpenUser(u)} style={styles.userRow}>
                      <Avatar
                        initials={u.displayInitials}
                        tint={TINT_A}
                        size={34}
                        fontSize={12}
                        frameId={u.frameId}
                        backgroundId={u.backgroundId}
                        iconId={u.iconId}
                      />
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={styles.userName}>
                          {u.displayName}
                          {u.isAdmin ? ' · Admin' : ''}
                        </Text>
                        <Text style={styles.footNote}>{u.email}</Text>
                      </View>
                      <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </Card>

            <EngagementAdminCard />

            <AppVersionsCard />

            <GoalsAdminCard />

            <PushReachCard />

            <SignupAlertsCard />

            <FindPeopleAdminCard />

            <TrashTalkAdminCard />
            <FairPlayAdminCard />

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Chase labels</Text>
              <Text style={styles.footNote}>
                What a chase&rsquo;s three roles are called, app-wide. This is the default for anyone not in an
                organization with its own override &mdash; manage a specific organization&rsquo;s labels from its own page
                instead (see the organization icon in the top bar).
              </Text>
              <TextField label="Hound" value={hunterInput} onChangeText={setHunterInput} placeholder={DEFAULT_HUNT_LABELS.hunter} />
              <TextField label="Fox" value={huntedInput} onChangeText={setHuntedInput} placeholder={DEFAULT_HUNT_LABELS.hunted} />
              <TextField label="Out" value={zombieInput} onChangeText={setZombieInput} placeholder={DEFAULT_HUNT_LABELS.zombie} />
              {labelsError && <Text style={styles.loadError}>{labelsError}</Text>}
              {labelsSaved && !labelsError && <Text style={styles.successNote}>Saved — updated everywhere.</Text>}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  label={savingLabels ? 'Saving…' : 'Save'}
                  variant="primary"
                  disabled={savingLabels}
                  onPress={() => submitLabels({ hunter: hunterInput, hunted: huntedInput, zombie: zombieInput })}
                />
                <Button label="Reset to default" disabled={savingLabels} onPress={() => submitLabels(DEFAULT_HUNT_LABELS)} />
              </View>
            </Card>

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Daily bonus</Text>
              <Text style={styles.footNote}>
                What opening the app once a day pays. Every 7th day in a row pays the weekly amount instead; missing a
                day starts the streak over. Changes apply to everyone&rsquo;s next claim. Daily bonus Bones never count
                toward challenge unlocks.
              </Text>
              <TextField
                label="Each day"
                value={bonusDailyInput}
                onChangeText={(v) => {
                  setBonusDailyInput(v);
                  setBonusSaved(false);
                }}
                placeholder="e.g. 1"
                keyboardType="number-pad"
              />
              <TextField
                label="Every 7th day"
                value={bonusWeeklyInput}
                onChangeText={(v) => {
                  setBonusWeeklyInput(v);
                  setBonusSaved(false);
                }}
                placeholder="e.g. 25"
                keyboardType="number-pad"
              />
              {bonusError && <Text style={styles.loadError}>{bonusError}</Text>}
              {bonusSaved && !bonusError && <Text style={styles.successNote}>Saved.</Text>}
              <Button label={savingBonus ? 'Saving…' : 'Save'} variant="primary" disabled={savingBonus} onPress={saveBonus} />
            </Card>

            <AdsAdminCard />

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Goal rewards</Text>
              <Text style={styles.footNote}>
                What hitting your goals pays. A goal day is every daily goal done; every 7th goal day in a row pays the
                streak amount instead. A goal week is every weekly goal done, paid once a week. A Streak Shield is
                what players pay to cover one missed day. Changes apply to everyone&rsquo;s next claim. These Bones
                never count toward challenge unlocks.
              </Text>
              {(
                [
                  ['Each goal day', goalDayInput, setGoalDayInput, 'e.g. 5'],
                  ['Every 7th goal day in a row', goalStreakInput, setGoalStreakInput, 'e.g. 25'],
                  ['Each goal week', goalWeekInput, setGoalWeekInput, 'e.g. 15'],
                  ['Streak Shield price', shieldInput, setShieldInput, 'e.g. 50'],
                ] as const
              ).map(([label, value, set, placeholder]) => (
                <TextField
                  key={label}
                  label={label}
                  value={value}
                  onChangeText={(v) => {
                    set(v);
                    setGoalRewardsSaved(false);
                  }}
                  placeholder={placeholder}
                  keyboardType="number-pad"
                />
              ))}
              {goalRewardsError && <Text style={styles.loadError}>{goalRewardsError}</Text>}
              {goalRewardsSaved && !goalRewardsError && <Text style={styles.successNote}>Saved.</Text>}
              <Button
                label={savingGoalRewards ? 'Saving…' : 'Save'}
                variant="primary"
                disabled={savingGoalRewards}
                onPress={saveGoalRewards}
              />
            </Card>

            <Card style={{ gap: 12 }} elevated={false}>
              <Text style={text.h4}>Challenge unlocks</Text>
              <Text style={styles.footNote}>
                Gate a challenge kind behind Bones earned through play, so new players meet the core loop first
                and unlock the rest as a reward for sticking around &mdash; a real-money Bones purchase never
                counts toward this. Leave a kind unchecked to keep it always available.
              </Text>
              <View style={{ gap: 12 }}>
                {CHALLENGE_TYPES.map((t) => {
                  const gated = gatedKinds.has(t.id);
                  return (
                    <View key={t.id} style={{ gap: 8 }}>
                      <ToggleRow
                        label={t.id === 'hunt' ? huntKindName() : t.name}
                        note={gated ? 'Gated' : 'Always available'}
                        value={gated}
                        onChange={() => toggleGateKind(t.id)}
                      />
                      {gated && (
                        <TextField
                          label="Bones required"
                          value={gateBonesInput[t.id]}
                          onChangeText={(v) => setGateBonesInput((cur) => ({ ...cur, [t.id]: v }))}
                          placeholder="e.g. 250"
                          keyboardType="number-pad"
                        />
                      )}
                    </View>
                  );
                })}
              </View>
              {gatesError && <Text style={styles.loadError}>{gatesError}</Text>}
              {gatesSaved && !gatesError && <Text style={styles.successNote}>Saved.</Text>}
              <Button label={savingGates ? 'Saving…' : 'Save'} variant="primary" disabled={savingGates} onPress={saveGates} />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    successNote: { fontSize: 12.5, color: colors.green },
    directoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    directoryScroll: { maxHeight: 520 },
    userRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    userName: { fontFamily: font.body, fontSize: 14.5, color: colors.text },
  });
}

// "42 link taps by 31 people · 38 while it ran", for a sponsored global
// challenge's row.
function sponsorClicksLine(c: SponsorClicks | undefined): string {
  if (!c || c.clicks === 0) return 'No link taps yet';
  const taps = `${c.clicks.toLocaleString()} link ${c.clicks === 1 ? 'tap' : 'taps'} by ${c.people.toLocaleString()} ${c.people === 1 ? 'person' : 'people'}`;
  return c.clicksDuring === c.clicks ? taps : `${taps} · ${c.clicksDuring.toLocaleString()} while it ran`;
}
