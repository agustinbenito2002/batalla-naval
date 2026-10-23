-- Batalla naval: backend inicial para Supabase.
-- Ejecutar una vez en Supabase > SQL Editor. Requiere Supabase Auth.
-- Las coordenadas son índices 0-based: fila * 15 + columna.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null
    check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  board_size smallint not null default 15 check (board_size = 15),
  status text not null default 'waiting'
    check (status in ('waiting', 'placing', 'active', 'finished')),
  created_by uuid not null references public.profiles (id),
  current_turn uuid references public.profiles (id),
  winner_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null check (seat in (1, 2)),
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id),
  unique (game_id, seat)
);

create table if not exists public.ships (
  game_id uuid not null,
  user_id uuid not null,
  ship_number smallint not null check (ship_number between 1 and 4),
  cells integer[] not null check (cardinality(cells) between 2 and 4),
  created_at timestamptz not null default now(),
  primary key (game_id, user_id, ship_number),
  foreign key (game_id, user_id)
    references public.game_players (game_id, user_id) on delete cascade
);

create table if not exists public.attacks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  attacker_id uuid not null references public.profiles (id),
  target_id uuid not null references public.profiles (id),
  center_cell integer not null check (center_cell between 0 and 224),
  attack_type text not null check (attack_type in ('normal', 'cross', 'bombardment')),
  created_at timestamptz not null default now()
);

create table if not exists public.shots (
  id bigint generated always as identity primary key,
  attack_id uuid not null references public.attacks (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  attacker_id uuid not null references public.profiles (id),
  target_id uuid not null references public.profiles (id),
  cell_index integer not null check (cell_index between 0 and 224),
  is_hit boolean not null,
  ship_sunk boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, attacker_id, cell_index)
);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists game_players_user_idx
  on public.game_players (user_id, game_id);
create index if not exists games_status_created_idx
  on public.games (status, created_at);
create index if not exists attacks_game_created_idx
  on public.attacks (game_id, created_at);
create index if not exists shots_game_idx
  on public.shots (game_id, created_at);
create index if not exists chat_messages_game_created_idx
  on public.chat_messages (game_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists games_set_updated_at on public.games;
create trigger games_set_updated_at
before update on public.games
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    'capitan_' || pg_catalog.substr(
      pg_catalog.replace(new.id::text, '-', ''),
      1,
      12
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, username)
select
  users.id,
  'capitan_' || pg_catalog.substr(
    pg_catalog.replace(users.id::text, '-', ''),
    1,
    12
  )
from auth.users as users
on conflict (id) do nothing;

-- SECURITY DEFINER evita la recursión de RLS al consultar game_players.
create or replace function public.is_game_player(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.game_players gp
    where gp.game_id = p_game_id
      and gp.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_game_player(uuid) from public;
grant execute on function public.is_game_player(uuid) to authenticated;

create or replace function public.create_game()
returns table (game_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_game_id uuid := gen_random_uuid();
  v_invite_code text := pg_catalog.upper(
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 8)
  );
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para crear una partida.';
  end if;

  insert into public.games (id, invite_code, created_by)
  values (v_game_id, v_invite_code, v_user_id);

  insert into public.game_players (game_id, user_id, seat)
  values (v_game_id, v_user_id, 1);

  return query select v_game_id, v_invite_code;
end;
$$;

create or replace function public.join_game(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para unirte a una partida.';
  end if;

  select *
  into v_game
  from public.games
  where invite_code = pg_catalog.upper(pg_catalog.btrim(p_invite_code))
  for update;

  if not found or v_game.status <> 'waiting' then
    raise exception 'La partida no existe o ya no está disponible.';
  end if;
  if v_game.created_by = v_user_id then
    raise exception 'No puedes unirte a tu propia partida.';
  end if;

  insert into public.game_players (game_id, user_id, seat)
  values (v_game.id, v_user_id, 2);

  update public.games
  set status = 'placing'
  where id = v_game.id;

  return v_game.id;
end;
$$;

create or replace function public.place_fleet(p_game_id uuid, p_ships jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_ship jsonb;
  v_cell_json jsonb;
  v_cells integer[];
  v_occupied integer[] := array[]::integer[];
  v_cell integer;
  v_row integer;
  v_column integer;
  v_min_row integer;
  v_max_row integer;
  v_min_column integer;
  v_max_column integer;
  v_count integer;
  v_ship_number integer := 0;
  v_ready_count integer;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para colocar barcos.';
  end if;
  if p_ships is null or pg_catalog.jsonb_typeof(p_ships) <> 'array' then
    raise exception 'La flota debe contener exactamente 4 barcos.';
  end if;
  if pg_catalog.jsonb_array_length(p_ships) <> 4 then
    raise exception 'La flota debe contener exactamente 4 barcos.';
  end if;

  select *
  into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found or v_game.status <> 'placing' then
    raise exception 'La partida no está en fase de colocación.';
  end if;
  if not exists (
    select 1
    from public.game_players gp
    where gp.game_id = p_game_id and gp.user_id = v_user_id
  ) then
    raise exception 'No participas en esta partida.';
  end if;
  if exists (
    select 1 from public.game_players gp
    where gp.game_id = p_game_id
      and gp.user_id = v_user_id
      and gp.is_ready
  ) then
    raise exception 'Ya confirmaste tu flota.';
  end if;

  delete from public.ships
  where game_id = p_game_id and user_id = v_user_id;

  for v_ship in
    select ship
    from pg_catalog.jsonb_array_elements(p_ships) as ships(ship)
  loop
    v_ship_number := v_ship_number + 1;
    if pg_catalog.jsonb_typeof(v_ship) <> 'array' then
      raise exception 'Cada barco debe medir entre 2 y 4 casillas.';
    end if;
    if pg_catalog.jsonb_array_length(v_ship) not between 2 and 4 then
      raise exception 'Cada barco debe medir entre 2 y 4 casillas.';
    end if;

    v_cells := array[]::integer[];
    for v_cell_json in
      select cell
      from pg_catalog.jsonb_array_elements(v_ship) as ship_cells(cell)
    loop
      if pg_catalog.jsonb_typeof(v_cell_json) <> 'number' then
        raise exception 'Las casillas deben ser índices enteros del tablero.';
      end if;
      if (v_cell_json #>> '{}') !~ '^[0-9]+$' then
        raise exception 'Las casillas deben ser índices enteros del tablero.';
      end if;
      v_cell := (v_cell_json #>> '{}')::integer;
      if v_cell < 0 or v_cell >= v_game.board_size * v_game.board_size then
        raise exception 'Una casilla está fuera del tablero.';
      end if;
      if v_cell = any(v_cells) or v_cell = any(v_occupied) then
        raise exception 'Hay casillas repetidas o barcos superpuestos.';
      end if;
      v_cells := pg_catalog.array_append(v_cells, v_cell);
    end loop;

    select
      pg_catalog.count(distinct cell / v_game.board_size),
      pg_catalog.count(distinct cell % v_game.board_size),
      pg_catalog.min(cell / v_game.board_size),
      pg_catalog.max(cell / v_game.board_size),
      pg_catalog.min(cell % v_game.board_size),
      pg_catalog.max(cell % v_game.board_size)
    into v_count, v_column, v_min_row, v_max_row, v_min_column, v_max_column
    from pg_catalog.unnest(v_cells) as expanded_cells(cell);

    if not (
      (v_count = 1 and v_max_column - v_min_column + 1 = pg_catalog.cardinality(v_cells))
      or
      (v_column = 1 and v_max_row - v_min_row + 1 = pg_catalog.cardinality(v_cells))
    ) then
      raise exception 'Cada barco debe ocupar casillas contiguas en línea recta.';
    end if;

    insert into public.ships (game_id, user_id, ship_number, cells)
    values (p_game_id, v_user_id, v_ship_number, v_cells);
    v_occupied := v_occupied || v_cells;
  end loop;

  update public.game_players
  set is_ready = true
  where game_id = p_game_id and user_id = v_user_id;

  select pg_catalog.count(*) filter (where is_ready)
  into v_ready_count
  from public.game_players
  where game_id = p_game_id;

  if v_ready_count = 2 then
    update public.games
    set status = 'active',
        current_turn = (
          select gp.user_id
          from public.game_players gp
          where gp.game_id = p_game_id and gp.seat = 1
        )
    where id = p_game_id;
    v_status := 'active';
  else
    v_status := 'placing';
  end if;

  return v_status;
end;
$$;

create or replace function public.fire_attack(
  p_game_id uuid,
  p_row integer,
  p_column integer,
  p_attack_type text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_target_id uuid;
  v_attack_id uuid := gen_random_uuid();
  v_center integer;
  v_cell integer;
  v_row_offset integer;
  v_column_offset integer;
  v_target_row integer;
  v_target_column integer;
  v_targets integer[] := array[]::integer[];
  v_cells integer[];
  v_is_hit boolean;
  v_ship_sunk boolean;
  v_results jsonb := '[]'::jsonb;
  v_winner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para atacar.';
  end if;
  if p_attack_type is null
     or p_attack_type not in ('normal', 'cross', 'bombardment') then
    raise exception 'Tipo de ataque no válido.';
  end if;
  if p_row not between 0 and 14 or p_column not between 0 and 14 then
    raise exception 'La coordenada está fuera del tablero.';
  end if;

  select *
  into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found or v_game.status <> 'active' or v_game.current_turn <> v_user_id then
    raise exception 'La partida no está activa o no es tu turno.';
  end if;
  if not exists (
    select 1 from public.game_players gp
    where gp.game_id = p_game_id and gp.user_id = v_user_id
  ) then
    raise exception 'No participas en esta partida.';
  end if;

  select gp.user_id
  into v_target_id
  from public.game_players gp
  where gp.game_id = p_game_id and gp.user_id <> v_user_id;

  if v_target_id is null or not exists (
    select 1 from public.game_players gp
    where gp.game_id = p_game_id and gp.user_id = v_target_id and gp.is_ready
  ) then
    raise exception 'El rival todavía no confirmó su flota.';
  end if;

  v_center := p_row * v_game.board_size + p_column;
  if p_attack_type = 'normal' then
    v_targets := array[v_center];
  else
    for v_row_offset in -2..2 loop
      for v_column_offset in -2..2 loop
        if p_attack_type = 'cross' then
          if not (
            (v_row_offset = 0 and v_column_offset = 0)
            or (v_row_offset = 0 and abs(v_column_offset) = 1)
            or (v_column_offset = 0 and abs(v_row_offset) = 1)
          ) then
            continue;
          end if;
        elsif (v_row_offset + v_column_offset) % 2 <> 0 then
          continue;
        end if;

        v_target_row := p_row + v_row_offset;
        v_target_column := p_column + v_column_offset;
        if v_target_row between 0 and 14 and v_target_column between 0 and 14 then
          v_targets := pg_catalog.array_append(
            v_targets,
            v_target_row * v_game.board_size + v_target_column
          );
        end if;
      end loop;
    end loop;
  end if;

  if exists (
    select 1 from public.shots s
    where s.game_id = p_game_id
      and s.attacker_id = v_user_id
      and s.cell_index = any(v_targets)
  ) then
    raise exception 'El ataque incluye casillas que ya fueron atacadas.';
  end if;

  insert into public.attacks (
    id, game_id, attacker_id, target_id, center_cell, attack_type
  )
  values (v_attack_id, p_game_id, v_user_id, v_target_id, v_center, p_attack_type);

  foreach v_cell in array v_targets loop
    select s.cells
    into v_cells
    from public.ships s
    where s.game_id = p_game_id
      and s.user_id = v_target_id
      and v_cell = any(s.cells);

    v_is_hit := found;
    v_ship_sunk := false;
    if v_is_hit then
      select not exists (
        select 1
        from pg_catalog.unnest(v_cells) as ship_cells(ship_cell)
        where ship_cell <> v_cell
          and not exists (
            select 1
            from public.shots previous_shot
            where previous_shot.game_id = p_game_id
              and previous_shot.attacker_id = v_user_id
              and previous_shot.cell_index = ship_cell
          )
      )
      into v_ship_sunk;
    end if;

    insert into public.shots (
      attack_id, game_id, attacker_id, target_id, cell_index, is_hit, ship_sunk
    )
    values (
      v_attack_id, p_game_id, v_user_id, v_target_id, v_cell, v_is_hit, v_ship_sunk
    );

    v_results := v_results || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'cell', v_cell,
        'result', case when v_is_hit then 'hit' else 'miss' end,
        'ship_sunk', v_ship_sunk
      )
    );
  end loop;

  if not exists (
    select 1
    from public.ships ship
    cross join lateral pg_catalog.unnest(ship.cells) as ship_cells(ship_cell)
    where ship.game_id = p_game_id
      and ship.user_id = v_target_id
      and not exists (
        select 1
        from public.shots s
        where s.game_id = p_game_id
          and s.attacker_id = v_user_id
          and s.cell_index = ship_cell
      )
  ) then
    v_winner_id := v_user_id;
    update public.games
    set status = 'finished', winner_id = v_winner_id, current_turn = null
    where id = p_game_id;
  else
    update public.games
    set current_turn = v_target_id
    where id = p_game_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'attack_id', v_attack_id,
    'results', v_results,
    'winner_id', v_winner_id
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.ships enable row level security;
alter table public.attacks enable row level security;
alter table public.shots enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Authenticated users can view profiles" on public.profiles;
create policy "Authenticated users can view profiles"
on public.profiles for select to authenticated
using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "Players can view their games" on public.games;
create policy "Players can view their games"
on public.games for select to authenticated
using (public.is_game_player(id));

drop policy if exists "Players can view game participants" on public.game_players;
create policy "Players can view game participants"
on public.game_players for select to authenticated
using (public.is_game_player(game_id));

drop policy if exists "Players can view their own ships" on public.ships;
create policy "Players can view their own ships"
on public.ships for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Players can view game attacks" on public.attacks;
create policy "Players can view game attacks"
on public.attacks for select to authenticated
using (public.is_game_player(game_id));

drop policy if exists "Players can view game shots" on public.shots;
create policy "Players can view game shots"
on public.shots for select to authenticated
using (public.is_game_player(game_id));

drop policy if exists "Players can view game chat" on public.chat_messages;
create policy "Players can view game chat"
on public.chat_messages for select to authenticated
using (public.is_game_player(game_id));

drop policy if exists "Players can send game chat" on public.chat_messages;
create policy "Players can send game chat"
on public.chat_messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_game_player(game_id)
);

revoke all on public.profiles, public.games, public.game_players, public.ships,
  public.attacks, public.shots, public.chat_messages from anon, authenticated;
grant select on public.profiles, public.games, public.game_players, public.ships,
  public.attacks, public.shots, public.chat_messages to authenticated;
grant update (username) on public.profiles to authenticated;
grant insert (game_id, user_id, message) on public.chat_messages to authenticated;

revoke all on function public.create_game() from public;
revoke all on function public.join_game(text) from public;
revoke all on function public.place_fleet(uuid, jsonb) from public;
revoke all on function public.fire_attack(uuid, integer, integer, text) from public;
grant execute on function public.create_game() to authenticated;
grant execute on function public.join_game(text) to authenticated;
grant execute on function public.place_fleet(uuid, jsonb) to authenticated;
grant execute on function public.fire_attack(uuid, integer, integer, text) to authenticated;
