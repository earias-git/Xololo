import slide1 from '../assets/hero/hero-slide-1-confianza.jpg';
import slide2 from '../assets/hero/hero-slide-2-oferta.jpg';
import slide3 from '../assets/hero/hero-slide-3-tienda.jpg';

// XOLOLO: slides del hero carrusel del landing page.
// Los textos y CTAs se editan aquí — las imágenes viven en src/assets/hero/.
// Cuando exista contenido dinámico desde Console (marketing/promos), migrar
// esta configuración a un asset alojado ahí.
const heroSlides = [
  {
    id: 'confianza',
    eyebrow: 'Marketplace Xololo',
    title: 'Compra con confianza. Vende con seguridad.',
    description:
      'Tu dinero se libera solo cuando recibes lo acordado. Miles de negocios mexicanos ya venden con Xololo Verified™.',
    ctas: [
      { label: 'Explorar productos', href: '/s?pub_listingType=product' },
      { label: 'Explorar servicios', href: '/s?pub_listingType=service', variant: 'ghost' },
    ],
    background: slide1,
    imageAlt: 'Fondo azul Xololo — compra con confianza',
  },
  {
    id: 'cero-comisiones',
    eyebrow: 'Para tu negocio',
    title: 'Tu tienda en línea y marketplace desde CERO comisiones por venta',
    description:
      'Solo pagas tu plan mensual. Tu tienda propia en tuempresa.xololo.mx más el marketplace de Xololo, sin retención por transacción.',
    ctas: [
      { label: 'Ver planes', href: '/p/planes' },
      { label: 'Crear mi tienda', href: '/signup', variant: 'ghost' },
    ],
    background: slide2,
    imageAlt: 'Fondo verde Xololo — cero comisiones por venta',
  },
  {
    id: 'abrir-tienda',
    eyebrow: 'Para negocios',
    title: 'Abre tu tienda en línea desde $169/mes',
    description:
      'Tu propia tienda en tuempresa.xololo.mx: fácil de armar, fácil de administrar. Sin necesidad de saber de tecnología.',
    ctas: [
      { label: 'Crear mi tienda', href: '/signup' },
      { label: 'Ver planes', href: '/p/planes', variant: 'ghost' },
    ],
    note: 'Precio con pago anual',
    background: slide3,
    imageAlt: 'Fondo ámbar Xololo — abre tu tienda',
  },
];

export default heroSlides;
