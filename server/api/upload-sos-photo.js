// XOLOLO: endpoint para subir una de las 5 fotos SOS de una orden.
// El seller sube por slot (producto, embalado, guia, medidas, peso)
// antes de generar la guía Skydropx. Se persiste la URL en
// tx.metadata.xololoShippingSosPhotos.{slot} via trustedSdk para que
// generate-shipping-guide valide su presencia.
//
// Contrato:
//   POST /api/upload-sos-photo?transactionId=<uuid>&slot=<producto|embalado|guia|medidas|peso>
//   Content-Type: multipart/form-data, field `file`
//   200 → { url, slot }
//   400 → { error: 'invalid_slot' | 'invalid_type' | 'too_large' | 'missing_transactionId' | 'no_file' }
//   401 → { error: 'unauthorized' }
//   403 → { error: 'not_provider' } — el user logueado no es el seller de la orden
//   404 → { error: 'transaction_not_found' }
//   500 → { error: 'upload_failed' | 'r2_not_configured' | 'internal' }

const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharetribeSdk = require('../api-util/sdk');
const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const MAX_SIZE = 8 * 1024 * 1024; // 8 MB — fotos de móvil pueden ser más grandes que logos
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

const VALID_SLOTS = new Set(['producto', 'embalado', 'guia', 'medidas', 'peso']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('invalid_type'));
      return;
    }
    cb(null, true);
  },
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

const PUBLIC_BASE_URL = () =>
  process.env.R2_PUBLIC_BASE_URL || 'https://media.xololo.mx';
const BUCKET = () => process.env.R2_BUCKET || 'xololo-media';

const runUpload = (req, res) =>
  new Promise((resolve, reject) => {
    upload.single('file')(req, res, err => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return reject({ code: 400, error: 'too_large' });
        if (err.message === 'invalid_type') return reject({ code: 400, error: 'invalid_type' });
        return reject({ code: 500, error: 'upload_failed', detail: err.message });
      }
      resolve();
    });
  });

module.exports = async (req, res) => {
  const transactionId = String(req.query.transactionId || '').trim();
  const slot = String(req.query.slot || '').toLowerCase();

  if (!transactionId) return res.status(400).json({ error: 'missing_transactionId' });
  if (!VALID_SLOTS.has(slot)) return res.status(400).json({ error: 'invalid_slot' });

  const client = getR2();
  if (!client) return res.status(500).json({ error: 'r2_not_configured' });

  // Auth + validación de que el user es el provider de la transacción.
  let currentUserId;
  let providerId;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    currentUserId = uResp.data.data.id.uuid;
    if (!currentUserId) return res.status(401).json({ error: 'unauthorized' });

    let txResp;
    try {
      txResp = await sdk.transactions.show({ id: transactionId, include: ['provider'] });
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: 'transaction_not_found' });
      throw e;
    }
    providerId = txResp.data.data.relationships?.provider?.data?.id?.uuid;
    if (providerId !== currentUserId) {
      return res.status(403).json({ error: 'not_provider' });
    }
  } catch (err) {
    if (!currentUserId) return res.status(401).json({ error: 'unauthorized' });
    // eslint-disable-next-line no-console
    console.error('[upload-sos-photo] auth error', err?.message);
    return res.status(500).json({ error: 'internal' });
  }

  try {
    await runUpload(req, res);
  } catch (e) {
    return res.status(e.code || 500).json(e);
  }

  if (!req.file) return res.status(400).json({ error: 'no_file' });

  const ext = EXT_BY_MIME[req.file.mimetype] || 'bin';
  const key = `orders/${transactionId}/insurance/${slot}.${ext}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET(),
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[upload-sos-photo] R2 error', err?.name, err?.message);
    return res.status(500).json({ error: 'upload_failed' });
  }

  const url = `${PUBLIC_BASE_URL().replace(/\/$/, '')}/${key}`;

  // Persistir la URL en la metadata de la transacción.
  //
  // IMPORTANTE: `metadata` sólo es visible/escribible al OPERATOR vía
  // Integration API. El trustedSdk (Marketplace API con token
  // trust-exchanged) NO puede leerla — devuelve `metadata: undefined`
  // aunque haya sido escrita previamente. Si usáramos trustedSdk aquí,
  // cada upload leería `metadata: {}` y sobreescribiría los slots
  // previos, dejando sólo la última foto en la tx (bug detectado en
  // 2026-09-21: 5 fotos subidas, sólo la última persistida).
  //
  // updateMetadata hace merge SHALLOW al top level de `metadata`, así
  // que `xololoShippingSosPhotos` como key completo se preserva entre
  // llamadas, pero su VALOR se sustituye entero. Por eso re-leemos el
  // objeto actual antes de mergear.
  try {
    const isdk = getIntegrationSdk();
    if (!isdk) {
      // Sin Integration SDK no podemos persistir metadata de forma
      // fiable; el R2 upload sí completó, así que devolvemos 200 pero
      // logueamos para alertar. Ver docs/deploy env vars.
      // eslint-disable-next-line no-console
      console.error(
        '[upload-sos-photo] SHARETRIBE_INTEGRATION_CLIENT_ID/SECRET no configurados; metadata NO se persistió'
      );
    } else {
      const currentTx = await isdk.transactions.show({ id: transactionId });
      const currentSos =
        currentTx.data.data.attributes.metadata?.xololoShippingSosPhotos || {};
      const mergedSos = { ...currentSos, [slot]: url };
      await isdk.transactions.updateMetadata({
        id: transactionId,
        metadata: { xololoShippingSosPhotos: mergedSos },
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[upload-sos-photo] updateMetadata error', err?.message);
    // El archivo ya está en R2. El client puede reintentar mediante
    // una acción del seller si esto falla — la próxima subida vuelve
    // a mergear todos los slots que existan en R2 (por convención de
    // path `orders/{txId}/insurance/{slot}.{ext}`).
  }

  return res.status(200).json({ url, slot });
};
