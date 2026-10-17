-- Tufani · migration 0005 · embarquement
-- Chaque scan est inscrit au journal (même hors ligne, envoyé ensuite).
-- Un billet ne fait monter qu'une seule personne : le second scan est signalé
-- avec l'heure et l'auteur du premier.

alter table public.tickets
  add column boarded_at timestamptz,
  add column boarded_by uuid references auth.users (id) on delete set null,
  add column boarded_station uuid references public.stations (id) on delete restrict;

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  -- Référence du scan côté téléphone : un scan rejoué (réseau coupé) n'est compté qu'une fois.
  scan_ref uuid not null unique,
  company_id uuid not null references public.companies (id) on delete restrict,
  ticket_id uuid references public.tickets (id) on delete restrict,
  departure_id uuid not null references public.departures (id) on delete restrict,
  station_id uuid not null references public.stations (id) on delete restrict,
  scanned_by uuid references auth.users (id) on delete set null,
  scanned_at timestamptz not null,
  received_at timestamptz not null default now(),
  offline boolean not null default false,
  result text not null check (result in ('embarque', 'deja_embarque', 'annule', 'autre_depart', 'inconnu'))
);
create index scans_departure_idx on public.scans (departure_id, scanned_at);

-- Embarquement d'un billet, par son identifiant (QR) ou son code (saisie manuelle).
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
    select * into v_t from tickets where id = p_ticket and company_id = v_dep.company_id;
  else
    select * into v_t from tickets where code = upper(trim(p_code)) and company_id = v_dep.company_id;
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

alter table public.scans enable row level security;
create policy "gérant, chefs de gare et comptable lisent les scans" on public.scans for select
  using (public.is_platform_admin()
    or public.has_company_role(company_id, array['gerant', 'chef_de_gare', 'comptable']::member_role[]));

grant execute on function public.board_ticket(uuid, uuid, uuid, text, timestamptz, uuid, boolean) to authenticated;
