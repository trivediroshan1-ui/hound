-- 0120: admin rules use is_platform_admin(), and time zones are hidden.
select plan(6);

select tests.new_user('Ada', true) as ada \gset
select tests.new_user('Mo') as mo \gset
update public.profiles set time_zone = 'Asia/Kolkata' where id = :'mo';

select tests.sign_in(:'mo');
set local role authenticated;
select is(public.is_platform_admin(), false, 'A member is not an admin');
select throws_ok('select time_zone from public.profiles', '42501', null, 'Members can''t read anyone''s time zone');
select lives_ok('select name from public.profiles', 'Names are still readable');
reset role;

select tests.sign_in(:'ada');
set local role authenticated;
select is(public.is_platform_admin(), true, 'An admin is an admin');
reset role;

select is((select count(*)::int from pg_policies
           where coalesce(qual, '') || coalesce(with_check, '') like '%is_admin%'
             and coalesce(qual, '') || coalesce(with_check, '') not like '%is_platform_admin()%'),
  0, 'No access rule reads is_admin directly');
select ok(not has_function_privilege('anon', 'public.is_platform_admin()', 'EXECUTE'), 'Signed-out visitors can''t call it');

select * from finish();
