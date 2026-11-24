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
//     legalDocsComplete: boolean,           // ALL docs con status='approved'
//   }
//   401 → { error: 'unauthorized' }
//
// Reglas (server/api-util/payoutGate.js — fuente única de verdad):
//   - stripeConnected: user.attributes.stripeConnected === true.
//   - legalDocsComplete: todos los slots requeridos (filtrados por
//     personType + sellerMode) tienen status='approved'.
//     Fase 1 aceptaba "cualquier status subido" → fase 2 exige
//     explícitamente aprobado (task #27 cierre). Rechazados y
//     pending ya NO cuentan.
//
// Rationale: casual publica sin stripe ni docs (fricción mínima), pero
// antes de que el dinero salga de Xololo hacia su cuenta debe cerrar
// ambos. Este endpoint es la fuente de verdad para el banner que lo
// avisa en InboxPage/TransactionPage.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { computePayoutGate } = require('../api-util/payoutGate');

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
    const gate = computePayoutGate({ user: resp.data.data, stripeConnected });
    return res.json(gate);
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
