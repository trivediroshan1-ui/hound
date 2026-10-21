-- 0122: unsubscribing stops every Hound email to that address.
select plan(6);

select tests.new_user('Una') as una \gset
select email as una_email from public.profiles where id = :'una' \gset

-- What email-unsubscribe does after checking the link.
select public.email_unsubscribe(upper(:'una_email'));
select is((select count(*)::int from public.email_unsubscribes where email = lower(:'una_email')), 1, 'The address is recorded, in lower case');
select is((select notify_email_enabled or alert_stale_data_email_enabled or alert_daily_standings_email_enabled
           from public.profiles where id = :'una'), false, 'Every email toggle is off');

-- Turning one back on in Settings means "email me again".
update public.profiles set notify_email_enabled = true where id = :'una';
select is((select count(*)::int from public.email_unsubscribes where email = lower(:'una_email')), 0, 'Turning email back on removes the address');

select public.email_unsubscribe('someone-new@example.org');
select is((select count(*)::int from public.email_unsubscribes where email = 'someone-new@example.org'), 1, 'Works for someone not on Hound yet');

select tests.sign_in(:'una');
set local role authenticated;
select throws_ok('select * from public.email_unsubscribes', '42501', null, 'Members can''t read the list');
select throws_ok($q$select public.email_unsubscribe('x@example.org')$q$, '42501', null, 'Members can''t call it');
reset role;

select * from finish();
