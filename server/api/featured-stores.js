// XOLOLO: endpoint para el bloque "Tiendas destacadas Xololo" del landing.
// Devuelve hasta 6 sellers que tengan publicData.slug definido (o sea:
// tiendas listas para servirse en subdominio). Ordenados por más recientes.
//
// Contrato:
//   GET /api/featured-stores?limit=6
//   200 → { stores: [{ id, name, slug, coverUrl, primaryColor, description }] }

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');

let integrationSdk = null;
const getIntegrationSdk = () => {
  if (integrationSdk) return integrationSdk;
  const clientId = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  integrationSdk = sharetribeIntegrationSdk.createInstance({ clientId, clientSecret });
  return integrationSdk;
};

// Caché para no golpear Integration API en cada landing. Se invalida en
// cada reinicio; con TTL de 5 minutos evitamos rate limits.
let cache = null;
let cacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

module.exports = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 6, 12);
  const now = Date.now();

  if (cache && now - cacheAt < TTL_MS && cache.length >= limit) {
    return res.status(200).json({ stores: cache.slice(0, limit) });
  }

  const sdk = getIntegrationSdk();
  if (!sdk) {
    // Sin creds → devolvemos array vacío para que el cliente caiga al
    // placeholder estático (mock) del landing.
    return res.status(200).json({ stores: [] });
  }

  try {
    // Paginamos hasta 3 páginas para encontrar sellers con slug.
    // Alcance actual: pocos users, muy rápido. Si crece, hacer índice.
    let candidates = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await sdk.users.query({ perPage: 100, page });
      const users = response.data.data || [];
      candidates.push(
        ...users.filter(u => {
          const pd = u.attributes.profile.publicData || {};
          return pd.slug && pd.userType === 'provider';
        })
      );
      const totalPages = response.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
      if (candidates.length >= limit * 3) break;
    }

    // Ordenar por createdAt desc y tomar los primeros `limit`.
    candidates.sort((a, b) => {
      const aa = new Date(a.attributes.createdAt).getTime();
      const bb = new Date(b.attributes.createdAt).getTime();
      return bb - aa;
    });

    // En dev queremos que los links del landing apunten a *.localhost:3000
    // para probar el subdominio sin salir de la máquina. En prod van a
    // *.xololo.mx (dominio real). Nos guiamos por REACT_APP_MARKETPLACE_ROOT_URL.
    const isDev = /localhost|127\.0\.0\.1/.test(process.env.REACT_APP_MARKETPLACE_ROOT_URL || '');
    const buildStoreUrls = slug =>
      isDev
        ? { subdomain: `${slug}.localhost:3000`, href: `http://${slug}.localhost:3000` }
        : { subdomain: `${slug}.xololo.mx`, href: `https://${slug}.xololo.mx` };

    const stores = candidates.slice(0, limit).map(u => {
      const pd = u.attributes.profile.publicData || {};
      const { subdomain, href } = buildStoreUrls(pd.slug);
      return {
        id: u.id.uuid,
        name: u.attributes.profile.displayName,
        slug: pd.slug,
        subdomain,
        href,
        cover: pd.bannerUrl || pd.logoUrl || null,
        primaryColor: pd.brandPrimaryColor || null,
        description: pd.shortDescription || null,
        category: pd.primaryCategory || null,
      };
    });

    cache = stores;
    cacheAt = now;
    return res.status(200).json({ stores });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[featured-stores] error', err?.status, err?.statusText);
    return res.status(200).json({ stores: [] });
  }
};
