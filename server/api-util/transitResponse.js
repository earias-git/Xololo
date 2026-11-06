// XOLOLO · E9 — helper para responder endpoints custom con Transit+JSON
// (formato nativo del Sharetribe SDK). Preserva los tipos Money, UUID,
// LatLng, BigDecimal como instancias del SDK — si se responde con res.json()
// plano, el cliente recibe {_sdkType:'Money', ...} y formatMoney()
// y otros helpers crashean ("Value must be a Money type").
//
// Uso en un endpoint:
//   const { sendTransit } = require('../api-util/transitResponse');
//   sendTransit(res, { data, included, meta });

const { serialize } = require('./sdk');

const sendTransit = (res, payload) => {
  res.set('Content-Type', 'application/transit+json');
  res.send(serialize(payload));
};

module.exports = { sendTransit };
