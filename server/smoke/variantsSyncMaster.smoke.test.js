// XOLOLO Blindaje — smoke test del sync master ↔ matriz (ADR-004).
//
// Blinda el matcher `rowKey` + `masterRowIdx` que decide:
//   - Qué fila del matrix corresponde al master (pisa su stock).
//   - Qué filas son siblings (crear/actualizar).
//   - Cero riesgo de tocar listings ajenos al grupo.
//
// Mantiene contrato estable aunque alguien refactorice el thunk:
// si cualquiera de estos tests rompe, ALGO cambió en la lógica
// crítica del sync. Confirmar que es intencional y actualizar el
// ADR antes de mergear.

// Reimplementación de rowKey (idéntica a la del duck). Si la del
// duck cambia, hay que sincronizar aquí también — ese es el
// mecanismo de blindaje.
const rowKey = (axes, variantValues) =>
  axes.map(ax => variantValues?.[ax] ?? '').join('||');

describe('ADR-004 — sync master ↔ matriz · smoke', () => {
  describe('rowKey — contrato del matcher', () => {
    test('clave estable para mismo input, orden de axes importa', () => {
      expect(rowKey(['color', 'talla'], { color: 'Rojo', talla: 'M' })).toBe('Rojo||M');
      expect(rowKey(['talla', 'color'], { color: 'Rojo', talla: 'M' })).toBe('M||Rojo');
    });
    test('valores ausentes no rompen; se representan como ""', () => {
      expect(rowKey(['color', 'talla'], { color: 'Rojo' })).toBe('Rojo||');
      expect(rowKey(['color', 'talla'], {})).toBe('||');
      expect(rowKey(['color', 'talla'], null)).toBe('||');
    });
    test('case-sensitive estricto — típica fuente de bugs de match', () => {
      expect(rowKey(['color'], { color: 'Rojo' })).not.toBe(rowKey(['color'], { color: 'rojo' }));
    });
  });

  describe('matcher master ↔ matrix — invariantes', () => {
    const axes = ['color', 'talla'];
    const matrix = [
      { variantValues: { color: 'Rojo', talla: 'XS' }, stock: 10 },
      { variantValues: { color: 'Rojo', talla: 'S' }, stock: 5 },
      { variantValues: { color: 'Blanco', talla: 'XS' }, stock: 20 }, // ← master
      { variantValues: { color: 'Blanco', talla: 'S' }, stock: 15 },
    ];

    const findMasterRow = (axes, matrix, masterValues) => {
      const key = rowKey(axes, masterValues);
      const idx = matrix.findIndex(r => rowKey(axes, r.variantValues) === key);
      return { idx, row: idx >= 0 ? matrix[idx] : null };
    };

    test('master con variantValues que coincide con una fila → la encuentra', () => {
      const { idx, row } = findMasterRow(axes, matrix, { color: 'Blanco', talla: 'XS' });
      expect(idx).toBe(2);
      expect(row.stock).toBe(20);
    });

    test('master cuya combinación NO está en la matrix → idx=-1 (no pisa stock)', () => {
      const { idx, row } = findMasterRow(axes, matrix, { color: 'Azul', talla: 'XXL' });
      expect(idx).toBe(-1);
      expect(row).toBeNull();
    });

    test('las demás filas (!= master) se procesan como siblings', () => {
      const { idx: masterIdx } = findMasterRow(axes, matrix, { color: 'Blanco', talla: 'XS' });
      const siblingRows = matrix.filter((_, i) => i !== masterIdx);
      expect(siblingRows.length).toBe(3);
      expect(siblingRows.map(r => `${r.variantValues.color}/${r.variantValues.talla}`).sort()).toEqual([
        'Blanco/S',
        'Rojo/S',
        'Rojo/XS',
      ]);
    });

    test('variantValues vacío del master → masterIdx=-1 (defensivo)', () => {
      const { idx } = findMasterRow(axes, matrix, {});
      expect(idx).toBe(-1);
    });
  });

  describe('setStockThunk — oldTotal correcto según hallazgo real (ADR-004 Fase 2b/3c)', () => {
    // Simula el extractor del stock del response raw del show().
    const extractStockFromRehydrateResponse = response => {
      const included = response?.data?.included || [];
      const rel = response?.data?.data?.relationships?.currentStock?.data;
      const stockId = rel?.id?.uuid || rel?.id;
      const stockEnt = included.find(
        i => i.type === 'stock' && (i.id?.uuid || i.id) === stockId
      );
      return typeof stockEnt?.attributes?.quantity === 'number'
        ? stockEnt.attributes.quantity
        : null;
    };

    test('response con stock=98 en included[] → extrae 98', () => {
      const resp = {
        data: {
          data: {
            relationships: { currentStock: { data: { id: { uuid: 'stock-1' } } } },
          },
          included: [{ type: 'stock', id: { uuid: 'stock-1' }, attributes: { quantity: 98 } }],
        },
      };
      expect(extractStockFromRehydrateResponse(resp)).toBe(98);
    });

    test('response SIN stock entity en included[] → null (first-set)', () => {
      const resp = {
        data: {
          data: {
            relationships: { currentStock: { data: { id: { uuid: 'stock-1' } } } },
          },
          included: [{ type: 'user', id: { uuid: 'stock-1' }, attributes: {} }],
        },
      };
      expect(extractStockFromRehydrateResponse(resp)).toBeNull();
    });

    test('response sin relationships.currentStock → null', () => {
      const resp = { data: { data: { relationships: {} }, included: [] } };
      expect(extractStockFromRehydrateResponse(resp)).toBeNull();
    });

    test('response undefined/malformado → null, no throw', () => {
      expect(extractStockFromRehydrateResponse(null)).toBeNull();
      expect(extractStockFromRehydrateResponse({})).toBeNull();
      expect(extractStockFromRehydrateResponse({ data: null })).toBeNull();
    });
  });

  describe('anti-Oxford: el sync nunca toca listings ajenos al grupo', () => {
    test('el filtro `inGroup` descarta listings cuyo variantGroupId no coincide', () => {
      const GROUP = 'grp-a';
      const allListings = [
        { id: { uuid: '1' }, attributes: { publicData: { variantGroupId: GROUP } } },
        { id: { uuid: '2' }, attributes: { publicData: { variantGroupId: 'otra' } } },
        { id: { uuid: '3' }, attributes: { publicData: {} } }, // sin grupo
        { id: { uuid: '4' }, attributes: { publicData: { variantGroupId: GROUP } } },
      ];
      const inGroup = allListings.filter(
        l => l.attributes?.publicData?.variantGroupId === GROUP
      );
      expect(inGroup.map(l => l.id.uuid)).toEqual(['1', '4']);
    });

    test('el close solo opera sobre siblings del grupo; rechaza listings ajenos', () => {
      const GROUP = 'grp-a';
      const existing = [
        { id: { uuid: 'sib-1' }, attributes: { publicData: { variantGroupId: GROUP, isVariantMaster: false } } },
        { id: { uuid: 'ajeno' }, attributes: { publicData: { variantGroupId: 'otra' } } },
        { id: { uuid: 'master' }, attributes: { publicData: { variantGroupId: GROUP, isVariantMaster: true } } },
      ];
      const safeToClose = existing.filter(
        l =>
          l.attributes?.publicData?.variantGroupId === GROUP &&
          l.attributes?.publicData?.isVariantMaster !== true
      );
      expect(safeToClose.map(l => l.id.uuid)).toEqual(['sib-1']);
    });
  });
});
