-- Tufani · migration 0003 · mise en route d'une compagnie
-- Lignes et arrêts, tarifs par tronçon, modèles de bus et bus, semaine type,
-- règle d'annulation, compte de versement, invitations de l'équipe.
-- Lecture : membres de la compagnie (versements : gérant et comptable seulement).
-- Écriture : gérant, directement (RLS) ou via des fonctions journalisées.

-- ────────────────────────────────────────────────────────────────────────────
-- Lignes et arrêts
-- ────────────────────────────────────────────────────────────────────────────

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  name text not null check (length(trim(name)) between 3 and 120),
  sell_segments boolean not null default true,
  return_of uuid references public.routes (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index routes_company_idx on public.routes (company_id);

-- position 0 = départ ; minutes = temps de parcours depuis le départ.
create table public.route_stops (
  route_id uuid not null references public.routes (id) on delete cascade,
  position integer not null check (position between 0 and 30),
  station_id uuid not null references public.stations (id) on delete restrict,
  minutes integer not null default 0 check (minutes between 0 and 4320),
  primary key (route_id, position),
  unique (route_id, station_id)
);

-- Prix adulte d'un tronçon (du point from_pos au point to_pos), en FCFA entiers.
create table public.fares (
  route_id uuid not null references public.routes (id) on delete cascade,
  from_pos integer not null check (from_pos >= 0),
  to_pos integer not null,
  price integer not null check (price between 100 and 2000000),
  primary key (route_id, from_pos, to_pos),
  check (to_pos > from_pos)
);

-- ────────────────────────────────────────────────────────────────────────────
-- Bus
-- ────────────────────────────────────────────────────────────────────────────

-- pattern : une rangée de gauche à droite, 1 = siège, 0 = couloir (ex. « 11011 »).
create table public.bus_models (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 60),
  seat_rows integer not null check (seat_rows between 1 and 25),
  pattern text not null check (pattern ~ '^[01]{2,7}$' and pattern like '%1%'),
  capacity integer generated always as (seat_rows * (length(pattern) - length(replace(pattern, '1', '')))) stored,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.buses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  model_id uuid not null references public.bus_models (id) on delete restrict,
  label text not null check (length(trim(label)) between 1 and 40),
  plate text check (plate is null or length(trim(plate)) between 3 and 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, label)
);

-- ────────────────────────────────────────────────────────────────────────────
-- Semaine type : les départs du calendrier seront générés à partir d'ici.
-- ────────────────────────────────────────────────────────────────────────────

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  route_id uuid not null references public.routes (id) on delete cascade,
  departure_time time not null,
  -- 1 = lundi … 7 = dimanche
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  model_id uuid not null references public.bus_models (id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (route_id, departure_time)
);
create index schedules_company_idx on public.schedules (company_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Annulation, versements
-- ────────────────────────────────────────────────────────────────────────────

create table public.cancellation_policies (
  company_id uuid primary key references public.companies (id) on delete restrict,
  preset text not null check (preset in ('souple', 'standard', 'stricte')),
  free_change_once boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.payout_accounts (
  company_id uuid primary key references public.companies (id) on delete restrict,
  method text not null check (method in ('wave', 'orange_money', 'banque')),
  account text not null check (length(trim(account)) between 8 and 40),
  holder text not null check (length(trim(holder)) between 2 and 80),
  frequency text not null check (frequency in ('quotidien', 'hebdomadaire', 'bimensuel')),
  -- Après un changement de compte, les versements sont suspendus jusqu'à cette date.
  hold_until timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ────────────────────────────────────────────────────────────────────────────
-- Fonctions
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.route_company(p_route uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from routes where id = p_route;
$$;

-- Crée une ligne et ses arrêts, et en option la ligne retour (arrêts inversés).
create or replace function public.create_route(
  p_company uuid, p_station_ids uuid[], p_minutes integer[], p_sell_segments boolean, p_with_return boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_route uuid;
  v_return uuid;
  v_n integer := coalesce(array_length(p_station_ids, 1), 0);
  v_total integer;
  v_name text;
  v_back text;
  i integer;
begin
  if not public.has_company_role(p_company, array['gerant']::member_role[]) then
    raise exception 'Réservé au gérant';
  end if;
  if v_n < 2 then raise exception 'Une ligne a au moins un départ et une arrivée'; end if;
  if coalesce(array_length(p_minutes, 1), 0) <> v_n then raise exception 'Temps de parcours incomplets'; end if;
  if (select count(*) from stations where id = any (p_station_ids) and company_id = p_company) <> v_n then
    raise exception 'Gare inconnue ou en double';
  end if;
  for i in 2..v_n loop
    if p_minutes[i] < p_minutes[i - 1] then raise exception 'Les temps de parcours doivent augmenter'; end if;
  end loop;

  select string_agg(s.city, ' → ' order by t.ord) into v_name
  from unnest(array[p_station_ids[1], p_station_ids[v_n]]) with ordinality t(id, ord)
  join stations s on s.id = t.id;

  insert into routes (company_id, name, sell_segments) values (p_company, v_name, p_sell_segments) returning id into v_route;
  insert into route_stops (route_id, position, station_id, minutes)
  select v_route, k - 1, p_station_ids[k], p_minutes[k] from generate_series(1, v_n) k;

  if p_with_return then
    v_total := p_minutes[v_n];
    select string_agg(s.city, ' → ' order by t.ord) into v_back
    from unnest(array[p_station_ids[v_n], p_station_ids[1]]) with ordinality t(id, ord)
    join stations s on s.id = t.id;
    insert into routes (company_id, name, sell_segments, return_of)
    values (p_company, v_back, p_sell_segments, v_route) returning id into v_return;
    insert into route_stops (route_id, position, station_id, minutes)
    select v_return, v_n - k, p_station_ids[k], v_total - p_minutes[k] from generate_series(1, v_n) k;
  end if;

  perform log_action(p_company, 'ligne.creee', 'routes', v_route::text, null,
    jsonb_build_object('name', v_name, 'arrets', v_n, 'retour', p_with_return));
  return v_route;
end;
$$;

-- Compte de versement : seul le gérant le modifie ; un changement suspend les versements 48 h.
create or replace function public.set_payout_account(
  p_company uuid, p_method text, p_account text, p_holder text, p_frequency text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_old payout_accounts;
begin
  if not public.has_company_role(p_company, array['gerant']::member_role[]) then
    raise exception 'Réservé au gérant';
  end if;
  select * into v_old from payout_accounts where company_id = p_company;
  insert into payout_accounts (company_id, method, account, holder, frequency, hold_until, updated_at, updated_by)
  values (p_company, p_method, trim(p_account), trim(p_holder), p_frequency,
    case when v_old.company_id is not null and (v_old.method, v_old.account) is distinct from (p_method, trim(p_account))
      then now() + interval '48 hours' else v_old.hold_until end,
    now(), auth.uid())
  on conflict (company_id) do update set
    method = excluded.method, account = excluded.account, holder = excluded.holder,
    frequency = excluded.frequency, hold_until = excluded.hold_until,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform log_action(p_company, 'versement.compte_modifie', 'payout_accounts', p_company::text,
    case when v_old.company_id is null then null else jsonb_build_object('method', v_old.method, 'account', v_old.account) end,
    jsonb_build_object('method', p_method, 'account', trim(p_account), 'frequency', p_frequency));
end;
$$;

-- Invitation d'un membre de l'équipe (le SMS est envoyé par le serveur).
create or replace function public.invite_member(
  p_company uuid, p_phone text, p_full_name text, p_roles public.member_role[], p_station_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_all boolean := 'gerant' = any (p_roles) or 'comptable' = any (p_roles);
begin
  if not public.has_company_role(p_company, array['gerant']::member_role[]) then
    raise exception 'Réservé au gérant';
  end if;
  if not v_all and coalesce(array_length(p_station_ids, 1), 0) = 0 then
    raise exception 'Choisissez au moins une gare';
  end if;
  if exists (select 1 from unnest(p_station_ids) sid where not exists (
    select 1 from stations s where s.id = sid and s.company_id = p_company)) then
    raise exception 'Gare inconnue';
  end if;

  insert into members (company_id, user_id, phone, full_name, roles, all_stations, invited_by)
  values (p_company, (select id from auth.users where '+' || phone = p_phone), p_phone, trim(p_full_name), p_roles, v_all, auth.uid())
  returning id into v_member;
  update members set activated_at = now() where id = v_member and user_id is not null;
  if not v_all then
    insert into member_stations (member_id, station_id) select v_member, unnest(p_station_ids);
  end if;

  perform log_action(p_company, 'membre.invite', 'members', v_member::text, null,
    jsonb_build_object('phone', p_phone, 'roles', p_roles));
  return v_member;
end;
$$;

-- État de la mise en route, pour la liste des étapes.
create or replace function public.setup_status(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_company_member(p_company) then null else jsonb_build_object(
    'gares', (select count(*) from stations where company_id = p_company and active),
    'lignes', (select count(*) from routes where company_id = p_company and active),
    'modeles', (select count(*) from bus_models where company_id = p_company),
    'bus', (select count(*) from buses where company_id = p_company and active),
    'horaires', (select count(*) from schedules where company_id = p_company and active),
    'troncons_sans_prix', (
      select count(*) from routes r
      cross join lateral (select max(position) as last from route_stops where route_id = r.id) m
      cross join lateral generate_series(0, m.last - 1) a(f)
      cross join lateral generate_series(a.f + 1, m.last) b(t)
      where r.company_id = p_company and r.active and (r.sell_segments or (a.f = 0 and b.t = m.last))
        and not exists (select 1 from fares where route_id = r.id and from_pos = a.f and to_pos = b.t)),
    'annulation', exists (select 1 from cancellation_policies where company_id = p_company),
    'equipe', (select count(*) from members where company_id = p_company and active),
    'versements', exists (select 1 from payout_accounts where company_id = p_company)
  ) end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Cloisonnement (RLS)
-- ────────────────────────────────────────────────────────────────────────────

alter table public.routes enable row level security;
alter table public.route_stops enable row level security;
alter table public.fares enable row level security;
alter table public.bus_models enable row level security;
alter table public.buses enable row level security;
alter table public.schedules enable row level security;
alter table public.cancellation_policies enable row level security;
alter table public.payout_accounts enable row level security;

create policy "membres lisent les lignes" on public.routes for select
  using (public.is_platform_admin() or public.is_company_member(company_id));
create policy "le gérant modifie les lignes" on public.routes for update
  using (public.has_company_role(company_id, array['gerant']::member_role[]))
  with check (public.has_company_role(company_id, array['gerant']::member_role[]));

create policy "membres lisent les arrêts" on public.route_stops for select
  using (public.is_platform_admin() or public.is_company_member(public.route_company(route_id)));

create policy "membres lisent les tarifs" on public.fares for select
  using (public.is_platform_admin() or public.is_company_member(public.route_company(route_id)));
create policy "le gérant gère les tarifs" on public.fares for all
  using (public.has_company_role(public.route_company(route_id), array['gerant']::member_role[]))
  with check (public.has_company_role(public.route_company(route_id), array['gerant']::member_role[]));

create policy "membres lisent les modèles de bus" on public.bus_models for select
  using (public.is_platform_admin() or public.is_company_member(company_id));
create policy "le gérant gère les modèles de bus" on public.bus_models for all
  using (public.has_company_role(company_id, array['gerant']::member_role[]))
  with check (public.has_company_role(company_id, array['gerant']::member_role[]));

create policy "membres lisent les bus" on public.buses for select
  using (public.is_platform_admin() or public.is_company_member(company_id));
create policy "le gérant gère les bus" on public.buses for all
  using (public.has_company_role(company_id, array['gerant']::member_role[]))
  with check (public.has_company_role(company_id, array['gerant']::member_role[]));

create policy "membres lisent la semaine type" on public.schedules for select
  using (public.is_platform_admin() or public.is_company_member(company_id));
create policy "le gérant gère la semaine type" on public.schedules for all
  using (public.has_company_role(company_id, array['gerant']::member_role[])
    and public.route_company(route_id) = company_id)
  with check (public.has_company_role(company_id, array['gerant']::member_role[])
    and public.route_company(route_id) = company_id);

create policy "membres lisent la règle d'annulation" on public.cancellation_policies for select
  using (public.is_platform_admin() or public.is_company_member(company_id));
create policy "le gérant gère la règle d'annulation" on public.cancellation_policies for all
  using (public.has_company_role(company_id, array['gerant']::member_role[]))
  with check (public.has_company_role(company_id, array['gerant']::member_role[]));

create policy "gérant et comptable lisent le compte de versement" on public.payout_accounts for select
  using (public.is_platform_admin() or public.has_company_role(company_id, array['gerant', 'comptable']::member_role[]));
-- Aucune écriture directe : uniquement via set_payout_account().

revoke execute on function public.route_company(uuid) from anon;
grant execute on function public.create_route(uuid, uuid[], integer[], boolean, boolean) to authenticated;
grant execute on function public.set_payout_account(uuid, text, text, text, text) to authenticated;
grant execute on function public.invite_member(uuid, text, text, public.member_role[], uuid[]) to authenticated;
grant execute on function public.setup_status(uuid) to authenticated;
