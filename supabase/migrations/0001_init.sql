-- QuickLot stage one: accounts, settings, saved cars, and a log of AI-written listings.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.

-- One settings row per user, created automatically at first sign-in.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tone text not null default 'friendly' check (tone in ('friendly', 'direct', 'energy')),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  accent text not null default 'blue' check (accent in ('blue', 'green', 'red', 'graphite')),
  risk_accepted_at timestamptz,
  setup_done boolean not null default false,
  daily_cap int not null default 5 check (daily_cap between 1 and 10),
  spacing_minutes int not null default 15 check (spacing_minutes between 5 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "My cars": every car the user filled a Marketplace form for, with its listing text.
create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vin text,
  title text not null,
  price numeric,
  mileage numeric,
  details jsonb not null default '{}'::jsonb,
  description text,
  source_url text,
  status text not null default 'filled' check (status in ('filled', 'published', 'sold', 'removed')),
  created_at timestamptz not null default now()
);
create index if not exists cars_user_created on public.cars (user_id, created_at desc);

-- One row per AI-written listing, used for the daily limit and cost tracking.
create table if not exists public.listing_generations (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vin text,
  tone text,
  created_at timestamptz not null default now()
);
create index if not exists generations_user_created on public.listing_generations (user_id, created_at desc);

-- Row level security: each user can only see and change their own rows.
alter table public.profiles enable row level security;
alter table public.cars enable row level security;
alter table public.listing_generations enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own cars" on public.cars;
create policy "own cars" on public.cars
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read own generations" on public.listing_generations;
create policy "read own generations" on public.listing_generations
  for select using (auth.uid() = user_id);

drop policy if exists "insert own generations" on public.listing_generations;
create policy "insert own generations" on public.listing_generations
  for insert with check (auth.uid() = user_id);

-- Create the profile row when someone signs in for the first time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
