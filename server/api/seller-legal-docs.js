// XOLOLO Track B (docs/SUBSCRIPTIONS_V1.md §2): status de documentos
// legales del seller autenticado + selección de tipo de persona.
//
// Contrato:
//   GET /api/seller-legal-docs
//   Auth: user logueado. Devuelve SUS propios documentos.
//   200 → {
//     personType: 'fisica' | 'moral' | null,
//     docs: { [slotKey]: { url, status, uploadedAt, reviewedAt, reviewNote } },
//     requiredSlots: [{ key, label, accept }]  // ya filtrados por personType, [] si personType es null
//   }
//   401 → { error: 'unauthorized' }
//
//   POST /api/seller-legal-docs
//   Body: { personType: 'fisica' | 'moral' }
//   Auth: user logueado. Fija/cambia el tipo de persona — se puede
//   cambiar aunque ya haya documentos subidos (no se borran, sólo
//   cambian qué slots se muestran como pendientes/requeridos).
//   200 → { ok: true, personType }
//   400 → { error: 'invalid_person_type' }
//   401 → { error: 'unauthorized' }

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { PERSON_TYPES, slotsForPersonType } = require('../api-util/legalDocSlots');

const getStatus = async (req, res) => {
  let sellerId;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    sellerId = uResp.data.data.id.uuid;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.users.show({ id: sellerId });
    const legalDocs = resp.data.data.attributes?.profile?.metadata?.xololoLegalDocs || {};
    const personType = legalDocs.personType || null;
    const docs = legalDocs.docs || {};
    const requiredSlots = personType ? slotsForPersonType(personType) : [];
    return res.json({ personType, docs, requiredSlots });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-legal-docs] get error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const setPersonType = async (req, res) => {
  const personType = String(req.body?.personType || '').trim();
  if (!PERSON_TYPES.has(personType)) {
    return res.status(400).json({ error: 'invalid_person_type' });
  }

  let sellerId;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    sellerId = uResp.data.data.id.uuid;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.users.show({ id: sellerId });
    const existing = resp.data.data.attributes?.profile?.metadata?.xololoLegalDocs || {};
    await isdk.users.updateProfile({
      id: sellerId,
      metadata: {
        xololoLegalDocs: { ...existing, personType },
      },
    });
    return res.json({ ok: true, personType });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-legal-docs] setPersonType error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = async (req, res) => {
  if (req.method === 'POST') return setPersonType(req, res);
  return getStatus(req, res);
};
