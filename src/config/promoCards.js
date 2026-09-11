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
    description:
      'Piezas hechas a mano de sellers Verified en Oaxaca, Puebla y Michoacán.',
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
    id: 'vender-hoy',
    kicker: 'Para tu negocio',
    title: 'Vende en Xololo hoy mismo',
    description:
      'Tu tienda propia + acceso al marketplace, sin elegir entre uno u otro.',
    cta: 'Empezar a vender',
    href: '/signup',
    variant: 'navy',
  },
];

export default promoCards;
