/**
 * Marea Entrenamiento · Automatización con Google
 *
 * Pega este archivo en script.google.com con la cuenta de Google del entrenador.
 * Supabase le avisa (webhook) cada vez que se crea o cambia una reserva:
 *   - nueva solicitud   → correo al entrenador
 *   - aceptada          → evento en el Google Calendar del entrenador + invitación al cliente
 *   - rechazada         → correo al cliente para que elija otra hora
 *   - cancelada         → borra el evento y avisa al cliente
 *
 * La clave secreta NO va aquí: va en Configuración del proyecto → Propiedades
 * del script → CLAVE_WEBHOOK.
 */

const CONFIG = {
  NEGOCIO: 'Marea Entrenamiento',
  ENTRENADOR: 'Yaku',
  CORREO_ENTRENADOR: 'yaku.colque@gmail.com',
  WHATSAPP: '41783011397',
  ZONA: 'America/Bogota',
  LUGAR: 'Medellín · Parque de El Poblado o a domicilio',
  // Cámbialo por la URL publicada en GitHub Pages (termina en /)
  URL_SITIO: 'https://yaks-collab.github.io/reservas-marea/'
};

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------------------------------------------------------------------
// Entrada del webhook de Supabase
// ---------------------------------------------------------------------
function doPost(e) {
  const clave = PropertiesService.getScriptProperties().getProperty('CLAVE_WEBHOOK');
  const recibida = e && e.parameter ? e.parameter.clave : '';
  if (!clave || recibida !== clave) {
    console.warn('Webhook con clave incorrecta: no se hace nada.');
    return respuesta('no');
  }

  let datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    console.error('JSON inválido', err);
    return respuesta('json');
  }

  const tipo = datos.type;            // INSERT | UPDATE
  const r = datos.record || {};
  const antes = datos.old_record || {};

  // Evita que dos avisos del mismo cambio se procesen a la vez
  const candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    if (tipo === 'INSERT' && r.estado === 'pendiente') {
      correoNuevaSolicitud(r);
    } else if (tipo === 'UPDATE' && r.estado !== antes.estado) {
      if (r.estado === 'aceptada') crearEvento(r);
      if (r.estado === 'rechazada') correoRechazo(r);
      if (r.estado === 'cancelada') cancelarEvento(r);
    }
  } finally {
    candado.releaseLock();
  }
  return respuesta('ok');
}

function respuesta(texto) {
  return ContentService.createTextOutput(texto);
}

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------
function correoNuevaSolicitud(r) {
  const cuando = fechaLarga(r.inicio) + ' · ' + hora(r.inicio);
  const wa = numeroWhatsApp(r.telefono);
  MailApp.sendEmail({
    to: CONFIG.CORREO_ENTRENADOR,
    subject: 'Nueva solicitud: ' + r.sesion_nombre + ' · ' + cuando,
    replyTo: r.email,
    name: CONFIG.NEGOCIO,
    htmlBody: plantilla(
      'Nueva solicitud de reserva',
      '<p><b>' + esc(r.sesion_nombre) + '</b><br>' + esc(cuando) + ' – ' + esc(hora(r.fin)) + '</p>' +
      '<p>Nombre: ' + esc(r.nombre) + '<br>' +
      'Correo: ' + esc(r.email) + '<br>' +
      'Celular: ' + (wa ? '<a href="https://wa.me/' + wa + '">' + esc(r.telefono) + '</a>' : esc(r.telefono)) +
      (r.nota ? '<br>Nota: ' + esc(r.nota) : '') + '</p>' +
      '<p>Solicitud #' + esc(r.id) + '</p>',
      'Abrir el panel para aceptar o rechazar', CONFIG.URL_SITIO + 'admin.html'
    )
  });
}

function crearEvento(r) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('reserva_' + r.id)) return;   // ya existe (aviso repetido)

  const evento = CalendarApp.getDefaultCalendar().createEvent(
    r.sesion_nombre + ' · ' + r.nombre,
    new Date(r.inicio),
    new Date(r.fin),
    {
      guests: r.email,
      sendInvites: true,
      location: CONFIG.LUGAR,
      description:
        CONFIG.NEGOCIO + ' · Solicitud #' + r.id + '\n' +
        'Cliente: ' + r.nombre + '\n' +
        'Celular: ' + r.telefono + '\n' +
        (r.nota ? 'Nota: ' + r.nota + '\n' : '') +
        '\n¿Necesitas cambiarla? Escríbele a ' + CONFIG.ENTRENADOR + ' por WhatsApp: https://wa.me/' + CONFIG.WHATSAPP
    }
  );
  props.setProperty('reserva_' + r.id, evento.getId());
}

function correoRechazo(r) {
  borrarEventoSiExiste(r.id);
  MailApp.sendEmail({
    to: r.email,
    subject: 'Tu solicitud en ' + CONFIG.NEGOCIO + ': elige otra hora',
    replyTo: CONFIG.CORREO_ENTRENADOR,
    name: CONFIG.NEGOCIO,
    htmlBody: plantilla(
      'Hola, ' + esc(r.nombre),
      '<p>Gracias por querer entrenar con nosotros. Lamentablemente no podemos atenderte en ' +
      '<b>' + esc(r.sesion_nombre) + '</b> el ' + esc(fechaLarga(r.inicio)) + ' a las ' + esc(hora(r.inicio)) + '.</p>' +
      '<p>¿Eliges otra hora? Hay más espacios disponibles en la página.</p>' +
      '<p>— ' + esc(CONFIG.ENTRENADOR) + '</p>',
      'Elegir otra hora', CONFIG.URL_SITIO
    )
  });
}

function cancelarEvento(r) {
  borrarEventoSiExiste(r.id);
  MailApp.sendEmail({
    to: r.email,
    subject: 'Sesión cancelada · ' + CONFIG.NEGOCIO,
    replyTo: CONFIG.CORREO_ENTRENADOR,
    name: CONFIG.NEGOCIO,
    htmlBody: plantilla(
      'Hola, ' + esc(r.nombre),
      '<p>Tu sesión de <b>' + esc(r.sesion_nombre) + '</b> del ' + esc(fechaLarga(r.inicio)) +
      ' a las ' + esc(hora(r.inicio)) + ' fue cancelada. Ya la quitamos del calendario.</p>' +
      '<p>Si quieres, puedes reservar otra hora.</p>' +
      '<p>— ' + esc(CONFIG.ENTRENADOR) + '</p>',
      'Reservar otra hora', CONFIG.URL_SITIO
    )
  });
}

function borrarEventoSiExiste(id) {
  const props = PropertiesService.getScriptProperties();
  const eventoId = props.getProperty('reserva_' + id);
  if (!eventoId) return;
  const evento = CalendarApp.getDefaultCalendar().getEventById(eventoId);
  if (evento) evento.deleteEvent();
  props.deleteProperty('reserva_' + id);
}

// ---------------------------------------------------------------------
// Ayudas: fechas en español y en la zona del negocio
// ---------------------------------------------------------------------
function fechaLarga(iso) {
  const d = new Date(iso);
  const dow = Number(Utilities.formatDate(d, CONFIG.ZONA, 'u')) % 7;   // 1=lunes … 7=domingo
  const dia = Utilities.formatDate(d, CONFIG.ZONA, 'd');
  const mes = Number(Utilities.formatDate(d, CONFIG.ZONA, 'M')) - 1;
  return DIAS[dow] + ' ' + dia + ' de ' + MESES[mes];
}

function hora(iso) {
  const d = new Date(iso);
  const h = Number(Utilities.formatDate(d, CONFIG.ZONA, 'H'));
  const m = Utilities.formatDate(d, CONFIG.ZONA, 'mm');
  return ((h + 11) % 12 + 1) + ':' + m + (h < 12 ? ' a. m.' : ' p. m.');
}

function numeroWhatsApp(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.length === 10 && d.charAt(0) === '3' ? '57' + d : d;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function plantilla(titulo, cuerpo, textoBoton, url) {
  return '' +
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0b1f3a">' +
      '<div style="background:#0b1f3a;color:#fff;padding:18px 20px;border-radius:12px 12px 0 0">' +
        '<b style="font-size:18px">🌊 ' + esc(CONFIG.NEGOCIO) + '</b>' +
      '</div>' +
      '<div style="background:#fff;border:1px solid #e3e7ed;border-top:0;padding:20px;border-radius:0 0 12px 12px">' +
        '<h2 style="margin:0 0 12px;font-size:20px">' + titulo + '</h2>' +
        cuerpo +
        '<p style="margin:20px 0 0"><a href="' + url + '" style="background:#0b1f3a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;display:inline-block">' +
          esc(textoBoton) + '</a></p>' +
      '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------
// Correr UNA vez a mano: así Google pide los permisos de Calendar y Gmail
// ---------------------------------------------------------------------
function probarCalendario() {
  const inicio = new Date(Date.now() + 60 * 60 * 1000);
  const fin = new Date(inicio.getTime() + 15 * 60 * 1000);
  const evento = CalendarApp.getDefaultCalendar().createEvent('Prueba ' + CONFIG.NEGOCIO, inicio, fin);
  console.log('Evento de prueba creado: ' + evento.getId());
  evento.deleteEvent();
  console.log('Evento de prueba borrado. Calendario OK.');
  console.log('Correos que puedes enviar hoy: ' + MailApp.getRemainingDailyQuota());
  console.log('Zona horaria del script: ' + Session.getScriptTimeZone() + ' (debe ser ' + CONFIG.ZONA + ')');
  if (!PropertiesService.getScriptProperties().getProperty('CLAVE_WEBHOOK')) {
    console.warn('Falta la propiedad CLAVE_WEBHOOK en Configuración del proyecto.');
  }
}
