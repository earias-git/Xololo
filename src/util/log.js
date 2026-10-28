/**
 * Error logging
 *
 * Can be used to log errors to console or and eternal
 * error logging system, like Sentry for example.
 *
 */

import * as Sentry from '@sentry/browser';
import appSettings from '../config/settings';

const ingoreErrorsMap = {
  ['ResizeObserver loop limit exceeded']: true, // Some exotic browsers seems to emit these.
  ['Error reading']: true, // Ignore file reader errors (ImageFromFile)
  ['AxiosError: Network Error']: true,
};

const pickSelectedErrors = (ignored, entry) => {
  const [key, value] = entry;
  return value === true ? [...ignored, key] : ignored;
};

/**
 * Set up error handling. If a Sentry DSN is
 * provided a Sentry client will be installed.
 */
// XOLOLO 2026-10-27: PII scrubber para Sentry en cliente. Las URLs
// pueden traer query params con PII; los bodies de forms también
// (recipientPhoneNumber, direcciones, montos).
const PII_KEYS = [
  'password',
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
];
const PII_SET = new Set(PII_KEYS);
const PII_PATTERNS = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/g,
  /\b\d{10}\b/g,
];
const scrubStr = s => {
  if (typeof s !== 'string') return s;
  let o = s;
  for (const re of PII_PATTERNS) o = o.replace(re, '[REDACTED]');
  return o;
};
const scrubObj = (obj, depth = 0) => {
  if (depth > 6) return '[DEEP]';
  if (obj == null) return obj;
  if (typeof obj === 'string') return scrubStr(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => scrubObj(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_SET.has(k) || PII_SET.has(k.toLowerCase())) out[k] = '[REDACTED]';
    else out[k] = scrubObj(v, depth + 1);
  }
  return out;
};
const beforeSend = (event, _hint) => {
  try {
    if (event.request) {
      if (event.request.headers) {
        const safe = {};
        for (const [k, v] of Object.entries(event.request.headers)) {
          if (!PII_SET.has(k.toLowerCase())) safe[k] = v;
        }
        event.request.headers = safe;
      }
      if (event.request.data) event.request.data = scrubObj(event.request.data);
      if (event.request.cookies) event.request.cookies = { scrubbed: true };
      if (event.request.query_string)
        event.request.query_string = scrubStr(event.request.query_string);
    }
    if (event.extra) event.extra = scrubObj(event.extra);
    if (event.contexts) event.contexts = scrubObj(event.contexts);
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(b => ({
        ...b,
        data: b.data ? scrubObj(b.data) : b.data,
        message: b.message ? scrubStr(b.message) : b.message,
      }));
    }
    if (event.message) event.message = scrubStr(event.message);
  } catch (_) {
    return { message: '[sentry-scrubber-failed]', level: 'warning' };
  }
  return event;
};

export const setup = () => {
  if (appSettings.sentryDsn) {
    const ignoreErrors = Object.entries(ingoreErrorsMap).reduce(pickSelectedErrors, []);

    // Configures the Sentry client. Adds a handler for
    // any uncaught exception.
    Sentry.init({
      dsn: appSettings.sentryDsn,
      environment: appSettings.env,
      ignoreErrors,
      beforeSend,
    });
  }
};

/**
 * Set user ID for the logger so that it
 * can be attached to Sentry issues.
 *
 * @param {String} userId ID of current user
 */
export const setUserId = userId => {
  Sentry.setUser({ id: userId });
};

/**
 * Clears the user ID.
 */

export const clearUserId = () => {
  Sentry.setUser(null);
};

const printAPIErrorsAsConsoleTable = apiErrors => {
  /* eslint-disable no-console */
  if (apiErrors != null && apiErrors.length > 0 && typeof console.table === 'function') {
    console.log('Errors returned by Marketplace API call:');
    console.table(
      apiErrors.map(err => ({
        status: err.status,
        code: err.code,
        details: err.details,
        ...err.meta,
      }))
    );
  }
  /* eslint-enable no-console */
};

const responseAPIErrors = error => {
  return error && error.data && error.data.errors ? error.data.errors : [];
};

const responseApiErrorInfo = err =>
  responseAPIErrors(err).map(e => ({
    status: e.status,
    code: e.code,
    meta: e.meta,
    details: e.details,
  }));

/**
 * Logs an exception. If Sentry is configured
 * sends the error information there. Otherwise
 * prints the error to the console.
 *
 * @param {Error} e Error that occurred
 * @param {String} code Error code
 * @param {Object} data Additional data to be sent to Sentry
 */
export const error = (e, code, data) => {
  const apiErrors = responseApiErrorInfo(e);
  if (appSettings.sentryDsn) {
    const extra = { ...data, apiErrorData: apiErrors };

    Sentry.withScope(scope => {
      scope.setTag('code', code);
      Object.keys(extra).forEach(key => {
        scope.setExtra(key, extra[key]);
      });
      Sentry.captureException(e);
    });

    printAPIErrorsAsConsoleTable(apiErrors);
  } else {
    console.error(e);
    console.error('Error code:', code, 'data:', data);
    printAPIErrorsAsConsoleTable(apiErrors);
  }
};

const setCause = (error, cause) => {
  const seenErrors = new WeakSet();

  const setCauseIfNoExistingCause = (error, cause) => {
    if (seenErrors.has(error)) {
      return;
    }
    if (error.cause) {
      seenErrors.add(error);
      return setCauseIfNoExistingCause(error.cause, cause);
    }
    error.cause = cause;
  };

  setCauseIfNoExistingCause(error, cause);
};

export const onRecoverableError = (e, componentStack) => {
  let data = {};

  if (componentStack) {
    // Generating this synthetic error allows monitoring services to apply sourcemaps
    // to unminify the stacktrace and make it readable.
    const errorBoundaryError = new Error(e.message);
    errorBoundaryError.name = `React ErrorBoundary ${errorBoundaryError.name}`;
    errorBoundaryError.stack = componentStack;

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
    setCause(e, errorBoundaryError);

    data.componentStack = componentStack;
  }

  // Replace with your error monitoring service.
  error(error, 'recoverable-error', data);
};
