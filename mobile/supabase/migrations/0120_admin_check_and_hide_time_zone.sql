-- Hound: other members can no longer read anyone's time zone, and the
-- database stops needing everyone to read the admin flag (step 1 of 2).
--
-- 0092 hid email and friend code. Two profile columns are still readable
-- by every signed-in member:
--   time_zone  roughly where someone lives. The app only ever writes it
--              (notifications/timeZone.ts); only server functions read it.
--              Hidden now.
--   is_admin   who the admins are, which tells an attacker who to go after.
--              Fourteen access rules read it directly, so it can't be hidden
--              until they stop. This migration moves them all to
--              is_platform_admin(), which checks only your own flag. The
--              hiding itself is 0121, run after the app update.
--
-- The rules keep exactly the same meaning; only how they check for an
-- admin changes. Each is altered in place, so nothing is dropped.
--
-- Run this once, after 0119, in the SQL Editor. Safe on any app version.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

alter policy "Only admins can update the app's labels" on public.app_labels
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Only admins can update the app banner" on public.app_banner
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Only admins can update challenge unlock gates" on public.challenge_unlock_gates
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Only admins can update the daily bonus config" on public.daily_bonus_config
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Admins can edit achievements" on public.achievements
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Only admins can update the friend discovery config" on public.friend_discovery_config
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Only admins can update the trash talk config" on public.trash_talk_config
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Only admins can change the goal rewards" on public.goal_reward_config
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter policy "Only admins can insert challenge unlock gates" on public.challenge_unlock_gates
  with check (public.is_platform_admin());

alter policy "Only admins can delete challenge unlock gates" on public.challenge_unlock_gates
  using (public.is_platform_admin());

alter policy "Admins can delete global challenges" on public.challenges
  using (is_global and public.is_platform_admin());

alter policy "Members and platform admins can view an organization" on public.organizations
  using (
    id = (select organization_id from public.profiles where id = auth.uid())
    or public.is_platform_admin()
  );

alter policy "Members and platform admins can view their org's labels" on public.organization_labels
  using (
    organization_id = (select organization_id from public.profiles where id = auth.uid())
    or public.is_platform_admin()
  );

alter policy "Org admins and platform admins can update their org's labels" on public.organization_labels
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.organization_id = organization_labels.organization_id
        and p.org_role = 'admin'
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.organization_id = organization_labels.organization_id
        and p.org_role = 'admin'
    )
  );

-- time_zone: readable only through server functions from now on. Still
-- writable by its owner (0088).
revoke select (time_zone) on public.profiles from authenticated;

-- Undo, if needed:
--   grant select (time_zone) on public.profiles to authenticated;
--   (the access rules work either way; to restore their old wording, re-run
--   their create policy statements from 0022, 0035, 0036, 0050, 0067,
--   0070, 0072, 0075, 0080, 0083 and 0099 after dropping them)
