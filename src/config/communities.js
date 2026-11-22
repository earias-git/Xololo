/**
 * XOLOLO 2026-11-18 — Catálogo seed de comunidades (ADR-006).
 *
 * Esta es la data inicial que se escribe a metadata del marketplace
 * en el primer deploy (via script de seeding). Después, el CRUD
 * admin es la fuente de verdad: este archivo NO se re-lee en runtime
 * (es solo un seed).
 *
 * Para agregar una comunidad en runtime: usar /ops/communities CRUD.
 * Para agregar una comunidad al seed inicial: push aquí y correr el
 * script de seeding.
 */

const COMMUNITIES_SEED = [
  {
    id: 'opf',
    type: 'sectorial',
    name: 'OPF – Sector Verde',
    slug: 'opf',
    tagline: '13 años conectando el sector verde mexicano',
    description:
      'Red fundacional del sector verde en México. Agrupa viveros, productores, floristas, paisajistas y comerciantes del sector que reciben el respaldo de 13 años de trayectoria del programa OPF, ahora integrado como primera comunidad vertical de Xololo.',
    bylaws:
      'OPF nació en 2013 como red del sector verde mexicano para conectar productores con compradores institucionales y particulares, con énfasis en comercio justo y trazabilidad del productor directo. En 2026 se integra a Xololo como primera comunidad comercial, manteniendo sus valores: respaldo al productor, transparencia y vocación educativa del sector.',
    branding: {
      // Se llenan cuando lleguen assets reales. Null fuerza
      // fallback visual (iniciales + gradient) — ver §6 del
      // MODEL_COMMUNITIES_V1.
      logoUrl: null,
      heroUrl: null,
      primaryColor: '#2d5016', // verde profundo
      secondaryColor: '#8fbc8f', // verde salvia
      accentColor: '#c9b037', // dorado hoja seca
    },
    admins: [
      // Se llenan via /ops/communities post-seed.
      // Default inicial: operador que corre el seed (@earias).
    ],
    membership: 'open', // sellers pueden unirse directo sin aprobación
    requiresCertification: false,
    primaryFacets: {
      sector: ['verde'],
      uso: ['ornamental', 'comestible'],
    },
    // XOLOLO 2026-11-18 — chips de filtro propios de la comunidad.
    // Si está definido, la landing /comunidad/:slug lo usa en vez de
    // derivar los chips de los categoryLevel1 genéricos de Xololo.
    // Taxonomía Sector Verde — ver docs/TAXONOMIA_SECTOR_VERDE.md.
    // Cada chip tiene un matcher simple (categoryLevel1 + opcional
    // categoryLevel2). Un listing sin esa taxonomía NO matchea y
    // aparece solo bajo "Todos".
    // XOLOLO 2026-11-21 — iconId mapea a un SVG outlined estilo Xololo
    // (ver src/containers/CommunityLandingPage/communityFilterIcons.js).
    // El seed sigue siendo puro JSON para que server y client lo
    // compartan sin JSX.
    filterGroups: [
      {
        id: 'plantas-ornamentales',
        label: 'Plantas ornamentales',
        iconId: 'leaf',
        match: { categoryLevel1: 'hogar', categoryLevel2: 'jardineria' },
      },
      {
        id: 'flores-de-corte',
        label: 'Flores de corte',
        iconId: 'flower',
        match: { categoryLevel1: 'hogar', categoryLevel2: 'flores-de-corte' },
      },
      {
        id: 'servicios-jardineria',
        label: 'Jardinería',
        iconId: 'scissors',
        match: { categoryLevel1: 'servicios', categoryLevel2: 'jardineria' },
      },
      {
        id: 'servicios-arboricultura',
        label: 'Arboricultura',
        iconId: 'tree',
        match: { categoryLevel1: 'servicios', categoryLevel2: 'arboricultura' },
      },
      {
        id: 'servicios-floristeria',
        label: 'Floristería',
        iconId: 'bouquet',
        match: { categoryLevel1: 'servicios', categoryLevel2: 'floristeria' },
      },
      {
        id: 'servicios-agricultura',
        label: 'Agricultura y horticultura',
        iconId: 'tractor',
        match: { categoryLevel1: 'servicios', categoryLevel2: 'agricultura' },
      },
      {
        id: 'insumos-agricolas',
        label: 'Insumos agrícolas',
        iconId: 'vial',
        match: { categoryLevel1: 'alimentos', categoryLevel2: 'insumos-agricolas' },
      },
    ],
    seoKeywords: [
      'viveros méxico',
      'sector verde',
      'plantas méxico',
      'productor directo verde',
      'OPF',
      'arboricultura',
      'floristería',
      'jardinería profesional',
    ],
    isPublished: true, // XOLOLO 2026-11-18: publicada para que la
    // landing /comunidad/opf sea visible desde PR-6. Mientras no
    // haya sellers con membership, muestra el EmptyState con CTA
    // "Ir a mi tienda" (ver CommunityLandingPage.js).
    sellerCount: 0,
    createdAt: '2026-11-18T00:00:00Z',
    updatedAt: '2026-11-18T00:00:00Z',
    createdBy: 'seed',
  },
];

module.exports = { COMMUNITIES_SEED };
