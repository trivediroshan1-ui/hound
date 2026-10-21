-- 0092: other people's email and friend code aren't readable; the app
-- gets what it needs through 0091's functions.
select plan(6);

select tests.new_user('Ann', true) as ann \gset
select tests.new_user('Bob') as bob \gset
select tests.new_user('Cat') as cat \gset

select friend_code as bob_code from public.profiles where id = :'bob' \gset
select email as cat_email from auth.users where id = :'cat' \gset

select tests.sign_in(:'bob');
set local role authenticated;
select throws_ok('select email from public.profiles', '42501', null, 'H1: email is not readable');
select throws_ok('select friend_code from public.profiles', '42501', null, 'H1: friend codes are not readable');
select lives_ok('select id, name, initials, username from public.profiles', 'Other profile columns still are (is_admin is hidden by 0121)');
select is(public.my_friend_code(), :'bob_code',
  'my_friend_code() returns your own code');
select is(public.profile_id_for_email(upper(:'cat_email')), :'cat'::uuid,
  'Invite by email finds one address at a time');
select throws_ok($q$select * from public.admin_search_users('')$q$, 'not authorized',
  'Only platform admins can search all users');
reset role;

select * from finish();
