-- ScorePlay Connect webhook landings + inbound media projection
-- Consume media.create / media.update; inspect every file that hits REROUTE.

create extension if not exists pgcrypto;

create table if not exists public.scoreplay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  event text not null check (event in ('media.create', 'media.update')),
  media_id text,
  company_id text,
  media_title text,
  media_type text,
  cdn_url text,
  thumbnail_url text,
  media_status text,
  payload jsonb not null default '{}'::jsonb,
  headers jsonb,
  media_snapshot jsonb,
  duplicate boolean not null default false,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint scoreplay_webhook_events_event_id_key unique (event_id)
);

create index if not exists scoreplay_webhook_events_received_at_idx
  on public.scoreplay_webhook_events (received_at desc);

create index if not exists scoreplay_webhook_events_media_id_idx
  on public.scoreplay_webhook_events (media_id);

create index if not exists scoreplay_webhook_events_event_idx
  on public.scoreplay_webhook_events (event);

comment on table public.scoreplay_webhook_events is
  'Append-oriented ScorePlay webhook log (media.create / media.update). Service-role writes from REROUTE.';

-- One row per ScorePlay media_id — latest webhook wins (for “all files coming in”)
create table if not exists public.scoreplay_inbound_media (
  media_id text primary key,
  company_id text,
  title text,
  media_type text,
  cdn_url text,
  thumbnail_url text,
  media_status text,
  last_event text not null check (last_event in ('media.create', 'media.update')),
  last_event_id text not null,
  last_payload jsonb not null default '{}'::jsonb,
  media_snapshot jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  create_count integer not null default 0,
  update_count integer not null default 0
);

create index if not exists scoreplay_inbound_media_last_seen_at_idx
  on public.scoreplay_inbound_media (last_seen_at desc);

comment on table public.scoreplay_inbound_media is
  'Latest projection of each ScorePlay media_id received via webhooks — browse all inbound files here.';

alter table public.scoreplay_webhook_events enable row level security;
alter table public.scoreplay_inbound_media enable row level security;

-- No anon/authenticated policies: REROUTE writes with the secret/service key only.
