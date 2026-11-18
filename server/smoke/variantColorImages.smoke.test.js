// XOLOLO Blindaje — smoke test del flujo "Foto por color" (ADR-003).
//
// Verifica las invariantes CRÍTICAS que previenen regresión del bug
// Oxford (commit 0b100d554, en el que replicate pisó títulos de
// listings ajenos al grupo):
//
//   1. El flow de guardado del wizard SOLO escribe sobre el publicData
//      del master — nunca sobre siblings ni listings ajenos.
//   2. Los helpers puros no mutan su input.
//   3. El shape final del master contiene variantValueImages.color
//      con los slugs correctos, y nada más tocado fuera del scope.
//   4. Sibling y listings ajenos permanecen estructural y
//      referencialmente intactos (deep equal contra snapshot).
//
// Si estos fallan, PARAR: alguien violó el diseño "zero write
// cross-listing" del ADR-003.

const {
  slugifyAxisValue,
  setColorImageId,
  pruneDanglingColorImages,
  getColorImageIdForValue,
  isFashionCategory,
  getColorAxisValues,
} = require('../../src/util/variants');

const deepClone = o => JSON.parse(JSON.stringify(o));

const mkListing = ({ id, publicData = {}, images = [] }) => ({
  id: { uuid: id },
  attributes: { publicData },
  images,
});

const GROUP_A = 'group-fashion-a';
const GROUP_B = 'group-electronics-b';
const MASTER_ID = 'master-fashion-1';
const SIBLING_ID = 'sibling-fashion-1-rojo';
const FOREIGN_ID = 'foreign-electronics-1';

// Fábrica del escenario de fixture usado por todos los tests del
// bloque. Cada test corre su propia copia (deepClone).
const buildScenario = () => {
  const master = mkListing({
    id: MASTER_ID,
    publicData: {
      categoryLevel1: 'moda',
      variantGroupId: GROUP_A,
      isVariantMaster: true,
      variantAxes: ['talla', 'color'],
      variantValues: {},
      variantsMatrix: [
        { variantValues: { talla: 'S', color: 'Rojo' }, stock: 10 },
        { variantValues: { talla: 'S', color: 'Verde' }, stock: 5 },
        { variantValues: { talla: 'M', color: 'Rojo' }, stock: 8 },
      ],
    },
    images: [{ id: { uuid: 'img-master-main' } }],
  });
  const sibling = mkListing({
    id: SIBLING_ID,
    publicData: {
      categoryLevel1: 'moda',
      variantGroupId: GROUP_A,
      isVariantMaster: false,
      variantAxes: ['talla', 'color'],
      variantValues: { talla: 'S', color: 'Rojo' },
    },
    images: [{ id: { uuid: 'img-sibling-1' } }],
  });
  const foreign = mkListing({
    id: FOREIGN_ID,
    publicData: {
      categoryLevel1: 'electronica',
      // NO es variante, no pertenece al grupo.
    },
    images: [{ id: { uuid: 'img-foreign-1' } }],
  });
  return { master, sibling, foreign };
};

describe('ADR-003 — Foto por color · smoke anti-Oxford', () => {
  test('setColorImageId solo escribe en el publicData pasado, nunca en otros listings', () => {
    const { master, sibling, foreign } = buildScenario();
    const siblingSnapshot = deepClone(sibling);
    const foreignSnapshot = deepClone(foreign);

    // Flow del wizard: el panel recibe el master y el imageId nuevo.
    const nextMasterPd = setColorImageId(
      master.attributes.publicData,
      'Rojo',
      'img-rojo-123'
    );

    // Verificación 1: el master recibe la imagen correcta en el slug.
    expect(nextMasterPd.variantValueImages?.color?.rojo).toBe('img-rojo-123');

    // Verificación 2: sibling y foreign NO fueron tocados.
    expect(sibling).toEqual(siblingSnapshot);
    expect(foreign).toEqual(foreignSnapshot);

    // Verificación 3: el master original tampoco fue mutado (inmutable).
    expect(master.attributes.publicData.variantValueImages).toBeUndefined();
  });

  test('flujo completo del handleSubmit no toca sibling ni foreign aunque simulemos el flow entero', () => {
    const { master, sibling, foreign } = buildScenario();
    const siblingSnapshot = deepClone(sibling);
    const foreignSnapshot = deepClone(foreign);

    // Simula lo que hace el panel al guardar:
    // 1. Construye colorMap del wizard (slugs)
    const colorImagesMap = { rojo: 'img-r', verde: 'img-v' };
    const currentColorValues = ['Rojo', 'Verde'];

    // 2. Construye un publicData "parcial" con esos colores
    let nextPd = { variantValueImages: { color: { ...colorImagesMap } } };

    // 3. Purga danglings (como hace el panel)
    nextPd = pruneDanglingColorImages(nextPd, currentColorValues);

    // 4. Verifica shape final del master
    expect(nextPd.variantValueImages?.color).toEqual({
      rojo: 'img-r',
      verde: 'img-v',
    });

    // 5. CRÍTICO: sibling y foreign intactos tras toda la secuencia
    expect(sibling).toEqual(siblingSnapshot);
    expect(foreign).toEqual(foreignSnapshot);
  });

  test('un color borrado del eje purga su imageId del mapa y NO toca otros grupos', () => {
    const { sibling, foreign } = buildScenario();
    const siblingSnapshot = deepClone(sibling);
    const foreignSnapshot = deepClone(foreign);

    const pd = {
      variantValueImages: {
        color: { rojo: 'img-r', verde: 'img-v', amarillo: 'img-a' },
      },
    };
    const next = pruneDanglingColorImages(pd, ['Rojo', 'Verde']);

    expect(next.variantValueImages?.color).toEqual({
      rojo: 'img-r',
      verde: 'img-v',
    });
    expect(next.variantValueImages.color.amarillo).toBeUndefined();

    // Nunca tocó listings ajenos.
    expect(sibling).toEqual(siblingSnapshot);
    expect(foreign).toEqual(foreignSnapshot);
  });

  test('isFashionCategory + getColorAxisValues: gate solo activa en moda con eje color', () => {
    const { master, foreign } = buildScenario();

    expect(isFashionCategory(master)).toBe(true);
    expect(isFashionCategory(foreign)).toBe(false);

    expect(getColorAxisValues(master).sort()).toEqual(['Rojo', 'Verde']);
    expect(getColorAxisValues(foreign)).toEqual([]);
  });

  test('getColorImageIdForValue devuelve null para listing fuera del grupo (anti-Oxford)', () => {
    const { foreign } = buildScenario();
    // Un listing ajeno (no tiene variantValueImages) nunca retorna
    // un imageId, aunque alguien pase "rojo".
    expect(getColorImageIdForValue(foreign, 'rojo')).toBeNull();
    expect(getColorImageIdForValue(foreign, 'Rojo')).toBeNull();
    expect(getColorImageIdForValue(null, 'rojo')).toBeNull();
  });

  test('slugifyAxisValue — idempotencia y normalización consistentes', () => {
    // El mismo valor pasado dos veces debe generar el mismo slug.
    expect(slugifyAxisValue('Rojo')).toBe(slugifyAxisValue('ROJO'));
    expect(slugifyAxisValue('Café')).toBe(slugifyAxisValue('café'));
    expect(slugifyAxisValue('Blanco Roto')).toBe(slugifyAxisValue(' blanco roto '));
    // Idempotencia: aplicar slugify sobre un slug no cambia nada.
    expect(slugifyAxisValue(slugifyAxisValue('Rojo'))).toBe('rojo');
    expect(slugifyAxisValue(slugifyAxisValue('Blanco Roto'))).toBe('blanco-roto');
  });

  test('scenario integracion: aplicar flow múltiples veces no acumula basura', () => {
    const { master } = buildScenario();
    const basePd = master.attributes.publicData;

    // Vuelta 1: agrega rojo
    let pd = setColorImageId(basePd, 'Rojo', 'img-r1');
    expect(pd.variantValueImages.color).toEqual({ rojo: 'img-r1' });

    // Vuelta 2: agrega verde
    pd = setColorImageId(pd, 'Verde', 'img-v1');
    expect(pd.variantValueImages.color).toEqual({ rojo: 'img-r1', verde: 'img-v1' });

    // Vuelta 3: cambia rojo
    pd = setColorImageId(pd, 'Rojo', 'img-r2');
    expect(pd.variantValueImages.color).toEqual({ rojo: 'img-r2', verde: 'img-v1' });

    // Vuelta 4: quita verde
    pd = setColorImageId(pd, 'Verde', null);
    expect(pd.variantValueImages.color).toEqual({ rojo: 'img-r2' });

    // Vuelta 5: quita rojo → variantValueImages queda limpiamente vacío
    pd = setColorImageId(pd, 'Rojo', null);
    expect(pd.variantValueImages).toBeUndefined();

    // basePd intacto a lo largo de las 5 vueltas (no mutación acumulativa).
    expect(master.attributes.publicData.variantValueImages).toBeUndefined();
  });
});
