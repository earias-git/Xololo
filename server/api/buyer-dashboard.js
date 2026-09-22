// XOLOLO F3 · Fase 2: dashboard del buyer en /inbox/orders.
//
// Contrato:
//   GET /api/buyer-dashboard
//   Auth: user logueado (usa cookie de Sharetribe). Solo trae SUS
//         pedidos.
//   200 → {
//     inTransit: [
//       { txId, listingTitle, listingImageUrl, sellerName, sellerSlug,
//         carrierName, trackingNumber, trackingUrl, currentStatus,
//         estimatedDeliveryDate?, lastEventAt? }
//     ],
//     reviewsPending: [
//       { txId, listingTitle, listingImageUrl, sellerName,
//         deliveredAt, deadlineAt, hoursLeft }
//     ],
//     buyAgain: [
//       { sellerId, sellerName, sellerSlug, sellerLogoUrl?,
//         lastOrderAt, ordersCount }
//     ],
//     summary: { ordersActive, ordersDelivered30d, ordersTotal }
//   }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// Todo desde tx del user (sdk.transactions.query only:'order'). Sin
// Integration SDK — el user ve solo sus datos.

const { getSdk } = require('../api-util/sdk');

const MAX_PAGES = 5;
const PER_PAGE = 100;
const REVIEW_WINDOW_HOURS = 48; // ventana de review (§4 LOGISTICS)
const IN_TRANSIT_LOOKBACK_DAYS = 60;
const BUY_AGAIN_LOOKBACK_DAYS = 180;
const BUY_AGAIN_LIMIT = 5;
const DELIVERED_LOOKBACK_DAYS = 30;

// -------------- helpers --------------

const isDelivered = tx => {
  const transitions = tx.attributes?.transitions || [];
  if (transitions.some(t => t.transition === 'transition/mark-received')) return true;
  if (transitions.some(t => t.transition === 'transition/auto-mark-received')) return true;
  const events = tx.attributes?.metadata?.xololoShippingTrackingEvents || [];
  return events.some(e => e.status === 'delivered');
};

const isCanceled = tx => {
  const s = tx.attributes?.state;
  return s === 'canceled' || s === 'refunded';
};

const isInTransit = tx => {
  if (isDelivered(tx) || isCanceled(tx)) return false;
  const guide = tx.attributes?.metadata?.xololoShippingGuide;
  return !!guide?.shipmentId; // tiene guía → viajando o esperando recolección
};

const deliveredAt = tx => {
  const transitions = tx.attributes?.transitions || [];
  const mark =
    transitions.find(t => t.transition === 'transition/mark-received') ||
    transitions.find(t => t.transition === 'transition/auto-mark-received');
  if (mark?.createdAt) return mark.createdAt;
  const events = tx.attributes?.metadata?.xololoShippingTrackingEvents || [];
  const evt = events.find(e => e.status === 'delivered');
  return evt?.receivedAt || null;
};

const hasReview = tx => !!tx.attributes?.metadata?.xololoBuyerReview;
const hasDispute = tx => !!tx.attributes?.metadata?.xololoDispute;

const firstImageUrl = (listing, included) => {
  const imgRels = listing?.relationships?.images?.data || [];
  const firstImgId = imgRels[0]?.id?.uuid;
  if (!firstImgId) return null;
  const img = (included || []).find(r => r.type === 'image' && r.id.uuid === firstImgId);
  const variants = img?.attributes?.variants || {};
  return (
    variants['listing-card']?.url ||
    variants['default']?.url ||
    variants['square-small']?.url ||
    null
  );
};

// -------------- fetch --------------

const fetchOrders = async sdk => {
  const all = [];
  const included = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await sdk.transactions.query({
      only: 'order', // user es customer
      page,
      perPage: PER_PAGE,
      include: ['listing', 'provider', 'listing.images'],
      'fields.transaction': [
        'createdAt',
        'lastTransitionedAt',
        'state',
        'lastTransition',
        'transitions',
        'metadata',
      ],
      'fields.listing': ['title'],
      'fields.user': ['profile.displayName', 'profile.publicData'],
      'fields.image': ['variants.listing-card', 'variants.square-small'],
    });
    const data = resp.data.data || [];
    for (const inc of resp.data.included || []) included.push(inc);
    all.push(...data);
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return { txs: all, included };
};

// -------------- handler --------------

module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    try {
      await sdk.currentUser.show();
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { txs, included } = await fetchOrders(sdk);

    const listings = new Map();
    const users = new Map();
    for (const r of included) {
      if (r.type === 'listing') listings.set(r.id.uuid, r);
      else if (r.type === 'user') users.set(r.id.uuid, r);
    }

    const now = Date.now();
    const inTransitCutoff = now - IN_TRANSIT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const buyAgainCutoff = now - BUY_AGAIN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const deliveredCutoff = now - DELIVERED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

    const inTransit = [];
    const reviewsPending = [];
    const buyAgainAgg = new Map();
    let ordersActive = 0;
    let ordersDelivered30d = 0;

    for (const tx of txs) {
      const attrs = tx.attributes || {};
      const ca = attrs.createdAt ? new Date(attrs.createdAt).getTime() : 0;
      const listingId = tx.relationships?.listing?.data?.id?.uuid;
      const providerId = tx.relationships?.provider?.data?.id?.uuid;
      const listing = listings.get(listingId);
      const provider = users.get(providerId);
      const providerPd = provider?.attributes?.profile?.publicData || {};

      // ----- En tránsito -----
      if (ca >= inTransitCutoff && isInTransit(tx)) {
        const guide = attrs.metadata?.xololoShippingGuide || {};
        inTransit.push({
          txId: tx.id.uuid,
          listingTitle: listing?.attributes?.title || 'Producto',
          listingImageUrl: listing ? firstImageUrl(listing, included) : null,
          sellerName: provider?.attributes?.profile?.displayName || 'Vendedor',
          sellerSlug: providerPd.slug || null,
          carrierName: guide.carrierName || null,
          trackingNumber: guide.trackingNumber || null,
          trackingUrl: guide.trackingUrl || null,
          currentStatus: guide.currentStatus || 'label_generated',
          lastEventAt: guide.lastEventAt || null,
        });
      }

      // ----- Reviews pendientes -----
      if (isDelivered(tx) && !hasReview(tx) && !hasDispute(tx)) {
        const dAt = deliveredAt(tx);
        if (dAt) {
          const dMs = new Date(dAt).getTime();
          const deadlineMs = dMs + REVIEW_WINDOW_HOURS * 60 * 60 * 1000;
          const hoursLeft = Math.max(0, Math.floor((deadlineMs - now) / (60 * 60 * 1000)));
          reviewsPending.push({
            txId: tx.id.uuid,
            listingTitle: listing?.attributes?.title || 'Producto',
            listingImageUrl: listing ? firstImageUrl(listing, included) : null,
            sellerName: provider?.attributes?.profile?.displayName || 'Vendedor',
            deliveredAt: dAt,
            deadlineAt: new Date(deadlineMs).toISOString(),
            hoursLeft,
            expired: hoursLeft === 0,
          });
        }
      }

      // ----- Buy again (agg por seller) -----
      if (ca >= buyAgainCutoff && providerId && !isCanceled(tx)) {
        let entry = buyAgainAgg.get(providerId);
        if (!entry) {
          entry = {
            sellerId: providerId,
            sellerName: provider?.attributes?.profile?.displayName || 'Vendedor',
            sellerSlug: providerPd.slug || null,
            sellerLogoUrl: providerPd.logoUrl || providerPd.brandLogoUrl || null,
            lastOrderAt: attrs.createdAt,
            ordersCount: 0,
          };
          buyAgainAgg.set(providerId, entry);
        }
        entry.ordersCount += 1;
        if (attrs.createdAt && (!entry.lastOrderAt || attrs.createdAt > entry.lastOrderAt)) {
          entry.lastOrderAt = attrs.createdAt;
        }
      }

      // ----- Summary counters -----
      if (!isCanceled(tx)) {
        if (isInTransit(tx) || (!isDelivered(tx) && tx.attributes.lastTransition?.includes('confirm-payment'))) {
          ordersActive += 1;
        }
      }
      if (isDelivered(tx)) {
        const dAt = deliveredAt(tx);
        if (dAt && new Date(dAt).getTime() >= deliveredCutoff) ordersDelivered30d += 1;
      }
    }

    // Ordena en-tránsito por lastEventAt desc, o por createdAt.
    inTransit.sort((a, b) => {
      const ta = a.lastEventAt ? new Date(a.lastEventAt).getTime() : 0;
      const tb = b.lastEventAt ? new Date(b.lastEventAt).getTime() : 0;
      return tb - ta;
    });

    // Reviews pendientes: primero los más cerca del deadline (menos horas left).
    reviewsPending.sort((a, b) => a.hoursLeft - b.hoursLeft);

    // Buy again: por lastOrderAt desc, top N.
    const buyAgain = Array.from(buyAgainAgg.values())
      .filter(x => !!x.sellerSlug) // solo sellers con subdominio configurado
      .sort((a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime())
      .slice(0, BUY_AGAIN_LIMIT);

    return res.json({
      inTransit,
      reviewsPending,
      buyAgain,
      summary: {
        ordersActive,
        ordersDelivered30d,
        ordersTotal: txs.filter(t => !isCanceled(t)).length,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[buyer-dashboard] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
