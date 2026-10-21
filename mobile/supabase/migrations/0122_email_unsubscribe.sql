-- Hound: an unsubscribe link in every email.
--
-- Hound's emails had no way to opt out from the email itself. Gmail and
-- Yahoo require a one-click unsubscribe for regular senders, and the US
-- CAN-SPAM and EU rules expect one for anything that isn't a password
-- reset.
--
-- email_unsubscribes holds the addresses that said "no more Hound email",
-- members and non-members alike (an invite can go to someone who isn't on
-- Hound yet). The email functions check it before sending. Only server
-- code can read or write it: row-level security is on, with no rules.
--
-- email_unsubscribe(address) is what the email-unsubscribe function calls
-- once it has checked the link's signature. It records the address and,
-- for a member, turns off every email toggle in Settings, so the app
-- shows the truth. They can turn any of them back on there; turning one
-- on removes the address from this list (see the trigger below).
--
-- Run this once, after 0121, in the SQL Editor. The email functions keep
-- sending as before until it has run.

create table public.email_unsubscribes (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table public.email_unsubscribes enable row level security;
revoke all on public.email_unsubscribes from anon, authenticated;

create or replace function public.email_unsubscribe(p_email text)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.email_unsubscribes (email)
  values (lower(trim(p_email)))
  on conflict (email) do nothing;

  update public.profiles
  set notify_email_enabled = false,
      alert_stale_data_email_enabled = false,
      alert_daily_standings_email_enabled = false
  where lower(email) = lower(trim(p_email));
$$;

revoke execute on function public.email_unsubscribe(text) from public, anon, authenticated;
grant execute on function public.email_unsubscribe(text) to service_role;

-- Turning an email toggle back on in Settings means "email me again".
create or replace function public.email_resubscribe_on_toggle()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.notify_email_enabled and not old.notify_email_enabled)
     or (new.alert_stale_data_email_enabled and not old.alert_stale_data_email_enabled)
     or (new.alert_daily_standings_email_enabled and not old.alert_daily_standings_email_enabled) then
    delete from public.email_unsubscribes where email = lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists email_resubscribe_on_toggle on public.profiles;
create trigger email_resubscribe_on_toggle
  after update of notify_email_enabled, alert_stale_data_email_enabled, alert_daily_standings_email_enabled
  on public.profiles
  for each row execute procedure public.email_resubscribe_on_toggle();

-- Undo, if needed:
--   drop trigger email_resubscribe_on_toggle on public.profiles;
--   drop function public.email_resubscribe_on_toggle();
--   drop function public.email_unsubscribe(text);
--   drop table public.email_unsubscribes;
