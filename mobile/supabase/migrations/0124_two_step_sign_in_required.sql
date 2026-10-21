-- Hound: once a member turns on two-step sign-in, the database itself
-- insists on it, not just the app.
--
-- The app's code screen (auth/twoStep.ts) stops someone with only a
-- stolen password from getting into Hound on a phone. But the password
-- alone still gets a valid session from the sign-in service, and that
-- session could read and write the member's data directly. This closes
-- that gap.
--
-- For a member with a verified authenticator, every table's rules now
-- also need a session that has passed the code (aal2 in the sign-in
-- token). Members who haven't turned it on are not affected at all.
-- Server functions run as their owner and bypass these rules, as they
-- already bypass the others.
--
-- How: one extra RESTRICTIVE policy per table that has row-level security
-- on. Restrictive policies are ANDed with the existing ones, so nothing
-- that's allowed today is widened. two_step_satisfied() is evaluated once
-- per query, not once per row.
--
-- A table added later needs the same policy. Re-running this file adds it
-- to any table that's missing it.
--
-- Run this once, after 0123, in the SQL Editor, and after the app update
-- with the code screen has reached everyone: a member who sets up two-step
-- sign-in and then opens an older app version elsewhere would see empty
-- screens there, because that app can't ask for the code.

create or replace function public.two_step_satisfied()
returns boolean
language sql
stable
security definer set search_path = public, auth
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

revoke execute on function public.two_step_satisfied() from public, anon;
grant execute on function public.two_step_satisfied() to authenticated;

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I', 'Two-step sign-in is required once it is on', t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.two_step_satisfied())) with check ((select public.two_step_satisfied()))',
      'Two-step sign-in is required once it is on',
      t.relname
    );
  end loop;
end $$;

-- Undo, if needed:
--   do $$ declare t record; begin
--     for t in select tablename from pg_policies
--              where schemaname = 'public' and policyname = 'Two-step sign-in is required once it is on'
--     loop execute format('drop policy %I on public.%I', 'Two-step sign-in is required once it is on', t.tablename); end loop;
--   end $$;
--   drop function public.two_step_satisfied();
