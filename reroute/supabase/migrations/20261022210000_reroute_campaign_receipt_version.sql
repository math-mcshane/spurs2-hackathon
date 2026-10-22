-- Ties receipts to the exact campaign version they cover, and makes a new campaign version unreviewed.

-- Which campaign version a receipt covers. Required for campaign receipts from now on (NOT VALID: rows
-- written before this migration are not re-checked).
alter table public.reroute_receipts
  add column campaign_version integer,
  add constraint reroute_receipts_campaign_version_fk
    foreign key (campaign_id, campaign_version) references public.reroute_campaign_versions (campaign_id, version),
  add constraint reroute_receipts_campaign_version_required
    check (campaign_id is null or campaign_version is not null) not valid;

/**
 * Same contract as before, but a new version clears the campaign's status, review and receipt: an approval
 * of version N never carries over to version N+1.
 */
create or replace function public.reroute_save_campaign_version(
  p_campaign_id uuid,
  p_draft jsonb,
  p_actor text,
  p_goal_run_id text default null,
  p_opportunity_id text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  next_version integer;
begin
  insert into public.reroute_campaigns as c (id, goal_run_id, opportunity_id, current_version)
  values (p_campaign_id, p_goal_run_id, p_opportunity_id, 1)
  on conflict (id) do update
    set current_version = c.current_version + 1,
        goal_run_id = coalesce(c.goal_run_id, excluded.goal_run_id),
        opportunity_id = coalesce(c.opportunity_id, excluded.opportunity_id),
        status = 'DRAFT',
        review_status = null,
        receipt_id = null,
        updated_at = now()
  returning c.current_version into next_version;

  insert into public.reroute_campaign_versions (campaign_id, version, draft, actor)
  values (p_campaign_id, next_version, p_draft, p_actor);
  return next_version;
end;
$$;

-- `create or replace` keeps existing grants; restate them so this file is self-describing.
revoke all on function public.reroute_save_campaign_version(uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.reroute_save_campaign_version(uuid, jsonb, text, text, text) to service_role;
