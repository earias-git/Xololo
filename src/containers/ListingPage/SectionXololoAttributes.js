import React from 'react';

import {
  getAttributesForListing,
  CATEGORY_TREE,
} from '../../config/listingAttributes';

import css from './SectionXololoAttributes.module.css';

// XOLOLO (2026-11-10) — Muestra los atributos locales del listing
// (publicData.attributes) con su label desde el catálogo. Complementa
// a CustomListingFields, que solo renderiza los campos de Console.
//
// Caso de uso: el seller puso talla=M, color=Blanco, material=Mezcla,
// genero=Hombre, temporada=Otoño-invierno en el wizard. El ListingPage
// debe mostrárselos al buyer para que entienda qué está comprando sin
// adivinar desde el título.
//
// Para arrays (multiselect), se pintan como chips. Para dimensiones,
// se muestra "h × w × d cm". Resto, texto plano.
//
// Si publicData.attributes está vacío → el componente no renderiza nada
// (no agrega ruido visual al page).

const findCategoryLevel1 = publicData => {
  if (!publicData) return null;
  if (publicData.categoryLevel1) return publicData.categoryLevel1;
  for (const key of Object.keys(publicData)) {
    if (/^categoryLevel\d+$/.test(key) && publicData[key]) return publicData[key];
  }
  return null;
};

const formatValue = (value, def) => {
  if (value == null || value === '') return null;

  if (def?.type === 'dimensions' || (typeof value === 'object' && !Array.isArray(value) && ('h' in value || 'w' in value || 'd' in value))) {
    const h = value.h;
    const w = value.w;
    const d = value.d;
    const unit = value.unit || def?.unit || 'cm';
    const parts = [h, w, d].filter(n => n != null && n !== '').join(' × ');
    return parts ? (
      <span className={css.dims}>
        {parts}
        <span className={css.unit}>{unit}</span>
      </span>
    ) : null;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return (
      <div className={css.chipList}>
        {value.map(v => (
          <span key={String(v)} className={css.chip}>
            {String(v)}
          </span>
        ))}
      </div>
    );
  }

  if (def?.type === 'boolean') {
    return value === true || value === 'true' ? 'Sí' : 'No';
  }

  if (def?.type === 'number' && def?.unit) {
    return (
      <span className={css.dims}>
        {value}
        <span className={css.unit}>{def.unit}</span>
      </span>
    );
  }

  return String(value);
};

const SectionXololoAttributes = props => {
  const { publicData } = props;
  const attributes = publicData?.attributes;
  if (!attributes || typeof attributes !== 'object') return null;

  const categoryId = findCategoryLevel1(publicData);
  const subcategoryId = publicData?.subcategory || null;
  const isEvent = publicData?.isEvent === true;
  const schema = getAttributesForListing(categoryId, subcategoryId, isEvent) || {};

  // Enumera los atributos que SÍ tienen valor, en el orden del schema.
  const rows = [];
  // Primero los del schema (orden definido).
  for (const [key, def] of Object.entries(schema)) {
    if (!(key in attributes)) continue;
    const value = attributes[key];
    const rendered = formatValue(value, def);
    if (rendered == null) continue;
    rows.push({ key, label: def.label || key, value: rendered });
  }
  // Después, cualquier atributo que esté en publicData pero no en el
  // schema (legacy / catálogo cambió). Sin label bonito pero rendido.
  for (const [key, value] of Object.entries(attributes)) {
    if (key in schema) continue;
    const rendered = formatValue(value, null);
    if (rendered == null) continue;
    rows.push({ key, label: key.replace(/_/g, ' '), value: rendered });
  }

  if (rows.length === 0) return null;

  return (
    <section className={css.root}>
      <h3 className={css.title}>Características</h3>
      <div className={css.grid}>
        {rows.map(r => (
          <div key={r.key} className={css.row}>
            <span className={css.label}>{r.label}</span>
            <span className={css.value}>{r.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default SectionXololoAttributes;
