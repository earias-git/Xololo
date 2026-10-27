/**
 * Error logging for the Sharetribe Web Template's server. Can be used to
 * strap on an external error logging service like Sentry
 * or just plain printing errors to the log.
 */

const Sentry = require('@sentry/node');

const ENV = process.env.REACT_APP_ENV;
const SENTRY_DSN = process.env.REACT_APP_SENTRY_DSN;
const VERBOSE = process.env.VERBOSE === 'true';
const DEV = process.env.REACT_APP_ENV === 'development';

const ingoreErrorsMap = {
  ['AxiosError: Network Error']: true,
};

const pickSelectedErrors = (ignored, entry) => {
  const [key, value] = entry;
  return value === true ? [...ignored, key] : ignored;
};

// XOLOLO 2026-10-27: PII scrubber para eventos de Sentry.
// Antes del fix, Sentry recibía bodies completos de requests que
// podían incluir direcciones de buyer, teléfonos, montos de pago,
// datos de tarjeta (si se incluyeron por accidente), y datos privados
// de la tx. Esto es un riesgo LFPDPPP y de retention. El scrubber
// corre en beforeSend y limpia claves y valores sospechosos.
const PII_KEYS = new Set([
  'password',
  'passwordHash',
  'cardNumber',
  'cvv',
  'cvc',
  'ssn',
  'rfc',
  'curp',
  'ine',
  'phone',
  'phoneNumber',
  'telefono',
  'email',
  'recipientPhoneNumber',
  'recipientAddressLine1',
  'recipientAddressLine2',
  'recipientReferences',
  'recipientPostal',
  'recipientName',
  'recipientNeighborhood',
  'address',
  'direccion',
  'street1',
  'street2',
  'line1',
  'line2',
  'postal_code',
  'postalCode',
  'authorization',
  'bearer',
  'cookie',
  'token',
  'access_token',
  'refreshToken',
]);

const PII_VALUE_PATTERNS = [
  // Correo tipo foo@bar.com
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  // Tarjeta (13-19 dígitos agrupados o continuos)
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/g,
  // Teléfonos MX (10 dígitos)
  /\b\d{10}\b/g,
];

const scrubString = s => {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const re of PII_VALUE_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
};

const scrubObject = (obj, depth = 0) => {
  if (depth > 6) return '[DEEP]';
  if (obj == null) return obj;
  if (typeof obj === 'string') return scrubString(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => scrubObject(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k) || PII_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = scrubObject(v, depth + 1);
    }
  }
  return out;
};

const sentryBeforeSend = (event, _hint) => {
  try {
    if (event.request) {
      // Headers: solo mantenemos los no sensibles.
      if (event.request.headers) {
        const safeHeaders = {};
        for (const [k, v] of Object.entries(event.request.headers)) {
          if (PII_KEYS.has(k.toLowerCase())) continue;
          safeHeaders[k] = v;
        }
        event.request.headers = safeHeaders;
      }
      if (event.request.data) event.request.data = scrubObject(event.request.data);
      if (event.request.cookies) event.request.cookies = { scrubbed: true };
      if (event.request.query_string) {
        event.request.query_string = scrubString(event.request.query_string);
      }
    }
    if (event.extra) event.extra = scrubObject(event.extra);
    if (event.contexts) event.contexts = scrubObject(event.contexts);
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(b => ({
        ...b,
        data: b.data ? scrubObject(b.data) : b.data,
        message: b.message ? scrubString(b.message) : b.message,
      }));
    }
    if (event.message) event.message = scrubString(event.message);
  } catch (e) {
    // No queremos que el scrubber tire el evento. Si falla, mandamos
    // el evento con una marca para auditoría pero sin PII cruda.
    return { message: '[sentry-scrubber-failed]', level: 'warning' };
  }
  return event;
};

// Initialize Sentry ~ the way their suggested approach using instrument.js would have done it.
if (SENTRY_DSN) {
  const ignoreErrors = Object.entries(ingoreErrorsMap).reduce(pickSelectedErrors, []);

  // Configure the Sentry client. As is, this catches unhandled
  // exceptions from starting the server etc. but does not catch the
  // ones thrown from Express.js middleware functions. For those
  // an error handler has to be added to the Express app.
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV,
    ignoreErrors,
    beforeSend: sentryBeforeSend,
  });
}

/**
 * Returns a Sentry error handler in case
 * Sentry client is set up.
 */
exports.setupExpressErrorHandler = app => {
  if (SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }
};

const responseAPIErrors = error => {
  return error && error.data && error.data.errors ? error.data.errors : [];
};

const responseApiErrorInfo = err =>
  responseAPIErrors(err).map(e => ({
    status: e.status,
    code: e.code,
    meta: e.meta,
  }));

/**
 * Logs a error. If Sentry client is set up
 * passes the error to that. Otherwise prints
 * the error to `console.error`.
 *
 * @param {Error} e Error that occurred
 * @param {String} code Error code
 * @param {Object} data Additional data to be sent to Sentry
 */
exports.error = (e, code, data) => {
  if (SENTRY_DSN) {
    const extra = { ...data, apiErrorData: responseApiErrorInfo(e) };

    Sentry.withScope(scope => {
      scope.setTag('code', code);
      Object.keys(extra).forEach(key => {
        scope.setExtra(key, extra[key]);
      });
      Sentry.captureException(e);
    });
  }
  // Let's log always to stdout
  console.error(e);
  console.error(code);
  console.error(data);
};

exports.devLogger = (...args) => {
  if (DEV && VERBOSE) {
    console.log(...args); // eslint-disable-line no-console
  }
};
