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
const { sendEventNotifications } = require('../api-util/notifications');

// XOLOLO: mismo mapa que admin-tax-reviews.js para el email de
// auto-aprobación. Mantener sincronizados.
const TAX_CODE_META = {
  exento_9_iv: { label: 'Bienes muebles usados por particular', article: 'Art. 9 fracc. IV LIVA' },
  exento_9_iii: { label: 'Libro/revista/obra del propio autor', article: 'Art. 9 fracc. III LIVA' },
  tasa_cero_2a_i_a: {
    label: 'Animales y vegetales no industrializados',
    article: 'Art. 2-A I-a LIVA',
  },
  tasa_cero_2a_i_b: { label: 'Alimentos NO procesados', article: 'Art. 2-A I-b LIVA' },
  tasa_cero_2a_i_d: { label: 'Ixtle, palma y lechuguilla', article: 'Art. 2-A I-d LIVA' },
  tasa_cero_2a_i_f: {
    label: 'Fertilizantes y plaguicidas agrícolas',
    article: 'Art. 2-A I-f LIVA',
  },
  tasa_cero_2a_i_i: {
    label: 'Libros editados por el propio contribuyente',
    article: 'Art. 2-A I-i LIVA',
  },
  tasa_cero_2a_i_j: { label: 'Toallas sanitarias, tampones y copas', article: 'Art. 2-A I-j LIVA' },
  exento_15_iv: { label: 'Enseñanza con RVOE o preescolar', article: 'Art. 15 IV LIVA' },
  exento_15_xiv: { label: 'Servicios médicos con cédula', article: 'Art. 15 XIV LIVA' },
  exento_15_xvi: { label: 'Regalías del autor por obra inscrita', article: 'Art. 15 XVI LIVA' },
  actividad_transporte: { label: 'Transporte terrestre', article: 'LISR 113-A' },
  actividad_hospedaje: { label: 'Hospedaje', article: 'LISR 113-A' },
};

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
    //
    // XOLOLO: si la IA marca shouldAutoApprove (likely_valid con
    // confianza ≥85% y sin red flags), aprobamos sin pasar por Ops.
    // El operador humano SÓLO revisa needs_review y likely_invalid.
    const autoApproved = !!aiReview.shouldAutoApprove;
    const now = new Date().toISOString();
    const nextTax = {
      ...tc,
      aiReview: { ...aiReview, classifiedForCode: tc.code },
    };
    if (autoApproved) {
      nextTax.reviewStatus = 'approved';
      nextTax.reviewedBy = 'xololo-ia-auto';
      nextTax.reviewedAt = now;
      nextTax.reviewNote = `Auto-aprobado por IA (confianza ${aiReview.confidence}%)`;
    }

    await isdk.listings.update({
      id: listingId,
      publicData: { taxClassification: nextTax },
    });

    // 6) Si se auto-aprobó, notificar al seller como lo haría Ops.
    //    Fire-and-forget — no bloquea el response del seller.
    if (autoApproved) {
      try {
        const codeMeta = TAX_CODE_META[tc.code] || { label: tc.code, article: '' };
        const listingSlug = l.attributes?.publicData?.slug || l.id.uuid;
        const baseUrl = process.env.ROOT_URL || 'https://xololo.mx';
        const sellerName =
          authorInc?.attributes?.profile?.displayName ||
          authorInc?.attributes?.profile?.firstName ||
          'vendedor';
        sendEventNotifications('listing.tax_approved', {
          seller: {
            id: userId,
            email: authorInc?.attributes?.email || null,
            name: sellerName,
          },
          listing: {
            id: l.id.uuid,
            title: l.attributes?.title || '(sin título)',
            url: `${baseUrl}/l/${listingSlug}/${l.id.uuid}`,
            editUrl: `${baseUrl}/l/${listingSlug}/${l.id.uuid}/edit/pricing-and-stock`,
          },
          taxReview: {
            code: tc.code,
            label: codeMeta.label,
            article: codeMeta.article,
            reviewedBy: `Xololo IA (${aiReview.confidence}% confianza)`,
            noteText: '',
          },
        }).catch(e => {
          // eslint-disable-next-line no-console
          console.warn('[seller-tax-ai-classify] notify failed:', e?.message);
        });
      } catch (notifErr) {
        // eslint-disable-next-line no-console
        console.warn('[seller-tax-ai-classify] notify build failed:', notifErr?.message);
      }
    }

    return res.json({ ok: true, aiReview: nextTax.aiReview, autoApproved });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-tax-ai-classify] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
