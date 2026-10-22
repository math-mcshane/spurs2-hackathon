create table if not exists public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version text not null,
  name text not null,
  status text not null check (status in ('DRAFT', 'APPROVED', 'RETIRED')),
  locked_percentage integer not null check (locked_percentage between 80 and 100),
  club_rule_pack text,
  league_rule_pack text,
  partner_rule_pack text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_key, version)
);

create table if not exists public.agreement_clauses (
  id uuid primary key default gen_random_uuid(),
  clause_key text not null,
  version text not null,
  title text not null,
  body text not null,
  source_authority text not null,
  locked boolean not null default true,
  allowed_variables text[] not null default '{}',
  status text not null check (status in ('DRAFT', 'APPROVED', 'RETIRED')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (clause_key, version)
);

create table if not exists public.agreement_template_clauses (
  template_id uuid not null references public.agreement_templates(id),
  clause_id uuid not null references public.agreement_clauses(id),
  position integer not null,
  required boolean not null default true,
  primary key (template_id, clause_id),
  unique (template_id, position)
);

create table if not exists public.agreement_drafts (
  id uuid primary key default gen_random_uuid(),
  agreement_reference text not null unique,
  template_id uuid not null references public.agreement_templates(id),
  asset_id uuid not null references public.assets(id),
  publication_request_id uuid references public.publication_requests(id),
  partner_name text not null,
  campaign_name text not null,
  variables jsonb not null,
  rendered_text text not null,
  validation_status text not null check (validation_status in ('READY', 'REVIEW', 'BLOCKED')),
  validation_reasons text[] not null default '{}',
  rendered_hash text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.agreement_approvals (
  id uuid primary key default gen_random_uuid(),
  agreement_draft_id uuid not null references public.agreement_drafts(id),
  reviewer_id uuid references auth.users(id),
  role_name text not null,
  outcome text not null check (outcome in ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  comment text,
  decided_at timestamptz not null default now()
);

create index if not exists agreement_templates_status_idx on public.agreement_templates (status, template_key);
create index if not exists agreement_drafts_asset_idx on public.agreement_drafts (asset_id, created_at desc);
create index if not exists agreement_approvals_draft_idx on public.agreement_approvals (agreement_draft_id, decided_at);

alter table public.agreement_templates enable row level security;
alter table public.agreement_clauses enable row level security;
alter table public.agreement_template_clauses enable row level security;
alter table public.agreement_drafts enable row level security;
alter table public.agreement_approvals enable row level security;

comment on table public.agreement_templates is 'Versioned counsel-governed templates; locked_percentage may never be below 80.';
comment on table public.agreement_clauses is 'Approved or draft clauses with explicit source authority and bounded variables.';
comment on table public.agreement_drafts is 'Rendered agreements plus deterministic guardrail results and content hash.';
