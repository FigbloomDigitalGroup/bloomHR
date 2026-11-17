-- Signed offer letters (FIG-1232).
--
--   * Sending an offer keeps the sender's drawn signature (a PNG data: URL, from their My signature) and name on it;
--     the letter shows it where its text says {{signature}}. The default template gains that line.
--   * Accepting it, the candidate draws their signature; it is kept with the offer and shown under the letter.
--   * Only send_offer and respond_to_offer write these: HR can't put a signature on an offer, or change one, by hand.
--   * The candidate's page (offer_by_token) shows both.

alter table public.job_offers
  add column if not exists signature text,
  add column if not exists signed_by text,
  add column if not exists candidate_signature text;

create or replace function public.is_signature_image(p text) returns boolean
language sql immutable set search_path = public as $$
  select p is null or (p like 'data:image/png;base64,%' and length(p) <= 400000)
$$;

alter table public.job_offers drop constraint if exists job_offers_signature_check;
alter table public.job_offers add constraint job_offers_signature_check check (public.is_signature_image(signature));
alter table public.job_offers drop constraint if exists job_offers_candidate_signature_check;
alter table public.job_offers add constraint job_offers_candidate_signature_check check (public.is_signature_image(candidate_signature));

-- the signatures change only by sending or answering (which set app.offer_transition)
create or replace function public.job_offers_signature_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.offer_transition', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.signature := null;
    new.signed_by := null;
    new.candidate_signature := null;
  else
    new.signature := old.signature;
    new.signed_by := old.signed_by;
    new.candidate_signature := old.candidate_signature;
  end if;
  return new;
end $$;
drop trigger if exists job_offers_signature_guard on public.job_offers;
create trigger job_offers_signature_guard before insert or update on public.job_offers
  for each row execute function public.job_offers_signature_guard();

-- sending: as before, and the sender's signature and name go on the offer (null: none, the letter leaves the space)
drop function if exists public.send_offer(uuid);
create or replace function public.send_offer(p_offer uuid, p_signature text default null, p_signed_by text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers := public.hiring_offer(p_offer);
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if o.status not in ('draft', 'sent') then
    raise exception 'This offer is % and can''t be sent', o.status using errcode = '22023';
  end if;
  if o.candidate_email is null then
    raise exception 'Add the candidate''s email first' using errcode = '23514';
  end if;
  if o.start_date is null then
    raise exception 'Add the start date first' using errcode = '23514';
  end if;
  if o.expiry_date is null or o.expiry_date < current_date then
    raise exception 'Choose an expiry date from today on' using errcode = '23514';
  end if;
  if not public.is_signature_image(p_signature) then
    raise exception 'The signature must be a drawn signature (a PNG image)' using errcode = '22023';
  end if;
  perform set_config('app.offer_transition', 'on', true);
  update public.job_offers set status = 'sent', token_hash = public.hash_invite_token(v_token), sent_at = now(),
    signature = p_signature, signed_by = left(nullif(btrim(p_signed_by), ''), 200)
  where id = o.id;
  perform set_config('app.offer_transition', '', true);
  return v_token;
end $$;
revoke all on function public.send_offer(uuid, text, text) from public, anon;
grant execute on function public.send_offer(uuid, text, text) to authenticated;

-- answering: as before; accepting keeps the candidate's drawn signature
drop function if exists public.respond_to_offer(text, boolean, text);
create or replace function public.respond_to_offer(p_token text, p_accept boolean, p_reason text default null, p_signature text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers;
  v_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  if p_accept is null then
    raise exception 'Accept or decline the offer' using errcode = '22023';
  end if;
  if not public.is_signature_image(p_signature) then
    raise exception 'The signature must be a drawn signature' using errcode = '22023';
  end if;
  select * into o from public.job_offers
  where coalesce(length(p_token), 0) >= 32 and token_hash = public.hash_invite_token(p_token)
  for update;
  if o.id is null then
    raise exception 'This offer link is not valid' using errcode = 'P0002';
  end if;
  if o.status in ('accepted', 'declined') then
    raise exception 'You have already % this offer', o.status using errcode = '22023';
  end if;
  if o.status = 'expired' or (o.status = 'sent' and o.expiry_date < current_date) then
    raise exception 'This offer expired on %', to_char(o.expiry_date, 'FMDD FMMonth YYYY') using errcode = '22023';
  end if;
  if o.status <> 'sent' then
    raise exception 'This offer is no longer open' using errcode = '22023';
  end if;
  perform set_config('app.offer_transition', 'on', true);
  update public.job_offers set status = v_status, responded_at = now(),
    decline_reason = case when p_accept then null else left(nullif(btrim(p_reason), ''), 1000) end,
    candidate_signature = case when p_accept then p_signature end
  where id = o.id;
  perform set_config('app.offer_transition', '', true);
  return v_status;
end $$;
revoke all on function public.respond_to_offer(text, boolean, text, text) from public;
grant execute on function public.respond_to_offer(text, boolean, text, text) to anon, authenticated;

-- the candidate's page: as before, with the signatures
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
    'signature', o.signature,
    'signed_by', o.signed_by,
    'candidate_signature', o.candidate_signature,
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

-- the default template signs off with the sender's signature; templates still exactly as first given get it too
do $$
declare
  old_body text := public.default_offer_letter_body();
  -- the line breaks are \r\n where the migration was pushed from a Windows checkout
  new_body text := regexp_replace(old_body, E'Yours sincerely,(\\r?\\n)(\\r?\\n)\\{\\{company_name\\}\\}',
                                  E'Yours sincerely,\\1\\2{{signature}}\\1{{company_name}}');
begin
  update public.offer_letter_templates set body = new_body where body = old_body;
  execute format('create or replace function public.default_offer_letter_body() returns text language sql immutable as %L',
    'select ' || quote_literal(new_body));
end $$;

notify pgrst, 'reload schema';
