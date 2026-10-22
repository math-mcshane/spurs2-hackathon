-- REROUTE persistent store: rights receipts, human review log, HUMAN timecoded observations.
-- Stores ScorePlay ids, decisions and evidence text only — never event media (spec §9).
-- Run once in Supabase → SQL Editor. Idempotent.

create table if not exists public.reroute_receipts (
  id text primary key,
  receipt jsonb not null,                       -- RightsReceipt contract (Zod-validated by the app)
  verdict text not null check (verdict in ('ALLOWED', 'BLOCKED', 'NEEDS_REVIEW')),
  human_review_status text not null check (human_review_status in ('PENDING', 'APPROVED', 'REJECTED')),
  source_asset_ids text[] not null,
  version integer not null default 1,           -- optimistic concurrency for read-modify-write
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reroute_reviews (
  id bigint generated always as identity primary key,
  receipt_id text not null references public.reroute_receipts (id) on delete cascade,
  status text not null check (status in ('APPROVED', 'REJECTED')),
  reviewer text not null,
  at timestamptz not null default now()
);
create index if not exists reroute_reviews_receipt_id_idx on public.reroute_reviews (receipt_id, at);

create table if not exists public.reroute_observations (
  id uuid primary key default gen_random_uuid(),
  scoreplay_media_id text not null,
  evidence jsonb not null,                      -- Evidence contract, source/origin = HUMAN
  created_at timestamptz not null default now()
);
create index if not exists reroute_observations_media_idx on public.reroute_observations (scoreplay_media_id, created_at);

-- Server-only access through the secret key; no direct browser access.
alter table public.reroute_receipts enable row level security;
alter table public.reroute_reviews enable row level security;
alter table public.reroute_observations enable row level security;
revoke all on public.reroute_receipts, public.reroute_reviews, public.reroute_observations from anon, authenticated;
