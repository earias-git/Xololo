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
    id: 'envio-gratis',
    eyebrow: 'Oferta de lanzamiento',
    title: 'Envío gratis en tu primera compra',
    description:
      'Válido en pedidos mayores a $500 MXN con cualquier seller Xololo Verified™. Por tiempo limitado.',
    ctas: [{ label: 'Ver ofertas', href: '/s' }],
    background: slide2,
    imageAlt: 'Fondo verde Xololo — envío gratis',
  },
  {
    id: 'abrir-tienda',
    eyebrow: 'Para negocios',
    title: 'Abre tu tienda en línea desde $299/mes',
    description:
      'Tu propia tienda en tuempresa.xololo.mx: fácil de armar, fácil de administrar. Sin necesidad de saber de tecnología.',
    ctas: [
      { label: 'Crear mi tienda', href: '/signup' },
      { label: 'Ver planes', href: '/p/planes', variant: 'ghost' },
    ],
    background: slide3,
    imageAlt: 'Fondo ámbar Xololo — abre tu tienda',
  },
];

export default heroSlides;
