-- Chat: replies, reactions, files, and editing your own messages.
--
-- The tables were already there (messages.reply_to, messages.attachments, messages.is_edited, message_reactions) but
-- the chat never used them: the reply and reaction buttons only showed "coming soon" or wrote to the browser console,
-- and an attached file was dropped and replaced by the words "Sent 1 file(s)". This makes them safe to use:
--
--   message_reactions        one row per person, message and emoji (no duplicates), live for everyone in the chat
--   messages.reply_to        points at a message in the same chat; becomes empty if that message is deleted
--   messages.attachments     [{path, name, type, size}], files in the chat-attachments bucket under this chat's folder
--   messages (update)        only the text can change; who wrote it, where, and the files stay as sent
--   chat-attachments bucket  private, <company>/<chat id>/<file>, up to 25 MB; readable by whoever can read the chat
--
-- Who can read, write and react is decided exactly as for messages: being able to see the channel (the channels
-- policies: a direct message's two members, a private channel's members, everyone for a public channel). Safe to run
-- again.

-- ---------------------------------------------------------------------------------------------
-- 1. reactions: one per person, message and emoji
-- ---------------------------------------------------------------------------------------------
-- rows the old code may have left half-filled or doubled can't be shown or removed sensibly; drop them first
delete from public.message_reactions where message_id is null or user_id is null or emoji is null or btrim(emoji) = '';
delete from public.message_reactions r
using public.message_reactions d
where r.message_id = d.message_id and r.user_id = d.user_id and r.emoji = d.emoji
  and (r.created_at, r.id) > (d.created_at, d.id);

alter table public.message_reactions alter column message_id set not null;
alter table public.message_reactions alter column user_id set not null;
alter table public.message_reactions alter column emoji set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'message_reactions_emoji_short') then
    -- an emoji, not a paragraph (some emoji are several characters joined together)
    alter table public.message_reactions add constraint message_reactions_emoji_short check (char_length(emoji) between 1 and 16);
  end if;
end $$;

create unique index if not exists message_reactions_one_each on public.message_reactions (message_id, user_id, emoji);

-- react as yourself, on a message you can read (the messages policies decide which)
drop policy if exists add_reactions on public.message_reactions;
create policy add_reactions on public.message_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.messages m where m.id = message_reactions.message_id));

drop policy if exists read_reactions on public.message_reactions;
create policy read_reactions on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_reactions.message_id));

drop policy if exists remove_reactions on public.message_reactions;
create policy remove_reactions on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- the baseline gave reactions to anon too; the chat is for signed-in people only
revoke all on table public.message_reactions from anon;

-- ---------------------------------------------------------------------------------------------
-- 2. replies, files and edits on messages
-- ---------------------------------------------------------------------------------------------
-- a reply to a message that is later deleted stays, without its quote
update public.messages m set reply_to = null
where m.reply_to is not null and not exists (select 1 from public.messages t where t.id = m.reply_to);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_reply_to_fkey') then
    alter table public.messages
      add constraint messages_reply_to_fkey foreign key (reply_to) references public.messages(id) on delete set null;
  end if;
end $$;

create index if not exists messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;

update public.messages set attachments = '[]'::jsonb where attachments is null or jsonb_typeof(attachments) <> 'array';

-- Checks what the policies can't: a reply quotes a message in the same chat, files live in this chat's own folder
-- (so nobody can attach another chat's file to their message), and an edit changes only the text.
create or replace function public.check_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file jsonb;
  v_folder text;
begin
  if tg_op = 'UPDATE' then
    if new.channel_id is distinct from old.channel_id or new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at or new.tenant_id is distinct from old.tenant_id
       -- the quote may only go away (deleting the quoted message empties it), never point somewhere else
       or (new.reply_to is distinct from old.reply_to and new.reply_to is not null) then
      raise exception 'Only the text of a message can be changed' using errcode = '42501';
    end if;
    if new.attachments is distinct from old.attachments then
      raise exception 'The files on a message cannot be changed once it is sent' using errcode = '42501';
    end if;
    if new.content is distinct from old.content then
      new.is_edited := true;
      new.updated_at := now();
    end if;
    return new;
  end if;

  if new.reply_to is not null
     and not exists (select 1 from public.messages t where t.id = new.reply_to and t.channel_id = new.channel_id) then
    raise exception 'You can only reply to a message in the same chat' using errcode = '22023';
  end if;

  new.attachments := coalesce(new.attachments, '[]'::jsonb);
  if jsonb_typeof(new.attachments) <> 'array' then
    raise exception 'Attachments must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(new.attachments) > 10 then
    raise exception 'Send at most 10 files in one message' using errcode = '22023';
  end if;
  v_folder := new.tenant_id::text || '/' || new.channel_id::text || '/';
  for v_file in select * from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(v_file) <> 'object' or coalesce(v_file->>'path', '') = ''
       or left(v_file->>'path', length(v_folder)) <> v_folder or position('..' in v_file->>'path') > 0 then
      raise exception 'A file on this message is not in this chat''s folder' using errcode = '22023';
    end if;
  end loop;

  if coalesce(btrim(new.content), '') = '' and jsonb_array_length(new.attachments) = 0 then
    raise exception 'A message needs some text or a file' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.check_chat_message() from public, anon, authenticated;

drop trigger if exists messages_check on public.messages;
create trigger messages_check before insert or update on public.messages
  for each row execute function public.check_chat_message();

-- ---------------------------------------------------------------------------------------------
-- 3. the files: private bucket, <company>/<chat id>/<file>
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('chat-attachments', 'chat-attachments', false)
  on conflict (id) do update set public = false;
  -- pictures, PDFs, office documents and plain text, up to 25 MB (where storage has these settings). No HTML or SVG:
  -- a file opened from its link must not be able to run code.
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $u$update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
      'application/pdf', 'text/plain', 'text/csv',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip'] where id = 'chat-attachments'$u$;
  end if;

  drop policy if exists chat_attachments_select on storage.objects;
  drop policy if exists chat_attachments_insert on storage.objects;
  drop policy if exists chat_attachments_delete on storage.objects;

  -- anyone who can see the chat (the channels policies decide): the same people who can read its messages.
  -- objects.name, not name: inside the channels subquery a bare "name" is the channel's name, and nothing would match.
  create policy chat_attachments_select on storage.objects for select to authenticated
    using (
      bucket_id = 'chat-attachments'
      and (storage.foldername(objects.name))[1] = (select public.current_tenant_id())::text
      and exists (select 1 from public.channels c where c.id::text = (storage.foldername(objects.name))[2])
    );
  create policy chat_attachments_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'chat-attachments'
      and (storage.foldername(objects.name))[1] = (select public.current_tenant_id())::text
      and exists (select 1 from public.channels c where c.id::text = (storage.foldername(objects.name))[2])
    );
  -- the person who uploaded it (deleting their message deletes its files)
  create policy chat_attachments_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'chat-attachments'
      and (storage.foldername(objects.name))[1] = (select public.current_tenant_id())::text
      and owner = (select auth.uid())
    );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. live: reactions appear for everyone in the chat as they are added (messages are already published)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
