// XOLOLO: helper compartido para instanciar el Integration SDK.
//
// Contexto: la metadata (tx.attributes.metadata) sólo es visible al
// operator vía Integration API. El trustedSdk normal (Marketplace API)
// no la puede leer aunque el user sea el provider. Este helper lo
// necesitan endpoints que leen/escriben metadata (SOS photos, tracking,
// stock decrement, etc). Ya se usaba localmente en featured-stores,
// seller-by-slug, shipping-quote y webhooks/skydropx — este módulo
// centraliza el patrón para evitar duplicar credenciales/instancias.
//
// Uso:
//   const { getIntegrationSdk } = require('../api-util/integrationSdk');
//   const isdk = getIntegrationSdk();
//   if (!isdk) return res.status(500).json({ error: 'integration_sdk_missing' });

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');

let cached = null;

const getIntegrationSdk = () => {
  if (cached) return cached;
  const clientId = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  cached = sharetribeIntegrationSdk.createInstance({ clientId, clientSecret });
  return cached;
};

module.exports = { getIntegrationSdk };
