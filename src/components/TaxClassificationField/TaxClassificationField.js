import React from 'react';

import { FieldCheckbox, FieldSelect } from '../index';
import {
  CLASSIFICATION_GROUPS,
  getClassificationByCode,
} from '../../util/xololoTaxClassification';

import css from './TaxClassificationField.module.css';

// XOLOLO: campo de clasificación fiscal especial para el form de Pricing.
//
// COHERENCIA condition ↔ clasificación fiscal:
//   - condition === 'used': el componente NO renderiza el checkbox manual;
//     Art. 9 IV se auto-aplica desde xololoSellerMode.resolveUsedGoodsOverride
//     cuando también personType='individual'. Muestra una nota informativa
//     con el manifiesto bajo protesta.
//   - condition === 'new': se renderiza el checkbox + dropdown normal, pero
//     el catálogo filtra las clasificaciones con `requiresUsed: true` (hoy
//     sólo Art. 9 IV) porque son incompatibles con producto nuevo.
//
// Datos persistidos (al submit del form):
//   publicData.taxClassification = {
//     code: 'exento_9_iv' | 'tasa_cero_...' | ...,
//     declaredAt: ISO timestamp,
//     declarationAccepted: true,                       // manifiesto bajo protesta
//     declarationTermsVersion: 'v1-2026-10',
//     reviewStatus: 'pending',                         // gate antifraude #39
//   }
//
// Mientras reviewStatus !== 'approved', el preview sigue mostrando el default
// conservador. Al aprobarse en /ops, el override toma efecto.
//
// Props:
//   formId: prefix para IDs de los fields.
//   checkboxName: nombre del field del checkbox (default 'hasTaxSpecialClassification').
//   codeName: nombre del field del dropdown (default 'taxClassificationCode').
//   acceptanceName: nombre del field del checkbox de manifiesto (default 'taxClassificationAccepted').
//   values: form values (necesarios para el render condicional).
//   condition: 'new' | 'used' — se usa para filtrar el catálogo o esconder la UI.
//   personType: 'individual' | 'physical_business' | 'moral' — Art. 9 IV
//     SÓLO aplica a particulares. Un store seller comercial con producto
//     usado no califica a esa exención.
const DECLARATION_TERMS_VERSION = 'v1-2026-10';

const TaxClassificationField = props => {
  const {
    formId = 'TaxClassificationField',
    checkboxName = 'hasTaxSpecialClassification',
    codeName = 'taxClassificationCode',
    acceptanceName = 'taxClassificationAccepted',
    values = {},
    condition,
    personType,
  } = props;

  const isUsed = condition === 'used';
  const isIndividual = personType === 'individual';

  // XOLOLO: si el producto es usado Y el seller es particular, la
  // clasificación fiscal se deriva automáticamente (Art. 9 IV). No hay
  // choice manual; el seller sólo ve la nota + manifiesto bajo protesta.
  // Para usado + comercial (physical_business o moral), Art. 9 IV NO aplica
  // y el seller ve el dropdown normal con esa opción filtrada.
  if (isUsed && isIndividual) {
    return (
      <div className={css.root}>
        <div className={css.autoAppliedCard}>
          <strong className={css.autoAppliedTitle}>
            Clasificación fiscal auto-aplicada
          </strong>
          <p className={css.autoAppliedText}>
            Al marcar <strong>Usado / segunda mano</strong>, tu producto queda
            bajo <strong>Art. 9 fracc. IV LIVA</strong>{' '}
            (bienes muebles usados por particular). No se cobra IVA al cliente
            y no se te retiene ISR 113-A. Esta exención aplica únicamente si
            no realizas actividad empresarial ni vendes de forma habitual.
          </p>
          <p className={css.autoAppliedDeclaration}>
            Al publicar manifiestas <strong>bajo protesta de decir verdad</strong>
            {' '}que el bien es tuyo, usado y vendido de forma ocasional, y aceptas
            ser el único responsable ante el SAT por esta declaración.
          </p>
        </div>
      </div>
    );
  }

  // Producto nuevo: catálogo manual con dropdown. Las clasificaciones
  // `requiresUsed: true` (Art. 9 IV) quedan OCULTAS porque son
  // incompatibles con producto nuevo.
  const isEnabled = !!values[checkboxName];
  const selectedCode = values[codeName];
  const selectedEntry = getClassificationByCode(selectedCode);
  const acceptanceChecked = !!values[acceptanceName];

  const renderOption = code => {
    const entry = getClassificationByCode(code);
    if (!entry) return null;
    if (entry.requiresUsed) return null; // filtra Art. 9 IV cuando condition='new'
    return (
      <option key={code} value={code}>
        {entry.label}
      </option>
    );
  };

  return (
    <div className={css.root}>
      <FieldCheckbox
        id={`${formId}_${checkboxName}`}
        name={checkboxName}
        label="Mi producto tiene clasificación fiscal especial (tasa 0% o exento)"
      />

      {isEnabled ? (
        <div className={css.body}>
          <p className={css.help}>
            Por default aplicamos IVA 16% a tu producto. Si pertenece a los
            supuestos de la Ley del IVA (Art. 2-A o Art. 9) o es un servicio
            exento (Art. 15), elígelo aquí. Tu declaración entrará a revisión
            de Xololo para proteger a toda la plataforma de clasificaciones
            incorrectas ante el SAT.
          </p>

          <FieldSelect
            id={`${formId}_${codeName}`}
            name={codeName}
            label="Tipo de clasificación fiscal"
          >
            <option value="">— Elige una clasificación —</option>
            {CLASSIFICATION_GROUPS.map(group => {
              const items = group.items.map(renderOption).filter(Boolean);
              if (items.length === 0) return null;
              return (
                <optgroup key={group.label} label={group.label}>
                  {items}
                </optgroup>
              );
            })}
          </FieldSelect>

          {selectedEntry ? (
            <>
              <div className={css.description}>
                <strong>{selectedEntry.label}</strong>
                <p>{selectedEntry.description}</p>
              </div>
              <div className={css.reviewNotice}>
                <strong>Nota:</strong> esta clasificación entrará a revisión por
                Xololo antes de aplicarse. Mientras tanto tu listing se publica
                y se calcula con IVA 16% default. Al aprobarse recibirás una
                notificación y el payout mostrado abajo se recalculará.
              </div>
              <div className={css.acceptanceBlock}>
                <FieldCheckbox
                  id={`${formId}_${acceptanceName}`}
                  name={acceptanceName}
                  label={
                    'Declaro bajo protesta de decir verdad que esta clasificación fiscal es correcta y asumo ser el único responsable ante el SAT por esta manifestación. Acepto los Términos y Condiciones de Xololo (' +
                    DECLARATION_TERMS_VERSION +
                    ').'
                  }
                />
                {!acceptanceChecked ? (
                  <p className={css.acceptanceHint}>
                    Para publicar con clasificación especial, debes aceptar el
                    manifiesto. Si no lo marcas, el listing se publicará con
                    IVA 16% default.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default TaxClassificationField;

// XOLOLO: expuesto para que los paneles usen el mismo string al guardar
// publicData.taxClassification.declarationTermsVersion.
export { DECLARATION_TERMS_VERSION };
