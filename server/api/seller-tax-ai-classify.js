// XOLOLO Track #39: pre-análisis fiscal con IA disparado por el seller
// al momento de guardar la declaración, no por Ops al revisar.
//
// Rationale: aprovechamos el "momento" en el que la IA ya está en el
// pipeline (ai-suggest-listing-text también corre al editar un listing)
// para precargar el aiReview. Cuando Ops abre /ops/tax-reviews, el
// verdict ya está — ellos sólo deciden aprobar/rechazar sin esperar.
//
// Contrato:
//   POST /api/seller-tax-ai-classify
//   Body: { listingId }
//   Auth: user logueado DUEÑO del listing (seller-owned).
//   200 → { ok: true, aiReview: {...} } o { ok: true, skipped: 'reason' }
//   401 → { error: 'unauthorized' }
//   403 → { error: 'not_owner' }   // intento de clasificar listing ajeno
//   400 → { error: 'invalid_request' }
//
// Idempotencia: si ya existe aiReview reciente (<24h), no re-llama a
// la IA. Pisa si el seller cambió el código declarado.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { classifyTaxDeclaration } = require('../api-util/taxReviewAi');

const RECENT_HOURS = 24;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const listingId = String(req.body?.listingId || '').trim();
  if (!listingId) return res.status(400).json({ error: 'invalid_request' });

  // 1) Identifica al user logueado.
  let userId;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    userId = uResp.data.data?.id?.uuid;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // 2) Trae listing + author en una pasada.
    const resp = await isdk.listings.show({ id: listingId, include: ['author'] });
    const l = resp.data.data;
    const authorId = l.relationships?.author?.data?.id?.uuid;
    // Verifica ownership — defensa contra sellers que intenten
    // clasificar listings ajenos.
    if (authorId !== userId) {
      return res.status(403).json({ error: 'not_owner' });
    }

    const tc = l.attributes?.publicData?.taxClassification;
    if (!tc || !tc.code) {
      return res.json({ ok: true, skipped: 'no_classification' });
    }

    // 3) Idempotencia: si ya hay aiReview reciente para el MISMO code,
    //    no re-llamar. Si el seller cambió el code, sí re-llamar.
    const existingReview = tc.aiReview;
    const existingSameCode = existingReview && existingReview.classifiedForCode === tc.code;
    if (existingReview && existingSameCode) {
      const age = Date.now() - new Date(existingReview.classifiedAt || 0).getTime();
      if (age < RECENT_HOURS * 60 * 60 * 1000) {
        return res.json({ ok: true, aiReview: existingReview, skipped: 'cached' });
      }
    }

    // 4) Contexto para la IA desde included.
    const authorInc = (resp.data.included || []).find(inc => inc.type === 'user');
    const personType =
      authorInc?.attributes?.profile?.protectedData?.xololoTaxProfile?.personType || null;
    const sellerMode = authorInc?.attributes?.profile?.publicData?.sellerMode || 'store';

    const aiReview = await classifyTaxDeclaration({
      title: l.attributes?.title,
      description: l.attributes?.description,
      categoryId: l.attributes?.publicData?.categoryLevel1,
      condition: l.attributes?.publicData?.condition,
      personType,
      sellerMode,
      priceSubunits: l.attributes?.price?.amount,
      currency: l.attributes?.price?.currency,
      declaredCode: tc.code,
    });

    if (!aiReview) {
      return res.json({ ok: true, skipped: 'ai_not_configured' });
    }

    // 5) Persiste. classifiedForCode permite detectar cuando el seller
    //    cambia la clasificación y hay que re-correr.
    const updated = { ...tc, aiReview: { ...aiReview, classifiedForCode: tc.code } };
    await isdk.listings.update({
      id: listingId,
      publicData: { taxClassification: updated },
    });

    return res.json({ ok: true, aiReview: updated.aiReview });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-tax-ai-classify] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
