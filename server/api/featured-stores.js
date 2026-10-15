// XOLOLO: endpoint para el bloque "Tiendas destacadas Xololo" del landing
// y para el directorio público /tiendas-verified.
// Devuelve sellers que tengan publicData.slug definido (o sea: tiendas
// listas para servirse en subdominio). Ordenados por más recientes.
//
// Contrato:
//   GET /api/featured-stores?limit=6[&verified=true]
//   verified=true → sólo sellers con publicData.xololoVerified === true
//   200 → { stores: [{ id, name, slug, coverUrl, primaryColor, description }] }

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { isSellerUserType } = require('../api-util/userTypes');

// Caché separada por bucket: 'all' para el landing, 'verified' para el
// directorio /tiendas-verified. Evita que el filtro ensucie la caché del
// otro bucket y permite TTLs idénticos para ambos.
let cacheByBucket = { all: null, verified: null };
let cacheAtByBucket = { all: 0, verified: 0 };
const TTL_MS = 5 * 60 * 1000;

module.exports = async (req, res) => {
  const onlyVerified = req.query.verified === 'true';
  const bucket = onlyVerified ? 'verified' : 'all';
  // El directorio verified puede listar más tiendas que el bloque del
  // landing; subimos el cap a 48 cuando se piden verified.
  const maxCap = onlyVerified ? 48 : 12;
  const limit = Math.min(parseInt(req.query.limit, 10) || 6, maxCap);
  const now = Date.now();

  const cache = cacheByBucket[bucket];
  const cacheAt = cacheAtByBucket[bucket];
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
    // Para verified subimos a 6 páginas porque filtramos más restrictivamente.
    const maxPages = onlyVerified ? 6 : 3;
    let candidates = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await sdk.users.query({ perPage: 100, page });
      const users = response.data.data || [];
      candidates.push(
        ...users.filter(u => {
          const pd = u.attributes.profile.publicData || {};
          // Acepta variantes legacy del userType (p.ej. "Proveedor" en
          // español) además del canónico 'provider'. El Sub-commit 2 incluye
          // un script de backfill que normaliza los valores en Sharetribe.
          if (!pd.slug || !isSellerUserType(pd.userType)) return false;
          // Filtro Xololo Verified: el boolean vive en publicData, lo
          // escribe syncVerifiedBadge cada vez que cambia alguno de los
          // 4 criterios (ver api-util/sellerVerified.js).
          if (onlyVerified && pd.xololoVerified !== true) return false;
          return true;
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

    cacheByBucket[bucket] = stores;
    cacheAtByBucket[bucket] = now;
    return res.status(200).json({ stores });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[featured-stores] error', err?.status, err?.statusText);
    return res.status(200).json({ stores: [] });
  }
};
