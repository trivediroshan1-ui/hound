-- 0124: with two-step sign-in on, a session that hasn't had the code
-- can't read or write; everyone else is unaffected.
select plan(4);

select tests.new_user('Tia') as tia \gset
select tests.new_user('Ned') as ned \gset

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), :'tia', 'Hound', 'totp', 'verified', now(), now());

-- tests.sign_in gives a password-only session (no aal2 claim).
select tests.sign_in(:'tia');
set local role authenticated;
select is((select count(*)::int from public.profiles where id = :'tia'), 0, 'Without the code, Tia can''t read even her own profile');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'tia', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is((select count(*)::int from public.profiles where id = :'tia'), 1, 'With the code, she can');
reset role;

select tests.sign_in(:'ned');
set local role authenticated;
select is((select count(*)::int from public.profiles where id = :'ned'), 1, 'Ned, without two-step sign-in, is unaffected');
reset role;

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
             and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                             and p.policyname = 'Two-step sign-in is required once it is on')),
  0, 'Every table with row-level security has the rule');

select * from finish();
