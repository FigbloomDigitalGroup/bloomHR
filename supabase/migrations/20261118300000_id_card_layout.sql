-- Staff ID cards in landscape too: each company chooses which way up its cards are (Card settings).
--
-- layout: 'portrait' (54 x 85.6 mm, as before, the default) or 'landscape' (85.6 x 54 mm). Every card in the company,
-- its downloads and the print sheet follow it. Read and changed like the other card settings (the 'staff-id-cards'
-- module changes them, everyone in the company reads them). Written to run again safely.

alter table public.staff_id_card_settings
  add column if not exists layout text not null default 'portrait';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_id_card_settings_layout_check') then
    alter table public.staff_id_card_settings
      add constraint staff_id_card_settings_layout_check check (layout in ('portrait', 'landscape'));
  end if;
end $$;
