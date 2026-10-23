-- Partner discovery CDM (Studio reads Supabase; Databricks syncs eligible + evidence)
-- Paste into Supabase SQL Editor after 20261022220000_twelvelabs_evidence.sql
-- DEMO agreements are fictional — never real Spurs/Tottenham/Nike contracts.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Partners (brand directory)
-- ---------------------------------------------------------------------------
create table if not exists public.partners (
  id text primary key,
  brand_slug text not null,
  display_name text not null,
  scoreplay_sponsor_label text,
  demo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint partners_brand_slug_key unique (brand_slug)
);

comment on table public.partners is
  'Brand / partner directory. demo=true rows are fictional hackathon seed data.';

-- ---------------------------------------------------------------------------
-- Partnership agreements (club × partner entitlements)
-- ---------------------------------------------------------------------------
create table if not exists public.partnership_agreements (
  id text primary key,
  partner_id text not null references public.partners (id),
  club_code text not null check (club_code in ('SAS', 'TOT')),
  usage_allowed text[] not null default '{ORGANIC,SPONSORED}',
  territories text[] not null default '{}',
  platforms text[] not null default '{instagram,youtube,tiktok,x}',
  window_start timestamptz not null,
  window_end timestamptz not null,
  exclusivity_notes text,
  demo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists partnership_agreements_club_idx
  on public.partnership_agreements (club_code);

create index if not exists partnership_agreements_partner_idx
  on public.partnership_agreements (partner_id);

create index if not exists partnership_agreements_window_idx
  on public.partnership_agreements (window_start, window_end);

comment on table public.partnership_agreements is
  'Club–partner DEMO agreements for discover + decide. Observations never grant rights alone.';

-- ---------------------------------------------------------------------------
-- Eligible media mirror (L1-pass pool for Studio discover)
-- ---------------------------------------------------------------------------
create table if not exists public.eligible_media (
  media_id text primary key,
  club_code text check (club_code is null or club_code in ('SAS', 'TOT')),
  company_id text,
  title text,
  media_type text,
  cdn_url text,
  thumbnail_url text,
  event_label text,
  game_date date,
  sponsors text[] not null default '{}',
  brands_seen text[] not null default '{}',
  tl_status text check (tl_status is null or tl_status in ('pending', 'indexing', 'ready', 'failed', 'skipped')),
  tl_asset_id text,
  tl_index_id text,
  l1_passed_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists eligible_media_club_idx
  on public.eligible_media (club_code);

create index if not exists eligible_media_game_date_idx
  on public.eligible_media (game_date desc nulls last);

create index if not exists eligible_media_brands_seen_idx
  on public.eligible_media using gin (brands_seen);

create index if not exists eligible_media_tl_status_idx
  on public.eligible_media (tl_status);

comment on table public.eligible_media is
  'Mirror of UC silver.eligible_artifacts + facets for Studio NL discover (service-role upsert from Databricks).';

-- ---------------------------------------------------------------------------
-- RLS: service-role only
-- ---------------------------------------------------------------------------
alter table public.partners enable row level security;
alter table public.partnership_agreements enable row level security;
alter table public.eligible_media enable row level security;
