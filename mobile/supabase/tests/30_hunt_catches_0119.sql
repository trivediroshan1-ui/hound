-- 0119: the server records catches in a Chase, with the app's rule.
select plan(7);

select tests.new_user('Hal') as hal \gset
select tests.new_user('Ann') as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Out') as outsider \gset

-- Started five days ago, a two-day head start. Hal (the Hunter) logged
-- 8,000 steps during the head start and 12,000 after it, so 12,000
-- count. Ann has 10,000 (caught), Bob 15,000 (still running).
\set D '(now() at time zone ''utc'')::date'
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, head_start_days, scoring_method)
values ('88888888-0000-0000-0000-000000000001', 'Chase', 'hunt', :'hal', 7,
        date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '5 days',
        date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '2 days', 2, 'device_steps');
insert into public.challenge_participants (challenge_id, user_id, role) values
  ('88888888-0000-0000-0000-000000000001', :'hal', 'hunter'),
  ('88888888-0000-0000-0000-000000000001', :'ann', 'hunted'),
  ('88888888-0000-0000-0000-000000000001', :'bob', 'hunted');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('88888888-0000-0000-0000-000000000001', :'hal', :D - 5, 4000),
  ('88888888-0000-0000-0000-000000000001', :'hal', :D - 4, 4000),
  ('88888888-0000-0000-0000-000000000001', :'hal', :D - 3, 6000),
  ('88888888-0000-0000-0000-000000000001', :'hal', :D - 2, 6000),
  ('88888888-0000-0000-0000-000000000001', :'ann', :D - 3, 10000),
  ('88888888-0000-0000-0000-000000000001', :'bob', :D - 3, 15000);

select tests.sign_in(:'outsider');
set local role authenticated;
select is(public.hunt_apply_catches('88888888-0000-0000-0000-000000000001'), 0, 'Someone outside the chase can''t trigger it');
reset role;

-- Bob, who is still running, opens the chase: Ann's catch is recorded.
select tests.sign_in(:'bob');
set local role authenticated;
select is(public.hunt_apply_catches('88888888-0000-0000-0000-000000000001'), 1, 'One catch recorded');
reset role;
select is((select role from public.challenge_participants where challenge_id = '88888888-0000-0000-0000-000000000001' and user_id = :'ann'),
  'zombie', 'Ann is caught without opening the app');
select is((select role from public.challenge_participants where challenge_id = '88888888-0000-0000-0000-000000000001' and user_id = :'bob'),
  'hunted', 'Bob, ahead of the Hunter, is not');

-- The head start counts: before it ends, nobody is caught.
insert into public.challenges (id, name, kind, created_by, duration_days, starts_at, ends_at, head_start_days, scoring_method)
values ('88888888-0000-0000-0000-000000000002', 'Fresh chase', 'hunt', :'hal', 7, now() - interval '1 hour', now() + interval '7 days', 2, 'device_steps');
insert into public.challenge_participants (challenge_id, user_id, role) values
  ('88888888-0000-0000-0000-000000000002', :'hal', 'hunter'),
  ('88888888-0000-0000-0000-000000000002', :'ann', 'hunted');
insert into public.progress_snapshots (challenge_id, user_id, day, steps) values
  ('88888888-0000-0000-0000-000000000002', :'hal', :D, 9000),
  ('88888888-0000-0000-0000-000000000002', :'ann', :D, 10);
select is(public.hunt_apply_all_catches(), 0, 'No catch during the head start');

select ok(not has_function_privilege('anon', 'public.hunt_apply_catches(uuid)', 'EXECUTE'), 'Signed-out visitors can''t call it');
select ok(exists (select 1 from cron.job where jobname = 'hound-hunt-catches' and schedule = '5 * * * *'), 'The hourly job is scheduled');

select * from finish();
