// XOLOLO · E9 fase 3 — subir una imagen de listing bajo la identidad
// del admin del workspace.
//
// Contexto: el wizard del colaborador usa sdk.images.upload (SDK del
// colaborador logueado), que devuelve un imageId "claimado" por el
// colaborador. Al crear o actualizar el listing como admin via
// createDraftAs/updateListingAs, el Integration SDK recibe esos
// imageIds y los rechaza con image-invalid porque no son del admin.
//
// Fix: este endpoint recibe el file, lo re-sube via Integration SDK
// bajo la identidad del admin, y devuelve el imageId claimado por el
// admin — que el cliente usa en la payload del listing.
//
// Contrato:
//   POST /api/team/as/listing/upload-image?targetSellerId=<uuid>
//   Content-Type: multipart/form-data
//   Body: field `image`
//   Auth: cookie del colaborador (requirePermission('listings.create')
//         resuelve targetSellerId desde query, header o publicData).
//   200 → sendTransit({ data: image, included: [], meta: {} })
//   4xx → { error: '...' }
//
// NOTA: los middlewares `limits.generic` + `requirePermission` ya
// corren en apiRouter.js antes de llegar aquí. Este módulo solo
// expone el handler que procesa el multipart + llama al SDK.

const multer = require('multer');
const { Readable } = require('stream');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { sendTransit } = require('../api-util/transitResponse');

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB (consistent con Sharetribe)
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

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

const runUpload = (req, res) =>
  new Promise((resolve, reject) => {
    upload.single('image')(req, res, err => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return reject({ code: 400, error: 'too_large' });
        if (err.message === 'invalid_type') return reject({ code: 400, error: 'invalid_type' });
        return reject({ code: 500, error: 'upload_failed', detail: err.message });
      }
      resolve();
    });
  });

module.exports = async (req, res) => {
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    await runUpload(req, res);
  } catch (e) {
    return res.status(e.code || 500).json(e);
  }
  if (!req.file) return res.status(400).json({ error: 'no_file' });

  try {
    // Integration SDK images.upload acepta un stream. Readable.from
    // envuelve el Buffer de multer sin tocar disco.
    const stream = Readable.from(req.file.buffer);
    const resp = await isdk.images.upload({ image: stream });
    const img = resp.data.data;
    return sendTransit(res, { data: img, included: [], meta: {} });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.uploadImage] error:', e?.message || e);
    return res.status(500).json({ error: 'upload_failed', detail: e?.message });
  }
};
