require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');
(async () => {
  const sdk = getIntegrationSdk();
  const r = await sdk.listings.query({ perPage: 100 });
  const g = r.data.data.filter(l => l.attributes.publicData?.variantGroupId === 'a480bc9d-6678-43c4-87d0-4494b4783ef8');
  console.log('Del grupo:', g.length);
  for (const l of g) {
    const vv = l.attributes.publicData.variantValues || {};
    console.log(` - ${l.id.uuid} ${l.attributes.state} master=${l.attributes.publicData.isVariantMaster} ${JSON.stringify(vv)}`);
  }
})();
