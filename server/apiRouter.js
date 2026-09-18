/**
 * This file contains server side endpoints that can be used to perform backend
 * tasks that can not be handled in the browser.
 *
 * The endpoints should not clash with the application routes. Therefore, the
 * endpoints are prefixed in the main server where this file is used.
 */

const express = require('express');
const bodyParser = require('body-parser');
const { deserialize } = require('./api-util/sdk');

const initiateLoginAs = require('./api/initiate-login-as');
const loginAs = require('./api/login-as');
const transactionLineItems = require('./api/transaction-line-items');
const initiatePrivileged = require('./api/initiate-privileged');
const transitionPrivileged = require('./api/transition-privileged');
const deleteAccount = require('./api/delete-account');
const sellerBySlug = require('./api/seller-by-slug');
const featuredStores = require('./api/featured-stores');
const uploadStoreImage = require('./api/upload-store-image');
const shippingQuote = require('./api/shipping-quote');
const envCheck = require('./api/env-check');

const createUserWithIdp = require('./api/auth/createUserWithIdp');

const { authenticateFacebook, authenticateFacebookCallback } = require('./api/auth/facebook');
const { authenticateGoogle, authenticateGoogleCallback } = require('./api/auth/google');

const router = express.Router();

// ================ API router middleware: ================ //

// Parse Transit body first to a string
router.use(
  bodyParser.text({
    type: 'application/transit+json',
  })
);

// Deserialize Transit body string to JS data
router.use((req, res, next) => {
  if (req.get('Content-Type') === 'application/transit+json' && typeof req.body === 'string') {
    try {
      req.body = deserialize(req.body);
    } catch (e) {
      console.error('Failed to parse request body as Transit:');
      console.error(e);
      res.status(400).send('Invalid Transit in request body.');
      return;
    }
  }
  next();
});

// ================ API router endpoints: ================ //

router.get('/initiate-login-as', initiateLoginAs);
router.get('/login-as', loginAs);
router.post('/transaction-line-items', transactionLineItems);
router.post('/initiate-privileged', initiatePrivileged);
router.post('/transition-privileged', transitionPrivileged);
router.post('/delete-account', deleteAccount);

// XOLOLO: resolver slug de tienda a datos del seller. Usa Integration API.
router.get('/seller-by-slug', sellerBySlug);

// XOLOLO: tiendas destacadas para la sección FeaturedStores del landing.
router.get('/featured-stores', featuredStores);

// XOLOLO: subir logo/banner de la tienda del seller a Cloudflare R2.
// multer maneja el multipart/form-data dentro del handler, así que aquí
// no montamos body-parser transit.
router.post('/upload-store-image', uploadStoreImage);

// XOLOLO: endpoint diagnóstico TEMPORAL — muestra qué env vars están
// cargadas al proceso (solo presencia + prefijo, no valores completos).
// Borrar cuando termine el debug del setup de Skydropx en Render.
router.get('/env-check', envCheck);

// XOLOLO: cotización de envío por paquetería via Skydropx.
// Recibe listingId + destination (CP + área) y devuelve rates disponibles.
// Requiere que el listing tenga shippingPricingMode:'carrier' + peso/dim,
// y que el seller haya configurado originPostalCode en /account/store.
// body-parser JSON explícito porque el cliente manda application/json.
router.post('/shipping-quote', bodyParser.json(), shippingQuote);

// Create user with identity provider (e.g. Facebook or Google)
// This endpoint is called to create a new user after user has confirmed
// they want to continue with the data fetched from IdP (e.g. name and email)
router.post('/auth/create-user-with-idp', createUserWithIdp);

// Facebook authentication endpoints

// This endpoint is called when user wants to initiate authenticaiton with Facebook
router.get('/auth/facebook', authenticateFacebook);

// This is the route for callback URL the user is redirected after authenticating
// with Facebook. In this route a Passport.js custom callback is used for calling
// loginWithIdp endpoint in Sharetribe Auth API to authenticate user to the marketplace
router.get('/auth/facebook/callback', authenticateFacebookCallback);

// Google authentication endpoints

// This endpoint is called when user wants to initiate authenticaiton with Google
router.get('/auth/google', authenticateGoogle);

// This is the route for callback URL the user is redirected after authenticating
// with Google. In this route a Passport.js custom callback is used for calling
// loginWithIdp endpoint in Sharetribe Auth API to authenticate user to the marketplace
router.get('/auth/google/callback', authenticateGoogleCallback);

module.exports = router;
