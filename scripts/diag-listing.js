#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

(async () => {
  const sdk = getIntegrationSdk();
  const q = await sdk.listings.query({
    perPage: 100,
    keywords: 'Traje de baño rojo',
    include: ['currentStock', 'images', 'author'],
  });
  for (const l of q.data.data) {
    const attrs = l.attributes;
    const pd = attrs.publicData || {};
    console.log(`\n=== ${l.id.uuid} ===`);
    console.log('title:', attrs.title);
    console.log('state:', attrs.state);
    console.log('createdAt:', attrs.createdAt);
    console.log('price:', attrs.price && `${attrs.price.amount/100} ${attrs.price.currency}`);
    console.log('listingType:', pd.listingType);
    console.log('unitType:', pd.unitType);
    console.log('transactionProcessAlias:', pd.transactionProcessAlias);
    console.log('shippingEnabled:', pd.shippingEnabled);
    console.log('pickupEnabled:', pd.pickupEnabled);
    console.log('shippingCostPackage:', pd.shippingCostPackage);
    console.log('pricePackage:', pd.pricePackage);
    console.log('weight:', pd.weight);
    console.log('dimensions:', pd.dimensions);
    console.log('stockRef:', l.relationships?.currentStock?.data?.id?.uuid);
  }
})().catch(e => {
  console.error('ERR:', e.message);
  if (e.data?.errors) console.error(JSON.stringify(e.data.errors, null, 2));
});
