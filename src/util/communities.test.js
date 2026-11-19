/**
 * XOLOLO 2026-11-18 — Tests de helpers de Comunidades (ADR-006).
 */

const {
  COMMUNITY_TYPES,
  TYPE_TO_ROUTE_PREFIX,
  isValidCommunityId,
  isValidCommunityType,
  getCommunityRoute,
  parseCommunityRoute,
  getCommunitiesForType,
  isSellerInCommunity,
  listAllMemberships,
  addCommunityMembership,
  removeCommunityMembership,
  getListingCommunityMirror,
  metadataKey,
} = require('./communities');

describe('isValidCommunityId', () => {
  test.each([
    ['opf', true],
    ['alimentos-organicos', true],
    ['morelos', true],
    ['san-miguel-de-allende', true],
    ['abc', true],
    ['abc123', true],
    // Inválidos
    ['', false],
    ['ab', false], // muy corto
    ['a'.repeat(31), false], // muy largo
    ['OPF', false], // mayúscula
    ['opf_test', false], // underscore
    ['opf test', false], // espacio
    ['-opf', false], // empieza con guion
    ['opf-', false], // termina con guion
    ['op--f', false], // doble guion
    [null, false],
    [undefined, false],
    [123, false],
    [{}, false],
  ])('isValidCommunityId(%p) === %p', (id, expected) => {
    expect(isValidCommunityId(id)).toBe(expected);
  });
});

describe('isValidCommunityType', () => {
  test('acepta los 3 tipos', () => {
    COMMUNITY_TYPES.forEach(t => expect(isValidCommunityType(t)).toBe(true));
  });
  test('rechaza otros', () => {
    expect(isValidCommunityType('otro')).toBe(false);
    expect(isValidCommunityType('')).toBe(false);
    expect(isValidCommunityType(null)).toBe(false);
  });
});

describe('getCommunityRoute', () => {
  test('sectorial → /comunidad/:slug', () => {
    expect(getCommunityRoute({ type: 'sectorial', slug: 'opf' })).toBe('/comunidad/opf');
  });
  test('geografica → /region/:slug', () => {
    expect(getCommunityRoute({ type: 'geografica', slug: 'morelos' })).toBe('/region/morelos');
  });
  test('modelo → /programa/:slug', () => {
    expect(getCommunityRoute({ type: 'modelo', slug: 'productor-directo' })).toBe(
      '/programa/productor-directo'
    );
  });
  test('null-safe', () => {
    expect(getCommunityRoute(null)).toBeNull();
    expect(getCommunityRoute({})).toBeNull();
    expect(getCommunityRoute({ type: 'x', slug: 'y' })).toBeNull();
  });
});

describe('parseCommunityRoute', () => {
  test.each([
    ['/comunidad/opf', { type: 'sectorial', slug: 'opf' }],
    ['/region/morelos', { type: 'geografica', slug: 'morelos' }],
    ['/programa/productor-directo', { type: 'modelo', slug: 'productor-directo' }],
    ['/comunidad/opf/', { type: 'sectorial', slug: 'opf' }], // trailing slash
    // No-match
    ['/l/foo/bar', null],
    ['/comunidad/', null],
    ['/comunidad/OPF', null], // mayúscula
    ['/comunidades/opf', null], // prefijo inválido
    ['', null],
    ['/comunidad/opf/extra', null], // segmentos extra
  ])('parseCommunityRoute(%p)', (path, expected) => {
    expect(parseCommunityRoute(path)).toEqual(expected);
  });
});

describe('getCommunitiesForType', () => {
  const profile = {
    publicData: {
      communities: {
        sectorial: ['opf', 'alimentos-organicos'],
        modelo: ['productor-directo'],
        geografica: [],
      },
    },
  };
  test('devuelve el array del type', () => {
    expect(getCommunitiesForType(profile, 'sectorial')).toEqual(['opf', 'alimentos-organicos']);
    expect(getCommunitiesForType(profile, 'modelo')).toEqual(['productor-directo']);
    expect(getCommunitiesForType(profile, 'geografica')).toEqual([]);
  });
  test('vacío cuando no hay publicData.communities', () => {
    expect(getCommunitiesForType({}, 'sectorial')).toEqual([]);
    expect(getCommunitiesForType({ publicData: {} }, 'sectorial')).toEqual([]);
  });
  test('vacío con type inválido', () => {
    expect(getCommunitiesForType(profile, 'otro')).toEqual([]);
  });
  test('filtra valores falsy', () => {
    const corrupted = {
      publicData: { communities: { sectorial: ['opf', null, '', undefined, 'otra'] } },
    };
    expect(getCommunitiesForType(corrupted, 'sectorial')).toEqual(['opf', 'otra']);
  });
});

describe('isSellerInCommunity', () => {
  const profile = {
    publicData: { communities: { sectorial: ['opf'] } },
  };
  test('true cuando pertenece', () => {
    expect(isSellerInCommunity(profile, { id: 'opf', type: 'sectorial' })).toBe(true);
  });
  test('false cuando no pertenece', () => {
    expect(isSellerInCommunity(profile, { id: 'otra', type: 'sectorial' })).toBe(false);
  });
  test('false con type distinto (opf solo está en sectorial)', () => {
    expect(isSellerInCommunity(profile, { id: 'opf', type: 'modelo' })).toBe(false);
  });
  test('null-safe', () => {
    expect(isSellerInCommunity(null, { id: 'opf', type: 'sectorial' })).toBe(false);
    expect(isSellerInCommunity(profile, null)).toBe(false);
  });
});

describe('listAllMemberships', () => {
  test('aplana los 3 arrays', () => {
    const profile = {
      publicData: {
        communities: {
          sectorial: ['opf'],
          modelo: ['productor-directo'],
          geografica: ['morelos', 'cuernavaca'],
        },
      },
    };
    expect(listAllMemberships(profile)).toEqual([
      { id: 'opf', type: 'sectorial' },
      { id: 'productor-directo', type: 'modelo' },
      { id: 'morelos', type: 'geografica' },
      { id: 'cuernavaca', type: 'geografica' },
    ]);
  });
  test('vacío para profile sin communities', () => {
    expect(listAllMemberships({})).toEqual([]);
    expect(listAllMemberships(null)).toEqual([]);
  });
});

describe('addCommunityMembership', () => {
  test('agrega a array nuevo', () => {
    const out = addCommunityMembership({}, { id: 'opf', type: 'sectorial' });
    expect(out).toEqual({ sectorial: ['opf'] });
  });
  test('agrega a array existente', () => {
    const out = addCommunityMembership(
      { communities: { sectorial: ['x'] } },
      { id: 'opf', type: 'sectorial' }
    );
    expect(out).toEqual({ sectorial: ['x', 'opf'] });
  });
  test('idempotente (no duplica)', () => {
    const out = addCommunityMembership(
      { communities: { sectorial: ['opf'] } },
      { id: 'opf', type: 'sectorial' }
    );
    expect(out.sectorial).toEqual(['opf']);
  });
  test('no mezcla con otros types', () => {
    const out = addCommunityMembership(
      { communities: { modelo: ['a'] } },
      { id: 'opf', type: 'sectorial' }
    );
    expect(out).toEqual({ modelo: ['a'], sectorial: ['opf'] });
  });
  test('lanza con community inválida', () => {
    expect(() => addCommunityMembership({}, { id: 'opf', type: 'x' })).toThrow('invalid_community');
    expect(() => addCommunityMembership({}, {})).toThrow('invalid_community');
  });
});

describe('removeCommunityMembership', () => {
  test('quita del array', () => {
    const out = removeCommunityMembership(
      { communities: { sectorial: ['x', 'opf', 'y'] } },
      { id: 'opf', type: 'sectorial' }
    );
    expect(out.sectorial).toEqual(['x', 'y']);
  });
  test('no-op si no pertenece', () => {
    const out = removeCommunityMembership(
      { communities: { sectorial: ['x'] } },
      { id: 'opf', type: 'sectorial' }
    );
    expect(out.sectorial).toEqual(['x']);
  });
  test('no toca otros types', () => {
    const out = removeCommunityMembership(
      { communities: { sectorial: ['opf'], modelo: ['a'] } },
      { id: 'opf', type: 'sectorial' }
    );
    expect(out).toEqual({ sectorial: [], modelo: ['a'] });
  });
  test('lanza con community inválida', () => {
    expect(() => removeCommunityMembership({}, { id: 'opf', type: 'x' })).toThrow(
      'invalid_community'
    );
  });
});

describe('getListingCommunityMirror', () => {
  test('aplana todos los types en un array único', () => {
    const profile = {
      publicData: {
        communities: {
          sectorial: ['opf', 'alimentos-organicos'],
          modelo: ['productor-directo'],
          geografica: ['morelos'],
        },
      },
    };
    const mirror = getListingCommunityMirror(profile);
    expect(mirror.sort()).toEqual(
      ['opf', 'alimentos-organicos', 'productor-directo', 'morelos'].sort()
    );
  });
  test('vacío para profile sin communities', () => {
    expect(getListingCommunityMirror({})).toEqual([]);
    expect(getListingCommunityMirror(null)).toEqual([]);
  });
  test('filtra ids inválidos (p.ej. corrupción de data)', () => {
    const profile = {
      publicData: {
        communities: { sectorial: ['opf', 'BAD_ID', 'otra'] },
      },
    };
    expect(getListingCommunityMirror(profile).sort()).toEqual(['opf', 'otra'].sort());
  });
  test('dedupe (no esperado pero defensivo)', () => {
    const profile = {
      publicData: {
        communities: { sectorial: ['opf', 'opf'] },
      },
    };
    expect(getListingCommunityMirror(profile)).toEqual(['opf']);
  });
});

describe('metadataKey', () => {
  test('forma correcta', () => {
    expect(metadataKey('opf')).toBe('community:opf');
  });
});

describe('route prefix map', () => {
  test('cobertura total de los 3 types', () => {
    COMMUNITY_TYPES.forEach(t => {
      expect(TYPE_TO_ROUTE_PREFIX[t]).toBeDefined();
    });
  });
  test('sin colisión de prefijos', () => {
    const prefixes = Object.values(TYPE_TO_ROUTE_PREFIX);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

// ===== Smoke anti-regresión (ADR-006 §7 LOCKED) =====
describe('LOCKED: propiedades de inmutabilidad', () => {
  test('addCommunityMembership NO muta el input', () => {
    const input = { communities: { sectorial: ['x'] } };
    const inputCopy = JSON.parse(JSON.stringify(input));
    addCommunityMembership(input, { id: 'opf', type: 'sectorial' });
    expect(input).toEqual(inputCopy);
  });
  test('removeCommunityMembership NO muta el input', () => {
    const input = { communities: { sectorial: ['opf', 'x'] } };
    const inputCopy = JSON.parse(JSON.stringify(input));
    removeCommunityMembership(input, { id: 'opf', type: 'sectorial' });
    expect(input).toEqual(inputCopy);
  });
  test('getListingCommunityMirror es idempotente y puro', () => {
    const profile = {
      publicData: { communities: { sectorial: ['opf'] } },
    };
    const a = getListingCommunityMirror(profile);
    const b = getListingCommunityMirror(profile);
    expect(a).toEqual(b);
    // El output puede mutarse sin afectar al input
    a.push('fake');
    expect(getListingCommunityMirror(profile)).toEqual(['opf']);
  });
});
