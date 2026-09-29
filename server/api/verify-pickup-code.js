// XOLOLO: alias de compat que delega a verify-delivery-code.
// Se conserva para no romper clientes o webhooks que aún llamen al
// endpoint viejo /api/verify-pickup-code. La lógica vive en el nuevo
// handler porque ahora aplica a pickup, localDelivery y freight.
// Retirar cuando ya no queden referencias externas (~1 release).
module.exports = require('./verify-delivery-code');
