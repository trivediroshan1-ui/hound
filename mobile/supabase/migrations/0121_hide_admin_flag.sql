-- Hound: other members can no longer see who is an admin (step 2 of 2).
--
-- ⚠ DO NOT RUN THIS UNTIL THE APP UPDATE HAS REACHED EVERYONE. Run 0120
-- first, publish the OTA update from the same PR, then wait until Admin →
-- App versions shows (nearly) everyone on it. Older apps read their own
-- is_admin straight from profiles and would fail to load the signed-in
-- profile; the new app asks is_platform_admin() instead.
--
-- After this, is_admin is readable only through server functions:
-- is_platform_admin() for your own flag, admin_search_users() (0091) for
-- admins. Every access rule already uses is_platform_admin() (0120).
--
-- Run this once, after 0120 and after the app update has rolled out.

revoke select (is_admin) on public.profiles from authenticated;

-- Undo, if needed:
--   grant select (is_admin) on public.profiles to authenticated;
