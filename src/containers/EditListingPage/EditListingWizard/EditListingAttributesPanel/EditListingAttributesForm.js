import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import {
  CATEGORY_TREE,
  getSubcategories,
  listAttributes,
  getMissingRequiredAttributes,
} from '../../../../config/listingAttributes';
import { Form, Button, FieldSelect, FieldTextInput, FieldCheckbox } from '../../../../components';

import css from './EditListingAttributesPanel.module.css';

// XOLOLO: Form del nuevo paso Atributos del wizard. Renderiza:
//   1. Un selector de sub-categoría dependiente de la categoría ya elegida
//      en Details (publicData.categoryLevel1). Si la categoría no está en
//      CATEGORY_TREE (p.ej. cat del Console no mapeada aún), ocultamos el
//      sub-selector y mostramos sólo los atributos comunes de la categoría.
//   2. Un conjunto de inputs dinámicos según listAttributes(cat, sub).
//
// Cada atributo se renderiza según `type`:
//   - select       → FieldSelect
//   - multiselect  → grupo de FieldCheckbox (cada opción un check)
//   - text         → FieldTextInput
//   - number       → FieldTextInput type="number"
//   - dimensions   → trio alto × ancho × largo con unit visible
//   - boolean      → FieldCheckbox
//
// Validación: `getMissingRequiredAttributes` corre antes del submit.
// Los campos sin valor NO se persisten (quedan undefined — legacy OK).

const renderAttributeField = (attr, formId) => {
  const inputId = `${formId}.attr_${attr.key}`;
  const inputName = `attr_${attr.key}`;
  const label = attr.required ? `${attr.label} *` : attr.label;

  if (attr.type === 'select') {
    return (
      <FieldSelect key={attr.key} id={inputId} name={inputName} label={label} className={css.field}>
        <option value="">Elige una opción…</option>
        {(attr.options || []).map(opt => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </FieldSelect>
    );
  }

  if (attr.type === 'multiselect') {
    return (
      <fieldset key={attr.key} className={css.multiselectGroup}>
        <legend className={css.multiselectLegend}>{label}</legend>
        <div className={css.multiselectRow}>
          {(attr.options || []).map(opt => (
            <FieldCheckbox
              key={opt}
              id={`${inputId}_${opt}`}
              name={inputName}
              value={opt}
              label={opt}
            />
          ))}
        </div>
        {attr.helpText ? <p className={css.helpText}>{attr.helpText}</p> : null}
      </fieldset>
    );
  }

  if (attr.type === 'text') {
    return (
      <FieldTextInput
        key={attr.key}
        id={inputId}
        name={inputName}
        type="text"
        label={label}
        placeholder={attr.placeholder || ''}
        className={css.field}
      />
    );
  }

  if (attr.type === 'number') {
    return (
      <FieldTextInput
        key={attr.key}
        id={inputId}
        name={inputName}
        type="number"
        label={attr.unit ? `${label} (${attr.unit})` : label}
        className={css.field}
        min={0}
      />
    );
  }

  if (attr.type === 'dimensions') {
    const unit = attr.unit || 'cm';
    return (
      <fieldset key={attr.key} className={css.dimensionsGroup}>
        <legend className={css.multiselectLegend}>{label}</legend>
        <div className={css.dimensionsRow}>
          <FieldTextInput
            id={`${inputId}_h`}
            name={`${inputName}_h`}
            type="number"
            label={`Alto (${unit})`}
            min={0}
            className={css.dimField}
          />
          <FieldTextInput
            id={`${inputId}_w`}
            name={`${inputName}_w`}
            type="number"
            label={`Ancho (${unit})`}
            min={0}
            className={css.dimField}
          />
          <FieldTextInput
            id={`${inputId}_d`}
            name={`${inputName}_d`}
            type="number"
            label={`Largo/profundidad (${unit})`}
            min={0}
            className={css.dimField}
          />
        </div>
      </fieldset>
    );
  }

  if (attr.type === 'boolean') {
    return (
      <div key={attr.key} className={css.booleanField}>
        <FieldCheckbox id={inputId} name={inputName} label={attr.label} />
      </div>
    );
  }

  return null;
};

const EditListingAttributesForm = props => {
  const intl = useIntl();
  return (
    <FinalForm
      {...props}
      render={formRenderProps => {
        const {
          formId,
          className,
          handleSubmit,
          invalid,
          disabled,
          ready,
          updated,
          updateInProgress,
          saveActionMsg,
          values,
          categoryId,
          isEvent,
        } = formRenderProps;

        // Si cambia la sub-categoría, los atributos cambian — se re-renderiza
        // esta lista. Para evento, se mergean EVENT_ATTRIBUTES.
        const effectiveSub = values.subcategory || '';
        const attrs = listAttributes(categoryId, effectiveSub, isEvent);
        const subOptions = getSubcategories(categoryId);
        const hasSubcategories = subOptions.length > 0;

        // Validación informativa (no bloqueante aún — el seller puede
        // guardar y volver). Los required son hints visuales.
        const attrValues = Object.fromEntries(
          Object.entries(values)
            .filter(([k]) => k.startsWith('attr_'))
            .map(([k, v]) => [k.replace(/^attr_/, ''), v])
        );
        const missing = getMissingRequiredAttributes(categoryId, effectiveSub, attrValues, isEvent);

        const submitInProgress = updateInProgress;
        const submitReady = (updated && !invalid) || ready;
        const submitDisabled = invalid || disabled || submitInProgress;

        return (
          <Form className={classNames(className, css.form)} onSubmit={handleSubmit}>
            {hasSubcategories ? (
              <FieldSelect
                id={`${formId}.subcategory`}
                name="subcategory"
                label="Sub-categoría"
                className={css.field}
              >
                <option value="">Elige una sub-categoría…</option>
                {subOptions.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </FieldSelect>
            ) : (
              <p className={css.noSubNotice}>
                Esta categoría no tiene sub-categorías. Los atributos de abajo son generales para la
                categoría.
              </p>
            )}

            {isEvent ? (
              <div className={css.eventNotice}>
                <strong>🎫 Este anuncio es un Evento con fecha fija.</strong> Llena los campos de
                fecha, hora y lugar — se usan para mostrar el banner del evento en la ficha y para
                el boleto que recibe el buyer. El cupo total se persiste como stock del listing.
              </div>
            ) : null}

            {attrs.length > 0 ? (
              <div className={css.attributesSection}>
                <h3 className={css.sectionTitle}>
                  {isEvent ? 'Datos del evento' : 'Características del producto / servicio'}
                </h3>
                <p className={css.sectionLead}>
                  Entre más datos nos des, mejor te sugerirá la IA el título y descripción. Los
                  campos marcados con * son recomendados para que el buyer te encuentre fácil con
                  filtros.
                </p>
                {attrs.map(a => renderAttributeField(a, formId))}
                {missing.length > 0 ? (
                  <p className={css.missingHint}>
                    Te faltan {missing.length} campo{missing.length === 1 ? '' : 's'} recomendado
                    {missing.length === 1 ? '' : 's'}: {missing.join(', ')}. Puedes guardar y volver
                    después.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className={css.noAttrsNotice}>
                Aún no tenemos atributos específicos para esta categoría. Puedes saltarte este paso
                y continuar.
              </p>
            )}

            <Button
              className={css.submitButton}
              type="submit"
              inProgress={submitInProgress}
              disabled={submitDisabled}
              ready={submitReady}
            >
              {saveActionMsg || (
                <FormattedMessage
                  id="EditListingAttributesForm.saveAttributes"
                  defaultMessage="Guardar y continuar"
                />
              )}
            </Button>
          </Form>
        );
      }}
    />
  );
};

export default EditListingAttributesForm;
