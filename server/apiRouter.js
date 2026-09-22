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
const verifyPickupCode = require('./api/verify-pickup-code');
const generateShippingGuide = require('./api/generate-shipping-guide');
const uploadSosPhoto = require('./api/upload-sos-photo');
const skydropxWebhook = require('./api/webhooks/skydropx');
const orderSurvey = require('./api/order-survey');
const postalCode = require('./api/postal-code');
const sellerAnalytics = require('./api/seller-analytics');
const sellerAnalyticsExport = require('./api/seller-analytics-export');
const sellerCatalogInsights = require('./api/seller-catalog-insights');
const sellerMonthlyReportPreview = require('./api/seller-monthly-report-preview');
const adminMetrics = require('./api/admin-metrics');
const trackEvent = require('./api/track-event');

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

// XOLOLO: cotización de envío por paquetería via Skydropx.
// Recibe listingId + destination (CP + área) y devuelve rates disponibles.
// Requiere que el listing tenga shippingPricingMode:'carrier' + peso/dim,
// y que el seller haya configurado originPostalCode en /account/store.
// body-parser JSON explícito porque el cliente manda application/json.
router.post('/shipping-quote', bodyParser.json(), shippingQuote);

// XOLOLO: verificar código de 6 dígitos que el buyer muestra al seller
// al recoger. Solo el provider de la transacción puede llamarlo. 3
// intentos fallidos bloquean el código y disparan alerta a Xololo.
// Ver docs/LOGISTICS_V1.md §8.
router.post('/verify-pickup-code', bodyParser.json(), verifyPickupCode);

// XOLOLO: generar la guía Skydropx para una transacción "paid". Solo
// el provider (seller) puede llamarlo, y sólo si:
//   - modo carrier + rate seleccionado por el buyer
//   - las 5 fotos SOS están cargadas
//   - todavía no se ha generado (evita duplicados)
// Ver docs/LOGISTICS_V1.md §5 + Fase D.5.
router.post('/generate-shipping-guide', bodyParser.json(), generateShippingGuide);

// XOLOLO: subir una de las 5 fotos SOS de una orden (multipart/form-data).
// El seller sube por slot antes de poder generar la guía. Persiste la
// URL en tx.metadata.xololoShippingSosPhotos vía trustedSdk.
router.post('/upload-sos-photo', uploadSosPhoto);

// XOLOLO: webhook receiver de Skydropx. Recibe eventos de tracking
// (packages: in_transit, delivered, in_return, etc), valida token o
// HMAC-SHA512, busca la transacción por shipmentId, y actualiza
// metadata.xololoShippingTrackingEvents + xololoShippingGuide.currentStatus.
// Body-parser RAW porque necesitamos los bytes exactos para el HMAC.
router.post(
  '/webhooks/skydropx',
  bodyParser.raw({ type: 'application/json', limit: '1mb' }),
  skydropxWebhook
);

// XOLOLO: encuesta post-entrega del buyer (D.8). Sólo el customer
// puede llamar; registra su respuesta ("Todo bien" con rating y
// comentario opcional, o "Algo mal" abre disputa) y persiste
// xololoAcceptanceProof en la tx.
router.post('/order-survey', bodyParser.json(), orderSurvey);

// XOLOLO: proxy a SEPOMEX para autocompletar estado/ciudad/colonias
// desde el CP en el checkout. Público; caché in-memory 24h.
router.get('/postal-code', postalCode);

// XOLOLO F3: analytics de ventas para el dashboard del seller.
// Auth: user logueado. Devuelve las tx del provider en rango [from, to].
router.get('/seller-analytics', sellerAnalytics);

// XOLOLO F3 Sprint 3: insights de catálogo (top-sales + alertas).
// Auth: user logueado.
router.get('/seller-catalog-insights', sellerCatalogInsights);

// XOLOLO F3 Sprint 6: export CSV de ventas del seller.
// Auth: user logueado. Devuelve text/csv attachment (UTF-8 BOM).
router.get('/seller-analytics/export', sellerAnalyticsExport);

// XOLOLO F3 Sprint 6B: dispara el email de reporte mensual al user
// logueado (default: mes anterior). Sirve como preview del cron.
router.post('/seller-monthly-report-preview', bodyParser.json(), sellerMonthlyReportPreview);

// XOLOLO F3 Fase 3: endpoints admin gated por XOLOLO_ADMIN_EMAILS.
// GET /api/admin/health           → métricas globales del marketplace
// GET /api/admin/disputes         → tx con xololoDispute abierto
// GET /api/admin/sellers-ranking  → top sellers por revenue
router.get('/admin/health', adminMetrics.health);
router.get('/admin/disputes', adminMetrics.disputes);
router.get('/admin/sellers-ranking', adminMetrics.sellersRanking);

// XOLOLO F3 Sprint 2: recibe eventos de tracking del cliente.
// Público, rate-limited por IP. Encola y responde 200 inmediato.
router.post('/track/event', bodyParser.json(), trackEvent);

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
