import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import * as validators from '../../../../util/validators';
import {
  Form,
  Button,
  FieldTextInput,
} from '../../../../components';

import css from './EditListingTextPanel.module.css';

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 1500;

// XOLOLO: Form del paso final TEXT. Edita título y descripción con
// visibilidad del contexto que la IA del PR 4 usará para auto-generar
// (fotos + atributos + categoría + precio).
//
// Hoy (PR 3) sólo pulido manual. En PR 4 se agrega:
//   - Al mount, si title/description vienen vacíos o autogenerados → la
//     IA se dispara automáticamente usando listing + atributos y pre-
//     rellena los inputs.
//   - Botón "Re-generar con IA" con nota opcional (ej. "más corto",
//     "enfócate en calidad").

const EditListingTextForm = props => {
  const intl = useIntl();
  const required = validators.required(
    intl.formatMessage({ id: 'EditListingTextForm.titleRequired', defaultMessage: 'Pon un título' })
  );
  const maxLenTitle = validators.maxLength(
    intl.formatMessage(
      { id: 'EditListingTextForm.titleTooLong', defaultMessage: 'Máximo {max} caracteres' },
      { max: TITLE_MAX }
    ),
    TITLE_MAX
  );
  const maxLenDesc = validators.maxLength(
    intl.formatMessage(
      { id: 'EditListingTextForm.descTooLong', defaultMessage: 'Máximo {max} caracteres' },
      { max: DESCRIPTION_MAX }
    ),
    DESCRIPTION_MAX
  );

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
          contextSummary,
        } = formRenderProps;

        const submitInProgress = updateInProgress;
        const submitReady = (updated && !invalid) || ready;
        const submitDisabled = invalid || disabled || submitInProgress;

        return (
          <Form className={classNames(className, css.form)} onSubmit={handleSubmit}>
            {/* XOLOLO: resumen del contexto que la IA usaría (educativo
                para el seller — ve POR QUÉ la IA puede generar bien). */}
            {contextSummary ? (
              <div className={css.contextBox}>
                <p className={css.contextTitle}>Contexto que ya guardaste:</p>
                <ul className={css.contextList}>
                  {contextSummary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* PR 4 agrega aquí el botón "🤖 Generar con IA" + nota opcional */}

            <FieldTextInput
              id={`${formId}.title`}
              name="title"
              type="text"
              label={intl.formatMessage({ id: 'EditListingTextForm.titleLabel', defaultMessage: 'Título del anuncio' })}
              placeholder={intl.formatMessage({ id: 'EditListingTextForm.titlePlaceholder', defaultMessage: 'Ej. Mancuernas hexagonales 20kg marca Reebok, nuevas' })}
              maxLength={TITLE_MAX}
              validate={validators.composeValidators(required, maxLenTitle)}
              className={css.field}
            />

            <FieldTextInput
              id={`${formId}.description`}
              name="description"
              type="textarea"
              label={intl.formatMessage({ id: 'EditListingTextForm.descLabel', defaultMessage: 'Descripción del anuncio' })}
              placeholder={intl.formatMessage({ id: 'EditListingTextForm.descPlaceholder', defaultMessage: 'Describe tu producto o servicio con detalle. Si usas IA, te sugerirá algo basado en tus fotos y características.' })}
              maxLength={DESCRIPTION_MAX}
              validate={maxLenDesc}
              className={css.field}
            />

            <Button
              className={css.submitButton}
              type="submit"
              inProgress={submitInProgress}
              disabled={submitDisabled}
              ready={submitReady}
            >
              {saveActionMsg || (
                <FormattedMessage
                  id="EditListingTextForm.saveText"
                  defaultMessage="Guardar y publicar"
                />
              )}
            </Button>
          </Form>
        );
      }}
    />
  );
};

export default EditListingTextForm;
