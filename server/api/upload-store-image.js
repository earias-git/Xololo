// XOLOLO: endpoint para subir logo/banner de la tienda del seller a
// Cloudflare R2. R2 es S3-compatible, usamos @aws-sdk/client-s3.
//
// Contrato:
//   POST /api/upload-store-image?kind=logo|banner
//   Content-Type: multipart/form-data
//   Body: field `file`
//   Auth: sesión del user (cookie); usamos su ID para namespacing.
//   200 → { url: 'https://media.xololo.mx/<userId>/<kind>-<timestamp>.<ext>' }
//   400 → { error: 'invalid_kind' | 'no_file' | 'invalid_type' | 'too_large' }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'upload_failed' }

const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharetribeSdk = require('../api-util/sdk');

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

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

// Wrap multer para capturar errores (tamaño, tipo) y responderlos como JSON.
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
  const kind = String(req.query.kind || '').toLowerCase();
  if (kind !== 'logo' && kind !== 'banner') {
    return res.status(400).json({ error: 'invalid_kind' });
  }

  const client = getR2();
  if (!client) {
    return res.status(501).json({ error: 'r2_not_configured' });
  }

  // Auth: la cookie del user tiene que corresponder a una sesión válida.
  // Reusamos el SDK helper que arma un SDK instance con las credenciales
  // que el server ya ha estado usando para el proxy de Sharetribe.
  let currentUser;
  try {
    const sdk = sharetribeSdk.getSdk(req, res);
    const response = await sdk.currentUser.show();
    currentUser = response.data.data;
    if (!currentUser?.id?.uuid) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    await runUpload(req, res);
  } catch (e) {
    return res.status(e.code || 500).json(e);
  }

  if (!req.file) {
    return res.status(400).json({ error: 'no_file' });
  }

  const ext = EXT_BY_MIME[req.file.mimetype] || 'bin';
  const timestamp = Date.now();
  const key = `stores/${currentUser.id.uuid}/${kind}-${timestamp}.${ext}`;

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
    console.error('[upload-store-image] R2 error', err?.name, err?.message);
    return res.status(500).json({ error: 'upload_failed' });
  }

  const url = `${PUBLIC_BASE_URL().replace(/\/$/, '')}/${key}`;
  return res.status(200).json({ url });
};
