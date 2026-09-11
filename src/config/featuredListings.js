// XOLOLO: placeholders para las tarjetas de "Productos destacados" y
// "Servicios populares" del landing.
//
// TODO: cuando existan listings reales en el marketplace, reemplazar este
// arreglo por el fetch a la API de Sharetribe (por ejemplo, filtrando por
// `pub_featured=true` y ordenando por reviews). El componente
// FeaturedListings acepta esta forma de objeto:
//
//   { id, kind, name, seller, image, rating, reviewCount, price, priceUnit }
//
// donde `kind` es 'product' o 'service' y controla si se muestra un badge
// "Pago protegido" (product) o un botón "Reservar" (service).

export const featuredProducts = [
  {
    id: 'p-bolsa-artesanal',
    kind: 'product',
    name: 'Bolsa artesanal tejida',
    seller: 'Artesanías del Valle',
    tone: 'terracotta',
    rating: 4.9,
    reviewCount: 120,
    price: 350,
  },
  {
    id: 'p-vela-vainilla',
    kind: 'product',
    name: 'Vela aromática de vainilla',
    seller: 'Luz Natural',
    tone: 'butter',
    rating: 4.8,
    reviewCount: 85,
    price: 180,
  },
  {
    id: 'p-tapiz-macrame',
    kind: 'product',
    name: 'Tapiz en macramé',
    seller: 'Hilos y Nudos',
    tone: 'lilac',
    rating: 4.9,
    reviewCount: 98,
    price: 450,
  },
  {
    id: 'p-cartera-piel',
    kind: 'product',
    name: 'Cartera de piel',
    seller: 'Piel & Estilo',
    tone: 'cocoa',
    rating: 4.7,
    reviewCount: 63,
    price: 599,
  },
  {
    id: 'p-taza-artesanal',
    kind: 'product',
    name: 'Taza artesanal',
    seller: 'Barro y Fuego',
    tone: 'sand',
    rating: 4.9,
    reviewCount: 76,
    price: 220,
  },
  {
    id: 'p-maceta-concreto',
    kind: 'product',
    name: 'Maceta de concreto',
    seller: 'Deco Natural',
    tone: 'moss',
    rating: 4.8,
    reviewCount: 54,
    price: 250,
  },
];

export const featuredServices = [
  {
    id: 's-masaje',
    kind: 'service',
    name: 'Masaje relajante',
    seller: 'Carla Ramírez',
    tone: 'rose',
    rating: 4.9,
    reviewCount: 120,
    price: 500,
    priceUnit: 'Desde',
  },
  {
    id: 's-corte',
    kind: 'service',
    name: 'Corte de cabello',
    seller: 'Barber Shop MX',
    tone: 'steel',
    rating: 4.8,
    reviewCount: 96,
    price: 180,
    priceUnit: 'Desde',
  },
  {
    id: 's-maquillaje',
    kind: 'service',
    name: 'Maquillaje profesional',
    seller: 'María Make Up',
    tone: 'honey',
    rating: 4.9,
    reviewCount: 76,
    price: 650,
    priceUnit: 'Desde',
  },
  {
    id: 's-plomeria',
    kind: 'service',
    name: 'Plomería a domicilio',
    seller: 'Hogar en Orden',
    tone: 'ocean',
    rating: 4.7,
    reviewCount: 60,
    price: 400,
    priceUnit: 'Desde',
  },
  {
    id: 's-logo',
    kind: 'service',
    name: 'Diseño de logotipo',
    seller: 'Creativa Estudio',
    tone: 'violet',
    rating: 4.9,
    reviewCount: 45,
    price: 800,
    priceUnit: 'Desde',
  },
  {
    id: 's-yoga',
    kind: 'service',
    name: 'Clases de yoga',
    seller: 'Ale Yoga',
    tone: 'jade',
    rating: 4.8,
    reviewCount: 122,
    price: 250,
    priceUnit: 'Desde',
  },
];
