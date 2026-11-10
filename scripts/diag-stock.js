require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

(async () => {
  const sdk = getIntegrationSdk();
  const MASTER_ID = '6af2188d-3dea-406c-9cc9-7b8c8c69e1a4';
  const r = await sdk.listings.show({ id: MASTER_ID });
  const m = r.data.data;
  const pd = m.attributes.publicData;
  console.log('MASTER:', m.id.uuid);
  console.log('title:', m.attributes.title);
  console.log('state:', m.attributes.state);
  console.log('\nattributes:', JSON.stringify(pd.attributes, null, 2));
  console.log('\nvariantValues:', JSON.stringify(pd.variantValues));
  console.log('variantAxes:', JSON.stringify(pd.variantAxes));
  console.log('\nvariantsMatrix:');
  console.log(JSON.stringify(pd.variantsMatrix, null, 2));

  // Query siblings
  const q = await sdk.listings.query({
    pub_variantGroupId: pd.variantGroupId,
    perPage: 100,
  });
  const siblings = (q.data.data || []).filter(
    l =>
      l.attributes?.publicData?.variantGroupId === pd.variantGroupId &&
      l.id.uuid !== MASTER_ID
  );
  console.log('\n=== SIBLINGS (' + siblings.length + ') ===');
  for (const s of siblings) {
    console.log(
      '-',
      s.id.uuid,
      '| state=' + s.attributes.state,
      '| vv=' + JSON.stringify(s.attributes.publicData.variantValues),
      '| isMaster=' + s.attributes.publicData.isVariantMaster
    );
  }
})().catch(e => console.error(e.message));
