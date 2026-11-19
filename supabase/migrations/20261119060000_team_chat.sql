-- STM Team Chat: one group chat for every STM Daily staff member and the CEOs,
-- with photos, end-to-end encrypted.
--
-- Staff sign in to STM Daily with a password (set the first time they sign in,
-- through the staff-auth Edge Function); CEOs use the portal.
--
-- Who may read or post is decided here, in the database, from the caller's
-- verified account id — never from a name, email or role the browser sends.
--
-- End-to-end encryption: messages and photos are encrypted in the browser.
-- This database only ever stores
--   * each device's PUBLIC key (chat_devices),
--   * the shared chat key, wrapped separately for each member device
--     (chat_key_shares) — useless without that device's private key, which
--     never leaves the device,
--   * ciphertext (chat_messages, and the files in the chat-photos bucket).
-- Sender, time and "has a photo" stay visible, as in any end-to-end chat.
--
-- Besides messages, staff can ask for a day off and anyone can raise an
-- emergency. Only those two alert the CEOs on Telegram — ordinary messages
-- don't. Their dates / emergency type are stored readable (the alert needs
-- them); the reason / details are encrypted like any message.
--
-- Safe to run more than once, and on top of the earlier (unencrypted) version.

-- ── 1. Membership ────────────────────────────────────────────────────────────
-- 'ceo'   — email is in ceo_access
-- 'staff' — email is in allowed_employees (the STM Daily allowlist)
-- NULL    — everyone else
create or replace function public.chat_role_of(p_user uuid)
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
  from (select p_user as uid) me
  left join auth.users u on u.id = me.uid;
$$;

create or replace function public.chat_member_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.chat_role_of(auth.uid());
$$;

revoke all on function public.chat_role_of(uuid) from public, anon;
revoke all on function public.chat_member_role() from public, anon;
grant execute on function public.chat_role_of(uuid) to authenticated;
grant execute on function public.chat_member_role() to authenticated;

-- ── 2. Encryption keys ───────────────────────────────────────────────────────
-- One row per browser/phone. user_id is stamped from the session.
create table if not exists public.chat_devices (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  public_key jsonb not null,
  created_at timestamptz not null default now()
);

-- Each version of the shared chat key. A new version is made when someone
-- leaves, so they can't read what is sent after. check_iv/check_ct let a
-- device confirm the key it was handed is the real one.
create table if not exists public.chat_key_versions (
  version        int primary key check (version > 0),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check_iv       text not null,
  check_ct       text not null,
  needs_rotation boolean not null default false
);

-- The chat key, wrapped for one device (ephemeral ECDH P-256 + HKDF + AES-GCM).
create table if not exists public.chat_key_shares (
  key_version          int not null references public.chat_key_versions(version) on delete cascade,
  device_id            uuid not null references public.chat_devices(id) on delete cascade,
  wrapped_key          text not null,
  iv                   text not null,
  ephemeral_public_key jsonb not null,
  shared_by            uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  primary key (key_version, device_id)
);

create or replace function public.chat_devices_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.chat_member_role() is null then
    raise exception 'Only STM staff and CEOs can use the team chat' using errcode = '42501';
  end if;
  if new.public_key ? 'd'
     or new.public_key->>'kty' is distinct from 'EC'
     or new.public_key->>'crv' is distinct from 'P-256'
     or coalesce(new.public_key->>'x', '') = ''
     or coalesce(new.public_key->>'y', '') = '' then
    raise exception 'Not a valid public key' using errcode = '22023';
  end if;
  new.user_id    := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

create or replace function public.chat_key_versions_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.chat_member_role() is null then
    raise exception 'Only STM staff and CEOs can use the team chat' using errcode = '42501';
  end if;
  if new.version <> coalesce((select max(v.version) from public.chat_key_versions v), 0) + 1 then
    raise exception 'Someone else just changed the chat key' using errcode = '23505';
  end if;
  if coalesce(new.check_iv, '') = '' or coalesce(new.check_ct, '') = '' then
    raise exception 'Missing key check' using errcode = '22023';
  end if;
  new.created_by     := auth.uid();
  new.created_at     := now();
  new.needs_rotation := false;
  return new;
end;
$$;

create or replace function public.chat_key_shares_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.chat_member_role() is null then
    raise exception 'Only STM staff and CEOs can use the team chat' using errcode = '42501';
  end if;
  if public.chat_role_of((select d.user_id from public.chat_devices d where d.id = new.device_id)) is null then
    raise exception 'That device isn''t in the team chat' using errcode = '42501';
  end if;
  new.shared_by  := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

-- A device holding the current chat key disappeared (its login was reset or
-- removed): flag the key so the next member app makes a new one.
create or replace function public.chat_key_shares_gone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_key_versions v
     set needs_rotation = true
   where v.version = old.key_version
     and v.version = (select max(x.version) from public.chat_key_versions x);
  return null;
end;
$$;

-- True when someone who holds the current chat key has left the chat.
create or replace function public.chat_key_rotation_needed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (
    select v.version, v.needs_rotation from public.chat_key_versions v order by v.version desc limit 1
  )
  select public.chat_member_role() is not null and (
    coalesce((select needs_rotation from cur), false)
    or exists (
      select 1
      from public.chat_key_shares s
      join public.chat_devices d on d.id = s.device_id
      where s.key_version = (select version from cur)
        and public.chat_role_of(d.user_id) is null
    )
  );
$$;

revoke all on function public.chat_devices_stamp()       from public, anon, authenticated;
revoke all on function public.chat_key_versions_stamp()  from public, anon, authenticated;
revoke all on function public.chat_key_shares_stamp()    from public, anon, authenticated;
revoke all on function public.chat_key_shares_gone()     from public, anon, authenticated;
revoke all on function public.chat_key_rotation_needed() from public, anon;
grant execute on function public.chat_key_rotation_needed() to authenticated;

drop trigger if exists chat_devices_stamp on public.chat_devices;
create trigger chat_devices_stamp before insert on public.chat_devices
  for each row execute function public.chat_devices_stamp();

drop trigger if exists chat_key_versions_stamp on public.chat_key_versions;
create trigger chat_key_versions_stamp before insert on public.chat_key_versions
  for each row execute function public.chat_key_versions_stamp();

drop trigger if exists chat_key_shares_stamp on public.chat_key_shares;
create trigger chat_key_shares_stamp before insert on public.chat_key_shares
  for each row execute function public.chat_key_shares_stamp();

drop trigger if exists chat_key_shares_gone on public.chat_key_shares;
create trigger chat_key_shares_gone after delete on public.chat_key_shares
  for each row execute function public.chat_key_shares_gone();

alter table public.chat_devices      enable row level security;
alter table public.chat_key_versions enable row level security;
alter table public.chat_key_shares   enable row level security;

revoke all on public.chat_devices      from anon, authenticated;
revoke all on public.chat_key_versions from anon, authenticated;
revoke all on public.chat_key_shares   from anon, authenticated;
grant select, insert, delete on public.chat_devices      to authenticated;
grant select, insert         on public.chat_key_versions to authenticated;
grant select, insert         on public.chat_key_shares   to authenticated;

drop policy if exists chat_devices_read   on public.chat_devices;
drop policy if exists chat_devices_add    on public.chat_devices;
drop policy if exists chat_devices_remove on public.chat_devices;
drop policy if exists chat_keys_read      on public.chat_key_versions;
drop policy if exists chat_keys_add       on public.chat_key_versions;
drop policy if exists chat_shares_read    on public.chat_key_shares;
drop policy if exists chat_shares_add     on public.chat_key_shares;

-- Members see the devices of current members only, so nobody shares the key
-- with someone who has left.
create policy chat_devices_read on public.chat_devices
  for select to authenticated
  using ((select public.chat_member_role()) is not null and public.chat_role_of(user_id) is not null);
create policy chat_devices_add on public.chat_devices
  for insert to authenticated
  with check ((select public.chat_member_role()) is not null);
create policy chat_devices_remove on public.chat_devices
  for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.chat_member_role()) = 'ceo');

create policy chat_keys_read on public.chat_key_versions
  for select to authenticated
  using ((select public.chat_member_role()) is not null);
create policy chat_keys_add on public.chat_key_versions
  for insert to authenticated
  with check ((select public.chat_member_role()) is not null);

create policy chat_shares_read on public.chat_key_shares
  for select to authenticated
  using ((select public.chat_member_role()) is not null);
create policy chat_shares_add on public.chat_key_shares
  for insert to authenticated
  with check ((select public.chat_member_role()) is not null);

-- ── 3. Messages ──────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  sender_id        uuid references auth.users(id) on delete set null,
  sender_email     text not null,
  sender_name      text not null,
  sender_role      text not null check (sender_role in ('ceo', 'staff')),
  body             text,
  photo_path       text,
  client_id        uuid unique,
  telegram_sent_at timestamptz
);

alter table public.chat_messages add column if not exists ciphertext  text;
alter table public.chat_messages add column if not exists iv          text;
alter table public.chat_messages add column if not exists key_version int references public.chat_key_versions(version);
alter table public.chat_messages add column if not exists photo_iv    text;
alter table public.chat_messages add column if not exists kind            text not null default 'message';
alter table public.chat_messages add column if not exists leave_from      date;
alter table public.chat_messages add column if not exists leave_to        date;
alter table public.chat_messages add column if not exists emergency_type  text;
alter table public.chat_messages add column if not exists status          text;
alter table public.chat_messages add column if not exists decided_by      uuid references auth.users(id) on delete set null;
alter table public.chat_messages add column if not exists decided_by_name text;
alter table public.chat_messages add column if not exists decided_at      timestamptz;

-- New messages must be encrypted: no readable text, and photos only as
-- encrypted .bin files. (NOT VALID: leaves any older test messages alone.)
alter table public.chat_messages drop constraint if exists chat_messages_has_content;
alter table public.chat_messages drop constraint if exists chat_messages_photo_path_check;
alter table public.chat_messages drop constraint if exists chat_messages_encrypted;
alter table public.chat_messages drop constraint if exists chat_messages_kind;
alter table public.chat_messages add constraint chat_messages_photo_path_check
  check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.bin$') not valid;
alter table public.chat_messages add constraint chat_messages_encrypted
  check (
    body is null
    and (ciphertext is null or (char_length(ciphertext) <= 12000 and iv is not null and key_version is not null))
    and (kind <> 'message' or ciphertext is not null)
    and (photo_path is null or (photo_iv is not null and ciphertext is not null))
  ) not valid;
-- A request may go out without details (ciphertext) when the phone has no
-- chat key yet, so an emergency always gets through.
alter table public.chat_messages add constraint chat_messages_kind
  check (
    (kind = 'message' and leave_from is null and leave_to is null and emergency_type is null and status is null)
    or (kind = 'leave' and leave_from is not null and leave_to >= leave_from and leave_to - leave_from <= 30
        and emergency_type is null and photo_path is null and status in ('pending', 'approved', 'declined'))
    or (kind = 'emergency' and emergency_type in ('fire', 'fuel_leak', 'accident', 'robbery', 'equipment', 'other')
        and leave_from is null and leave_to is null and photo_path is null and status in ('open', 'handled'))
  ) not valid;

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
  if new.body is not null then
    raise exception 'Messages must be encrypted on the device' using errcode = '22023';
  end if;
  -- Only the newest chat key: someone who left can't read what's sent after.
  if new.ciphertext is null then
    new.iv := null;
    new.key_version := null;
  elsif new.key_version is distinct from (select max(v.version) from public.chat_key_versions v) then
    raise exception 'The chat key has changed. Try again.' using errcode = '40001';
  end if;

  new.kind := coalesce(new.kind, 'message');
  if new.kind = 'leave' then
    if v_role <> 'staff' then
      raise exception 'Only staff can ask for a day off' using errcode = '22023';
    end if;
    if new.leave_from < (now() at time zone 'Asia/Yangon')::date then
      raise exception 'The day off can''t start in the past' using errcode = '22023';
    end if;
    new.status := 'pending';
    new.emergency_type := null;
  elsif new.kind = 'emergency' then
    if exists (
      select 1 from public.chat_messages m
      where m.sender_id = auth.uid() and m.kind = 'emergency' and m.created_at > now() - interval '1 minute'
    ) then
      raise exception 'You just sent an emergency alert. Wait a minute before sending another.' using errcode = '22023';
    end if;
    new.status := 'open';
    new.leave_from := null;
    new.leave_to := null;
  else
    new.status := null;
    new.leave_from := null;
    new.leave_to := null;
    new.emergency_type := null;
  end if;
  new.decided_by      := null;
  new.decided_by_name := null;
  new.decided_at      := null;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();

  new.id               := gen_random_uuid();
  new.created_at       := now();
  new.sender_id        := auth.uid();
  new.sender_email     := v_email;
  new.sender_name      := split_part(v_email, '@', 1);
  new.sender_role      := v_role;
  new.telegram_sent_at := null;

  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> auth.uid()::text then
    raise exception 'You can only post photos you uploaded' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.chat_messages_stamp() from public, anon, authenticated;

-- A CEO approves / declines a day off, or marks an emergency handled.
-- (No one can UPDATE chat_messages directly.)
create or replace function public.chat_decide(p_message uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text;
  v_status text;
  v_by     text;
begin
  if public.chat_member_role() is distinct from 'ceo' then
    raise exception 'Only a CEO can do this' using errcode = '42501';
  end if;
  select m.kind, m.status into v_kind, v_status from public.chat_messages m where m.id = p_message for update;
  if v_kind is null then
    raise exception 'That request was deleted' using errcode = 'P0002';
  end if;
  if not ((v_kind = 'leave' and p_status in ('approved', 'declined')) or (v_kind = 'emergency' and p_status = 'handled')) then
    raise exception 'Not allowed' using errcode = '22023';
  end if;
  if v_status is distinct from (case v_kind when 'leave' then 'pending' else 'open' end) then
    raise exception 'Someone already marked this %', v_status using errcode = '22023';
  end if;
  select split_part(lower(u.email), '@', 1) into v_by from auth.users u where u.id = auth.uid();
  update public.chat_messages
     set status = p_status, decided_by = auth.uid(), decided_by_name = v_by, decided_at = now()
   where id = p_message;
end;
$$;

revoke all on function public.chat_decide(uuid, text) from public, anon;
grant execute on function public.chat_decide(uuid, text) to authenticated;

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

-- Live updates. Realtime applies each table's read policy to each subscriber.
do $$
declare t text;
begin
  foreach t in array array['chat_messages', 'chat_devices', 'chat_key_versions', 'chat_key_shares'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ── 4. Photos ────────────────────────────────────────────────────────────────
-- Private bucket of encrypted files, in a folder named after the uploader.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 5242880, array['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp'])
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

-- ── 5. Telegram ──────────────────────────────────────────────────────────────
-- Only day-off requests and emergencies alert the CEOs on Telegram; ordinary
-- chat messages don't. The reason / details stay encrypted and aren't sent.
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
  for each row
  when (new.kind in ('leave', 'emergency'))
  execute function public.notify_chat_telegram();
