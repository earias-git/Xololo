/**
 * Import reducers from shared ducks modules (default export)
 * We are following Ducks module proposition:
 * https://github.com/erikras/ducks-modular-redux
 */

import auth from './auth.duck';
import emailVerification from './emailVerification.duck';
import routing from './routing.duck';
import ui from './ui.duck';
import hostedAssets from './hostedAssets.duck';
import featuredListings from './featuredListings.duck';
import landingListings from './landingListings.duck';
import marketplaceData from './marketplaceData.duck';
import paymentMethods from './paymentMethods.duck';
import storefrontSubdomain from './storefrontSubdomain.duck';
import stripe from './stripe.duck';
import stripeConnectAccount from './stripeConnectAccount.duck';
import user from './user.duck';

export {
  auth,
  emailVerification,
  routing,
  ui,
  hostedAssets,
  featuredListings,
  landingListings,
  marketplaceData,
  paymentMethods,
  storefrontSubdomain,
  stripe,
  stripeConnectAccount,
  user,
};
