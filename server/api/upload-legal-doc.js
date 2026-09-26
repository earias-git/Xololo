// XOLOLO Track B (docs/SUBSCRIPTIONS_V1.md §2): sube un documento
// legal del seller autenticado (identificación, comprobante de
// domicilio, RFC, etc — ver api-util/legalDocSlots.js).
//
// Contrato:
//   POST /api/upload-legal-doc?slot=<key>&personType=<fisica|moral>
//   Content-Type: multipart/form-data, field `file`
//   Auth: user logueado — SIEMPRE sube a SU PROPIO perfil (no hay
//   parámetro sellerId; se resuelve del currentUser de la sesión).
//   200 → { url, slot, status: 'pending' }
//   400 → { error: 'invalid_slot' | 'invalid_type' | 'too_large' | 'no_file' | 'missing_person_type' }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'upload_failed' | 'r2_not_configured' | 'internal' }
//
// Storage: Cloudflare R2, path sellers/{sellerId}/legal/{slot}.{ext}.
// Persistencia: user.attributes.profile.metadata.xololoLegalDocs
// (OJO: en User, metadata vive ANIDADA bajo profile — no top-level
// como en Listing/Transaction. Mismo bug que ya corregimos hoy con
// xololoStoreAnalytics en trackingQueue.js). Cada slot sube con
// status:'pending' — sólo /admin puede cambiarlo a approved/rejected
// (ver server/api/admin-legal-docs.js).

const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { findSlot, PERSON_TYPES } = require('../api-util/legalDocSlots');

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB — PDFs de actas pueden pesar más que fotos
const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'application/pdf': 'pdf',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

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

const PUBLIC_BASE_URL = () => process.env.R2_PUBLIC_BASE_URL || 'https://media.xololo.mx';
const BUCKET = () => process.env.R2_BUCKET || 'xololo-media';

const runUpload = (req, res) =>
  new Promise((resolve, reject) => {
    upload.single('file')(req, res, err => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return reject({ code: 400, error: 'too_large' });
        return reject({ code: 500, error: 'upload_failed', detail: err.message });
      }
      resolve();
    });
  });

module.exports = async (req, res) => {
  const slotKey = String(req.query.slot || '').trim();
  const personType = String(req.query.personType || '').trim();

  const slot = findSlot(slotKey);
  if (!slot) return res.status(400).json({ error: 'invalid_slot' });
  if (!PERSON_TYPES.has(personType)) {
    return res.status(400).json({ error: 'missing_person_type' });
  }
  if (slot.personType !== 'both' && slot.personType !== personType) {
    return res.status(400).json({
      error: 'invalid_slot',
      details: `${slotKey} no aplica para personType=${personType}.`,
    });
  }

  const client = getR2();
  if (!client) return res.status(500).json({ error: 'r2_not_configured' });

  // Auth: sólo el propio user autenticado sube sus documentos.
  let sellerId;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    sellerId = uResp.data.data.id.uuid;
    if (!sellerId) return res.status(401).json({ error: 'unauthorized' });
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    await runUpload(req, res);
  } catch (e) {
    return res.status(e.code || 500).json(e);
  }
  if (!req.file) return res.status(400).json({ error: 'no_file' });

  if (!slot.accept.includes(req.file.mimetype)) {
    return res.status(400).json({
      error: 'invalid_type',
      details: `${slotKey} acepta: ${slot.accept.join(', ')}.`,
    });
  }

  const ext = EXT_BY_MIME[req.file.mimetype] || 'bin';
  const key = `sellers/${sellerId}/legal/${slotKey}.${ext}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET(),
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        CacheControl: 'private, max-age=0, no-cache',
      })
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[upload-legal-doc] R2 error', err?.name, err?.message);
    return res.status(500).json({ error: 'upload_failed' });
  }

  const url = `${PUBLIC_BASE_URL().replace(/\/$/, '')}/${key}`;
  const nowIso = new Date().toISOString();

  // Persistir en user.attributes.profile.metadata.xololoLegalDocs.
  // Shape: { personType, docs: { [slotKey]: {...} } } — personType a
  // nivel raíz (no por documento) porque es una elección única del
  // seller que determina qué slots debe llenar. Un nuevo upload del
  // mismo slot SIEMPRE resetea a 'pending' — si un seller re-sube tras
  // un rechazo, vuelve a la cola de revisión.
  try {
    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error('[upload-legal-doc] Integration SDK no configurado; no se persistió el status');
    } else {
      const currentResp = await isdk.users.show({ id: sellerId });
      const existing = currentResp.data.data.attributes?.profile?.metadata?.xololoLegalDocs || {};
      const mergedDocs = {
        personType: existing.personType || personType,
        docs: {
          ...(existing.docs || {}),
          [slotKey]: {
            url,
            status: 'pending',
            uploadedAt: nowIso,
            reviewedAt: null,
            reviewNote: null,
          },
        },
      };
      await isdk.users.updateProfile({
        id: sellerId,
        metadata: { xololoLegalDocs: mergedDocs },
      });
      // XOLOLO P3: subir un nuevo doc resetea el slot a 'pending' —
      // si el seller estaba verificado, deja de estarlo hasta que el
      // admin re-apruebe. Sync silent-fail.
      try {
        const { syncVerifiedBadge } = require('../api-util/sellerVerified');
        await syncVerifiedBadge({ isdk, sellerId });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[upload-legal-doc] syncVerifiedBadge falló:', e?.message);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[upload-legal-doc] updateProfile error', err?.message);
    // El archivo ya está en R2 — el seller puede reintentar el upload
    // para que quede registrado (mismo trade-off que upload-sos-photo.js).
  }

  return res.status(200).json({ url, slot: slotKey, status: 'pending' });
};
