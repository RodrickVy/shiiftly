-- Shiftly :: 0007_employee_notes
--
-- Manager notes attached to a person: "trained on the till", "asked for
-- Fridays off from March", "late twice this week, spoke to them".
--
-- Visibility: managers only. These are an internal record kept *about*
-- someone, and a manager needs to be able to write one candidly. The
-- employee cannot read them, and the UI says so plainly to the manager
-- writing one, so nobody is misled about who can see what.
--
-- If you later want notes an employee can see, add a `shared boolean` column
-- and a second policy rather than loosening this one.

create table public.employee_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_membership_id uuid not null
    references public.organization_memberships (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employee_notes_by_member
  on public.employee_notes (employee_membership_id, created_at desc);

create trigger employee_notes_touch
  before update on public.employee_notes
  for each row execute function public.touch_updated_at();

alter table public.employee_notes enable row level security;

-- Managers of the organization, and nobody else -- not even the person the
-- note is about.
create policy employee_notes_managers on public.employee_notes
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

grant select, insert, update, delete on public.employee_notes to authenticated;
