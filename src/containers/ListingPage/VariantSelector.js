import React from 'react';
import classNames from 'classnames';

import {
  axisValuesWithStock,
  findSiblingBySelection,
  getVariantAxes,
  getVariantValues,
  hasAnyStock,
} from '../../util/variants';

import css from './VariantSelector.module.css';

// XOLOLO (variantes · PR 3) — Selector de variantes en ListingPage.
//
// Props:
//   - masterListing: el listing master (ya cargado por loadData).
//   - siblings: array de listings hermanos (incluyendo al master).
//   - selection: objeto { axis: value, ... } con la elección actual.
//   - onChange(newSelection): callback al cambiar un valor.
//   - axisLabel(key): función opcional para rotular el eje (fallback a key).
//
// El componente es puramente presentacional. Deja que el padre maneje
// el estado y resuelva el sibling activo con findSiblingBySelection.
//
// Pills por eje: cada valor del catálogo que el grupo ofrece se pinta
// como pill. Si TODAS las variantes con ese valor están sin stock, se
// desactiva (visual + aria-disabled) y no se puede elegir.
//
// Si el eje 2 depende del valor del eje 1, se re-filtra en caliente al
// cambiar el 1 (p.ej. elegir Talla M pero color rojo no existe para M,
// el pill rojo queda disabled).

const defaultAxisLabel = key => {
  if (!key) return '';
  // Capitalize first letter, replace underscores with spaces.
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const VariantSelector = props => {
  const { masterListing, siblings, selection, onChange, axisLabel = defaultAxisLabel } = props;

  if (!masterListing) return null;
  const axes = getVariantAxes(masterListing);
  if (axes.length === 0 || !Array.isArray(siblings) || siblings.length === 0) {
    return null;
  }

  // ¿Todo el grupo está sin stock?
  const anyStock = hasAnyStock(siblings);

  // Para el eje N: TODOS los valores que el grupo ofrece para ese eje
  // (no solo los compatibles con la selección actual). Los que no
  // combinan con la selección de ejes ANTERIORES se marcan stock=0
  // para quedar visualmente "agotados" (disabled, tachados) en vez de
  // desaparecer. Así el buyer ve todas las opciones y entiende que
  // debe cambiar la talla para llegar a otro color.
  const valuesForAxis = axisIndex => {
    const axis = axes[axisIndex];
    // Elecciones ANTERIORES al eje actual.
    const partialSelection = {};
    for (let i = 0; i < axisIndex; i++) {
      const prevAxis = axes[i];
      if (selection[prevAxis] != null) {
        partialSelection[prevAxis] = selection[prevAxis];
      }
    }
    // Todos los valores que ofrece el grupo para este eje (sin filtrar).
    const allValues = axisValuesWithStock(siblings, axis);
    // Para cada valor, re-calcular su stock SOLO entre siblings que
    // cumplen la selección previa. Si cero, queda disabled.
    return allValues.map(({ value }) => {
      const compat = siblings.filter(l => {
        const vv = getVariantValues(l);
        if (vv[axis] !== value) return false;
        return Object.entries(partialSelection).every(([k, v]) => vv[k] === v);
      });
      const compatWithStock = axisValuesWithStock(compat, axis).find(
        x => x.value === value
      );
      return {
        value,
        stock: compatWithStock ? compatWithStock.stock : 0,
        siblingCount: compat.length,
      };
    });
  };

  const handlePillClick = (axis, value) => {
    const next = { ...selection, [axis]: value };
    // Si cambió un eje anterior, limpia los ejes posteriores porque
    // la combinación podría ya no existir (el padre revalidará).
    const axisIndex = axes.indexOf(axis);
    for (let i = axisIndex + 1; i < axes.length; i++) {
      delete next[axes[i]];
    }
    onChange(next);
  };

  const activeSibling = findSiblingBySelection(siblings, selection);

  return (
    <div className={css.root}>
      {axes.map((axis, i) => {
        const values = valuesForAxis(i);
        const current = selection[axis];
        return (
          <div key={axis} className={css.axisBlock}>
            <div className={css.axisLabel}>
              <span>{axisLabel(axis)}</span>
              {current ? <span className={css.axisValue}>{current}</span> : null}
            </div>
            <div className={css.pills} role="radiogroup" aria-label={axisLabel(axis)}>
              {values.map(({ value, stock }) => {
                const isActive = current === value;
                const isOut = stock === 0;
                const className = classNames({
                  [css.pill]: !isActive && !isOut,
                  [css.pillActive]: isActive,
                  [css.pillOut]: isOut && !isActive,
                });
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-disabled={isOut || undefined}
                    disabled={isOut}
                    className={className}
                    onClick={() => !isOut && handlePillClick(axis, value)}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {!anyStock ? (
        <p className={css.allOutNote}>
          Todas las variantes están agotadas por ahora.
        </p>
      ) : activeSibling == null ? (
        <p className={css.allOutNote}>
          Esa combinación no está disponible. Prueba otra.
        </p>
      ) : null}
    </div>
  );
};

export default VariantSelector;
