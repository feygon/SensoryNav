create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tag text not null default 'waitlist',
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_signups_email_tag_key
on public.waitlist_signups (lower(email), tag);

alter table public.waitlist_signups enable row level security;

drop policy if exists "Anyone can join waitlist" on public.waitlist_signups;

create policy "Anyone can join waitlist"
on public.waitlist_signups
for insert
to anon
with check (
  tag = 'waitlist'
  and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
);
