-- Policy Center: uploaded rule packages + the workspace default package per club.
-- Bundled presets live in the app (src/lib/rights/policies); only uploads and the selection are stored here.
-- An upload is NEVER verified: kind is always DEMO, whatever the uploaded JSON declared.
-- Server-only: RLS on, no anon/authenticated privileges; the app uses the secret key.

-- ---------- Uploaded packages (append-only; a new version is a new row) ----------

create table public.reroute_policy_packages (
  id text not null,
  version text not null,
  club text not null,
  title text not null,
  kind text not null default 'DEMO' check (kind = 'DEMO'),
  source_type text not null check (source_type in ('UPLOADED_JSON', 'UPLOADED_CSV', 'SAMPLE_DOCUMENT_MAPPING')),
  document jsonb not null,                      -- Policy (PolicySchema-validated by the app, kind forced to DEMO)
  file_name text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by text not null,
  created_at timestamptz not null default now(),
  primary key (id, version),
  constraint reroute_policy_packages_document_id check (document ->> 'id' = id and document ->> 'version' = version),
  constraint reroute_policy_packages_document_kind check (document ->> 'kind' = 'DEMO')
);
create index reroute_policy_packages_club_idx on public.reroute_policy_packages (club, created_at desc);

create trigger reroute_policy_packages_append_only before update or delete on public.reroute_policy_packages
  for each row execute function public.reroute_prevent_mutation();
create trigger reroute_policy_packages_no_truncate before truncate on public.reroute_policy_packages
  for each statement execute function public.reroute_prevent_mutation();

-- ---------- Workspace default package per club (preset or uploaded; latest choice wins) ----------

create table public.reroute_policy_selection (
  club text primary key,
  package_id text not null,
  package_version text not null,
  selected_by text not null,
  selected_at timestamptz not null default now()
);

-- ---------- Server-only access ----------

alter table public.reroute_policy_packages enable row level security;
alter table public.reroute_policy_selection enable row level security;

revoke all on public.reroute_policy_packages, public.reroute_policy_selection from anon, authenticated;
