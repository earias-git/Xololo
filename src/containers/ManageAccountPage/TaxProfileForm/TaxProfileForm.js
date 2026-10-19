import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { Button, FieldCheckbox, FieldRadioButton, Form, H4 } from '../../../components';
import { PERSON_TYPES, PERSON_TYPE_OPTIONS } from '../../../util/xololoTaxProfile';

import css from './TaxProfileForm.module.css';

// XOLOLO: formulario del perfil fiscal del seller.
//
// Se declara en Account Settings y aplica a TODOS sus listings. Afecta cómo
// se calcula la retención de ISR 113-A y el 20%/16% extra por falta de RFC.
//
// Props:
//   initialValues: { personType, hasRfc }
//   onSubmit: handler que recibe los valores crudos y persiste en
//             profile.protectedData.xololoTaxProfile.
//   updateInProgress / ready / updateProfileError: para feedback de submit.
const TaxProfileForm = props => (
  <FinalForm
    {...props}
    render={formRenderProps => {
      const {
        className,
        rootClassName,
        handleSubmit,
        values,
        pristine,
        invalid,
        updateInProgress = false,
        updateProfileError,
        ready = false,
      } = formRenderProps;

      const classes = classNames(rootClassName || css.root, className);
      const submitDisabled = invalid || pristine || updateInProgress;
      const submitReady = ready;
      const needsRfc = values?.personType !== PERSON_TYPES.PARTICULAR;

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          <H4 as="h2" className={css.heading}>
            Tu perfil fiscal
          </H4>
          <p className={css.description}>
            Esta información nos permite calcular correctamente tu pago neto por
            cada venta. Se mantiene privada (sólo tú y los admins de Xololo la
            vemos). Al guardarla firmas una declaración bajo protesta de decir
            verdad.
          </p>

          {updateProfileError ? (
            <p className={css.error}>
              Hubo un error al guardar tu perfil fiscal. Intenta de nuevo.
            </p>
          ) : null}

          <fieldset className={css.fieldset}>
            <legend className={css.legend}>¿Cómo vendes en Xololo?</legend>
            {PERSON_TYPE_OPTIONS.map(opt => (
              <div key={opt.key} className={css.radioRow}>
                <FieldRadioButton
                  id={`taxProfile_personType_${opt.key}`}
                  name="personType"
                  value={opt.key}
                  label={opt.label}
                />
                <p className={css.radioHelper}>{opt.helper}</p>
              </div>
            ))}
          </fieldset>

          {needsRfc ? (
            <div className={css.rfcBlock}>
              <FieldCheckbox
                id="taxProfile_hasRfc"
                name="hasRfc"
                label="Ya tengo mi RFC vigente ante el SAT"
              />
              <p className={css.rfcHelper}>
                Si lo dejas sin marcar, por ley Xololo debe retener 20% de ISR y
                16% de IVA extra sobre cada venta hasta que lo registres. En
                cuanto lo tengas, actualízalo aquí para dejar de pagar de más.
              </p>
            </div>
          ) : null}

          <p className={css.declaration}>
            Al guardar, declaro bajo protesta de decir verdad que la información
            es correcta y acepto que Xololo la use para calcular las retenciones
            SAT que correspondan a mis ventas.
          </p>

          <Button
            type="submit"
            className={css.submitButton}
            inProgress={updateInProgress}
            disabled={submitDisabled}
            ready={submitReady}
          >
            Guardar perfil fiscal
          </Button>
        </Form>
      );
    }}
  />
);

export default TaxProfileForm;
