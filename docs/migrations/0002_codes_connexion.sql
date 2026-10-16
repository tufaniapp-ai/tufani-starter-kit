-- Tufani · migration 0002 · codes de connexion par SMS
-- Les codes sont gérés par Tufani (fournisseur SMS au choix), jamais stockés en clair.
-- Table réservée au serveur : RLS activée sans aucune politique, donc illisible
-- depuis le navigateur ; seul le serveur (clé de service) y accède.

create table public.login_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^\+223[0-9]{8}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index login_codes_phone_idx on public.login_codes (phone, created_at desc);

alter table public.login_codes enable row level security;
revoke all on public.login_codes from anon, authenticated;

-- Nettoyage : les codes de plus de 2 jours ne servent plus (limites horaires et journalières).
create or replace function public.purge_login_codes()
returns integer language sql security definer set search_path = public as $$
  with gone as (delete from login_codes where created_at < now() - interval '2 days' returning 1)
  select count(*)::integer from gone;
$$;
revoke execute on function public.purge_login_codes() from anon, authenticated, public;
