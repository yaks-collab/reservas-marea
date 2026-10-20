-- =====================================================================
-- Marea Entrenamiento · Base de datos de reservas
-- Pégalo completo en Supabase → SQL Editor → Run.
-- Se puede correr más de una vez sin error.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Sesiones (lo que se puede reservar)
-- ---------------------------------------------------------------------
create table if not exists public.sesiones (
  id            bigint generated always as identity primary key,
  nombre        text    not null unique,
  descripcion   text    not null default '',
  duracion_min  integer not null check (duracion_min between 15 and 240),
  precio        integer not null check (precio >= 0),   -- en COP
  emoji         text    not null default '',
  orden         integer not null default 0,
  activa        boolean not null default true
);

insert into public.sesiones (nombre, descripcion, duracion_min, precio, emoji, orden) values
  ('Entrenamiento personal',  'Sesión 1 a 1 adaptada a tu objetivo.',      60,  80000, '🏋️', 1),
  ('Funcional en pareja',     'Entrena con un amigo y dividan el precio.', 60, 120000, '🤸', 2),
  ('Running técnico',         'Técnica de carrera, ritmo y respiración.',  45,  60000, '🏃', 3),
  ('Movilidad y estiramiento','Recupera, gana rango y evita lesiones.',    45,  50000, '🧘', 4)
on conflict (nombre) do update set
  descripcion  = excluded.descripcion,
  duracion_min = excluded.duracion_min,
  precio       = excluded.precio,
  emoji        = excluded.emoji,
  orden        = excluded.orden;

-- ---------------------------------------------------------------------
-- 2. Reservas (tienen datos personales: el público NO las puede leer)
-- ---------------------------------------------------------------------
create table if not exists public.reservas (
  id            bigint generated always as identity primary key,
  sesion_id     bigint not null references public.sesiones(id),
  sesion_nombre text   not null default '',   -- copia del nombre, para los correos
  inicio        timestamptz not null,
  fin           timestamptz not null,
  nombre        text not null,
  email         text not null,
  telefono      text not null default '',
  nota          text not null default '',
  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'aceptada', 'rechazada', 'cancelada')),
  creado_en     timestamptz not null default now(),
  check (fin > inicio)
);

alter table public.reservas add column if not exists sesion_nombre text not null default '';

-- EVITAR RESERVAS REPETIDAS: dos solicitudes pendientes o aceptadas no se
-- pueden cruzar en el tiempo. La regla vive en la base de datos, así que
-- aunque dos personas den clic al mismo segundo, solo una entra.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservas_sin_cruces') then
    alter table public.reservas
      add constraint reservas_sin_cruces
      exclude using gist (tstzrange(inicio, fin) with &&)
      where (estado in ('pendiente', 'aceptada'));
  end if;
end $$;

create index if not exists reservas_estado_inicio_idx on public.reservas (estado, inicio);

-- ---------------------------------------------------------------------
-- 3. Admins (quién es el entrenador)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 4. Seguridad (RLS)
-- ---------------------------------------------------------------------
alter table public.sesiones enable row level security;
alter table public.reservas enable row level security;
alter table public.admins   enable row level security;

drop policy if exists "sesiones activas para todos" on public.sesiones;
create policy "sesiones activas para todos" on public.sesiones
  for select to anon, authenticated
  using (activa or public.es_admin());

drop policy if exists "admins leen reservas" on public.reservas;
create policy "admins leen reservas" on public.reservas
  for select to authenticated
  using (public.es_admin());

drop policy if exists "admins cambian estado" on public.reservas;
create policy "admins cambian estado" on public.reservas
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- Quitar todo y dar solo lo necesario
revoke all on public.sesiones, public.reservas, public.admins from anon, authenticated;
grant select on public.sesiones to anon, authenticated;
grant select on public.reservas to authenticated;
grant update (estado) on public.reservas to authenticated;

-- ---------------------------------------------------------------------
-- 5. Funciones públicas
-- ---------------------------------------------------------------------

-- Horas ocupadas: SOLO inicio y fin, sin nombres ni correos.
create or replace function public.horas_ocupadas(desde timestamptz, hasta timestamptz)
returns table (inicio timestamptz, fin timestamptz)
language sql stable security definer
set search_path = public
as $$
  select r.inicio, r.fin
  from public.reservas r
  where r.estado in ('pendiente', 'aceptada')
    and r.fin > desde
    and r.inicio < least(hasta, desde + interval '45 days')
  order by r.inicio;
$$;

-- Pedir una cita. Valida todo y deja la reserva en 'pendiente'.
create or replace function public.solicitar_reserva(
  p_sesion_id bigint,
  p_inicio    timestamptz,
  p_nombre    text,
  p_email     text,
  p_telefono  text default '',
  p_nota      text default ''
)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  zona        constant text := 'America/Bogota';
  v_sesion    public.sesiones%rowtype;
  v_fin       timestamptz;
  v_local_ini timestamp;
  v_local_fin timestamp;
  v_nombre    text := trim(coalesce(p_nombre, ''));
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_telefono  text := trim(coalesce(p_telefono, ''));
  v_nota      text := trim(coalesce(p_nota, ''));
  v_id        bigint;
begin
  select * into v_sesion from public.sesiones where id = p_sesion_id and activa;
  if not found then
    raise exception 'Esa sesión no está disponible';
  end if;

  if p_inicio < now() + interval '12 hours' then
    raise exception 'Reserva con mínimo 12 horas de anticipación';
  end if;
  if p_inicio > now() + interval '21 days' then
    raise exception 'Solo se puede reservar hasta 21 días hacia adelante';
  end if;

  v_fin       := p_inicio + make_interval(mins => v_sesion.duracion_min);
  v_local_ini := p_inicio at time zone zona;
  v_local_fin := v_fin    at time zone zona;

  -- Horario: lunes a sábado, de 8:00 a 17:00, empezando en punto
  if extract(isodow from v_local_ini) = 7
     or v_local_ini::time < time '08:00'
     or v_local_fin::time > time '17:00'
     or v_local_fin::date <> v_local_ini::date
     or extract(minute from v_local_ini) <> 0
     or extract(second from v_local_ini) <> 0 then
    raise exception 'Esa hora está fuera del horario de atención';
  end if;

  if char_length(v_nombre) not between 2 and 100 then
    raise exception 'Escribe tu nombre';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(v_email) > 200 then
    raise exception 'Revisa tu correo: no parece válido';
  end if;
  if char_length(v_telefono) > 30 then
    raise exception 'Revisa tu celular';
  end if;
  if char_length(v_nota) > 500 then
    raise exception 'La nota es muy larga (máximo 500 caracteres)';
  end if;

  -- Freno contra spam: máximo 3 solicitudes pendientes por correo
  if (select count(*) from public.reservas
      where email = v_email and estado = 'pendiente' and inicio > now()) >= 3 then
    raise exception 'Ya tienes 3 solicitudes pendientes. Espera la confirmación';
  end if;

  begin
    insert into public.reservas (sesion_id, sesion_nombre, inicio, fin, nombre, email, telefono, nota)
    values (v_sesion.id, v_sesion.nombre, p_inicio, v_fin, v_nombre, v_email, v_telefono, v_nota)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Esa hora ya no está disponible';
  end;

  return v_id;
end;
$$;

revoke all on function public.es_admin()                      from public, anon, authenticated;
revoke all on function public.horas_ocupadas(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.solicitar_reserva(bigint, timestamptz, text, text, text, text) from public, anon, authenticated;

grant execute on function public.es_admin()                      to anon, authenticated;
grant execute on function public.horas_ocupadas(timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.solicitar_reserva(bigint, timestamptz, text, text, text, text) to anon, authenticated;
