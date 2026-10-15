-- Offer letterhead: a company can upload its own designed letterhead for offer letters.
--
--   company_profile.letterhead_header_url   a full-width image shown at the top of the letter instead of the generated
--                                            letterhead (logo, name, address); the date and title stay below it
--   company_profile.letterhead_footer_url   an optional full-width image at the bottom of the letter
--
-- Both are public URLs of images in the company-logo bucket, uploaded on Settings > Company profile exactly as the logo
-- is (same bucket, same kind of random file name), so storage needs nothing new. Who may change them is the profile's
-- own policies (ADMIN and people with Settings; each company only its own row). offer_by_token, which the candidate's
-- public offer page reads, now returns them with the rest of the company's branding.

alter table public.company_profile
  add column if not exists letterhead_header_url text
    constraint company_profile_letterhead_header_url_check check (letterhead_header_url is null or letterhead_header_url ~* '^https?://\S+$'),
  add column if not exists letterhead_footer_url text
    constraint company_profile_letterhead_footer_url_check check (letterhead_footer_url is null or letterhead_footer_url ~* '^https?://\S+$');

/**
 * The public offer page: the one offer this token opens (anyone with the link, signed in or not), with the company's
 * name, logo, colours, contact details and uploaded letterhead. Nothing else is reachable with the token. Null when
 * the link is not valid (unknown, replaced by a newer one, or the offer was withdrawn).
 */
create or replace function public.offer_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers;
  c public.company_profile;
  v_company text;
  v_group text;
begin
  if coalesce(length(p_token), 0) < 32 then
    return null;
  end if;
  select * into o from public.job_offers where token_hash = public.hash_invite_token(p_token);
  if o.id is null then
    return null;
  end if;
  if o.viewed_at is null then
    perform set_config('app.offer_transition', 'on', true);
    update public.job_offers set viewed_at = now() where id = o.id;
    perform set_config('app.offer_transition', '', true);
  end if;
  select * into c from public.company_profile where tenant_id = o.tenant_id;
  v_company := coalesce(c.company_name, (select t.name from public.tenants t where t.id = o.tenant_id));
  select j.name into v_group from public.job_groups j where j.id = o.job_group_id;
  return jsonb_build_object(
    'title', o.title,
    'body', o.body,
    'candidate_first_name', o.candidate_first_name,
    'candidate_last_name', o.candidate_last_name,
    'job_title', o.job_title,
    'job_group', v_group,
    'basic_salary', o.basic_salary,
    'house_allowance', o.house_allowance,
    'travel_allowance', o.travel_allowance,
    'other_allowances', o.other_allowances,
    'start_date', o.start_date,
    'expiry_date', o.expiry_date,
    'sent_at', o.sent_at,
    'status', case when o.status = 'sent' and o.expiry_date < current_date then 'expired' else o.status end,
    'responded_at', o.responded_at,
    'company', jsonb_build_object(
      'name', v_company, 'logo_url', c.logo_url, 'tagline', c.tagline,
      'primary_color', c.primary_color, 'secondary_color', c.secondary_color,
      'address_line1', c.address_line1, 'address_line2', c.address_line2, 'city', c.city, 'postal_code', c.postal_code,
      'country', c.country, 'phone', c.official_phone, 'email', c.official_email, 'website', c.website,
      'letterhead_header_url', c.letterhead_header_url, 'letterhead_footer_url', c.letterhead_footer_url)
  );
end $$;
revoke all on function public.offer_by_token(text) from public;
grant execute on function public.offer_by_token(text) to anon, authenticated;
