// XOLOLO task #27 — blindaje del gate de payout (server/api-util/payoutGate.js).
//
// LOCKED invariants:
//   1. Un doc 'pending' | 'rejected' | 'uploaded' NO cuenta como aprobado.
//      Sólo 'approved' pasa. Esto cierra el hueco que permitía payout
//      con docs "subidos pero no revisados".
//   2. Todos los slots requeridos deben estar approved para que
//      legalDocsComplete=true. Uno pending o rechazado → false.
//   3. stripeConnected=false → blocker 'stripe'.
//   4. personType=null (nunca eligió) → legalDocsComplete=false.
//   5. Casual reseller sólo necesita 2 slots (INE + domicilio) — no
//      Constancia Fiscal ni CURP. Blindado implícitamente porque
//      slotsForPersonType filtra casualOk.
//   6. Shape de la respuesta es estable para hook usePayoutGate y
//      PayoutQueueView.

const {
  isDocApproved,
  isLegalDocsComplete,
  computePayoutGate,
} = require('./payoutGate');

describe('isDocApproved', () => {
  it('true solo si status === "approved"', () => {
    expect(isDocApproved({ status: 'approved' })).toBe(true);
  });

  it('false para pending, rejected, uploaded, vacío o null', () => {
    expect(isDocApproved({ status: 'pending' })).toBe(false);
    expect(isDocApproved({ status: 'rejected' })).toBe(false);
    expect(isDocApproved({ status: 'uploaded' })).toBe(false);
    expect(isDocApproved({})).toBe(false);
    expect(isDocApproved(null)).toBe(false);
    expect(isDocApproved(undefined)).toBe(false);
  });
});

describe('isLegalDocsComplete', () => {
  // Fisica store: 5 slots (INE frente, INE reverso, domicilio, constancia, CURP).
  it('true cuando TODOS los slots requeridos están approved (fisica store)', () => {
    const docs = {
      identificacionOficialFrente: { status: 'approved' },
      identificacionOficialReverso: { status: 'approved' },
      comprobanteDomicilio: { status: 'approved' },
      constanciaFiscal: { status: 'approved' },
      curp: { status: 'approved' },
    };
    expect(isLegalDocsComplete('fisica', docs, 'store')).toBe(true);
  });

  it('false si al menos uno está pending', () => {
    const docs = {
      identificacionOficialFrente: { status: 'approved' },
      identificacionOficialReverso: { status: 'approved' },
      comprobanteDomicilio: { status: 'pending' },
      constanciaFiscal: { status: 'approved' },
      curp: { status: 'approved' },
    };
    expect(isLegalDocsComplete('fisica', docs, 'store')).toBe(false);
  });

  it('false si al menos uno está rejected', () => {
    const docs = {
      identificacionOficialFrente: { status: 'approved' },
      identificacionOficialReverso: { status: 'approved' },
      comprobanteDomicilio: { status: 'approved' },
      constanciaFiscal: { status: 'rejected' },
      curp: { status: 'approved' },
    };
    expect(isLegalDocsComplete('fisica', docs, 'store')).toBe(false);
  });

  it('false si personType no se eligió', () => {
    expect(isLegalDocsComplete(null, {}, 'store')).toBe(false);
  });

  it('casual_reseller solo requiere 2 docs (INE + domicilio)', () => {
    // No constancia ni CURP — para casual deben seguir dando complete.
    const docs = {
      identificacionOficialFrente: { status: 'approved' },
      identificacionOficialReverso: { status: 'approved' },
      comprobanteDomicilio: { status: 'approved' },
    };
    expect(isLegalDocsComplete('fisica', docs, 'casual_reseller')).toBe(true);
  });

  it('casual con uno pending → false', () => {
    const docs = {
      identificacionOficialFrente: { status: 'approved' },
      identificacionOficialReverso: { status: 'pending' },
      comprobanteDomicilio: { status: 'approved' },
    };
    expect(isLegalDocsComplete('fisica', docs, 'casual_reseller')).toBe(false);
  });

  it('acepta docs=undefined sin crashear', () => {
    expect(isLegalDocsComplete('fisica', undefined, 'store')).toBe(false);
  });
});

// Helpers para el shape user que viene de Sharetribe.
const makeUser = ({ stripeConnected = false, personType = null, docs = {}, sellerMode = 'store' } = {}) => ({
  attributes: {
    stripeConnected,
    profile: {
      publicData: { sellerMode },
      metadata: {
        xololoLegalDocs: { personType, docs },
      },
    },
  },
});

describe('computePayoutGate', () => {
  it('canReceivePayout=true solo con stripe + TODOS los docs approved', () => {
    const user = makeUser({
      stripeConnected: true,
      personType: 'fisica',
      docs: {
        identificacionOficialFrente: { status: 'approved' },
        identificacionOficialReverso: { status: 'approved' },
        comprobanteDomicilio: { status: 'approved' },
        constanciaFiscal: { status: 'approved' },
        curp: { status: 'approved' },
      },
    });
    const gate = computePayoutGate({ user });
    expect(gate.canReceivePayout).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it('blocker stripe cuando no está conectado', () => {
    const user = makeUser({ stripeConnected: false });
    const gate = computePayoutGate({ user });
    expect(gate.blockers.map(b => b.key)).toEqual(expect.arrayContaining(['stripe']));
    expect(gate.canReceivePayout).toBe(false);
  });

  it('blocker legalDocs cuando algún doc está pending/rejected', () => {
    const user = makeUser({
      stripeConnected: true,
      personType: 'fisica',
      docs: {
        identificacionOficialFrente: { status: 'pending' },
      },
    });
    const gate = computePayoutGate({ user });
    expect(gate.blockers.map(b => b.key)).toEqual(['legalDocs']);
    expect(gate.legalDocsComplete).toBe(false);
  });

  it('dos blockers cuando faltan ambos', () => {
    const user = makeUser({ stripeConnected: false, personType: null });
    const gate = computePayoutGate({ user });
    expect(gate.blockers.map(b => b.key).sort()).toEqual(['legalDocs', 'stripe']);
  });

  it('stripeConnected override del param tiene prioridad sobre el user', () => {
    // user.attributes.stripeConnected=false pero pasamos stripeConnected=true
    const user = makeUser({ stripeConnected: false });
    const gate = computePayoutGate({ user, stripeConnected: true });
    expect(gate.stripeConnected).toBe(true);
  });

  it('cada blocker trae label en español y routeName a su page', () => {
    const user = makeUser({ stripeConnected: false, personType: null });
    const gate = computePayoutGate({ user });
    const stripe = gate.blockers.find(b => b.key === 'stripe');
    const legal = gate.blockers.find(b => b.key === 'legalDocs');
    expect(stripe.label).toMatch(/banco|cuenta/i);
    expect(stripe.routeName).toBe('StripePayoutPage');
    expect(legal.label).toMatch(/documentos/i);
    expect(legal.routeName).toBe('LegalDocsPage');
  });

  it('user sin profile.metadata (recién creado) → fail closed', () => {
    const user = { attributes: { stripeConnected: true } };
    const gate = computePayoutGate({ user });
    expect(gate.canReceivePayout).toBe(false);
    expect(gate.legalDocsComplete).toBe(false);
  });
});
