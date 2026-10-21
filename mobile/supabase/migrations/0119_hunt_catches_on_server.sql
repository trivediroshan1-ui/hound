-- Hound: the server decides who has been caught in a Chase (hunt).
--
-- Until now the only thing that ever wrote "caught" (role 'zombie') was
-- the caught person's own phone, when it opened the challenge and worked
-- out from the board that the Hunter had passed them. Settlement then
-- trusted the stored role. So someone who was caught but never opened
-- the challenge again, or whose app never sent the write, stayed
-- "hunted": at settlement they were paid as a survivor (30 instead of
-- 10) and the Hunter missed the "caught everyone" score (40 instead of
-- 10).
--
-- hunt_apply_catches(challenge) works out the catches with the same rule
-- as the app (src/challenges/board.ts, withHuntCatches):
--   * nobody is caught until the head start is over, counted from the
--     UTC start of the challenge's first day (botSimulation.ts,
--     daysElapsedFraction);
--   * the Hunter counts only what they logged after the head start: their
--     total minus their total up to the day before it ended
--     (headStartBaselineDayKey), using each Hunted person's own time zone
--     for that day, as their phone did;
--   * a Hunted person is caught once they have logged something and the
--     Hunter's count reaches theirs, in miles for workout-distance chases
--     and steps otherwise (scoring.ts, boardSortFor).
-- It only ever moves 'hunted' to 'zombie', never back.
--
-- Two things call it:
--   * the app, whenever anyone in the chase opens it (0.12.0 and later;
--     older apps keep writing their own catch, which still works);
--   * a job every hour at :05, two minutes before settlement
--     (0095's hound-settle-due-challenges at :07), for every chase that
--     hasn't settled.
--
-- Not covered: a chase whose Hunter is a bot. A bot's steps are simulated
-- on the phone (botSimulation.ts), so those catches stay with the app.
--
-- Run this once, after 0118, in the SQL Editor (and after 0095, so the
-- settlement job exists; this one works without it too).

create or replace function public.hunt_apply_catches(p_challenge_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  use_miles boolean;
  hunter_id uuid;
  first_day_utc timestamptz;
  caught integer;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'hunt' or c.score_settled_at is not null then
    return 0;
  end if;

  -- From the app, only people in the chase may ask. The hourly job runs
  -- with no signed-in user.
  if auth.uid() is not null and not public.is_challenge_participant(p_challenge_id, auth.uid()) then
    return 0;
  end if;

  first_day_utc := date_trunc('day', c.starts_at at time zone 'utc') at time zone 'utc';
  if coalesce(c.head_start_days, 0) > c.duration_days
     or now() < first_day_utc + make_interval(days => coalesce(c.head_start_days, 0)) then
    return 0;
  end if;

  select cp.user_id into hunter_id
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id and cp.role = 'hunter'
  limit 1;
  if hunter_id is null then
    return 0;
  end if;

  use_miles := c.scoring_method::text in ('gps_distance', 'any_workout');

  with hunted as (
    select
      cp.user_id,
      -- The day before the head start ended, in this person's time zone.
      case when coalesce(c.head_start_days, 0) > 0 then
        ((c.starts_at + make_interval(days => c.head_start_days) - interval '1 day')
           at time zone coalesce(p.time_zone, 'UTC'))::date
      end as baseline_day
    from public.challenge_participants cp
    left join public.profiles p on p.id = cp.user_id
    where cp.challenge_id = p_challenge_id and cp.role = 'hunted'
  ),
  scored as (
    select
      h.user_id,
      (select coalesce(sum(case when use_miles then s.distance_mi else s.steps end), 0)
         from public.progress_snapshots s
         where s.challenge_id = p_challenge_id and s.user_id = h.user_id) as mine,
      greatest(0,
        (select coalesce(sum(case when use_miles then s.distance_mi else s.steps end), 0)
           from public.progress_snapshots s
           where s.challenge_id = p_challenge_id and s.user_id = hunter_id)
        - (select coalesce(sum(case when use_miles then s.distance_mi else s.steps end), 0)
             from public.progress_snapshots s
             where s.challenge_id = p_challenge_id and s.user_id = hunter_id
               and h.baseline_day is not null and s.day <= h.baseline_day)
      ) as hunter_count
    from hunted h
  )
  update public.challenge_participants cp
  set role = 'zombie'
  from scored
  where cp.challenge_id = p_challenge_id
    and cp.user_id = scored.user_id
    and cp.role = 'hunted'
    and scored.mine > 0
    and scored.mine <= scored.hunter_count;

  get diagnostics caught = row_count;
  return caught;
end;
$$;

revoke execute on function public.hunt_apply_catches(uuid) from public, anon;
grant execute on function public.hunt_apply_catches(uuid) to authenticated;

-- Every chase that hasn't settled, once an hour, just before settlement.
create or replace function public.hunt_apply_all_catches()
returns integer
language sql
security definer set search_path = public
as $$
  select coalesce(sum(public.hunt_apply_catches(c.id)), 0)::integer
  from public.challenges c
  where c.kind::text = 'hunt' and c.score_settled_at is null and c.starts_at <= now();
$$;

revoke execute on function public.hunt_apply_all_catches() from public, anon, authenticated;

select cron.unschedule('hound-hunt-catches')
where exists (select 1 from cron.job where jobname = 'hound-hunt-catches');
select cron.schedule('hound-hunt-catches', '5 * * * *', $$ select public.hunt_apply_all_catches(); $$);

-- Undo, if needed:
--   select cron.unschedule('hound-hunt-catches');
--   drop function public.hunt_apply_all_catches();
--   drop function public.hunt_apply_catches(uuid);
