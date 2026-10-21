-- 0123: the fair play switch is off by default, readable by members and
-- changeable only by admins.
select plan(5);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Mo') as mo \gset

select is((select exclude_manual_entries from public.fair_play_settings), false, 'Off by default');

select tests.sign_in(:'mo');
set local role authenticated;
select is((select count(*)::int from public.fair_play_settings), 1, 'Members can read it');
select throws_ok($q$select public.set_fair_play_settings(true)$q$, 'Only admins can change this.', 'Members can''t change it');
select throws_ok($q$update public.fair_play_settings set exclude_manual_entries = true$q$, '42501', null, 'Not even directly');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select public.set_fair_play_settings(true);
reset role;
select is((select exclude_manual_entries from public.fair_play_settings), true, 'An admin can turn it on');

select * from finish();
