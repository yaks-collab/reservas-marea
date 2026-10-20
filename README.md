# Marea Entrenamiento · Reservas de sesiones

Página para reservar sesiones con el coach Yaku en Medellín (lunes a sábado, 8:00 a. m. – 5:00 p. m.). Todo se coordina por **WhatsApp**: no se envían correos.

- `index.html`: el cliente elige sesión, día y hora. La solicitud se guarda y se abre WhatsApp con el mensaje listo para Yaku.
- `admin.html`: panel del entrenador. Al aceptar, rechazar o cancelar, se abre WhatsApp con el mensaje para el cliente.
- `supabase.sql`: base de datos. Tacha las horas ocupadas y no deja reservar dos veces la misma hora.

Publicada en GitHub Pages: https://yaks-collab.github.io/reservas-marea/

La clave de Supabase que va en el HTML es la **publishable** (pública). La seguridad la dan las reglas de `supabase.sql`.
