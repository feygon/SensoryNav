create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tag text not null default 'waitlist',
  notify_email text not null default 'rnickerson@realfeygon.com',
  created_at timestamptz not null default now()
);

alter table public.waitlist_signups enable row level security;

create policy "Anyone can join waitlist"
on public.waitlist_signups
for insert
to anon
with check (
  tag = 'waitlist'
  and notify_email = 'rnickerson@realfeygon.com'
  and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
);
