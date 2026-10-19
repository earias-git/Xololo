import React from 'react';

import { FieldCheckbox, FieldSelect } from '../index';
import {
  CLASSIFICATION_GROUPS,
  getClassificationByCode,
} from '../../util/xololoTaxClassification';

import css from './TaxClassificationField.module.css';

// XOLOLO: campo de clasificación fiscal especial para el form de Pricing.
//
// UX:
//   1. Checkbox "Mi producto tiene clasificación fiscal especial" (default off).
//   2. Si se marca, aparece dropdown con las 4 agrupaciones del catálogo
//      (Art. 9, Art. 2-A, Art. 15, actividad distinta en LISR 113-A).
//   3. Si el seller elige una opción, aparece la descripción educativa del
//      catálogo y una nota de "entrará a revisión por Xololo".
//
// Datos persistidos (al submit del form):
//   publicData.taxClassification = {
//     code: 'exento_9_iv',
//     declaredAt: ISO timestamp,
//     reviewStatus: 'pending',  // gate antifraude task #39
//   }
//
// Mientras el status NO esté en 'approved', el preview sigue mostrando el
// default conservador (16% + enajenación) y el seller ve un indicador.
// Esto protege a Xololo de multas SAT por clasificación errónea.
//
// Props:
//   formId: prefix para IDs de los fields.
//   checkboxName: nombre del field del checkbox (default 'hasTaxSpecialClassification').
//   codeName: nombre del field del dropdown (default 'taxClassificationCode').
//   values: form values (necesarios para el render condicional).
const TaxClassificationField = props => {
  const {
    formId = 'TaxClassificationField',
    checkboxName = 'hasTaxSpecialClassification',
    codeName = 'taxClassificationCode',
    values = {},
  } = props;

  const isEnabled = !!values[checkboxName];
  const selectedCode = values[codeName];
  const selectedEntry = getClassificationByCode(selectedCode);

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
            {CLASSIFICATION_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map(code => {
                  const entry = getClassificationByCode(code);
                  return entry ? (
                    <option key={code} value={code}>
                      {entry.label}
                    </option>
                  ) : null;
                })}
              </optgroup>
            ))}
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
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default TaxClassificationField;
