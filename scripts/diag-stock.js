require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

(async () => {
  const sdk = getIntegrationSdk();
  const r = await sdk.listings.show({
    id: '6adbbafd-9dbd-477b-80a5-227f1f049e76',
  });
  const l = r.data.data;
  console.log('publicData FULL:');
  console.log(JSON.stringify(l.attributes.publicData, null, 2));
})().catch(e => console.error(e.message));
