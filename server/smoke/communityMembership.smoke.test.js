// XOLOLO Blindaje — smoke test de communityMembership (ADR-006 PR-3).
//
// Verifica las invariantes del flujo join/leave + mirror:
//   1. join/leave es idempotente (join 2 veces no duplica,
//      leave sin ser miembro no hace nada).
//   2. El espejo listing.publicData.sellerCommunities SIEMPRE
//      refleja lo que hay en profile.publicData.communities.
//   3. join falla con community no encontrada, inválida, etc.
//   4. Mejor-esfuerzo: si un listings.update falla, no aborta todo.
//   5. ListSellerMemberships maneja comunidades stale (eliminadas
//      del catálogo pero quedadas en el profile).
//
// Si estos fallan, PARAR. Cambio al mirror = ruptura del filtro
// server-side de la landing.

// Mock Integration SDK con tracking de calls.
const mockIsdk = {
  users: {
    show: jest.fn(),
    updateProfile: jest.fn(),
  },
  listings: {
    query: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: () => mockIsdk,
}));

// XOLOLO 2026-11-19: mock del service para controlar el catalog
// que ve el computeMirrorForListing. Por default [] → se comporta
// como opt-out para todas las comunidades (shape legacy de estos
// tests). Los tests nuevos de opt-in setean FAKE_CATALOG.
let FAKE_CATALOG = [];
const setCatalog = c => {
  FAKE_CATALOG.length = 0;
  FAKE_CATALOG.push(...c);
};
jest.mock('../api-util/communitiesService', () => ({
  getAllRaw: () => FAKE_CATALOG,
  invalidateCache: jest.fn(),
  getBySlugPublic: (slug, type) => {
    const c = FAKE_CATALOG.find(
      x => x.slug === slug && (!type || x.type === type)
    );
    return c ? { id: c.id, type: c.type, name: c.name || c.id } : null;
  },
}));

// Mock del catálogo para poder controlar comunidades existentes.
const FAKE_SEED = [];
jest.mock('../../src/config/communities', () => ({
  get COMMUNITIES_SEED() {
    return FAKE_SEED;
  },
}));

const setSeed = seed => {
  FAKE_SEED.length = 0;
  FAKE_SEED.push(...seed);
};

const makeUser = (id, communities = null) => ({
  id: { uuid: id },
  type: 'user',
  attributes: {
    email: `${id}@test.mx`,
    profile: {
      displayName: id,
      publicData: communities ? { communities } : {},
    },
  },
});

const makeListing = (id, sellerCommunities = []) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    title: `l-${id}`,
    publicData: { sellerCommunities },
  },
});

const makeCommunity = (id, extra = {}) => ({
  id,
  type: 'sectorial',
  slug: id,
  name: `C${id}`,
  isPublished: true,
  isDeleted: false,
  ...extra,
});

describe('communityMembership · smoke', () => {
  beforeEach(() => {
    jest.resetModules();
    Object.values(mockIsdk.users).forEach(fn => fn.mockReset());
    Object.values(mockIsdk.listings).forEach(fn => fn.mockReset());
    setSeed([makeCommunity('opf'), makeCommunity('morelos', { type: 'geografica' })]);
    mockIsdk.listings.update.mockResolvedValue({});
    mockIsdk.users.updateProfile.mockResolvedValue({});
    mockIsdk.listings.query.mockResolvedValue({
      data: { data: [], meta: { page: 1, totalPages: 1 } },
    });
  });

  describe('joinCommunity', () => {
    test('escribe profile + mirror en todos los listings', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({ data: { data: makeUser('u1') } });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: {
          data: [makeListing('l1'), makeListing('l2')],
          meta: { page: 1, totalPages: 1 },
        },
      });
      const { joinCommunity } = require('../api-util/communityMembership');
      const result = await joinCommunity('u1', { id: 'opf', type: 'sectorial' });

      expect(result.status).toBe('joined');
      expect(result.mirror).toEqual(['opf']);
      expect(result.stats.updated).toBe(2);
      expect(result.stats.failed).toBe(0);

      expect(mockIsdk.users.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'u1',
          publicData: { communities: { sectorial: ['opf'] } },
        })
      );
      // Ambos listings reciben el mirror.
      expect(mockIsdk.listings.update).toHaveBeenCalledTimes(2);
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({ publicData: { sellerCommunities: ['opf'] } })
      );
    });

    test('idempotente: join 2 veces no duplica ni re-escribe profile', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({
        data: { data: makeUser('u1', { sectorial: ['opf'] }) },
      });
      const { joinCommunity } = require('../api-util/communityMembership');
      const result = await joinCommunity('u1', { id: 'opf', type: 'sectorial' });
      expect(result.status).toBe('already_member');
      expect(result.alreadyMember).toBe(true);
      expect(mockIsdk.users.updateProfile).not.toHaveBeenCalled();
      expect(mockIsdk.listings.update).not.toHaveBeenCalled();
    });

    test('mezcla múltiples types en el mirror plano', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({
        data: { data: makeUser('u1', { sectorial: ['opf'] }) },
      });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: { data: [makeListing('l1')], meta: { page: 1, totalPages: 1 } },
      });
      const { joinCommunity } = require('../api-util/communityMembership');
      const result = await joinCommunity('u1', { id: 'morelos', type: 'geografica' });
      expect(result.mirror.sort()).toEqual(['morelos', 'opf']);
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          publicData: { sellerCommunities: expect.arrayContaining(['opf', 'morelos']) },
        })
      );
    });

    test('rechaza community id inválido', async () => {
      const { joinCommunity } = require('../api-util/communityMembership');
      await expect(
        joinCommunity('u1', { id: 'BAD_ID', type: 'sectorial' })
      ).rejects.toThrow('invalid_community_id');
    });

    test('rechaza type inválido', async () => {
      const { joinCommunity } = require('../api-util/communityMembership');
      await expect(
        joinCommunity('u1', { id: 'opf', type: 'otro' })
      ).rejects.toThrow('invalid_community_type');
    });

    test('mejor-esfuerzo: si un listings.update falla, cuenta y sigue', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({ data: { data: makeUser('u1') } });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: {
          data: [makeListing('l1'), makeListing('l2'), makeListing('l3')],
          meta: { page: 1, totalPages: 1 },
        },
      });
      mockIsdk.listings.update
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('listing conflict'))
        .mockResolvedValueOnce({});

      const { joinCommunity } = require('../api-util/communityMembership');
      const result = await joinCommunity('u1', { id: 'opf', type: 'sectorial' });
      expect(result.status).toBe('joined');
      expect(result.stats.updated).toBe(2);
      expect(result.stats.failed).toBe(1);
      expect(result.stats.total).toBe(3);
    });
  });

  describe('leaveCommunity', () => {
    test('quita del profile y vacía el mirror cuando era la única comunidad', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({
        data: { data: makeUser('u1', { sectorial: ['opf'] }) },
      });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: { data: [makeListing('l1', ['opf'])], meta: { page: 1, totalPages: 1 } },
      });
      const { leaveCommunity } = require('../api-util/communityMembership');
      const result = await leaveCommunity('u1', { id: 'opf', type: 'sectorial' });
      expect(result.status).toBe('left');
      expect(result.mirror).toEqual([]);
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({ publicData: { sellerCommunities: [] } })
      );
    });

    test('no-op si no es miembro', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({ data: { data: makeUser('u1') } });
      const { leaveCommunity } = require('../api-util/communityMembership');
      const result = await leaveCommunity('u1', { id: 'opf', type: 'sectorial' });
      expect(result.status).toBe('not_member');
      expect(mockIsdk.users.updateProfile).not.toHaveBeenCalled();
      expect(mockIsdk.listings.update).not.toHaveBeenCalled();
    });

    test('preserva otras comunidades en el mirror post-leave', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({
        data: {
          data: makeUser('u1', { sectorial: ['opf'], geografica: ['morelos'] }),
        },
      });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: { data: [makeListing('l1')], meta: { page: 1, totalPages: 1 } },
      });
      const { leaveCommunity } = require('../api-util/communityMembership');
      const result = await leaveCommunity('u1', { id: 'opf', type: 'sectorial' });
      expect(result.mirror).toEqual(['morelos']);
    });
  });

  describe('endpoint HTTP wrapper extrae ambos campos del body', () => {
    // XOLOLO 2026-11-19 — test para prevenir regresión del bug
    // donde el endpoint HTTP ignoraba includeInCommunities del body.
    test('extrae includeInCommunities y excludeFromCommunities del body', () => {
      // Lee el código del endpoint para verificar que ambos campos
      // se extraen. Protección paranoica contra regresión futura.
      const src = require('fs').readFileSync(
        require.resolve('../api/communities-membership.js'),
        'utf8'
      );
      expect(src).toMatch(/req\.body\?\.includeInCommunities/);
      expect(src).toMatch(/req\.body\?\.excludeFromCommunities/);
      // Verifica que ambos se pasan al helper.
      expect(src).toMatch(/includeInCommunities,\s*\n?\s*excludeFromCommunities,/);
    });
  });

  describe('setListingCommunities (opt-out por listing)', () => {
    test('actualiza listing con excludeFromCommunities + mirror recalculado', async () => {
      // Seller con 2 comunidades. Listing excluye solo opf.
      // Debe quedar sellerCommunities=['morelos'].
      const listing = {
        id: { uuid: 'lx' },
        relationships: { author: { data: { id: { uuid: 'u1' } } } },
        attributes: { publicData: { title: 'escritorio usado' } },
      };
      mockIsdk.listings.show = jest.fn(() =>
        Promise.resolve({ data: { data: listing } })
      );
      mockIsdk.users.show.mockResolvedValueOnce({
        data: {
          data: makeUser('u1', { sectorial: ['opf'], geografica: ['morelos'] }),
        },
      });
      const { setListingCommunities } = require('../api-util/communityMembership');
      const result = await setListingCommunities({
        sellerId: 'u1',
        listingId: 'lx',
        excludeFromCommunities: ['opf'],
      });
      expect(result.excluded).toEqual(['opf']);
      expect(result.mirror).toEqual(['morelos']);
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'lx',
          publicData: expect.objectContaining({
            excludeFromCommunities: ['opf'],
            sellerCommunities: ['morelos'],
          }),
        })
      );
    });

    test('rechaza listings que no son del seller autenticado (y no es colaborador)', async () => {
      const listing = {
        id: { uuid: 'lx' },
        relationships: { author: { data: { id: { uuid: 'OTRO' } } } },
        attributes: { publicData: {} },
      };
      mockIsdk.listings.show = jest.fn(() =>
        Promise.resolve({ data: { data: listing } })
      );
      // El user u1 no tiene workspace con OTRO → rechaza.
      mockIsdk.users.show.mockResolvedValueOnce({
        data: {
          data: {
            id: { uuid: 'u1' },
            attributes: {
              profile: { publicData: {} /* no workspaces */ },
            },
          },
        },
      });
      const { setListingCommunities } = require('../api-util/communityMembership');
      await expect(
        setListingCommunities({
          sellerId: 'u1',
          listingId: 'lx',
          excludeFromCommunities: ['opf'],
        })
      ).rejects.toThrow('not_listing_owner');
      expect(mockIsdk.listings.update).not.toHaveBeenCalled();
    });

    test('colaborador con workspace activo SÍ puede actualizar listings del Negocio', async () => {
      const listing = {
        id: { uuid: 'lx' },
        relationships: { author: { data: { id: { uuid: 'adminAbc' } } } },
        attributes: { publicData: { title: 'escritorio' } },
      };
      mockIsdk.listings.show = jest.fn(() =>
        Promise.resolve({ data: { data: listing } })
      );
      // colaboradorU1 tiene workspace activo con adminAbc.
      mockIsdk.users.show
        .mockResolvedValueOnce({
          data: {
            data: {
              id: { uuid: 'colaboradorU1' },
              attributes: {
                profile: {
                  publicData: {
                    xololoWorkspaces: {
                      workspaces: [
                        { adminId: 'adminAbc', status: 'active' },
                      ],
                    },
                  },
                },
              },
            },
          },
        })
        // segundo show: el profile del adminAbc para calcular mirror.
        .mockResolvedValueOnce({
          data: {
            data: makeUser('adminAbc', { sectorial: ['opf'] }),
          },
        });
      const { setListingCommunities } = require('../api-util/communityMembership');
      const result = await setListingCommunities({
        sellerId: 'colaboradorU1',
        listingId: 'lx',
        excludeFromCommunities: ['opf'],
      });
      expect(result.excluded).toEqual(['opf']);
      expect(mockIsdk.listings.update).toHaveBeenCalled();
    });

    test('ignora excludes de comunidades a las que el seller no pertenece', async () => {
      const listing = {
        id: { uuid: 'lx' },
        relationships: { author: { data: { id: { uuid: 'u1' } } } },
        attributes: { publicData: {} },
      };
      mockIsdk.listings.show = jest.fn(() =>
        Promise.resolve({ data: { data: listing } })
      );
      mockIsdk.users.show.mockResolvedValueOnce({
        data: { data: makeUser('u1', { sectorial: ['opf'] }) },
      });
      const { setListingCommunities } = require('../api-util/communityMembership');
      const result = await setListingCommunities({
        sellerId: 'u1',
        listingId: 'lx',
        excludeFromCommunities: ['opf', 'inexistente', 'otra'],
      });
      expect(result.excluded).toEqual(['opf']);
      expect(result.mirror).toEqual([]);
    });
  });

  describe('modo opt-in para sectoriales (Mejora 2)', () => {
    test('join a sectorial con catalog sectorial → mirror vacío por default', async () => {
      // Configura el catálogo con OPF sectorial (opt-in por default).
      setCatalog([{ id: 'opf', type: 'sectorial' }]);
      mockIsdk.users.show.mockResolvedValueOnce({ data: { data: makeUser('u1') } });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: {
          data: [makeListing('l-sin-opt-in')],
          meta: { page: 1, totalPages: 1 },
        },
      });
      const { joinCommunity } = require('../api-util/communityMembership');
      const result = await joinCommunity('u1', { id: 'opf', type: 'sectorial' });
      expect(result.status).toBe('joined');
      // El profile queda con opf, pero el mirror del listing NO
      // porque sectorial es opt-in y el listing no está opted-in.
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'l-sin-opt-in',
          publicData: { sellerCommunities: [] },
        })
      );
    });

    test('listing con includeInCommunities=["opf"] SÍ aparece tras join sectorial', async () => {
      setCatalog([{ id: 'opf', type: 'sectorial' }]);
      mockIsdk.users.show.mockResolvedValueOnce({ data: { data: makeUser('u1') } });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: { uuid: 'l-nochebuena' },
              attributes: {
                publicData: { includeInCommunities: ['opf'] },
              },
            },
          ],
          meta: { page: 1, totalPages: 1 },
        },
      });
      const { joinCommunity } = require('../api-util/communityMembership');
      await joinCommunity('u1', { id: 'opf', type: 'sectorial' });
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'l-nochebuena',
          publicData: { sellerCommunities: ['opf'] },
        })
      );
    });

    test('join a geografica (opt-out) sigue incluyendo todos los listings', async () => {
      setCatalog([{ id: 'morelos', type: 'geografica' }]);
      mockIsdk.users.show.mockResolvedValueOnce({ data: { data: makeUser('u1') } });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: {
          data: [makeListing('l1'), makeListing('l2')],
          meta: { page: 1, totalPages: 1 },
        },
      });
      const { joinCommunity } = require('../api-util/communityMembership');
      await joinCommunity('u1', { id: 'morelos', type: 'geografica' });
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'l1',
          publicData: { sellerCommunities: ['morelos'] },
        })
      );
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'l2',
          publicData: { sellerCommunities: ['morelos'] },
        })
      );
    });
  });

  describe('join/leave respeta excludeFromCommunities existente en listings', () => {
    test('al hacer join, listings con excludeFromCommunities mantienen el mirror correcto', async () => {
      // Seller tenía ya `morelos`. Un listing suyo tiene
      // excludeFromCommunities=['morelos']. Al unirse a opf, ese
      // listing debe quedar sellerCommunities=['opf'] (no morelos).
      mockIsdk.users.show.mockResolvedValueOnce({
        data: { data: makeUser('u1', { geografica: ['morelos'] }) },
      });
      mockIsdk.listings.query.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: { uuid: 'l-normal' },
              attributes: { publicData: {} },
            },
            {
              id: { uuid: 'l-sin-morelos' },
              attributes: {
                publicData: { excludeFromCommunities: ['morelos'] },
              },
            },
          ],
          meta: { page: 1, totalPages: 1 },
        },
      });
      const { joinCommunity } = require('../api-util/communityMembership');
      await joinCommunity('u1', { id: 'opf', type: 'sectorial' });

      // l-normal debe tener mirror completo
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'l-normal',
          publicData: { sellerCommunities: expect.arrayContaining(['morelos', 'opf']) },
        })
      );
      // l-sin-morelos debe excluir morelos
      expect(mockIsdk.listings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'l-sin-morelos',
          publicData: { sellerCommunities: ['opf'] },
        })
      );
    });
  });

  describe('listSellerMemberships', () => {
    test('devuelve comunidades públicas que el seller tiene', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({
        data: {
          data: makeUser('u1', { sectorial: ['opf'], geografica: ['morelos'] }),
        },
      });
      const { listSellerMemberships } = require('../api-util/communityMembership');
      const out = await listSellerMemberships('u1');
      const ids = out.map(c => c.id).sort();
      expect(ids).toEqual(['morelos', 'opf']);
    });

    test('marca _stale las comunidades que ya no están en el catálogo', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({
        data: { data: makeUser('u1', { sectorial: ['comunidad-vieja'] }) },
      });
      const { listSellerMemberships } = require('../api-util/communityMembership');
      const out = await listSellerMemberships('u1');
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ id: 'comunidad-vieja', _stale: true });
    });

    test('vacío cuando no tiene comunidades', async () => {
      mockIsdk.users.show.mockResolvedValueOnce({ data: { data: makeUser('u1') } });
      const { listSellerMemberships } = require('../api-util/communityMembership');
      expect(await listSellerMemberships('u1')).toEqual([]);
    });
  });
});
