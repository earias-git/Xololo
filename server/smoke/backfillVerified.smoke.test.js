// XOLOLO Task #22 — smoke test del backfill del badge Xololo Verified.
//
// Invariantes blindadas:
//   1. Dry-run NO escribe (nunca llama users.updateProfile).
//   2. Dry-run cuenta correctamente: wouldBecomeVerified cuando el
//      criterio da true y el flag actual es false; wouldLoseVerified
//      cuando es al revés; noChange cuando coinciden.
//   3. Ejecución real llama updateProfile UNA vez por seller que cambia,
//      y no llama cuando no hay cambio (idempotencia).
//   4. Un fetch fallido de un seller NO aborta el batch — otros siguen.
//   5. Shape del response: todas las keys esperadas presentes.
//
// Importante: este test NO puede probar que computeVerifiedFromUser
// funciona (eso corresponde a sellerVerified). Lo trata como caja
// negra — forzamos el shape del user para controlar su output.

const {
  computeDryRun,
  executeBackfill,
} = require('../api/admin-backfill-verified');

// ---------------------------------------------------------------
// Helpers para construir entities fake al estilo Integration SDK
// ---------------------------------------------------------------

const makeUser = ({ id, verified = false, approved = false, mode = 'store' }) => ({
  id: { uuid: id },
  type: 'user',
  attributes: {
    email: `${id}@example.com`,
    stripeConnected: approved,
    profile: {
      firstName: approved ? 'Juan' : null,
      lastName: approved ? 'López' : null,
      displayName: approved ? 'Juan López' : null,
      publicData: {
        xololoVerified: verified,
        displayName: approved ? 'Juan López' : null,
        slug: approved ? `juan-${id}` : null,
        sellerMode: mode,
      },
      metadata: approved
        ? {
            xololoSubscription: { status: 'active' },
            xololoLegalDocs: {
              personType: 'fisica',
              docs: {
                identificacionOficialFrente: { status: 'approved' },
                identificacionOficialReverso: { status: 'approved' },
                comprobanteDomicilio: { status: 'approved' },
                constanciaFiscal: { status: 'approved' },
                curp: { status: 'approved' },
              },
            },
          }
        : {},
    },
  },
});

// Fake Integration SDK — guarda las writes para aserciones.
const makeFakeSdk = ({ sellers, failShowFor = [] } = {}) => {
  const updateCalls = [];
  const asList = sellers.map(s => ({ id: s.id, type: 'user' }));
  return {
    _updateCalls: updateCalls,
    listings: {
      query: async () => ({
        data: {
          data: sellers.map(s => ({
            id: { uuid: `lst-${s.id.uuid}` },
            type: 'listing',
            relationships: { author: { data: { id: s.id, type: 'user' } } },
          })),
          included: asList.map(ref => sellers.find(s => s.id.uuid === ref.id.uuid)),
          meta: { totalPages: 1 },
        },
      }),
    },
    users: {
      show: async ({ id }) => {
        if (failShowFor.includes(id)) {
          throw new Error(`fake_show_failure:${id}`);
        }
        const s = sellers.find(x => x.id.uuid === id);
        if (!s) throw new Error('not_found');
        return { data: { data: s } };
      },
      updateProfile: async args => {
        updateCalls.push(args);
        // Simulamos que la próxima users.show devolverá el nuevo publicData
        const s = sellers.find(x => x.id.uuid === args.id);
        if (s) {
          s.attributes.profile.publicData = {
            ...s.attributes.profile.publicData,
            ...(args.publicData || {}),
          };
        }
        return { data: { data: s } };
      },
    },
  };
};

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('backfill-verified — computeDryRun', () => {
  it('nunca llama updateProfile (dry-run read-only)', async () => {
    const sellers = [
      makeUser({ id: 'a', verified: false, approved: true }),
      makeUser({ id: 'b', verified: true, approved: false }),
    ];
    const isdk = makeFakeSdk({ sellers });
    await computeDryRun(isdk);
    expect(isdk._updateCalls).toEqual([]);
  });

  it('cuenta correctamente becomeVerified, loseVerified y noChange', async () => {
    const sellers = [
      // should become verified: cumple criterios, flag=false
      makeUser({ id: 'a', verified: false, approved: true }),
      makeUser({ id: 'b', verified: false, approved: true }),
      // should lose verified: no cumple, flag=true
      makeUser({ id: 'c', verified: true, approved: false }),
      // no change: no cumple, flag=false
      makeUser({ id: 'd', verified: false, approved: false }),
      // no change: cumple, flag=true
      makeUser({ id: 'e', verified: true, approved: true }),
    ];
    const isdk = makeFakeSdk({ sellers });
    const result = await computeDryRun(isdk);
    expect(result.total).toBe(5);
    expect(result.wouldBecomeVerified).toBe(2);
    expect(result.wouldLoseVerified).toBe(1);
    expect(result.noChange).toBe(2);
  });

  it('devuelve hasta 10 samples con el shape correcto', async () => {
    const sellers = Array.from({ length: 15 }, (_, i) =>
      makeUser({ id: `seller-${i}`, verified: false, approved: true })
    );
    const isdk = makeFakeSdk({ sellers });
    const result = await computeDryRun(isdk);
    expect(result.wouldBecomeVerified).toBe(15);
    expect(result.samples).toHaveLength(10);
    const s = result.samples[0];
    expect(s).toHaveProperty('sellerId');
    expect(s).toHaveProperty('email');
    expect(s).toHaveProperty('was', false);
    expect(s).toHaveProperty('willBe', true);
    expect(s.change).toBe('become_verified');
  });

  it('no aborta si users.show falla para un seller — sigue con los demás', async () => {
    const sellers = [
      makeUser({ id: 'ok-1', verified: false, approved: true }),
      makeUser({ id: 'bad', verified: false, approved: true }),
      makeUser({ id: 'ok-2', verified: false, approved: true }),
    ];
    const isdk = makeFakeSdk({ sellers, failShowFor: ['bad'] });
    const result = await computeDryRun(isdk);
    expect(result.total).toBe(3);
    expect(result.wouldBecomeVerified).toBe(2); // 'bad' skipped
  });
});

describe('backfill-verified — executeBackfill', () => {
  it('llama updateProfile UNA vez por cada seller que cambia', async () => {
    const sellers = [
      makeUser({ id: 'a', verified: false, approved: true }),
      makeUser({ id: 'b', verified: true, approved: false }),
      makeUser({ id: 'c', verified: false, approved: false }), // no cambia
      makeUser({ id: 'd', verified: true, approved: true }), // no cambia
    ];
    const isdk = makeFakeSdk({ sellers });
    const result = await executeBackfill(isdk);
    expect(isdk._updateCalls).toHaveLength(2);
    expect(result.becameVerified).toBe(1);
    expect(result.lostVerified).toBe(1);
    expect(result.noChange).toBe(2);
  });

  it('es idempotente: una segunda corrida sobre el mismo set no escribe', async () => {
    const sellers = [
      makeUser({ id: 'a', verified: false, approved: true }),
      makeUser({ id: 'b', verified: true, approved: false }),
    ];
    const isdk = makeFakeSdk({ sellers });
    await executeBackfill(isdk);
    const writesAfterFirst = isdk._updateCalls.length;
    await executeBackfill(isdk);
    // La segunda corrida no agrega ningún write.
    expect(isdk._updateCalls.length).toBe(writesAfterFirst);
  });

  it('shape del response incluye todas las keys esperadas', async () => {
    const sellers = [makeUser({ id: 'a', verified: false, approved: true })];
    const isdk = makeFakeSdk({ sellers });
    const result = await executeBackfill(isdk);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('becameVerified');
    expect(result).toHaveProperty('lostVerified');
    expect(result).toHaveProperty('noChange');
    expect(result).toHaveProperty('errorCount');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('startedAt');
    expect(result).toHaveProperty('finishedAt');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
