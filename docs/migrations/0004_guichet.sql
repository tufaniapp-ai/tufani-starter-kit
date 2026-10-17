-- Tufani · migration 0004 · guichet
-- Départs générés depuis la semaine type, billets, vente au guichet.
-- Règle d'or : un siège ne peut pas être vendu deux fois sur des tronçons qui se
-- chevauchent. C'est la base elle-même qui l'interdit (contrainte d'exclusion),
-- même si deux guichets vendent à la même seconde.
-- Le Mali est à UTC toute l'année : l'heure locale = l'heure UTC.

create extension if not exists btree_gist;

-- ────────────────────────────────────────────────────────────────────────────
-- Départs
-- ────────────────────────────────────────────────────────────────────────────

create table public.departures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  route_id uuid not null references public.routes (id) on delete restrict,
  schedule_id uuid references public.schedules (id) on delete set null,
  departure_date date not null,
  departure_time time not null,
  departs_at timestamptz not null,
  model_id uuid not null references public.bus_models (id) on delete restrict,
  bus_id uuid references public.buses (id) on delete set null,
  status text not null default 'prevu' check (status in ('prevu', 'embarquement', 'parti', 'annule')),
  created_at timestamptz not null default now(),
  unique (route_id, departure_date, departure_time)
);
create index departures_company_date_idx on public.departures (company_id, departure_date);

-- ────────────────────────────────────────────────────────────────────────────
-- Billets
-- ────────────────────────────────────────────────────────────────────────────

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  departure_id uuid not null references public.departures (id) on delete restrict,
  seat integer not null check (seat between 1 and 200),
  from_pos integer not null check (from_pos >= 0),
  to_pos integer not null,
  passenger_name text not null check (length(trim(passenger_name)) between 2 and 80),
  passenger_phone text check (passenger_phone is null or passenger_phone ~ '^\+223[0-9]{8}$'),
  price integer not null check (price >= 0),
  channel text not null check (channel in ('guichet', 'en_ligne')),
  payment_method text not null check (payment_method in ('especes', 'orange_money', 'wave', 'moov_money', 'carte')),
  status text not null default 'valide' check (status in ('valide', 'embarque', 'annule')),
  code text not null unique check (code ~ '^TFN-[A-Z0-9]{6}$'),
  -- Référence de la vente côté guichet : rejouer une vente (réseau coupé) ne crée pas de doublon.
  sale_ref uuid not null,
  station_id uuid references public.stations (id) on delete restrict,
  sold_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (to_pos > from_pos),
  unique (sale_ref, seat),
  constraint tickets_no_double_sale exclude using gist (
    departure_id with =,
    seat with =,
    int4range(from_pos, to_pos) with &&
  ) where (status <> 'annule')
);
create index tickets_departure_idx on public.tickets (departure_id);
create index tickets_seller_day_idx on public.tickets (sold_by, created_at);

-- ────────────────────────────────────────────────────────────────────────────
-- Fonctions
-- ────────────────────────────────────────────────────────────────────────────

-- Code court lisible au guichet (sans 0/O ni 1/I pour éviter les confusions).
create or replace function public.new_ticket_code()
returns text language sql volatile set search_path = public as $$
  select 'TFN-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

-- Crée les départs des p_days prochains jours à partir de la semaine type.
-- Sans effet sur les départs déjà créés : on peut l'appeler autant qu'on veut.
create or replace function public.generate_departures(p_company uuid, p_days integer default 60)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not (public.is_platform_admin() or public.is_company_member(p_company)) then
    raise exception 'Accès refusé';
  end if;
  insert into departures (company_id, route_id, schedule_id, departure_date, departure_time, departs_at, model_id)
  select s.company_id, s.route_id, s.id, d::date, s.departure_time, (d::date + s.departure_time) at time zone 'UTC', s.model_id
  from schedules s
  join routes r on r.id = s.route_id and r.active
  cross join generate_series(current_date, current_date + least(greatest(p_days, 1), 120), interval '1 day') d
  where s.company_id = p_company and s.active
    and extract(isodow from d)::smallint = any (s.weekdays)
  on conflict (route_id, departure_date, departure_time) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Vente au guichet de plusieurs places en une fois (tout ou rien).
-- p_passengers : [{"name": "...", "phone": "+223…" ou null, "seat": 14}, …]
create or replace function public.sell_tickets(
  p_departure uuid, p_from integer, p_to integer, p_station uuid,
  p_payment text, p_passengers jsonb, p_sale_ref uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dep departures;
  v_route routes;
  v_last integer;
  v_capacity integer;
  v_price integer;
  v_boarding uuid;
  v_p jsonb;
  v_seat integer;
  v_out jsonb := '[]'::jsonb;
  v_ticket tickets;
begin
  -- Rejeu d'une vente déjà enregistrée (réseau coupé pendant l'envoi) : on renvoie le résultat.
  if exists (select 1 from tickets where sale_ref = p_sale_ref) then
    return (select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'seat', seat, 'price', price, 'name', passenger_name) order by seat)
            from tickets where sale_ref = p_sale_ref);
  end if;

  select * into v_dep from departures where id = p_departure;
  if not found then raise exception 'Départ introuvable'; end if;
  if v_dep.status not in ('prevu', 'embarquement') then raise exception 'Ce départ n''est plus en vente'; end if;
  if not public.has_company_role(v_dep.company_id, array['gerant', 'chef_de_gare', 'agent']::member_role[]) then
    raise exception 'Vente réservée au personnel du guichet';
  end if;
  if not public.can_access_station(p_station) then raise exception 'Cette gare ne vous est pas confiée'; end if;

  select * into v_route from routes where id = v_dep.route_id;
  select max(position) into v_last from route_stops where route_id = v_route.id;
  if p_from < 0 or p_to > v_last or p_to <= p_from then raise exception 'Trajet invalide'; end if;
  if not v_route.sell_segments and (p_from <> 0 or p_to <> v_last) then raise exception 'Cette ligne ne vend que le trajet complet'; end if;
  select station_id into v_boarding from route_stops where route_id = v_route.id and position = p_from;
  if v_boarding <> p_station then raise exception 'Le voyageur doit monter dans votre gare'; end if;

  select price into v_price from fares where route_id = v_route.id and from_pos = p_from and to_pos = p_to;
  if v_price is null then raise exception 'Pas de prix pour ce trajet'; end if;
  select capacity into v_capacity from bus_models where id = v_dep.model_id;

  if jsonb_typeof(p_passengers) <> 'array' or jsonb_array_length(p_passengers) not between 1 and 10 then
    raise exception 'De 1 à 10 passagers par vente';
  end if;
  if p_payment not in ('especes', 'orange_money', 'wave', 'moov_money') then raise exception 'Moyen de paiement invalide'; end if;

  for v_p in select * from jsonb_array_elements(p_passengers) loop
    v_seat := (v_p ->> 'seat')::integer;
    if v_seat is null or v_seat < 1 or v_seat > v_capacity then raise exception 'Siège % inexistant', coalesce(v_seat::text, '?'); end if;
    begin
      insert into tickets (company_id, departure_id, seat, from_pos, to_pos, passenger_name, passenger_phone, price,
                           channel, payment_method, code, sale_ref, station_id, sold_by)
      values (v_dep.company_id, v_dep.id, v_seat, p_from, p_to, trim(v_p ->> 'name'), nullif(v_p ->> 'phone', ''), v_price,
              'guichet', p_payment, public.new_ticket_code(), p_sale_ref, p_station, auth.uid())
      returning * into v_ticket;
    exception when exclusion_violation then
      raise exception 'Siège % déjà vendu sur ce trajet', v_seat using errcode = 'TF001';
    end;
    v_out := v_out || jsonb_build_object('id', v_ticket.id, 'code', v_ticket.code, 'seat', v_ticket.seat,
                                         'price', v_ticket.price, 'name', v_ticket.passenger_name);
  end loop;
  return v_out;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Cloisonnement (RLS)
-- ────────────────────────────────────────────────────────────────────────────

alter table public.departures enable row level security;
alter table public.tickets enable row level security;

create policy "membres lisent les départs" on public.departures for select
  using (public.is_platform_admin() or public.is_company_member(company_id));
create policy "gérant et chefs de gare modifient les départs" on public.departures for update
  using (public.has_company_role(company_id, array['gerant', 'chef_de_gare']::member_role[]))
  with check (public.has_company_role(company_id, array['gerant', 'chef_de_gare']::member_role[]));

create policy "membres lisent les billets de leur compagnie" on public.tickets for select
  using (public.is_platform_admin() or public.is_company_member(company_id));
-- Aucune écriture directe : la vente passe par sell_tickets().

revoke execute on function public.new_ticket_code() from anon, authenticated, public;
grant execute on function public.generate_departures(uuid, integer) to authenticated;
grant execute on function public.sell_tickets(uuid, integer, integer, uuid, text, jsonb, uuid) to authenticated;
