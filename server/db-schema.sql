-- Nyumbani Concierge — Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor (after creating the project).
-- The Node server talks to these tables with the service_role key; the browser never connects directly.

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id text primary key,
  name text not null,
  email text not null unique,
  phone text not null default '',
  pass text not null,
  token text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  date timestamptz not null,
  method text not null,
  user_id text not null references public.users(id),
  items jsonb not null default '[]',
  total double precision not null default 0,
  status text not null default 'pending',
  txn_id text not null default '',
  phone text not null default '',
  bank_ref text not null default '',
  checkout_request_id text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id text primary key,
  user_id text not null references public.users(id),
  order_id text not null,
  title text not null,
  body text not null,
  link text not null default '',
  date timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.requests (
  id text primary key,
  user_id text,
  name text not null,
  contact text not null,
  text text not null,
  date timestamptz not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists reports_user_id_idx on public.reports (user_id);
create index if not exists requests_status_idx on public.requests (status);

-- RLS stays disabled: only the server (service_role key) reaches these tables.
alter table public.users enable row level security;
alter table public.orders enable row level security;
alter table public.reports enable row level security;
alter table public.requests enable row level security;
