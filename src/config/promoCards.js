// XOLOLO: tarjetas promocionales tipo MercadoLibre que aparecen en el landing
// entre el riel de categorías y las tiendas destacadas. Cada card tiene un
// color de tema propio (variante), un kicker corto y una llamada a acción.
//
// Los `href` son rutas internas del marketplace. Cambiar los textos, los
// links y las variantes aquí no requiere tocar el componente.

const promoCards = [
  {
    id: 'ofertas-dia',
    kicker: 'Ofertas del día',
    title: 'Hasta 30% off en artesanías mexicanas',
    description: 'Piezas hechas a mano de vendedores Verified en Oaxaca, Puebla y Michoacán.',
    cta: 'Ver ofertas',
    href: '/s?pub_categoryLevel1=artesanias',
    variant: 'amber',
  },
  {
    id: 'reserva-servicios',
    kicker: 'Nuevo',
    title: 'Reserva servicios con calendario en vivo',
    description: 'Elige fecha y hora, confirma al instante.',
    cta: 'Cómo funciona',
    href: '/p/como-funciona',
    variant: 'green',
  },
  {
    id: 'xololo-verified',
    kicker: 'Social Sellers — Vendedores en redes',
    title: 'Obtén el sello Xololo Verified™',
    description:
      'Más conversión, visibilidad superior y pack de assets para tu bio de Instagram, portada de Facebook y firma de WhatsApp.',
    cta: 'Verificarme ahora',
    href: '/p/verified#seller',
    variant: 'navy',
  },
];

export default promoCards;
