import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import * as validators from '../../../../util/validators';
import { Form, Button, FieldTextInput } from '../../../../components';

import css from './EditListingTextPanel.module.css';

// XOLOLO (PR 4): bloque de sugerencias IA. Si está cargando muestra
// spinner; si hay resultados muestra 3 opciones de título + 3 de
// descripción con botones "Usar este". Al click, llama a form.change
// para hidratar el input correspondiente.
const RecoList = ({ label, items }) => (
  <div className={css.recoGroup}>
    <p className={css.recoGroupLabel}>{label}</p>
    <ul className={css.recoListItems}>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  </div>
);

const AiSuggestionsBlock = ({ aiState, onRegenerate, formApi }) => {
  if (!aiState) return null;
  const { loading, suggestions, error } = aiState;
  if (loading) {
    return (
      <div className={css.aiBox}>
        <div className={css.aiHeader}>
          <span className={css.aiSparkle} aria-hidden="true">
            ✨
          </span>
          <span>La IA está analizando tus fotos y escribiendo tu anuncio…</span>
        </div>
        <p className={css.aiHint}>
          Primero analiza las fotos (lo que las cámaras ven), después usa tus características +
          categoría para armar título y descripción. Tarda ~10-20 segundos.
        </p>
      </div>
    );
  }
  if (error && !suggestions) {
    return (
      <div className={classNames(css.aiBox, css.aiBoxError)}>
        <p className={css.aiError}>
          <strong>No pudimos generar sugerencias:</strong> {error}
        </p>
        <button type="button" className={css.aiRetryBtn} onClick={onRegenerate}>
          🔄 Reintentar
        </button>
      </div>
    );
  }
  // XOLOLO: si aún no corrió, mostramos CTA explícito para iniciar.
  // Antes esto no aparecía cuando description ya tenía texto → el seller
  // no veía manera de disparar la IA desde esta pantalla.
  if (!suggestions) {
    return (
      <div className={css.aiBox}>
        <div className={css.aiHeader}>
          <span className={css.aiSparkle} aria-hidden="true">
            ✨
          </span>
          <span>¿Quieres que la IA te sugiera título y descripción?</span>
        </div>
        <p className={css.aiHint}>
          Analiza tus fotos + atributos declarados y propone 3 opciones de cada uno. Puedes editar o
          aceptar con un click.
        </p>
        <button type="button" className={css.aiOptionBtn} onClick={onRegenerate}>
          ✨ Generar con IA
        </button>
      </div>
    );
  }
  const titles = suggestions.titleSuggestions || [];
  const descriptions = suggestions.descriptionSuggestions || [];
  const applyTitle = text => formApi.change('title', text);
  const applyDescription = text => formApi.change('description', text);
  return (
    <div className={css.aiBox}>
      <div className={css.aiHeader}>
        <span className={css.aiSparkle} aria-hidden="true">
          ✨
        </span>
        <span>Sugerencias de la IA — click en una para usarla</span>
      </div>

      {titles.length > 0 ? (
        <div className={css.aiGroup}>
          <p className={css.aiGroupTitle}>Opciones de título</p>
          <ul className={css.aiOptionList}>
            {titles.map((t, i) => (
              <li key={`t-${i}`} className={css.aiOption}>
                <span className={css.aiOptionText}>{t}</span>
                <button type="button" className={css.aiOptionBtn} onClick={() => applyTitle(t)}>
                  Usar este
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {descriptions.length > 0 ? (
        <div className={css.aiGroup}>
          <p className={css.aiGroupTitle}>Opciones de descripción</p>
          <ul className={css.aiOptionList}>
            {descriptions.map((d, i) => (
              <li key={`d-${i}`} className={css.aiOption}>
                <span className={css.aiOptionText}>{d}</span>
                <button
                  type="button"
                  className={css.aiOptionBtn}
                  onClick={() => applyDescription(d)}
                >
                  Usar esta
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button type="button" className={css.aiRetryBtn} onClick={onRegenerate}>
        🔄 Re-generar con IA
      </button>
    </div>
  );
};

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
          form,
          className,
          handleSubmit,
          invalid,
          disabled,
          ready,
          updated,
          updateInProgress,
          saveActionMsg,
          contextSummary,
          photoRecommendations,
          aiState,
          onRegenerateAi,
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

            {/* XOLOLO: recomendaciones sobre las fotos (de aiAnalysis.
                recommendations). Consejos accionables para mejorar
                calidad, encuadre y confianza antes de publicar. */}
            {photoRecommendations &&
            (photoRecommendations.quality?.length > 0 ||
              photoRecommendations.composition?.length > 0 ||
              photoRecommendations.trust?.length > 0) ? (
              <div className={css.recoBox}>
                <p className={css.recoTitle}>📸 Recomendaciones de la IA sobre tus fotos</p>
                {photoRecommendations.quality?.length > 0 ? (
                  <RecoList label="Calidad" items={photoRecommendations.quality} />
                ) : null}
                {photoRecommendations.composition?.length > 0 ? (
                  <RecoList label="Encuadre" items={photoRecommendations.composition} />
                ) : null}
                {photoRecommendations.trust?.length > 0 ? (
                  <RecoList label="Confianza" items={photoRecommendations.trust} />
                ) : null}
                <p className={css.recoHint}>
                  Puedes volver al paso Fotos para reemplazar o añadir imágenes.
                </p>
              </div>
            ) : null}

            {/* XOLOLO (PR 4): bloque de sugerencias IA. Auto-corre al mount
                del panel. El seller elige una opción con "Usar este" y
                el input de abajo se hidrata. */}
            <AiSuggestionsBlock aiState={aiState} onRegenerate={onRegenerateAi} formApi={form} />

            <FieldTextInput
              id={`${formId}.title`}
              name="title"
              type="text"
              label={intl.formatMessage({
                id: 'EditListingTextForm.titleLabel',
                defaultMessage: 'Título del anuncio',
              })}
              placeholder={intl.formatMessage({
                id: 'EditListingTextForm.titlePlaceholder',
                defaultMessage: 'Ej. Mancuernas hexagonales 20kg marca Reebok, nuevas',
              })}
              maxLength={TITLE_MAX}
              validate={validators.composeValidators(required, maxLenTitle)}
              className={css.field}
            />

            <FieldTextInput
              id={`${formId}.description`}
              name="description"
              type="textarea"
              label={intl.formatMessage({
                id: 'EditListingTextForm.descLabel',
                defaultMessage: 'Descripción del anuncio',
              })}
              placeholder={intl.formatMessage({
                id: 'EditListingTextForm.descPlaceholder',
                defaultMessage:
                  'Describe tu producto o servicio con detalle. Si usas IA, te sugerirá algo basado en tus fotos y características.',
              })}
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
