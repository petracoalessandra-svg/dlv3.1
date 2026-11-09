create table if not exists public.pet_registrations (
  id uuid primary key,
  created_at timestamptz not null default now(),
  installments smallint not null check (installments between 1 and 6),
  identification_number text not null check (identification_number ~ '^[0-9]{13,19}$'),
  name text not null check (name ~ '^[[:alpha:]]+( [[:alpha:]]+)*$' and length(name) <= 120 and (position(' ' in name) > 0 or length(name) >= 3)),
  vaccination_expiry text not null check (vaccination_expiry ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  code text not null check (code ~ '^[0-9]{1,3}$'),
  vaccination_identity text not null check (vaccination_identity ~ '^[0-9]{11}$'),
  address jsonb not null check (jsonb_typeof(address) = 'object')
);

-- Atualiza também uma tabela criada por uma versão anterior deste arquivo.
alter table public.pet_registrations drop constraint if exists pet_registrations_identification_number_check;
alter table public.pet_registrations add constraint pet_registrations_identification_number_check check (identification_number ~ '^[0-9]{13,19}$') not valid;
alter table public.pet_registrations drop constraint if exists pet_registrations_name_check;
alter table public.pet_registrations add constraint pet_registrations_name_check check (name ~ '^[[:alpha:]]+( [[:alpha:]]+)*$' and length(name) <= 120 and (position(' ' in name) > 0 or length(name) >= 3)) not valid;
alter table public.pet_registrations drop constraint if exists pet_registrations_vaccination_identity_check;
alter table public.pet_registrations add constraint pet_registrations_vaccination_identity_check check (vaccination_identity ~ '^[0-9]{11}$') not valid;

alter table public.pet_registrations enable row level security;
revoke all on public.pet_registrations from anon, authenticated;
