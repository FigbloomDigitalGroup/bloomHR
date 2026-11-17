-- The letterhead from the letter screens (Oct 26: "ask for an image and I provide it").
--
-- The letterhead images (company_profile.letterhead_header_url / _footer_url, 20261016600000) could only be set on
-- Settings > Company profile, by people with Settings. The people who write letters (HR: Employees or HR lifecycle;
-- Recruitment for offers) now set them from the letter screens through set_company_letterhead(), which changes those
-- two columns only. A company with no profile row yet gets one, named as the company is.

create or replace function public.set_company_letterhead(p_header text, p_footer text)
returns table (letterhead_header_url text, letterhead_footer_url text)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null or not public.has_any_module('settings', 'employees', 'hr-lifecycle', 'recruitment') then
    raise exception 'Only HR, Recruitment or Settings can change the letterhead' using errcode = '42501';
  end if;
  if (p_header is not null and p_header !~* '^https?://\S+$') or (p_footer is not null and p_footer !~* '^https?://\S+$') then
    raise exception 'The letterhead must be an uploaded image' using errcode = '22023';
  end if;
  insert into public.company_profile as c (tenant_id, company_name, letterhead_header_url, letterhead_footer_url)
    values (t, (select name from public.tenants where id = t), p_header, p_footer)
    on conflict (tenant_id) do update set letterhead_header_url = excluded.letterhead_header_url,
      letterhead_footer_url = excluded.letterhead_footer_url, updated_by = auth.uid();
  return query select c.letterhead_header_url, c.letterhead_footer_url from public.company_profile c where c.tenant_id = t;
end $$;
revoke all on function public.set_company_letterhead(text, text) from public, anon;
grant execute on function public.set_company_letterhead(text, text) to authenticated;

notify pgrst, 'reload schema';
