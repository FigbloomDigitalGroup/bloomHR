-- Profile pictures: the addresses saved on employees ("Profile Image") are public URLs, so the employeeavatar
-- bucket must be public. 20261006000400 creates it public, but "on conflict do nothing" left a bucket that already
-- existed as private unchanged, and then every saved picture shows as a broken image (to the admin too).
-- Who may upload or replace a picture is unchanged (the storage.objects policies from 20261006000400).
-- Skipped where there is no storage schema (the test database), like 20261006000400.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public = true where id = 'employeeavatar' and public is distinct from true;
  end if;
end $$;
