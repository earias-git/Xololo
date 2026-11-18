// XOLOLO 2026-11-18 — endpoint público para hidratar el landing.
//
// GET /api/landing-listings
// Respuesta: { products, services, used } con el shape del thunk
// legacy (data + included). Cache 60s server-side (ver
// landingListingsService.js).

const { getLandingListings } = require('../api-util/landingListingsService');

const get = async (req, res) => {
  try {
    const payload = await getLandingListings();
    // Cache header para el cliente/CDN: 30s, con s-maxage hasta
    // 60s para edge. Suficientemente corto para que publishes se
    // reflejen rápido, suficientemente largo para absorber picos.
    res.set('Cache-Control', 'public, max-age=30, s-maxage=60');
    res.status(200).json(payload);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[landing-listings] error:', e?.message);
    // Devolvemos buckets vacíos para que el landing degrade elegante
    // (los componentes se auto-ocultan con items=[]).
    res.status(500).json({
      error: e?.message || 'internal_error',
      products: { data: [], included: [] },
      services: { data: [], included: [] },
      used: { data: [], included: [] },
    });
  }
};

module.exports = { get };
