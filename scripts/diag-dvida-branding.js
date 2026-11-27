// XOLOLO diag: ver qué logoUrl / bannerUrl tiene DVIDA Morelos para
// previsualizar el card del email con su branding real.
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

(async () => {
  const sdk = getIntegrationSdk();
  const r = await sdk.users.query({
    perPage: 50,
    'fields.user': ['email', 'profile.displayName', 'profile.publicData'],
  });
  const users = r.data.data || [];
  const dvida = users.find(u => /dvida/i.test(u.attributes?.email || '') || /dvida/i.test(u.attributes?.profile?.displayName || ''));
  if (!dvida) {
    console.log('DVIDA no encontrado en primeras', users.length, 'users');
    users.slice(0, 15).forEach(u => console.log(' -', u.attributes?.email, '|', u.attributes?.profile?.displayName));
    return;
  }
  const pd = dvida.attributes?.profile?.publicData || {};
  console.log('DVIDA id:', dvida.id.uuid);
  console.log('displayName:', dvida.attributes?.profile?.displayName);
  console.log('email:', dvida.attributes?.email);
  console.log('');
  console.log('BRANDING fields en publicData:');
  ['logoUrl', 'bannerUrl', 'bannerUrl2', 'bannerUrl3', 'brandPrimaryColor', 'brandSecondaryColor', 'storefrontTheme', 'slug'].forEach(k => {
    console.log(`  ${k}:`, pd[k] ?? '(none)');
  });
})().catch(e => { console.error(e.message); process.exit(1); });
