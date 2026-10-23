-- Rights Passport mirror (Databricks gold.l2_decisions.passport_json → Studio)
-- Paste after partners/eligible migrations. DEMO / sample rules only.

create table if not exists public.media_passports (
  media_id text primary key,
  decision_id text,
  verdict text not null check (verdict in ('ALLOWED', 'BLOCKED', 'NEEDS_REVIEW')),
  policy_pack_id text,
  policy_version text,
  passport_json jsonb not null default '{}'::jsonb,
  rules_fired text[] not null default '{}',
  usable_until date,
  demo boolean not null default true,
  decided_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists media_passports_verdict_idx on public.media_passports (verdict);
create index if not exists media_passports_usable_until_idx on public.media_passports (usable_until);

comment on table public.media_passports is
  'Latest Rights Passport grid per media (7 uses × 3 regions). Sample rules — not legal advice.';

alter table public.media_passports enable row level security;

-- Active pack versions for Studio /api/policies
create table if not exists public.policy_pack_activations (
  id uuid primary key default gen_random_uuid(),
  layer text not null check (layer in ('L1', 'L2')),
  pack_id text not null,
  version text not null,
  -- empty string = catalog-wide default (avoids NULL unique issues)
  club_code text not null default '' check (club_code in ('', 'SAS', 'TOT')),
  activated_at timestamptz not null default now(),
  notes text,
  unique (layer, pack_id, version, club_code)
);

alter table public.policy_pack_activations enable row level security;
