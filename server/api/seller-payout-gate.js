// XOLOLO Track #27: gate del primer payout. Devuelve el estado de
// requisitos para liberar dinero al seller.
//
// Contrato:
//   GET /api/seller-payout-gate
//   Auth: user logueado. Devuelve SU propio estado.
//   200 → {
//     canReceivePayout: boolean,            // true si no hay blockers
//     blockers: Array<{
//       key: 'stripe' | 'legalDocs',
//       label: string,                      // mensaje al seller
//       routeName: string,                  // destino del CTA
//     }>,
//     stripeConnected: boolean,
//     legalDocsComplete: boolean,
//     // Hoy no contamos ventas pendientes (requiere query a tx del seller).
//     // Fase 2: integrar con /api/seller-pending-sales para pintar el
//     // monto reservado en escrow.
//   }
//   401 → { error: 'unauthorized' }
//
// Reglas:
//   - stripeConnected: user.attributes.stripeConnected === true
//     (igual criterio que useOnboardingStatus/payouts).
//   - legalDocsComplete: todos los slots requeridos (según personType y
//     sellerMode) tienen un doc subido (status cualquiera por ahora —
//     fase 2: exigir status='approved').
//
// Rationale: casual publica sin stripe ni docs (fricción mínima), pero
// antes de que el dinero salga de Xololo hacia su cuenta debe cerrar
// ambos. Este endpoint es la fuente de verdad para el banner que lo
// avisa en InboxPage/TransactionPage.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { slotsForPersonType } = require('../api-util/legalDocSlots');

const isLegalDocsComplete = (personType, docs, sellerMode) => {
  if (!personType) return false;
  const requiredSlots = slotsForPersonType(personType, sellerMode);
  if (!requiredSlots.length) return false;
  return requiredSlots.every(slot => !!docs?.[slot.key]);
};

const getStatus = async (req, res) => {
  let sellerId;
  let stripeConnected = false;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    const data = uResp.data.data;
    sellerId = data.id.uuid;
    stripeConnected = data.attributes?.stripeConnected === true;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.users.show({ id: sellerId });
    const profile = resp.data.data.attributes?.profile || {};
    const legalDocs = profile.metadata?.xololoLegalDocs || {};
    const sellerMode = profile.publicData?.sellerMode || 'store';
    const legalDocsComplete = isLegalDocsComplete(
      legalDocs.personType || null,
      legalDocs.docs || {},
      sellerMode
    );

    const blockers = [];
    if (!stripeConnected) {
      blockers.push({
        key: 'stripe',
        label: 'Conecta tu cuenta de banco para recibir tu dinero',
        routeName: 'StripePayoutPage',
      });
    }
    if (!legalDocsComplete) {
      blockers.push({
        key: 'legalDocs',
        label: 'Sube tu identificación oficial y comprobante de domicilio',
        routeName: 'LegalDocsPage',
      });
    }

    return res.json({
      canReceivePayout: blockers.length === 0,
      blockers,
      stripeConnected,
      legalDocsComplete,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-payout-gate] get error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = (req, res) => {
  if (req.method === 'GET') return getStatus(req, res);
  res.status(405).json({ error: 'method_not_allowed' });
};
