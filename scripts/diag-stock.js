require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

(async () => {
  const sdk = getIntegrationSdk();
  const MASTER_ID = '6af2188d-3dea-406c-9cc9-7b8c8c69e1a4';
  const q = await sdk.listings.query({
    pub_variantGroupId: 'a480bc9d-6678-43c4-87d0-4494b4783ef8',
    include: ['currentStock'],
    perPage: 100,
  });
  const inc = q.data.included || [];
  const siblings = (q.data.data || []).filter(
    l => l.attributes?.publicData?.variantGroupId === 'a480bc9d-6678-43c4-87d0-4494b4783ef8'
  );
  console.log('Listings (master + siblings):');
  for (const l of siblings) {
    const rel = l.relationships?.currentStock?.data;
    const stock = rel ? inc.find(i => i.type === 'stock' && i.id?.uuid === rel.id?.uuid) : null;
    const pd = l.attributes.publicData;
    const label = pd.isVariantMaster
      ? `[MASTER ${Object.values(pd.variantValues || {}).join('/')}]`
      : `${Object.values(pd.variantValues || {}).join('/')}`;
    console.log(
      `  ${label.padEnd(25)} state=${l.attributes.state.padEnd(10)} stock=${stock?.attributes?.quantity ?? 'n/a'}`
    );
  }
})().catch(e => console.error(e.message));
