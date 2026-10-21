-- Hound: an admin switch to stop counting steps and workouts that were
-- typed in by hand.
--
-- Apple Health and Health Connect both let anyone add steps or a workout
-- by hand. Hound counted those like anything a phone or watch recorded,
-- so a challenge could be won by typing 50,000 steps into the Health app.
--
-- fair_play_settings.exclude_manual_entries (off by default, so nothing
-- changes until an admin turns it on): when on, the app leaves out
--   * steps marked as entered by hand: HKWasUserEntered on iPhone,
--     recording method "manual entry" in Health Connect;
--   * workouts marked the same way;
-- from everything it syncs into challenges (src/challenges/deviceSync.ts).
-- Personal charts on the phone still show everything.
--
-- Everyone signed in can read the switch, since every phone needs it.
-- Only admins can change it, through set_fair_play_settings().
--
-- Run this once, after 0122, in the SQL Editor. Apps from before this
-- change ignore the switch.

create table public.fair_play_settings (
  id boolean primary key default true check (id),
  exclude_manual_entries boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.fair_play_settings (id) values (true) on conflict do nothing;

alter table public.fair_play_settings enable row level security;
revoke all on public.fair_play_settings from anon, authenticated;
grant select (id, exclude_manual_entries, updated_at) on public.fair_play_settings to authenticated;

create policy "Signed-in members can read the fair play settings"
  on public.fair_play_settings for select
  to authenticated
  using (true);

create or replace function public.set_fair_play_settings(p_exclude_manual_entries boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can change this.';
  end if;
  update public.fair_play_settings
  set exclude_manual_entries = coalesce(p_exclude_manual_entries, false),
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke execute on function public.set_fair_play_settings(boolean) from public, anon;
grant execute on function public.set_fair_play_settings(boolean) to authenticated;

-- Undo, if needed:
--   drop function public.set_fair_play_settings(boolean);
--   drop table public.fair_play_settings;
