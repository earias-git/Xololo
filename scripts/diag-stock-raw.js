require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const ID = '6adbbafd-9dbd-477b-80a5-227f1f049e76';

(async () => {
  const isdk = getIntegrationSdk();
  const resp = await isdk.listings.show({
    id: ID,
    include: ['currentStock'],
  });
  console.log('data:', JSON.stringify(resp.data.data, null, 2));
  console.log('\nincluded:', JSON.stringify(resp.data.included, null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
