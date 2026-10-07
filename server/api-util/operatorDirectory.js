// XOLOLO Fase 1C (hoja Arquitectura técnica §1) — Directory de
// operators persistido en Cloudflare R2.
//
// Decisión de infra (2026-10-06): operators viven en un archivo
// JSON en R2 (operators/directory.json) en lugar de DB nueva. Razones:
//   - Volumen esperado: <20 operadores internos de Xololo. Sin
//     justificación para montar Postgres administrado.
//   - Reutiliza el R2 que ya tenemos para uploads (upload-store-image,
//     upload-sos-photo, etc.). Zero infra nueva.
//   - Lecturas cacheadas en memoria con TTL — en runtime es rápido.
//   - Si crece a 100+ operators, migrar a Postgres es un replace de
//     este archivo, zero cambio en consumers.
//
// Shape de un operator:
// {
//   id: string (uuid v4),
//   email: string (debe terminar en @xololo.mx),
//   name: string,
//   role: string (uno de operatorRoles.ROLES),
//   passwordHash: string | null (bcrypt — se setea en Fase 1C.3),
//   mfaSecret: string | null (TOTP base32 — se setea en Fase 1C.4),
//   mfaEnabled: boolean,
//   permissionsOverrides: Array<{module, action, allowed}>, // override por operator
//   createdAt: ISO string,
//   createdBy: string (operatorId del super admin que lo creó),
//   lastLoginAt: ISO string | null,
//   suspendedAt: ISO string | null,
//   suspendedBy: string | null,
//   suspendedReason: string | null,
// }

const crypto = require('crypto');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const { isValidRole } = require('./operatorRoles');

const DIRECTORY_KEY = 'operators/directory.json';
const CACHE_TTL_MS = 60 * 1000; // 1 minuto — balance entre frescura y latencia

let r2Client = null;
const getR2 = () => {
  if (r2Client) return r2Client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  r2Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return r2Client;
};

const BUCKET = () => process.env.R2_BUCKET || 'xololo-media';

// ============================================================
// Cache in-memory (shared across requests in el mismo proceso Node)
// ============================================================
let cache = { operators: null, loadedAt: 0 };

const invalidateCache = () => {
  cache = { operators: null, loadedAt: 0 };
};

const isCacheFresh = () => {
  return cache.operators !== null && Date.now() - cache.loadedAt < CACHE_TTL_MS;
};

// ============================================================
// R2 I/O
// ============================================================

const readDirectoryFromR2 = async () => {
  const r2 = getR2();
  if (!r2) {
    // eslint-disable-next-line no-console
    console.error('[operatorDirectory] R2 no configurado — devolviendo lista vacía');
    return [];
  }
  try {
    const resp = await r2.send(new GetObjectCommand({ Bucket: BUCKET(), Key: DIRECTORY_KEY }));
    const text = await resp.Body.transformToString('utf-8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.operators) ? parsed.operators : [];
  } catch (e) {
    // Si no existe el archivo (NoSuchKey), es primera vez — lista vacía.
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      return [];
    }
    // eslint-disable-next-line no-console
    console.error('[operatorDirectory.read] error', e?.message);
    throw e;
  }
};

const writeDirectoryToR2 = async operators => {
  const r2 = getR2();
  if (!r2) throw new Error('r2_not_configured');
  const body = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    operators,
  }, null, 2);
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: DIRECTORY_KEY,
    Body: body,
    ContentType: 'application/json',
    // CacheControl: no-cache porque es datos operacionales críticos
    CacheControl: 'no-cache',
  }));
  invalidateCache();
};

// ============================================================
// API pública (lecturas usan cache, escrituras invalidan)
// ============================================================

/**
 * Lista completa de operators. Retorna copia defensive para que
 * mutaciones del caller no afecten el cache.
 */
const listOperators = async () => {
  if (isCacheFresh()) return cache.operators.map(o => ({ ...o }));
  const operators = await readDirectoryFromR2();
  cache = { operators, loadedAt: Date.now() };
  return operators.map(o => ({ ...o }));
};

const getOperatorById = async id => {
  const all = await listOperators();
  return all.find(o => o.id === id) || null;
};

const getOperatorByEmail = async email => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const all = await listOperators();
  return all.find(o => o.email.toLowerCase() === normalized) || null;
};

/**
 * Validaciones de alta/edición. Devuelve array de errores (vacío = ok).
 */
const validateOperator = ({ email, name, role }) => {
  const errors = [];
  const emailStr = String(email || '').trim();
  if (!emailStr) errors.push('email_required');
  else if (!/^[^\s@]+@xololo\.mx$/i.test(emailStr)) errors.push('email_must_be_xololo_mx');
  if (!String(name || '').trim()) errors.push('name_required');
  if (!isValidRole(role)) errors.push('role_invalid');
  return errors;
};

/**
 * Crea un operator nuevo. passwordHash y mfaSecret quedan null —
 * se setean en flows separados (Fase 1C.3 y 1C.4).
 */
const createOperator = async ({ email, name, role, createdBy }) => {
  const errors = validateOperator({ email, name, role });
  if (errors.length) {
    const err = new Error('validation_failed');
    err.details = errors;
    throw err;
  }
  const operators = await listOperators();
  const normalizedEmail = email.trim().toLowerCase();
  if (operators.some(o => o.email.toLowerCase() === normalizedEmail)) {
    throw new Error('email_already_exists');
  }
  const operator = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name: String(name).trim(),
    role,
    passwordHash: null,
    mfaSecret: null,
    mfaEnabled: false,
    permissionsOverrides: [],
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null,
    lastLoginAt: null,
    suspendedAt: null,
    suspendedBy: null,
    suspendedReason: null,
  };
  await writeDirectoryToR2([...operators, operator]);
  return operator;
};

/**
 * Actualiza campos específicos de un operator. Nunca permite cambiar
 * `id`, `email` (crear nuevo si cambia), `createdAt`, `createdBy`.
 */
const updateOperator = async (id, patch) => {
  const operators = await listOperators();
  const idx = operators.findIndex(o => o.id === id);
  if (idx === -1) throw new Error('operator_not_found');
  const existing = operators[idx];
  // Lista blanca de campos actualizables.
  const allowed = [
    'name', 'role', 'passwordHash', 'mfaSecret', 'mfaEnabled',
    'mfaRecoveryCodes', 'permissionsOverrides', 'lastLoginAt',
  ];
  const updated = { ...existing };
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      updated[field] = patch[field];
    }
  }
  if (patch.role && !isValidRole(patch.role)) throw new Error('role_invalid');
  operators[idx] = updated;
  await writeDirectoryToR2(operators);
  return updated;
};

const suspendOperator = async (id, { suspendedBy, reason }) => {
  return updateOperator(id, {}).then(async () => {
    const operators = await listOperators();
    const idx = operators.findIndex(o => o.id === id);
    if (idx === -1) throw new Error('operator_not_found');
    operators[idx] = {
      ...operators[idx],
      suspendedAt: new Date().toISOString(),
      suspendedBy: suspendedBy || null,
      suspendedReason: reason || null,
    };
    await writeDirectoryToR2(operators);
    return operators[idx];
  });
};

const reinstateOperator = async id => {
  const operators = await listOperators();
  const idx = operators.findIndex(o => o.id === id);
  if (idx === -1) throw new Error('operator_not_found');
  operators[idx] = {
    ...operators[idx],
    suspendedAt: null,
    suspendedBy: null,
    suspendedReason: null,
  };
  await writeDirectoryToR2(operators);
  return operators[idx];
};

// Operators activos (no suspendidos). Útil para pickers.
const listActiveOperators = async () => {
  const all = await listOperators();
  return all.filter(o => !o.suspendedAt);
};

module.exports = {
  listOperators,
  listActiveOperators,
  getOperatorById,
  getOperatorByEmail,
  createOperator,
  updateOperator,
  suspendOperator,
  reinstateOperator,
  invalidateCache,
  validateOperator,
};
