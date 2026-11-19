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
      'OPF nació en 2013 como red del Prof. Enrique Arias para conectar productores del sector verde mexicano con compradores institucionales y particulares, con énfasis en comercio justo y trazabilidad del productor directo. En 2026 se integra a Xololo como primera comunidad comercial, manteniendo sus valores: respaldo al productor, transparencia y vocación educativa del sector.',
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
    isPublished: false, // se publica manualmente desde OPS cuando
    //                     haya ≥1 seller membership
    sellerCount: 0,
    createdAt: '2026-11-18T00:00:00Z',
    updatedAt: '2026-11-18T00:00:00Z',
    createdBy: 'seed',
  },
];

module.exports = { COMMUNITIES_SEED };
