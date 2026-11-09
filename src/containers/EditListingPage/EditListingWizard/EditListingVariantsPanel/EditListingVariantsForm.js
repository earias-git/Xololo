import React, { useMemo, useState } from 'react';

import { Button } from '../../../../components';
import { MAX_VARIANT_AXES } from '../../../../util/variants';

import css from './EditListingVariantsPanel.module.css';

// XOLOLO (Variantes · PR 2) — Form del tab de SKU variantes.
//
// Lee los atributos tipo 'select' de la subcategoría del listing y
// ofrece hasta MAX_VARIANT_AXES ejes (típicamente talla y color).
//
// Flujo:
//   1. Toggle "¿Tiene variantes?" controla visibilidad del resto.
//   2. Dos dropdowns opcionales: eje 1, eje 2. Las opciones son los
//      atributos `type: 'select'` de la (sub)categoría — con color/talla
//      priorizados por hint visual.
//   3. Para cada eje activo, un conjunto de checkboxes con sus opciones
//      posibles (del catálogo). El seller marca cuáles quiere ofrecer.
//   4. Se auto-genera la matriz cartesiana de variantes con inputs de
//      stock (requerido) y precio opcional (default = precio del master).
//   5. Submit → onSubmit({ enabled, axes, rows }) donde rows es
//      [{ variantValues, stock, priceOverride }].
//
// No usa React Final Form porque la matriz dinámica es más clara con
// useState. El resto del wizard sí usa FinalForm; este panel comparte
// la prop `onSubmit` para encajar en el flow estándar.

const cartesian = (arrA, arrB) => {
  if (!arrB || arrB.length === 0) return arrA.map(a => [a]);
  const out = [];
  for (const a of arrA) for (const b of arrB) out.push([a, b]);
  return out;
};

// Ejes disponibles: atributos tipo 'select' de la subcategoría.
const pickEligibleAxes = selectAttrs => selectAttrs;

const EditListingVariantsForm = props => {
  const {
    initialValues,
    selectAttrs,
    onSubmit,
    submitButtonText,
    disabled,
    ready,
    updated,
    updateInProgress,
    fetchErrors,
  } = props;

  const { createListingDraftError, updateListingError } = fetchErrors || {};

  const eligibleAxes = useMemo(() => pickEligibleAxes(selectAttrs || []), [selectAttrs]);

  // ---- State ----
  const [enabled, setEnabled] = useState(!!initialValues.enabled);
  const [axis1, setAxis1] = useState(initialValues.axes?.[0] || '');
  const [axis2, setAxis2] = useState(initialValues.axes?.[1] || '');

  // Valores seleccionados por eje (subconjunto de las opciones del catálogo).
  const [valuesByAxis, setValuesByAxis] = useState(initialValues.valuesByAxis || {});

  // Stock y precio por combinación (clave = "val1||val2").
  const [rowData, setRowData] = useState(initialValues.rowData || {});

  const toggleValue = (axis, value) => {
    setValuesByAxis(prev => {
      const current = prev[axis] || [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      return { ...prev, [axis]: next };
    });
  };

  const axesActive = [axis1, axis2].filter(Boolean).slice(0, MAX_VARIANT_AXES);

  // Opciones disponibles de cada eje (del catálogo).
  const optionsOfAxis = axisKey => {
    if (!axisKey) return [];
    const attr = eligibleAxes.find(a => a.key === axisKey);
    return attr?.options || [];
  };

  // Matriz de variantes (cartesiano de valores marcados).
  const matrix = useMemo(() => {
    if (!enabled || axesActive.length === 0) return [];
    const vals1 = (valuesByAxis[axesActive[0]] || []).filter(Boolean);
    const vals2 =
      axesActive.length > 1 ? (valuesByAxis[axesActive[1]] || []).filter(Boolean) : null;
    if (vals1.length === 0) return [];
    if (vals2 && vals2.length === 0) return [];
    return cartesian(vals1, vals2);
  }, [enabled, axesActive, valuesByAxis]);

  const rowKey = combo => combo.join('||');

  const setRowField = (combo, field, val) => {
    const k = rowKey(combo);
    setRowData(prev => ({ ...prev, [k]: { ...(prev[k] || {}), [field]: val } }));
  };

  const hasRows = matrix.length > 0;

  // ---- Validación ----
  const errors = [];
  if (enabled) {
    if (axesActive.length === 0) errors.push('Elige al menos un eje de variación.');
    axesActive.forEach(ax => {
      if ((valuesByAxis[ax] || []).length === 0) {
        errors.push(`Marca al menos un valor de "${ax}".`);
      }
    });
    if (hasRows) {
      for (const combo of matrix) {
        const r = rowData[rowKey(combo)] || {};
        const s = r.stock;
        if (s === '' || s === undefined || s === null || Number(s) < 0) {
          errors.push('Todas las variantes necesitan stock (≥ 0).');
          break;
        }
      }
    }
  }
  const isValid = errors.length === 0;

  const handleSubmit = e => {
    e?.preventDefault?.();
    if (!isValid) return;
    if (!enabled) {
      onSubmit({ enabled: false });
      return;
    }
    const rows = matrix.map(combo => {
      const vv = {};
      axesActive.forEach((ax, i) => (vv[ax] = combo[i]));
      const r = rowData[rowKey(combo)] || {};
      return {
        variantValues: vv,
        stock: Number(r.stock) || 0,
        priceOverride:
          r.price === '' || r.price === undefined || r.price === null
            ? null
            : Number(r.price),
      };
    });
    onSubmit({ enabled: true, axes: axesActive, rows });
  };

  // ---- Render helpers ----
  const renderAxisBlock = (axisKey, label) => {
    if (!axisKey) return null;
    const opts = optionsOfAxis(axisKey);
    const selected = valuesByAxis[axisKey] || [];
    return (
      <div className={css.axisBlock}>
        <div className={css.axisLabel}>{label}: valores a ofrecer</div>
        <div className={css.multiselectRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {opts.length === 0 ? (
            <div className={css.axisHint}>
              Este atributo no tiene opciones predefinidas en el catálogo.
            </div>
          ) : (
            opts.map(opt => (
              <label
                key={opt}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  border: '1px solid var(--colorGrey200)',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontSize: 13,
                  background: selected.includes(opt) ? '#eef2ff' : '#fff',
                  color: selected.includes(opt) ? '#1e3a8a' : 'inherit',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggleValue(axisKey, opt)}
                />
                {opt}
              </label>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderMatrixTable = () => {
    if (!hasRows) return null;
    const twoAxes = axesActive.length > 1;
    return (
      <div className={css.gridWrap}>
        <table className={css.grid}>
          <thead>
            <tr>
              <th>{axesActive[0]}</th>
              {twoAxes ? <th>{axesActive[1]}</th> : null}
              <th>Stock</th>
              <th>Precio (opcional)</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map(combo => {
              const k = rowKey(combo);
              const r = rowData[k] || {};
              return (
                <tr key={k}>
                  <td className={css.rowLabel}>{combo[0]}</td>
                  {twoAxes ? <td className={css.rowLabel}>{combo[1]}</td> : null}
                  <td>
                    <input
                      className={css.stockInput}
                      type="number"
                      min="0"
                      step="1"
                      value={r.stock ?? ''}
                      onChange={e => setRowField(combo, 'stock', e.target.value)}
                      aria-label={`Stock de ${combo.join(' · ')}`}
                    />
                  </td>
                  <td>
                    <input
                      className={css.priceInput}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="hereda"
                      value={r.price ?? ''}
                      onChange={e => setRowField(combo, 'price', e.target.value)}
                      aria-label={`Precio de ${combo.join(' · ')}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const noEligibleAxes = eligibleAxes.length === 0;
  const submitDisabled =
    disabled || updateInProgress || (enabled && !isValid);
  const submitReady = updated && ready;

  return (
    <form className={css.form} onSubmit={handleSubmit}>
      <div className={css.toggleRow}>
        <input
          id="variants-toggle"
          type="checkbox"
          checked={enabled}
          disabled={noEligibleAxes}
          onChange={e => setEnabled(e.target.checked)}
        />
        <label htmlFor="variants-toggle" className={css.toggleLabel}>
          <span className={css.toggleTitle}>Este producto tiene variantes</span>
          <span className={css.toggleHint}>
            Activa esto si vendes el mismo producto en diferentes tallas, colores u otras
            opciones. Se creará un listing por combinación y Sharetribe manejará el stock de
            cada una por separado.
          </span>
        </label>
      </div>

      {noEligibleAxes ? (
        <div className={css.noAxesWarning}>
          La subcategoría de este producto no tiene atributos de tipo opción (talla, color,
          etc.). Regresa al paso de Atributos y elige una subcategoría con opciones, o
          contacta a soporte para extender el catálogo.
        </div>
      ) : enabled ? (
        <div className={css.axesSection}>
          <div className={css.axisBlock}>
            <div className={css.axisLabel}>Eje 1 (obligatorio)</div>
            <select
              value={axis1}
              onChange={e => setAxis1(e.target.value)}
              className={css.stockInput}
              style={{ width: '100%', maxWidth: 240 }}
            >
              <option value="">Elige un eje…</option>
              {eligibleAxes
                .filter(a => a.key !== axis2)
                .map(a => (
                  <option key={a.key} value={a.key}>
                    {a.label || a.key}
                  </option>
                ))}
            </select>
          </div>

          {axis1 && eligibleAxes.length > 1 ? (
            <div className={css.axisBlock}>
              <div className={css.axisLabel}>Eje 2 (opcional)</div>
              <select
                value={axis2}
                onChange={e => setAxis2(e.target.value)}
                className={css.stockInput}
                style={{ width: '100%', maxWidth: 240 }}
              >
                <option value="">Solo un eje</option>
                {eligibleAxes
                  .filter(a => a.key !== axis1)
                  .map(a => (
                    <option key={a.key} value={a.key}>
                      {a.label || a.key}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          {renderAxisBlock(axis1, eligibleAxes.find(a => a.key === axis1)?.label || axis1)}
          {renderAxisBlock(axis2, eligibleAxes.find(a => a.key === axis2)?.label || axis2)}

          {hasRows ? (
            <div className={css.summary}>
              Se publicarán <strong>{matrix.length}</strong> variantes. La primera fila
              queda como listing principal; las demás se crean como listings hermanos
              con stock propio. Si quitas una variante, su listing se cierra (no se
              borra; puedes reabrirlo).
            </div>
          ) : null}

          {renderMatrixTable()}

          {errors.map((e, i) => (
            <div key={i} className={css.warning}>
              {e}
            </div>
          ))}
        </div>
      ) : null}

      {createListingDraftError ? (
        <div className={css.error}>No pudimos crear el draft. Intenta de nuevo.</div>
      ) : null}
      {updateListingError ? (
        <div className={css.error}>No pudimos guardar las variantes. Intenta de nuevo.</div>
      ) : null}

      <div className={css.submitBtnWrap}>
        <Button
          type="submit"
          disabled={submitDisabled}
          inProgress={updateInProgress}
          ready={submitReady}
        >
          {submitButtonText}
        </Button>
      </div>
    </form>
  );
};

export default EditListingVariantsForm;
