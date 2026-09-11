import artesaniasDelMar from '../assets/stores/artesanias-del-mar.jpg';
import bellezaNatural from '../assets/stores/belleza-natural.jpg';
import bajaBlueAdventures from '../assets/stores/baja-blue-adventures.jpg';

// XOLOLO: 3 tiendas destacadas piloto que aparecen al final del landing.
// Las fotos son las del set oficial de mockups (Estrategia Maestra), como
// referencia visual hasta que existan storefronts reales.

const featuredStores = [
  {
    id: 'artesanias-del-mar',
    name: 'Artesanías del Mar',
    subdomain: 'artesaniasdelmar.xololo.mx',
    description:
      'Piezas de cerámica y joyería hechas a mano, inspiradas en la costa mexicana.',
    href: 'https://artesaniasdelmar.xololo.mx',
    cover: artesaniasDelMar,
    coverPosition: 'center 65%',
  },
  {
    id: 'belleza-natural',
    name: 'Belleza Natural',
    subdomain: 'bellezanatural.xololo.mx',
    description:
      'Estética avanzada en Querétaro: tratamientos faciales y servicios profesionales.',
    href: 'https://bellezanatural.xololo.mx',
    cover: bellezaNatural,
    coverPosition: 'center 30%',
  },
  {
    id: 'baja-blue-adventures',
    name: 'Baja Blue Adventures',
    subdomain: 'bajablueadventures.xololo.mx',
    description:
      'Renta de lanchas, tours y experiencias inolvidables en La Paz, Baja California Sur.',
    href: 'https://bajablueadventures.xololo.mx',
    cover: bajaBlueAdventures,
    coverPosition: 'center 55%',
  },
];

export default featuredStores;
