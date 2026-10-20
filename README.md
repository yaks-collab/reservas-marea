# Marea Entrenamiento · Reservas de sesiones

Página para reservar sesiones con el coach Yaku en Medellín (lunes a sábado, 8:00 a. m. – 5:00 p. m.).

- `index.html` — el cliente elige sesión, día y hora y envía la solicitud.
- `admin.html` — panel del entrenador para aceptar, rechazar o cancelar.
- `supabase.sql` — base de datos (no deja reservar dos veces la misma hora).
- `apps-script/Code.gs` — correos y Google Calendar (se pega en script.google.com).

La clave de Supabase que va en el HTML es la **publishable**. La clave del webhook vive solo en Apps Script y en Supabase, nunca en este repositorio.
