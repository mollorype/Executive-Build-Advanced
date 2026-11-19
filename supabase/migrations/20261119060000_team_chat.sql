-- STM Team Chat: one group chat for every STM Daily staff member and the CEOs,
-- with photos. Staff sign in to STM Daily with a password (set the first time
-- they sign in, through the staff-auth Edge Function); CEOs use the portal.
--
-- Who may read or post is decided here, in the database, from the caller's
-- verified account id — never from a name, email or role the browser sends.

-- ── 1. Membership ────────────────────────────────────────────────────────────
-- 'ceo'   — email is in ceo_access
-- 'staff' — email is in allowed_employees (the STM Daily allowlist)
-- NULL    — everyone else, including signed-out visitors
create or replace function public.chat_member_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.id is null or u.email_confirmed_at is null then null
    when exists (select 1 from public.ceo_access c where c.email = lower(u.email)) then 'ceo'
    when exists (select 1 from public.allowed_employees e where lower(e.email) = lower(u.email)) then 'staff'
    else null
  end
  from (select auth.uid() as uid) me
  left join auth.users u on u.id = me.uid;
$$;

revoke all on function public.chat_member_role() from public, anon;
grant execute on function public.chat_member_role() to authenticated;

-- ── 2. Messages ──────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  sender_id        uuid references auth.users(id) on delete set null,
  sender_email     text not null,
  sender_name      text not null,
  sender_role      text not null check (sender_role in ('ceo', 'staff')),
  body             text check (body is null or char_length(body) between 1 and 2000),
  photo_path       text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  client_id        uuid unique,
  telegram_sent_at timestamptz,
  constraint chat_messages_has_content check (body is not null or photo_path is not null)
);

create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at desc);

-- Everything about the sender is stamped here from the verified session;
-- whatever the browser put in those columns is overwritten.
create or replace function public.chat_messages_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text := public.chat_member_role();
  v_email text;
begin
  if v_role is null then
    raise exception 'Only STM staff and CEOs can post in the team chat' using errcode = '42501';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();

  new.id               := gen_random_uuid();
  new.created_at       := now();
  new.sender_id        := auth.uid();
  new.sender_email     := v_email;
  new.sender_name      := split_part(v_email, '@', 1);
  new.sender_role      := v_role;
  new.body             := nullif(btrim(new.body), '');
  new.telegram_sent_at := null;

  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> auth.uid()::text then
    raise exception 'You can only post photos you uploaded' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.chat_messages_stamp() from public, anon, authenticated;

drop trigger if exists chat_messages_stamp on public.chat_messages;
create trigger chat_messages_stamp
  before insert on public.chat_messages
  for each row execute function public.chat_messages_stamp();

alter table public.chat_messages enable row level security;

revoke all on public.chat_messages from anon, authenticated;
grant select, insert, delete on public.chat_messages to authenticated;

drop policy if exists chat_read   on public.chat_messages;
drop policy if exists chat_post   on public.chat_messages;
drop policy if exists chat_delete on public.chat_messages;

create policy chat_read on public.chat_messages
  for select to authenticated
  using ((select public.chat_member_role()) is not null);

create policy chat_post on public.chat_messages
  for insert to authenticated
  with check ((select public.chat_member_role()) is not null);

-- Delete your own messages; a CEO can delete any message.
create policy chat_delete on public.chat_messages
  for delete to authenticated
  using (
    (select public.chat_member_role()) is not null
    and (sender_id = (select auth.uid()) or (select public.chat_member_role()) = 'ceo')
  );

-- Live updates. Realtime applies chat_read to each subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end;
$$;

-- ── 3. Photos ────────────────────────────────────────────────────────────────
-- Private bucket: photos are only reachable through short-lived signed links
-- that chat members request. Uploads go in a folder named after the uploader.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_photos_read   on storage.objects;
drop policy if exists chat_photos_upload on storage.objects;
drop policy if exists chat_photos_delete on storage.objects;

create policy chat_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-photos' and (select public.chat_member_role()) is not null);

create policy chat_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-photos'
    and (select public.chat_member_role()) is not null
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy chat_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-photos'
    and (select public.chat_member_role()) is not null
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.chat_member_role()) = 'ceo')
  );

-- ── 4. Telegram ──────────────────────────────────────────────────────────────
-- Each new message is passed to the chat-telegram-alert Edge Function, which
-- forwards it to every CEO connected to Telegram (except the sender). A
-- failure here never blocks the message itself.
create or replace function public.notify_chat_telegram()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url                  := 'https://ryubjollofribrvrwqtz.supabase.co/functions/v1/chat-telegram-alert',
      body                 := jsonb_build_object('message_id', new.id),
      headers              := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notify_chat_telegram failed for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.notify_chat_telegram() from public, anon, authenticated;

drop trigger if exists chat_messages_telegram on public.chat_messages;
create trigger chat_messages_telegram
  after insert on public.chat_messages
  for each row execute function public.notify_chat_telegram();
