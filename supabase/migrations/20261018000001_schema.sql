-- Sterling: core schema (PRD §10.2). Money is bigint pence everywhere (PRD §10.1).
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create type account_type  as enum ('current','savings','credit_card','cash','other');
create type txn_type      as enum ('expense','income','transfer','adjustment');
create type category_kind as enum ('expense','income');
create type txn_source    as enum ('app','nl','shortcut','recurring','favourite','receipt');

create function london_today() returns date
  language sql stable as $$ select (now() at time zone 'Europe/London')::date $$;

create function london_date(p timestamptz) returns date
  language sql immutable as $$ select (p at time zone 'Europe/London')::date $$;

create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  display_name     text,
  month_start_day  smallint not null default 1 check (month_start_day between 1 and 28),
  timezone         text not null default 'Europe/London',
  tap_to_save      boolean not null default true,
  ai_enabled       boolean not null default true,
  ai_include_notes boolean not null default false,
  lock_after_min   smallint default 5,
  reminder_enabled boolean not null default false,
  reminder_time    time not null default '21:00',
  reminder_prompted boolean not null default false,       -- the one-time in-context card was answered
  last_reminder_on date,                                  -- London date of the last reminder sent (max one a day)
  onboarded_at     timestamptz,                           -- AUTH-02 completed
  acct_switch_candidate uuid,                             -- ACC-02: account the user keeps switching to
  acct_switch_count     smallint not null default 0,
  created_at       timestamptz not null default now()
);

create table accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users on delete cascade,
  name                  text not null check (char_length(name) between 1 and 40),
  institution           text,
  type                  account_type not null,
  -- Balance at the START of opening_date (London). Signed: owed on a card is negative.
  opening_balance_pence bigint not null default 0,
  opening_date          date not null default london_today(),
  counts_as_cash        boolean not null default true,
  is_default            boolean not null default false,
  sort_order            int not null default 0,
  archived_at           timestamptz,
  created_at            timestamptz not null default now()
);
create unique index one_default_account on accounts(user_id) where is_default and archived_at is null;
create index accounts_user on accounts(user_id);

create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id   uuid references categories on delete restrict,
  kind        category_kind not null,
  name        text not null check (char_length(name) between 1 and 32),
  icon        text not null default 'circle',
  color       text not null default 'stone' check (color in
              ('stone','sage','moss','sky','slate','clay','sand','plum','rose','ochre')),
  sort_order  int not null default 0,
  is_fixed    boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
-- "unique among its siblings": a plain unique constraint ignores NULL parents, so use an index.
create unique index categories_sibling_name on categories
  (user_id, kind, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index categories_user on categories(user_id, parent_id);

-- CAT-01: exactly two levels, income categories are single level, kinds must match.
create function categories_guard() returns trigger language plpgsql as $$
declare par categories%rowtype;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A category cannot be its own parent' using errcode = 'check_violation'; end if;
    select * into par from categories where id = new.parent_id;
    if par.id is null then raise exception 'Parent category not found' using errcode = 'foreign_key_violation'; end if;
    if par.parent_id is not null then
      raise exception 'Categories are at most two levels deep' using errcode = 'check_violation';
    end if;
    if par.kind <> new.kind then
      raise exception 'A sub-category must have the same type as its parent' using errcode = 'check_violation';
    end if;
    if par.user_id <> new.user_id then raise exception 'Parent belongs to another user' using errcode = 'check_violation'; end if;
    if new.kind = 'income' then
      raise exception 'Income categories are a single level' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from categories where parent_id = new.id) then
      raise exception 'A category with sub-categories cannot move under another category' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger categories_guard before insert or update of parent_id, kind on categories
  for each row execute function categories_guard();

create table payees (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  name                text not null,
  name_norm           text generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored,
  default_category_id uuid references categories on delete set null,
  default_account_id  uuid references accounts on delete set null,
  use_count           int not null default 0,
  last_used_at        timestamptz,
  unique (user_id, name_norm)
);
create index payees_trgm on payees using gin (name_norm extensions.gin_trgm_ops);

create table transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  client_id          uuid not null,
  type               txn_type not null,
  amount_pence       bigint not null,
  account_id         uuid not null references accounts,
  counter_account_id uuid references accounts,
  category_id        uuid references categories,
  payee_id           uuid references payees on delete set null,
  note               text check (char_length(note) <= 280),
  tags               text[] not null default '{}',
  occurred_on        date not null,
  occurred_at        timestamptz,
  source             txn_source not null default 'app',
  recurring_id       uuid,
  needs_review       boolean not null default false,
  parent_id          uuid references transactions on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (user_id, client_id),
  check ( (type = 'adjustment' and amount_pence <> 0) or (type <> 'adjustment' and amount_pence > 0) ),
  check ( (type = 'transfer') = (counter_account_id is not null) ),
  check ( counter_account_id is distinct from account_id ),
  check ( (type in ('expense','income')) = (category_id is not null) ),
  check ( amount_pence between -99999999999 and 99999999999 )
);
create index txn_user_date  on transactions (user_id, occurred_on desc, created_at desc, id desc) where deleted_at is null;
create index txn_user_cat   on transactions (user_id, category_id, occurred_on) where deleted_at is null;
create index txn_user_acct  on transactions (user_id, account_id, occurred_on) where deleted_at is null;
create index txn_user_counter on transactions (user_id, counter_account_id, occurred_on) where deleted_at is null and counter_account_id is not null;
create index txn_user_payee on transactions (user_id, payee_id, occurred_on) where deleted_at is null;
create index txn_deleted    on transactions (deleted_at) where deleted_at is not null;
create index txn_note_trgm  on transactions using gin (note extensions.gin_trgm_ops);

-- Integrity rules that a CHECK cannot express (they look at other tables).
create function transactions_guard() returns trigger language plpgsql as $$
declare a accounts%rowtype; b accounts%rowtype; c categories%rowtype;
begin
  new.updated_at := now();

  -- History on an archived account is frozen: its balance was zero when it left, and must stay so.
  if tg_op = 'UPDATE' and old.deleted_at is null
     and exists (select 1 from accounts x where x.id in (old.account_id, old.counter_account_id) and x.archived_at is not null)
     and (new.deleted_at is not null or new.amount_pence <> old.amount_pence or new.type <> old.type
          or new.occurred_on <> old.occurred_on or new.account_id <> old.account_id
          or new.counter_account_id is distinct from old.counter_account_id) then
    raise exception 'This transaction belongs to an archived account and can no longer change'
      using errcode = 'check_violation';
  end if;

  if new.deleted_at is not null then return new; end if;

  select * into a from accounts where id = new.account_id;
  if a.id is null then raise exception 'Account not found' using errcode = 'foreign_key_violation'; end if;
  if new.occurred_on < a.opening_date then
    raise exception 'This account starts on %; it cannot hold earlier transactions', to_char(a.opening_date, 'DD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  if a.archived_at is not null and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id) then
    raise exception 'Account "%" is archived', a.name using errcode = 'check_violation';
  end if;

  if new.counter_account_id is not null then
    select * into b from accounts where id = new.counter_account_id;
    if b.id is null then raise exception 'Account not found' using errcode = 'foreign_key_violation'; end if;
    if new.occurred_on < b.opening_date then
      raise exception 'This account starts on %; it cannot hold earlier transactions', to_char(b.opening_date, 'DD Mon YYYY')
        using errcode = 'check_violation';
    end if;
    if b.archived_at is not null and (tg_op = 'INSERT' or new.counter_account_id is distinct from old.counter_account_id) then
      raise exception 'Account "%" is archived', b.name using errcode = 'check_violation';
    end if;
  end if;

  if new.category_id is not null then
    select * into c from categories where id = new.category_id;
    if c.id is null then raise exception 'Category not found' using errcode = 'foreign_key_violation'; end if;
    if c.kind::text <> new.type::text then
      raise exception 'A % needs a % category', new.type, new.type using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger transactions_guard before insert or update on transactions
  for each row execute function transactions_guard();

-- An account's opening balance/date can only move if nothing predates the new date.
create function accounts_guard() returns trigger language plpgsql as $$
declare bal bigint;
begin
  if tg_op = 'UPDATE' and new.opening_date > old.opening_date then
    if exists (select 1 from transactions t where t.deleted_at is null and t.occurred_on < new.opening_date
               and (t.account_id = new.id or t.counter_account_id = new.id)) then
      raise exception 'Some transactions on this account are earlier than %', to_char(new.opening_date, 'DD Mon YYYY')
        using errcode = 'check_violation';
    end if;
  end if;
  -- ACC-03: archiving needs a zero balance (archive_account() writes the adjustment first).
  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null then
    select new.opening_balance_pence + coalesce(sum(case
        when t.account_id = new.id then (case t.type when 'expense' then -t.amount_pence when 'income' then t.amount_pence
                                                     when 'transfer' then -t.amount_pence else t.amount_pence end)
        else t.amount_pence end), 0)
      into bal
      from transactions t
     where t.deleted_at is null and (t.account_id = new.id or t.counter_account_id = new.id);
    if bal <> 0 then
      raise exception 'Account balance must be £0 before archiving (use "write off remaining balance")'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger accounts_guard before update on accounts
  for each row execute function accounts_guard();

create table recurring_rules (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  type               txn_type not null check (type in ('expense','income','transfer')),
  amount_pence       bigint not null check (amount_pence > 0),
  account_id         uuid not null references accounts,
  counter_account_id uuid references accounts,
  category_id        uuid references categories,
  payee_id           uuid references payees,
  frequency          text not null check (frequency in ('weekly','monthly','yearly')),
  interval_n         smallint not null default 1,
  day_rule           text,
  next_due_on        date not null,
  end_on             date,
  mode               text not null default 'remind' check (mode in ('auto','remind')),
  active             boolean not null default true
);

create table budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category_id  uuid not null references categories,
  amount_pence bigint not null check (amount_pence > 0),
  rollover     boolean not null default false,
  starts_on    date not null,
  unique (user_id, category_id, starts_on)
);

create table insight_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  scope         text not null check (scope in ('weekly','monthly','adhoc')),
  period_start  date not null,
  period_end    date not null,
  facts         jsonb not null,
  cards         jsonb not null,
  model         text not null,
  input_tokens  int,
  output_tokens int,
  used_fallback boolean not null default false,
  validation    jsonb not null default '{}'::jsonb,   -- cards the grounding validator dropped, and why
  created_at    timestamptz not null default now()
);
create index insight_runs_user on insight_runs(user_id, created_at desc);

create table insight_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  run_id      uuid not null references insight_runs on delete cascade,
  card_key    text not null,
  card_type   text not null,
  action      text not null check (action in ('helpful','dismissed','opened')),
  created_at  timestamptz not null default now()
);
create index insight_feedback_user on insight_feedback(user_id, created_at desc);

create table api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null,
  token_hash   text not null unique,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);

create table no_spend_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
