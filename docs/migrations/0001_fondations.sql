-- Tufani · migration 0001 · fondations
-- Compagnies, gares, personnel et rôles, cloisonnement (RLS), journal d'audit.
-- À appliquer dans Lovable → Cloud → SQL editor, une fois Lovable Cloud activé.
--
-- Principe : chaque ligne appartient à une compagnie ; une personne ne lit que
-- les compagnies (et les gares) qui lui sont confiées. Les écritures sensibles
-- passent par des fonctions qui vérifient le rôle et écrivent dans le journal.

-- ────────────────────────────────────────────────────────────────────────────
-- Types
-- ────────────────────────────────────────────────────────────────────────────

create type public.member_role as enum ('gerant', 'chef_de_gare', 'agent', 'controleur', 'comptable');
create type public.company_status as enum ('en_attente', 'validee', 'suspendue');

-- ────────────────────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────────────────────

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.company_status not null default 'en_attente',
  service_phone text check (service_phone ~ '^\+223[0-9]{8}$'),
  rccm text,
  nif text,
  created_at timestamptz not null default now(),
  validated_at timestamptz
);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 80),
  city text not null check (length(trim(city)) between 2 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, city, name)
);
create index stations_company_idx on public.stations (company_id);

-- Une ligne par personne et par compagnie. Les rôles sont une liste :
-- un chef de gare peut aussi vendre au guichet.
create table public.members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  phone text not null check (phone ~ '^\+223[0-9]{8}$'),
  full_name text not null check (length(trim(full_name)) between 2 and 80),
  roles public.member_role[] not null check (cardinality(roles) between 1 and 5),
  all_stations boolean not null default false,
  active boolean not null default true,
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  deactivated_at timestamptz,
  unique (company_id, phone)
);
create index members_user_idx on public.members (user_id) where active;
create index members_company_idx on public.members (company_id);

create table public.member_stations (
  member_id uuid not null references public.members (id) on delete cascade,
  station_id uuid not null references public.stations (id) on delete cascade,
  primary key (member_id, station_id)
);

-- Journal en ajout seul : ni modification ni suppression, même par un admin.
create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete restrict,
  actor uuid references auth.users (id) on delete set null,
  action text not null,
  target_table text,
  target_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index audit_company_idx on public.audit_log (company_id, at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- Fonctions d'accès (security definer : lisent les droits sans boucler sur la RLS)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function public.has_company_role(p_company uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members
    where company_id = p_company and user_id = auth.uid() and active and roles && p_roles
  );
$$;

create or replace function public.is_company_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members where company_id = p_company and user_id = auth.uid() and active
  );
$$;

-- Accès à une gare : admin, membre « toutes les gares », ou gare explicitement confiée.
create or replace function public.can_access_station(p_station uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1
    from stations s
    join members m on m.company_id = s.company_id and m.user_id = auth.uid() and m.active
    where s.id = p_station
      and (m.all_stations or exists (
        select 1 from member_stations ms where ms.member_id = m.id and ms.station_id = s.id
      ))
  );
$$;

create or replace function public.log_action(
  p_company uuid, p_action text, p_table text, p_target text, p_before jsonb, p_after jsonb
) returns void language sql security definer set search_path = public as $$
  insert into audit_log (company_id, actor, action, target_table, target_id, before, after)
  values (p_company, auth.uid(), p_action, p_table, p_target, p_before, p_after);
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Actions métier
-- ────────────────────────────────────────────────────────────────────────────

-- Première étape de la mise en route : la personne connectée crée sa compagnie
-- et en devient gérante. La compagnie reste « en attente » jusqu'à validation.
create or replace function public.create_company(p_name text, p_slug text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_phone text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select '+' || phone into v_phone from auth.users where id = auth.uid();
  if v_phone is null or v_phone !~ '^\+223[0-9]{8}$' then
    raise exception 'Numéro malien vérifié requis';
  end if;

  insert into companies (name, slug) values (trim(p_name), p_slug) returning id into v_company;
  insert into members (company_id, user_id, phone, full_name, roles, all_stations, activated_at, invited_by)
  values (v_company, auth.uid(), v_phone, trim(p_full_name), array['gerant']::member_role[], true, now(), auth.uid());

  perform log_action(v_company, 'compagnie.creee', 'companies', v_company::text, null,
    jsonb_build_object('name', trim(p_name), 'slug', p_slug));
  return v_company;
end;
$$;

-- À la connexion : rattache au compte les invitations envoyées à ce numéro.
create or replace function public.claim_invitations()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_count integer;
begin
  if auth.uid() is null then return 0; end if;
  select '+' || phone into v_phone from auth.users where id = auth.uid();
  if v_phone is null then return 0; end if;

  update members set user_id = auth.uid(), activated_at = now()
  where phone = v_phone and user_id is null and active;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Désactivation d'un membre : coupe l'accès immédiatement, garde l'historique.
create or replace function public.deactivate_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row members;
begin
  select * into v_row from members where id = p_member;
  if not found then raise exception 'Membre introuvable'; end if;
  if not (public.is_platform_admin() or public.has_company_role(v_row.company_id, array['gerant']::member_role[])) then
    raise exception 'Réservé au gérant';
  end if;
  if v_row.user_id = auth.uid() then raise exception 'Impossible de se désactiver soi-même'; end if;

  update members set active = false, deactivated_at = now() where id = p_member;
  perform log_action(v_row.company_id, 'membre.desactive', 'members', p_member::text, to_jsonb(v_row), null);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Cloisonnement (RLS)
-- ────────────────────────────────────────────────────────────────────────────

alter table public.platform_admins enable row level security;
alter table public.companies enable row level security;
alter table public.stations enable row level security;
alter table public.members enable row level security;
alter table public.member_stations enable row level security;
alter table public.audit_log enable row level security;

create policy "admins lisent la liste des admins" on public.platform_admins
  for select using (public.is_platform_admin());

create policy "membres et admins lisent leur compagnie" on public.companies
  for select using (public.is_platform_admin() or public.is_company_member(id));
create policy "le gérant modifie sa compagnie" on public.companies
  for update using (public.has_company_role(id, array['gerant']::member_role[]))
  with check (public.has_company_role(id, array['gerant']::member_role[]));
create policy "les admins modifient les compagnies" on public.companies
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "membres lisent les gares de leur compagnie" on public.stations
  for select using (public.is_platform_admin() or public.is_company_member(company_id));
create policy "le gérant crée les gares" on public.stations
  for insert with check (public.has_company_role(company_id, array['gerant']::member_role[]));
create policy "le gérant modifie les gares" on public.stations
  for update using (public.has_company_role(company_id, array['gerant']::member_role[]))
  with check (public.has_company_role(company_id, array['gerant']::member_role[]));

create policy "chacun lit sa fiche, gérant et chefs de gare lisent l'équipe" on public.members
  for select using (
    user_id = auth.uid()
    or public.is_platform_admin()
    or public.has_company_role(company_id, array['gerant', 'chef_de_gare', 'comptable']::member_role[])
  );
create policy "le gérant invite" on public.members
  for insert with check (public.has_company_role(company_id, array['gerant']::member_role[]));
create policy "le gérant modifie l'équipe" on public.members
  for update using (public.has_company_role(company_id, array['gerant']::member_role[]))
  with check (public.has_company_role(company_id, array['gerant']::member_role[]));

create policy "membres lisent les affectations de leur compagnie" on public.member_stations
  for select using (exists (
    select 1 from members m where m.id = member_id and (public.is_platform_admin() or public.is_company_member(m.company_id))
  ));
create policy "le gérant affecte aux gares" on public.member_stations
  for all using (exists (
    select 1 from members m where m.id = member_id and public.has_company_role(m.company_id, array['gerant']::member_role[])
  )) with check (exists (
    select 1 from members m where m.id = member_id and public.has_company_role(m.company_id, array['gerant']::member_role[])
  ));

create policy "gérant, comptable et admins lisent le journal" on public.audit_log
  for select using (
    public.is_platform_admin()
    or (company_id is not null and public.has_company_role(company_id, array['gerant', 'comptable']::member_role[]))
  );
-- Aucune politique d'écriture sur audit_log : on n'y écrit que via log_action().

revoke update, delete on public.audit_log from anon, authenticated;
revoke execute on function public.log_action(uuid, text, text, text, jsonb, jsonb) from anon, authenticated, public;
grant execute on function public.create_company(text, text, text) to authenticated;
grant execute on function public.claim_invitations() to authenticated;
grant execute on function public.deactivate_member(uuid) to authenticated;
