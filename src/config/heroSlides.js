import slide1 from '../assets/hero/hero-slide-1-confianza.jpg';
import slide2 from '../assets/hero/hero-slide-2-oferta.jpg';
import slide3 from '../assets/hero/hero-slide-3-tienda.jpg';

// XOLOLO: slides del hero carrusel del landing page.
// Los textos y CTAs se editan aquí — las imágenes viven en src/assets/hero/.
// Cuando exista contenido dinámico desde Console (marketing/promos), migrar
// esta configuración a un asset alojado ahí.
const heroSlides = [
  {
    id: 'verified',
    eyebrow: 'Xololo Verified™',
    title: 'Compra y vende con quien está verificado',
    description:
      'Cada seller Xololo Verified pasó un filtro de identidad, documentos legales y cuenta de cobros. Tu dinero se libera solo cuando confirmas que recibiste.',
    ctas: [
      { label: 'Explorar productos', href: '/s?pub_listingType=product' },
      { label: '¿Qué es Verified?', href: '/p/verified', variant: 'ghost' },
    ],
    background: slide1,
    imageAlt: 'Fondo azul Xololo — compra con confianza',
  },
  {
    id: 'social-seller',
    eyebrow: 'Para quien vende en redes',
    title: 'Vende en Instagram, WhatsApp o TikTok con una tienda que da confianza',
    description:
      'Link profesional (tutienda.xololo.mx), cobro protegido, factura automática y herramientas listas para compartir en redes. Olvídate de los "mándame tus datos al DM".',
    ctas: [
      { label: 'Crear mi tienda', href: '/signup' },
      { label: 'Cómo funciona', href: '/p/como-funciona', variant: 'ghost' },
    ],
    background: slide2,
    imageAlt: 'Fondo verde Xololo — vende en redes sociales',
  },
  {
    id: 'pricing',
    eyebrow: 'Pricing honesto',
    title: 'Tu tienda profesional desde $169/mes — sin comisión por venta',
    description:
      'Suscripción fija, cobro directo a tu cuenta y badge Xololo Verified™ para que tus clientes compren con tranquilidad.',
    ctas: [
      { label: 'Ver planes', href: '/p/planes' },
      { label: 'Verificarme', href: '/p/verified', variant: 'ghost' },
    ],
    note: 'Precio con pago anual',
    background: slide3,
    imageAlt: 'Fondo ámbar Xololo — tienda profesional desde $169/mes',
  },
];

export default heroSlides;
