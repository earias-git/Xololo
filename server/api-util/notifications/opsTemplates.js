// XOLOLO 2026-11-18 — plantillas de emails ad-hoc para OPS.
//
// Cada plantilla tiene placeholders {{name}} que el operador llena
// en el form antes de enviar. La sustitución la hace el frontend
// (ver OpsConsolePage/NotificationsView.js).
//
// Para agregar una plantilla: push un nuevo objeto a OPS_TEMPLATES
// y deploy. Es config como código — no hay CRUD de UI por diseño,
// para evitar que cualquier operador pueda enviar cosas improvisadas.

const OPS_TEMPLATES = [
  {
    id: 'resync-variants',
    label: 'Resincronizar variantes (bug legacy)',
    description:
      'Pide al seller entrar al tab Variantes y re-guardar para corregir sync incompleto del bug previo (ADR-004).',
    subject: 'Acción requerida: resincronizar las variantes de {{listingTitle}}',
    bodyText:
      `Hola {{name}},

Detectamos que las variantes de tu anuncio "{{listingTitle}}" quedaron con el inventario incompleto por un bug de nuestro lado que acabamos de corregir. Hoy el anuncio dice que tendrá {{expectedVariants}} variantes pero sus hermanos nunca se crearon, así que los compradores no pueden elegir talla/color desde la ficha.

Para corregirlo (30 segundos):
  1. Abre: {{listingUrl}}
  2. Baja hasta el final del panel.
  3. Click en "Guardar cambios" (sin tocar nada más).
  4. Espera unos segundos a que termine el sync.

Después de eso, las variantes quedarán correctamente creadas y los compradores podrán elegir.

Si prefieres que te acompañemos o tienes dudas, responde este correo.

Gracias por tu paciencia,
El equipo de Xololo`,
  },
  {
    id: 'foto-por-color',
    label: 'Nueva función: foto por color (Moda)',
    description:
      'Anuncia a sellers moda con variantes color que ya pueden subir una foto distinta por cada color.',
    subject: 'Nueva función: una foto distinta por cada color en {{listingTitle}}',
    bodyText:
      `Hola {{name}},

Ya habilitamos la función de foto por color para los anuncios de la categoría Moda.

En el tab Variantes de tu anuncio "{{listingTitle}}", debajo de los chips de color, verás un bloque "Foto por color (Moda)" con un slot por cada color que marcaste. Sube una imagen real de ese color (p.ej. la foto en negro, otra en azul, etc.) y en la ficha pública el comprador verá la foto correcta cuando cambie de color.

Si no subes foto para algún color, se usará automáticamente la foto principal del producto.

Link al tab Variantes: {{listingUrl}}

Cualquier duda, responde este correo.

Saludos,
El equipo de Xololo`,
  },
  {
    id: 'docs-legales-pendientes',
    label: 'Recordatorio: completar datos legales',
    description:
      'Recordatorio al seller de que sus pagos están retenidos hasta que complete sus datos legales.',
    subject: 'Tus pagos están retenidos — completa tus datos legales',
    bodyText:
      `Hola {{name}},

Tus ventas se están acumulando pero los pagos no se liberan todavía porque faltan algunos datos legales (RFC, régimen fiscal, dirección fiscal).

Para liberar tus pagos:
  1. Abre: https://xololo.mx/account/store
  2. Completa la sección "Datos fiscales" y "Datos legales".
  3. Sube los documentos pedidos (identificación oficial, constancia de situación fiscal).

Normalmente la revisión toma 1 día hábil. Cuando quede aprobado, Xololo libera automáticamente todos los pagos retenidos y los siguientes se depositan a Stripe en el ciclo normal.

Si tienes dudas sobre los documentos, responde este correo y te orientamos.

Gracias,
El equipo de Xololo`,
  },
  {
    id: 'bienvenida',
    label: 'Bienvenida al marketplace',
    description:
      'Mensaje post-signup para orientar al seller en sus primeros pasos.',
    subject: '¡Bienvenido a Xololo, {{name}}!',
    bodyText:
      `Hola {{name}},

¡Qué gusto tenerte en Xololo! Somos un marketplace mexicano con pago protegido — el dinero del comprador se queda con nosotros hasta que te confirme que recibió el producto bien.

Para empezar a vender:
  1. Completa tu tienda en: https://xololo.mx/account/store
  2. Publica tu primer anuncio en: https://xololo.mx/l/new
  3. Agrega tus datos legales para que los pagos se liberen automático.

¿Dudas? Responde este correo o escríbenos por WhatsApp.

Gracias por confiar en Xololo,
El equipo`,
  },
  {
    id: 'libre',
    label: '(Mensaje libre — sin plantilla)',
    description: 'Partir de cero. El operador escribe el subject y body manualmente.',
    subject: '',
    bodyText: '',
  },
];

// Placeholders disponibles (para doc del form UI):
const AVAILABLE_PLACEHOLDERS = [
  { key: 'name', label: 'Nombre del destinatario' },
  { key: 'listingTitle', label: 'Título del anuncio' },
  { key: 'listingUrl', label: 'URL del anuncio (edit variants)' },
  { key: 'expectedVariants', label: 'Nº de variantes esperadas' },
];

module.exports = { OPS_TEMPLATES, AVAILABLE_PLACEHOLDERS };
