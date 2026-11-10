#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const GROUP_ID = 'a480bc9d-6678-43c4-87d0-4494b4783ef8';

(async () => {
  const sdk = getIntegrationSdk();
  const r = await sdk.listings.query({
    perPage: 100,
    include: ['currentStock', 'images'],
  });
  const siblings = r.data.data.filter(
    l => l.attributes.publicData?.variantGroupId === GROUP_ID
  );
  console.log(`Siblings total: ${siblings.length}\n`);
  for (const l of siblings) {
    const attrs = l.attributes;
    const pd = attrs.publicData || {};
    const vv = pd.variantValues || {};
    const label = `${vv.talla || '?'} · ${vv.color || '?'}`;
    const isMaster = pd.isVariantMaster;
    const stockRef = l.relationships?.currentStock?.data?.id?.uuid;
    const imgCount = l.relationships?.images?.data?.length || 0;
    const price = attrs.price ? `${attrs.price.amount / 100} ${attrs.price.currency}` : 'NULL';
    console.log(`  ${l.id.uuid} [${isMaster ? 'MASTER' : '      '}] ${label}`);
    console.log(`    state: ${attrs.state}`);
    console.log(`    price: ${price}`);
    console.log(`    images: ${imgCount}`);
    console.log(`    stockRef: ${stockRef || 'none'}`);
    console.log(`    listingType: ${pd.listingType}`);
    console.log(`    unitType: ${pd.unitType}`);
    console.log(`    transactionProcessAlias: ${pd.transactionProcessAlias}`);
    console.log(`    shippingEnabled: ${pd.shippingEnabled}`);
    console.log(`    pickupEnabled: ${pd.pickupEnabled}`);
    console.log('');
  }
})().catch(e => {
  console.error('ERR:', e.message);
  if (e.data?.errors) console.error(JSON.stringify(e.data.errors, null, 2));
});
