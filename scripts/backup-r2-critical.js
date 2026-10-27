#!/usr/bin/env node
// XOLOLO 2026-10-27: backup de archivos críticos de R2 a disco local.
//
// Uso:
//   node scripts/backup-r2-critical.js [--out ./backups] [--prefix operators/]
//
// Qué respalda (prefijos default):
//   - operators/            → directorio de operators, backups incluidos.
//   - ai-metrics/           → métricas de uso de IA.
//   - legal-docs/           → PDFs de constancias legales de sellers.
//   - sos-photos/           → OPCIONAL (muy grande; off por default).
//
// Output:
//   ./backups/<YYYY-MM-DD>/<key>  (misma jerarquía)
//   ./backups/<YYYY-MM-DD>/manifest.json  (lista + size + sha256)
//
// Operación recomendada:
//   - Correr semanalmente desde laptop del CEO o un CI job cron.
//   - Después del backup, verificar que manifest.json tenga entradas
//     esperadas (operators/directory.json presente, size > 0).
//   - Guardar los backups en una ubicación distinta a Render (Google
//     Drive, laptop, caja fuerte). Nunca commitear al repo (sensitive).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const KEY_ID = process.env.KEY_ID;
const SECRET = process.env.R_SECRET || process.env.R2_SECRET;
const ENDPOINT = process.env.R_ENDPOINT || process.env.R2_ENDPOINT;
const BUCKET = process.env.R_BUCKET || process.env.R2_BUCKET || 'xololo-prod';

if (!KEY_ID || !SECRET || !ENDPOINT) {
  console.error('[backup] faltan env vars KEY_ID, R_SECRET, R_ENDPOINT');
  process.exit(1);
}

const client = new S3Client({
  endpoint: ENDPOINT,
  region: 'auto',
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
});

const args = process.argv.slice(2);
const outDir = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : path.resolve('./backups');

const todayDir = path.join(outDir, new Date().toISOString().slice(0, 10));

const DEFAULT_PREFIXES = ['operators/', 'ai-metrics/', 'legal-docs/'];
const prefixes = args.includes('--prefix')
  ? [args[args.indexOf('--prefix') + 1]]
  : DEFAULT_PREFIXES;

const listKeys = async prefix => {
  const keys = [];
  let continuationToken;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );
    (resp.Contents || []).forEach(obj => {
      keys.push({ key: obj.Key, size: obj.Size, etag: obj.ETag });
    });
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
};

const downloadKey = async key => {
  const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const main = async () => {
  fs.mkdirSync(todayDir, { recursive: true });
  const manifest = {
    bucket: BUCKET,
    endpoint: ENDPOINT,
    startedAt: new Date().toISOString(),
    prefixes,
    files: [],
    errors: [],
  };

  for (const prefix of prefixes) {
    console.log(`\n[backup] listing prefix: ${prefix}`);
    const keys = await listKeys(prefix);
    console.log(`[backup]   found ${keys.length} objects`);
    for (const { key, size } of keys) {
      try {
        const buf = await downloadKey(key);
        const dest = path.join(todayDir, key);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        const digest = sha256(buf);
        manifest.files.push({ key, size: buf.length, sha256: digest });
        process.stdout.write('.');
      } catch (e) {
        manifest.errors.push({ key, error: e?.message });
        process.stdout.write('x');
      }
    }
    process.stdout.write('\n');
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.summary = {
    total_files: manifest.files.length,
    total_bytes: manifest.files.reduce((s, f) => s + f.size, 0),
    errors: manifest.errors.length,
  };
  fs.writeFileSync(
    path.join(todayDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`\n[backup] done:`);
  console.log(`  files:  ${manifest.summary.total_files}`);
  console.log(`  bytes:  ${manifest.summary.total_bytes.toLocaleString()}`);
  console.log(`  errors: ${manifest.summary.errors}`);
  console.log(`  out:    ${todayDir}`);
  if (manifest.summary.errors > 0) {
    console.error('[backup] ⚠ hubo errores, revisar manifest.json');
    process.exit(2);
  }
};

main().catch(e => {
  console.error('[backup] fatal:', e);
  process.exit(1);
});
