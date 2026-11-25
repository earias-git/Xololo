// XOLOLO diag: qué marketplace controla la Integration SDK + un ejemplo
// de listing con sellerCommunities para inspeccionar el payload real.
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

(async () => {
  const sdk = getIntegrationSdk();
  const mp = await sdk.marketplace.show();
  console.log('MARKETPLACE:', JSON.stringify(mp.data.data.attributes, null, 2));
  console.log('ID:', mp.data.data.id?.uuid);

  // Fetch un listing OPF específico y muestra su publicData completo
  const r = await sdk.listings.show({ id: '6adbf40d-71b9-4e69-bcef-caf80eaf755e' });
  const l = r.data.data;
  console.log('\nLISTING example:');
  console.log('  id:', l.id.uuid);
  console.log('  state:', l.attributes.state);
  console.log('  publicData:', JSON.stringify(l.attributes.publicData, null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
