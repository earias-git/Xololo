// XOLOLO: moderación de legalidad del listing — invocado desde el
// cliente al publicar/editar un listing. Fire-and-forget desde el
// cliente; el server corre la IA y actúa según verdict:
//
//   legal         → marca metadata, listing sigue publicado.
//   needs_review  → marca metadata, listing sigue publicado. Ops ve
//                   en /ops/legal-moderation para revisar.
//   illegal       → marca metadata + CIERRA el listing (closeListing
//                   del Integration SDK) + email al seller + emite
//                   evento 'listing.legality_blocked'.
//
// Verifica ownership del listing — un seller NO puede moderar listings
// ajenos.
//
// Contrato:
//   POST /api/seller-listing-legality-check
//   Body: { listingId }
//   200 → { ok, moderation: { verdict, category, confidence, ...}, blocked }
//   401 → unauthorized
//   403 → not_owner

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { moderateListingLegality } = require('../api-util/listingLegalityAi');
const { sendEventNotifications } = require('../api-util/notifications');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const listingId = String(req.body?.listingId || '').trim();
  if (!listingId) return res.status(400).json({ error: 'invalid_request' });

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
    const resp = await isdk.listings.show({ id: listingId, include: ['author'] });
    const l = resp.data.data;
    const authorId = l.relationships?.author?.data?.id?.uuid;
    if (authorId !== userId) {
      return res.status(403).json({ error: 'not_owner' });
    }

    const pubData = l.attributes?.publicData || {};

    // Idempotencia: si ya analizamos esta misma versión del título +
    // descripción, no re-llamar.
    const title = l.attributes?.title || '';
    const description = l.attributes?.description || '';
    const contentHash = require('crypto')
      .createHash('sha256')
      .update(`${title}\n${description}`)
      .digest('hex')
      .slice(0, 16);
    const existing = pubData.xololoLegalModeration;
    if (existing && existing.contentHash === contentHash) {
      return res.json({ ok: true, moderation: existing, blocked: false, cached: true });
    }

    const moderation = await moderateListingLegality({
      title,
      description,
      categoryId: pubData.categoryLevel1,
      listingType: pubData.listingType,
      priceSubunits: l.attributes?.price?.amount,
      currency: l.attributes?.price?.currency,
    });
    if (!moderation) {
      return res.json({ ok: true, skipped: 'ai_not_configured', blocked: false });
    }

    const persisted = { ...moderation, contentHash };
    const isBlocking = moderation.verdict === 'illegal';

    // Guardamos moderation en publicData para que /ops lo lea.
    await isdk.listings.update({
      id: listingId,
      publicData: { xololoLegalModeration: persisted },
    });

    if (isBlocking) {
      // Cierra el listing — queda invisible para buyers hasta que Ops
      // decida reabrirlo o el seller edite + se re-apruebe.
      try {
        await isdk.listings.close({ id: listingId });
      } catch (closeErr) {
        // eslint-disable-next-line no-console
        console.warn('[seller-listing-legality-check] close failed:', closeErr?.message);
      }

      // Notificar al seller.
      try {
        const authorInc = (resp.data.included || []).find(inc => inc.type === 'user');
        const baseUrl = process.env.ROOT_URL || 'https://xololo.mx';
        const listingSlug = pubData.slug || l.id.uuid;
        sendEventNotifications('listing.legality_blocked', {
          seller: {
            id: userId,
            email: authorInc?.attributes?.email || null,
            name:
              authorInc?.attributes?.profile?.displayName ||
              authorInc?.attributes?.profile?.firstName ||
              'vendedor',
          },
          listing: {
            id: l.id.uuid,
            title: title || '(sin título)',
            url: `${baseUrl}/l/${listingSlug}/${l.id.uuid}`,
            editUrl: `${baseUrl}/l/${listingSlug}/${l.id.uuid}/edit/description`,
          },
          moderation: {
            category: moderation.category || 'ilegal',
            reasoning: moderation.reasoning,
          },
        }).catch(e => {
          // eslint-disable-next-line no-console
          console.warn('[seller-listing-legality-check] notify failed:', e?.message);
        });
      } catch (notifErr) {
        // eslint-disable-next-line no-console
        console.warn('[seller-listing-legality-check] notify build failed:', notifErr?.message);
      }
    }

    return res.json({ ok: true, moderation: persisted, blocked: isBlocking });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-listing-legality-check] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
