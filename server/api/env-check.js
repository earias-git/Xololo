// XOLOLO: endpoint diagnóstico que expone qué env vars están cargadas
// (solo presencia + primeros 6 chars, NO valores completos). Sirve para
// verificar desde curl que Render inyectó las vars al proceso.
//
// Contrato:
//   GET /api/env-check
//   200 → { checked: { VAR_NAME: '<empty>' | '<set:XXXXXX...>' }, node_env, uptime_s }
//
// TEMPORAL — borrar cuando terminemos de configurar Skydropx en prod.

const CHECK_VARS = [
  'NODE_ENV',
  'REACT_APP_ENV',
  'SKYDROPX_HOST',
  'SKYDROPX_ENV',
  'SKYDROPX_CLIENT_ID',
  'SKYDROPX_CLIENT_SECRET',
  'SHARETRIBE_INTEGRATION_CLIENT_ID',
  'R2_BUCKET',
];

module.exports = (req, res) => {
  const checked = {};
  for (const name of CHECK_VARS) {
    const v = process.env[name];
    if (!v) {
      checked[name] = '<empty>';
    } else {
      // Solo primeros 6 chars + longitud para no filtrar el secret.
      checked[name] = `<set:${v.slice(0, 6)}... (${v.length}ch)>`;
    }
  }
  return res.json({
    checked,
    node_env: process.env.NODE_ENV,
    uptime_s: Math.round(process.uptime()),
  });
};
