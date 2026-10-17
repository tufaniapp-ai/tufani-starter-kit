-- Tufani · migration 0006 · vente en ligne
-- Le voyageur cherche un trajet, choisit ses sièges et paie par mobile money.
-- Pendant le paiement, les sièges sont tenus 10 minutes : ce sont des billets au statut
-- « reserve », protégés par la même contrainte d'exclusion que les billets vendus.
-- Un billet ne devient valide que lorsque le serveur a vérifié le paiement auprès du
-- fournisseur, jamais sur un retour du navigateur.
-- Seules les compagnies validées par Tufani apparaissent au public.

-- ────────────────────────────────────────────────────────────────────────────
-- Commandes
-- ────────────────────────────────────────────────────────────────────────────

alter table public.tickets drop constraint tickets_status_check;
alter table public.tickets add constraint tickets_status_check
  check (status in ('reserve', 'valide', 'embarque', 'annule'));
alter table public.tickets add column hold_until timestamptz;
alter table public.tickets add column order_id uuid;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Clé du lien de la commande envoyé au voyageur (il n'a pas besoin de compte).
  access_key text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  company_id uuid not null references public.companies (id) on delete restrict,
  departure_id uuid not null references public.departures (id) on delete restrict,
  from_pos integer not null,
  to_pos integer not null,
  buyer_phone text not null check (buyer_phone ~ '^\+223[0-9]{8}$'),
  payment_method text not null check (payment_method in ('orange_money', 'wave', 'moov_money')),
  fare_total integer not null check (fare_total >= 0),
  service_fee integer not null check (service_fee >= 0),
  amount integer not null check (amount = fare_total + service_fee),
  status text not null default 'en_attente'
    check (status in ('en_attente', 'payee', 'echouee', 'expiree', 'a_rembourser', 'remboursee')),
  provider text,
  provider_ref text,
  hold_until timestamptz not null,
  sms_sent_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index orders_buyer_idx on public.orders (buyer_phone, created_at);
create index orders_company_idx on public.orders (company_id, created_at);

alter table public.tickets add constraint tickets_order_fk
  foreign key (order_id) references public.orders (id) on delete restrict;
create index tickets_order_idx on public.tickets (order_id);

alter table public.orders enable row level security;
create policy "gérant, chefs de gare et comptable lisent les commandes" on public.orders for select
  using (public.is_platform_admin()
    or public.has_company_role(company_id, array['gerant', 'chef_de_gare', 'comptable']::member_role[]));
-- Aucune écriture directe : tout passe par les fonctions ci-dessous, appelées par le serveur.

-- ────────────────────────────────────────────────────────────────────────────
-- Réservations expirées : les sièges reviennent à la vente
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.release_expired_holds()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update orders set status = 'expiree' where status = 'en_attente' and hold_until < now();
  update tickets set status = 'annule' where status = 'reserve' and hold_until < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Lecture publique (site voyageur)
-- ────────────────────────────────────────────────────────────────────────────

-- Villes desservies, pour le formulaire de recherche.
create or replace function public.served_cities()
returns table (city text) language sql stable security definer set search_path = public as $$
  select distinct s.city
  from stations s
  join companies c on c.id = s.company_id and c.status = 'validee'
  join route_stops rs on rs.station_id = s.id
  join routes r on r.id = rs.route_id and r.active
  where s.active
  order by 1;
$$;

-- Crée les départs d'un jour pour les compagnies validées (sans effet s'ils existent).
create or replace function public.ensure_public_departures(p_date date)
returns void language sql security definer set search_path = public as $$
  insert into departures (company_id, route_id, schedule_id, departure_date, departure_time, departs_at, model_id)
  select s.company_id, s.route_id, s.id, p_date, s.departure_time, (p_date + s.departure_time) at time zone 'UTC', s.model_id
  from schedules s
  join routes r on r.id = s.route_id and r.active
  join companies c on c.id = s.company_id and c.status = 'validee'
  where s.active and extract(isodow from p_date)::smallint = any (s.weekdays)
  on conflict (route_id, departure_date, departure_time) do nothing;
$$;

-- Trajets d'une ville à une autre un jour donné. La vente en ligne ferme 30 minutes avant
-- le passage du bus à la gare de montée.
create or replace function public.search_trips(p_from text, p_to text, p_date date)
returns table (
  departure_id uuid, company_name text, route_name text,
  from_pos integer, to_pos integer, from_station text, to_station text, from_city text, to_city text,
  leaves_at timestamptz, arrives_at timestamptz, price integer, seats_left integer, capacity integer, model_name text
) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_date is null or p_date < current_date or p_date > current_date + 60 then return; end if;
  perform public.release_expired_holds();
  perform public.ensure_public_departures(p_date);
  return query
  select d.id, c.name, r.name, a.position, b.position, sa.name, sb.name, sa.city, sb.city,
         d.departs_at + make_interval(mins => a.minutes),
         d.departs_at + make_interval(mins => b.minutes),
         f.price,
         (m.capacity - (select count(distinct t.seat) from tickets t
                        where t.departure_id = d.id and t.status <> 'annule'
                          and int4range(t.from_pos, t.to_pos) && int4range(a.position, b.position)))::integer,
         m.capacity, m.name
  from departures d
  join companies c on c.id = d.company_id and c.status = 'validee'
  join routes r on r.id = d.route_id and r.active
  join route_stops a on a.route_id = r.id
  join stations sa on sa.id = a.station_id
  join route_stops b on b.route_id = r.id and b.position > a.position
  join stations sb on sb.id = b.station_id
  join fares f on f.route_id = r.id and f.from_pos = a.position and f.to_pos = b.position
  join bus_models m on m.id = d.model_id
  where d.departure_date = p_date
    and d.status = 'prevu'
    and lower(sa.city) = lower(trim(p_from))
    and lower(sb.city) = lower(trim(p_to))
    and (r.sell_segments
         or (a.position = 0 and b.position = (select max(position) from route_stops x where x.route_id = r.id)))
    and d.departs_at + make_interval(mins => a.minutes) > now() + interval '30 minutes'
  order by d.departs_at + make_interval(mins => a.minutes), f.price;
end;
$$;

-- Plan du bus et sièges pris sur un tronçon, avec le résumé du trajet.
create or replace function public.trip_seats(p_departure uuid, p_from integer, p_to integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.release_expired_holds();
  select jsonb_build_object(
    'departure_id', d.id, 'company', c.name, 'route', r.name,
    'from_pos', a.position, 'to_pos', b.position,
    'from_city', sa.city, 'to_city', sb.city, 'from_station', sa.name, 'to_station', sb.name,
    'leaves_at', d.departs_at + make_interval(mins => a.minutes),
    'arrives_at', d.departs_at + make_interval(mins => b.minutes),
    'price', f.price,
    'open', d.status = 'prevu' and d.departs_at + make_interval(mins => a.minutes) > now() + interval '30 minutes',
    'model', jsonb_build_object('name', m.name, 'rows', m.seat_rows, 'pattern', m.pattern, 'capacity', m.capacity),
    'taken', coalesce((select jsonb_agg(distinct t.seat) from tickets t
                       where t.departure_id = d.id and t.status <> 'annule'
                         and int4range(t.from_pos, t.to_pos) && int4range(a.position, b.position)), '[]'::jsonb))
  into v
  from departures d
  join companies c on c.id = d.company_id and c.status = 'validee'
  join routes r on r.id = d.route_id
  join route_stops a on a.route_id = r.id and a.position = p_from
  join stations sa on sa.id = a.station_id
  join route_stops b on b.route_id = r.id and b.position = p_to
  join stations sb on sb.id = b.station_id
  join fares f on f.route_id = r.id and f.from_pos = p_from and f.to_pos = p_to
  join bus_models m on m.id = d.model_id
  where d.id = p_departure and p_to > p_from;
  return v;
end;
$$;

-- Commande vue par le voyageur (lien avec clé). Codes et noms des billets seulement une fois payée.
create or replace function public.get_order(p_order uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v orders;
  v_out jsonb;
begin
  select * into v from orders where id = p_order and access_key = p_key;
  if not found then return null; end if;
  select jsonb_build_object(
    'id', v.id, 'status', v.status, 'amount', v.amount, 'fare_total', v.fare_total, 'service_fee', v.service_fee,
    'method', v.payment_method, 'buyer_phone', v.buyer_phone, 'hold_until', v.hold_until,
    'company', c.name, 'service_phone', c.service_phone,
    'from_city', sa.city, 'to_city', sb.city, 'from_station', sa.name, 'to_station', sb.name,
    'leaves_at', d.departs_at + make_interval(mins => a.minutes),
    'arrives_at', d.departs_at + make_interval(mins => b.minutes),
    'tickets', coalesce((select jsonb_agg(
        case when v.status = 'payee'
          then jsonb_build_object('id', t.id, 'seat', t.seat, 'name', t.passenger_name, 'code', t.code, 'status', t.status)
          else jsonb_build_object('seat', t.seat, 'name', t.passenger_name) end
        order by t.seat)
      from tickets t where t.order_id = v.id), '[]'::jsonb))
  into v_out
  from departures d
  join companies c on c.id = d.company_id
  join route_stops a on a.route_id = d.route_id and a.position = v.from_pos
  join stations sa on sa.id = a.station_id
  join route_stops b on b.route_id = d.route_id and b.position = v.to_pos
  join stations sb on sb.id = b.station_id
  where d.id = v.departure_id;
  return v_out;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Écritures (serveur Tufani uniquement, clé de service)
-- ────────────────────────────────────────────────────────────────────────────

-- Tient les sièges et crée la commande (tout ou rien).
-- p_passengers : [{"name": "...", "phone": "+223…" ou null, "seat": 14}, …]
create or replace function public.create_order(
  p_departure uuid, p_from integer, p_to integer, p_passengers jsonb,
  p_buyer_phone text, p_method text, p_service_fee integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dep departures;
  v_route routes;
  v_last integer;
  v_capacity integer;
  v_price integer;
  v_leaves timestamptz;
  v_boarding uuid;
  v_order orders;
  v_count integer;
  v_p jsonb;
  v_seat integer;
  v_hold timestamptz := now() + interval '10 minutes';
begin
  perform public.release_expired_holds();

  -- Anti-blocage : un numéro ne peut pas tenir des sièges sans payer en boucle.
  if (select count(*) from orders where buyer_phone = p_buyer_phone and status <> 'payee'
      and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Trop de réservations non payées avec ce numéro. Réessayez dans une heure.' using errcode = 'TF002';
  end if;

  select * into v_dep from departures where id = p_departure;
  if not found then raise exception 'Départ introuvable'; end if;
  if v_dep.status <> 'prevu' then raise exception 'Ce départ n''est plus en vente'; end if;
  if not exists (select 1 from companies where id = v_dep.company_id and status = 'validee') then
    raise exception 'Départ introuvable';
  end if;

  select * into v_route from routes where id = v_dep.route_id;
  select max(position) into v_last from route_stops where route_id = v_route.id;
  if p_from < 0 or p_to > v_last or p_to <= p_from then raise exception 'Trajet invalide'; end if;
  if not v_route.sell_segments and (p_from <> 0 or p_to <> v_last) then raise exception 'Cette ligne ne vend que le trajet complet'; end if;

  select station_id, v_dep.departs_at + make_interval(mins => minutes) into v_boarding, v_leaves
  from route_stops where route_id = v_route.id and position = p_from;
  if v_leaves <= now() + interval '30 minutes' then
    raise exception 'La vente en ligne de ce départ est fermée. Achetez au guichet.';
  end if;

  select price into v_price from fares where route_id = v_route.id and from_pos = p_from and to_pos = p_to;
  if v_price is null then raise exception 'Pas de prix pour ce trajet'; end if;
  select capacity into v_capacity from bus_models where id = v_dep.model_id;

  if jsonb_typeof(p_passengers) <> 'array' then raise exception 'Passagers invalides'; end if;
  v_count := jsonb_array_length(p_passengers);
  if v_count not between 1 and 6 then raise exception 'De 1 à 6 passagers par commande'; end if;
  if p_method not in ('orange_money', 'wave', 'moov_money') then raise exception 'Moyen de paiement invalide'; end if;
  if p_service_fee < 0 then raise exception 'Frais invalides'; end if;

  insert into orders (company_id, departure_id, from_pos, to_pos, buyer_phone, payment_method,
                      fare_total, service_fee, amount, hold_until)
  values (v_dep.company_id, v_dep.id, p_from, p_to, p_buyer_phone, p_method,
          v_price * v_count, p_service_fee, v_price * v_count + p_service_fee, v_hold)
  returning * into v_order;

  for v_p in select * from jsonb_array_elements(p_passengers) loop
    v_seat := (v_p ->> 'seat')::integer;
    if v_seat is null or v_seat < 1 or v_seat > v_capacity then raise exception 'Siège % inexistant', coalesce(v_seat::text, '?'); end if;
    begin
      insert into tickets (company_id, departure_id, seat, from_pos, to_pos, passenger_name, passenger_phone, price,
                           channel, payment_method, status, code, sale_ref, station_id, order_id, hold_until)
      values (v_dep.company_id, v_dep.id, v_seat, p_from, p_to, trim(v_p ->> 'name'), nullif(v_p ->> 'phone', ''), v_price,
              'en_ligne', p_method, 'reserve', public.new_ticket_code(), v_order.id, v_boarding, v_order.id, v_hold);
    exception when exclusion_violation then
      raise exception 'Siège % déjà pris sur ce trajet', v_seat using errcode = 'TF001';
    end;
  end loop;

  return jsonb_build_object('id', v_order.id, 'access_key', v_order.access_key, 'amount', v_order.amount);
end;
$$;

create or replace function public.set_order_payment(p_order uuid, p_provider text, p_ref text)
returns void language sql security definer set search_path = public as $$
  update orders set provider = p_provider, provider_ref = p_ref where id = p_order and provider_ref is null;
$$;

-- Résultat du paiement vérifié par le serveur auprès du fournisseur.
-- Payé après expiration : les sièges sont repris s'ils sont encore libres, sinon la
-- commande passe « à rembourser » (garantie Tufani).
create or replace function public.settle_order(p_order uuid, p_status text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v orders;
begin
  select * into v from orders where id = p_order for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if v.status in ('payee', 'a_rembourser', 'remboursee') then return v.status; end if;

  if p_status = 'payee' then
    begin
      update tickets set status = 'valide', hold_until = null
      where order_id = v.id and status in ('reserve', 'annule');
      update orders set status = 'payee', paid_at = now() where id = v.id;
    exception when exclusion_violation then
      update orders set status = 'a_rembourser', paid_at = now() where id = v.id;
      return 'a_rembourser';
    end;
    return 'payee';
  elsif p_status in ('echouee', 'expiree') then
    update tickets set status = 'annule' where order_id = v.id and status = 'reserve';
    update orders set status = p_status where id = v.id;
    return p_status;
  end if;
  return v.status;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Embarquement : un billet tenu pendant un paiement ne fait monter personne
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.board_ticket(
  p_departure uuid, p_station uuid, p_ticket uuid, p_code text,
  p_scanned_at timestamptz, p_scan_ref uuid, p_offline boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dep departures;
  v_t tickets;
  v_result text;
  v_prev scans;
  v_at timestamptz := least(coalesce(p_scanned_at, now()), now());
begin
  select * into v_prev from scans where scan_ref = p_scan_ref;
  if found then
    select * into v_t from tickets where id = v_prev.ticket_id;
    return jsonb_build_object('result', v_prev.result, 'seat', v_t.seat, 'name', v_t.passenger_name,
      'code', v_t.code, 'boarded_at', v_t.boarded_at);
  end if;

  select * into v_dep from departures where id = p_departure;
  if not found then raise exception 'Départ introuvable'; end if;
  if not public.has_company_role(v_dep.company_id, array['gerant', 'chef_de_gare', 'controleur']::member_role[]) then
    raise exception 'Embarquement réservé aux contrôleurs';
  end if;
  if not public.can_access_station(p_station) then raise exception 'Cette gare ne vous est pas confiée'; end if;

  if p_ticket is not null then
    select * into v_t from tickets where id = p_ticket and company_id = v_dep.company_id and status <> 'reserve';
  else
    select * into v_t from tickets where code = upper(trim(p_code)) and company_id = v_dep.company_id and status <> 'reserve';
  end if;

  if v_t.id is null then
    v_result := 'inconnu';
  elsif v_t.departure_id <> v_dep.id then
    v_result := 'autre_depart';
  elsif v_t.status = 'annule' then
    v_result := 'annule';
  elsif v_t.boarded_at is not null then
    v_result := 'deja_embarque';
  else
    update tickets set status = 'embarque', boarded_at = v_at, boarded_by = auth.uid(), boarded_station = p_station
    where id = v_t.id returning * into v_t;
    v_result := 'embarque';
  end if;

  insert into scans (scan_ref, company_id, ticket_id, departure_id, station_id, scanned_by, scanned_at, offline, result)
  values (p_scan_ref, v_dep.company_id, v_t.id, v_dep.id, p_station, auth.uid(), v_at, coalesce(p_offline, false), v_result);

  return jsonb_build_object('result', v_result, 'seat', v_t.seat, 'name', v_t.passenger_name, 'code', v_t.code,
    'boarded_at', v_t.boarded_at, 'from', v_t.from_pos, 'to', v_t.to_pos);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Droits
-- ────────────────────────────────────────────────────────────────────────────

revoke execute on function public.release_expired_holds() from public, anon, authenticated;
revoke execute on function public.ensure_public_departures(date) from public, anon, authenticated;
revoke execute on function public.create_order(uuid, integer, integer, jsonb, text, text, integer) from public, anon, authenticated;
revoke execute on function public.set_order_payment(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.settle_order(uuid, text) from public, anon, authenticated;
grant execute on function public.release_expired_holds() to service_role;
grant execute on function public.ensure_public_departures(date) to service_role;
grant execute on function public.create_order(uuid, integer, integer, jsonb, text, text, integer) to service_role;
grant execute on function public.set_order_payment(uuid, text, text) to service_role;
grant execute on function public.settle_order(uuid, text) to service_role;

grant execute on function public.served_cities() to anon, authenticated;
grant execute on function public.search_trips(text, text, date) to anon, authenticated;
grant execute on function public.trip_seats(uuid, integer, integer) to anon, authenticated;
grant execute on function public.get_order(uuid, text) to anon, authenticated;
