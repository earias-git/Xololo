// XOLOLO: endpoint que resuelve slug de tienda → user + su primaria data pública.
// Se llama desde la StorefrontPage cuando el server detectó un subdominio (o
// desde el fallback client-side en dev). Usa Integration API porque la
// Marketplace SDK del cliente no soporta filtrar users por extended data.
//
// Contrato:
//   GET /api/seller-by-slug?slug=kike-pruebas
//   200 → { seller: { id, displayName, profileImageUrl, publicData: {...} } }
//   404 → { error: 'not_found' }
//   500 → { error: 'internal' }

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');

let integrationSdk = null;

const getIntegrationSdk = () => {
  if (integrationSdk) return integrationSdk;
  const clientId = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  integrationSdk = sharetribeIntegrationSdk.createInstance({ clientId, clientSecret });
  return integrationSdk;
};

// Cache de slug → seller para no golpear Integration API en cada request.
// TTL 60s en dev, más largo si conviene en prod. Se invalida al reiniciar.
const cache = new Map();
const TTL_MS = 60 * 1000;

const getCached = slug => {
  const entry = cache.get(slug);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(slug);
    return null;
  }
  return entry.seller;
};

const putCached = (slug, seller) => {
  cache.set(slug, { seller, at: Date.now() });
};

module.exports = async (req, res) => {
  const rawSlug = String(req.query.slug || '').trim().toLowerCase();
  if (!rawSlug || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(rawSlug)) {
    return res.status(400).json({ error: 'invalid_slug' });
  }

  const cached = getCached(rawSlug);
  if (cached) {
    return res.status(200).json({ seller: cached });
  }

  const sdk = getIntegrationSdk();
  if (!sdk) {
    // Sin credenciales de Integration API el endpoint no puede resolver
    // — devolvemos 501 para que el cliente muestre un fallback claro
    // (staging normalmente sí las tiene; en dev sin config también).
    return res.status(501).json({ error: 'integration_api_not_configured' });
  }

  try {
    // NOTA: Sharetribe Integration API ignora los filtros pub_* / meta_* en
    // el endpoint users.query (a diferencia de listings.query donde sí
    // funciona con "Enable field for search"). Por eso paginamos hasta
    // encontrar el user con publicData.slug matcheando, y cacheamos.
    // Alcance de F2: pocos sellers, funciona. Si escala a miles, migrar a
    // un índice mantenido en un event listener + Redis/DB.
    const perPage = 100;
    let page = 1;
    let match = null;
    let matchIncluded = [];
    let totalPages = 1;

    while (page <= totalPages && !match) {
      const response = await sdk.users.query({
        include: ['profileImage'],
        perPage,
        page,
      });
      const users = response.data.data;
      const meta = response.data.meta || {};
      totalPages = meta.totalPages || 1;
      match = users.find(u => u.attributes.profile.publicData?.slug === rawSlug);
      if (match) matchIncluded = response.data.included || [];
      page += 1;
      // hard stop: no más de 20 páginas (2000 users)
      if (page > 20) break;
    }

    if (!match) {
      return res.status(404).json({ error: 'not_found' });
    }
    const profileImage = matchIncluded.find(i => i.type === 'image');
    const variants = profileImage?.attributes?.variants || {};
    const profileImageUrl =
      variants['square-small2x']?.url ||
      variants['square-small']?.url ||
      variants['default']?.url ||
      null;

    const seller = {
      id: match.id.uuid,
      displayName: match.attributes.profile.displayName,
      abbreviatedName: match.attributes.profile.abbreviatedName,
      bio: match.attributes.profile.bio,
      profileImageUrl,
      publicData: match.attributes.profile.publicData || {},
    };

    putCached(rawSlug, seller);
    return res.status(200).json({ seller });
  } catch (err) {
    // Log del server pero respuesta genérica al cliente.
    // eslint-disable-next-line no-console
    console.error('[seller-by-slug] error', err?.status, err?.statusText, err?.data?.errors);
    return res.status(500).json({ error: 'internal' });
  }
};
