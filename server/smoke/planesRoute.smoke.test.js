// XOLOLO: smoke mínimo que verifica que la ruta /planes existe en la
// configuración de rutas. Esta prueba no renderiza el componente —
// solo garantiza que el registro de la ruta sobrevive refactors
// futuros (ej. si alguien reorganiza routeConfiguration.js).
//
// Si falla: alguien removió o renombró la ruta sin actualizar los
// links desde Topbar/Mobile menu/PlanesPage CTAs — romperían navegación.

const fs = require('fs');
const path = require('path');

describe('PlanesPage route registration', () => {
  const routingFile = path.resolve(__dirname, '../../src/routing/routeConfiguration.js');
  const src = fs.readFileSync(routingFile, 'utf8');

  it('ruta /planes está declarada', () => {
    expect(src).toMatch(/path:\s*'\/planes'/);
  });

  it('ruta /planes se llama PlanesPage', () => {
    expect(src).toMatch(/name:\s*'PlanesPage'/);
  });

  it('PlanesPage es importado como loadable', () => {
    expect(src).toMatch(/const PlanesPage = loadable/);
    expect(src).toMatch(/PlanesPage\/PlanesPage/);
  });
});
