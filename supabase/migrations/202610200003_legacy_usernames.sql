-- The legacy app has usernames with spaces, such as "admin mikro".
-- Spaces are percent-encoded only in the internal Supabase Auth email identity.
begin;
alter table public.app_profiles drop constraint app_profiles_username_check;
alter table public.app_profiles add constraint app_profiles_username_check
    check (username ~ '^[a-z0-9._-][a-z0-9 ._-]{1,62}[a-z0-9._-]$');
commit;
