import React from 'react';
import { Form as FinalForm, Field } from 'react-final-form';
import classNames from 'classnames';

import { Form, PrimaryButton, FieldTextInput, FieldSelect } from '../../../components';

import css from './ManageStoreForm.module.css';

// XOLOLO: form controls to edit the seller's storefront branding.
// Todos los inputs escriben en publicData. La validación es cliente
// (opcional) — el server valida al persistir.

const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'staging', 'dev', 'test',
  'mail', 'blog', 'docs', 'help', 'my', 'account', 'stripe',
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const validateSlug = value => {
  if (!value) return 'Slug requerido para tu tienda.';
  const v = String(value).toLowerCase().trim();
  if (!SLUG_PATTERN.test(v)) return 'Solo letras minúsculas, números y guiones. 2-40 caracteres.';
  if (RESERVED_SLUGS.has(v)) return 'Este slug está reservado. Elige otro.';
  return undefined;
};

const validateHex = value => {
  if (!value) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(String(value).trim())) return 'Formato HEX: #RRGGBB';
  return undefined;
};

const validateUrl = value => {
  if (!value) return undefined;
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Debe ser una URL http:// o https://';
    return undefined;
  } catch {
    return 'URL inválida';
  }
};

const validateWhatsapp = value => {
  if (!value) return undefined;
  const clean = String(value).replace(/[^\d]/g, '');
  if (clean.length < 10 || clean.length > 15) return 'Entre 10 y 15 dígitos, sin espacios ni "+"';
  return undefined;
};

const ColorField = ({ name, label, defaultColor }) => (
  <Field name={name} validate={validateHex}>
    {({ input, meta }) => (
      <div className={css.colorFieldWrap}>
        <label className={css.colorFieldLabel}>{label}</label>
        <div className={css.colorFieldRow}>
          <input
            type="color"
            value={input.value || defaultColor}
            onChange={input.onChange}
            className={css.colorPicker}
            aria-label={`${label} — selector`}
          />
          <input
            type="text"
            {...input}
            placeholder={defaultColor}
            className={css.colorHexInput}
          />
        </div>
        {meta.touched && meta.error ? (
          <span className={css.fieldError}>{meta.error}</span>
        ) : null}
      </div>
    )}
  </Field>
);

const ManageStoreForm = props => (
  <FinalForm
    {...props}
    render={formRenderProps => {
      const {
        className,
        handleSubmit,
        invalid,
        pristine,
        submitting,
        inProgress,
        ready,
        saveStoreError,
      } = formRenderProps;

      const submitInProgress = submitting || inProgress;
      const submitDisabled = invalid || pristine || submitInProgress;

      return (
        <Form className={classNames(className, css.form)} onSubmit={handleSubmit}>
          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>Identidad de tu tienda</legend>

            <FieldTextInput
              className={css.field}
              type="text"
              id="slug"
              name="slug"
              label="Slug — el subdominio de tu tienda"
              placeholder="mi-tienda"
              validate={validateSlug}
            />
            <p className={css.hint}>
              Tu tienda quedará en{' '}
              <code className={css.code}>tu-slug.xololo.mx</code>. Solo puedes
              usar letras minúsculas, números y guiones.
            </p>

            <FieldTextInput
              className={css.field}
              type="text"
              id="shortDescription"
              name="shortDescription"
              label="Descripción corta"
              placeholder="Frase que aparece bajo el nombre de tu tienda"
              maxLength={120}
            />

            <FieldTextInput
              className={css.field}
              type="textarea"
              id="longDescription"
              name="longDescription"
              label="Sobre nosotros"
              placeholder="Cuéntanos quién eres, qué haces y por qué eliges Xololo"
              rows={5}
            />

            <FieldSelect
              className={css.field}
              id="primaryCategory"
              name="primaryCategory"
              label="Categoría principal de tu tienda"
            >
              <option value="">Selecciona una categoría</option>
              <option value="artesanias">Artesanías</option>
              <option value="hogar">Hogar</option>
              <option value="moda">Moda</option>
              <option value="belleza">Belleza</option>
              <option value="alimentos">Alimentos</option>
              <option value="tecnologia">Tecnología</option>
              <option value="mascotas">Mascotas</option>
              <option value="papeleria">Papelería</option>
              <option value="turismo">Turismo</option>
              <option value="servicios-pro">Servicios pro</option>
            </FieldSelect>
          </fieldset>

          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>Look de tu tienda</legend>

            <div className={css.colorRow}>
              <ColorField
                name="brandPrimaryColor"
                label="Color primario"
                defaultColor="#1f8f52"
              />
              <ColorField
                name="brandSecondaryColor"
                label="Color secundario"
                defaultColor="#6bcb8c"
              />
            </div>
            <p className={css.hint}>
              El color primario tiñe botones y encabezados; el secundario
              destaca bandas y detalles.
            </p>

            <FieldTextInput
              className={css.field}
              type="text"
              id="logoUrl"
              name="logoUrl"
              label="Logo (URL)"
              placeholder="https://..."
              validate={validateUrl}
            />
            <p className={css.hint}>
              URL a tu logo (Imgur, Cloudinary o similar). Idealmente PNG con
              fondo transparente, alto de 200 px.
            </p>

            <FieldTextInput
              className={css.field}
              type="text"
              id="bannerUrl"
              name="bannerUrl"
              label="Banner publicitario (URL)"
              placeholder="https://..."
              validate={validateUrl}
            />
            <p className={css.hint}>
              Imagen horizontal (1600 x 400 px recomendado) que aparece bajo
              el header de tu storefront.
            </p>
          </fieldset>

          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>Contacto directo</legend>

            <FieldTextInput
              className={css.field}
              type="text"
              id="whatsapp"
              name="whatsapp"
              label="WhatsApp (formato internacional, sin +)"
              placeholder="521XXXXXXXXXX"
              validate={validateWhatsapp}
            />

            <FieldTextInput
              className={css.field}
              type="text"
              id="instagram"
              name="instagram"
              label="Usuario de Instagram (sin @)"
              placeholder="mi_tienda"
            />
          </fieldset>

          <fieldset className={css.section}>
            <legend className={css.sectionTitle}>Disponibilidad</legend>

            <FieldSelect
              className={css.field}
              id="showCalendar"
              name="showCalendar"
              label="Mostrar sección de disponibilidad en tu storefront"
            >
              <option value="no">No mostrar</option>
              <option value="yes">Sí, mostrar calendario</option>
            </FieldSelect>
            <p className={css.hint}>
              Actívalo si vendes servicios con reserva por hora o por día.
              La sección aparece bajo el catálogo con las próximas fechas.
            </p>
          </fieldset>

          {saveStoreError ? (
            <p className={css.error}>
              No pudimos guardar los cambios. Intenta de nuevo o revisa que los
              datos sean válidos.
            </p>
          ) : null}
          {ready ? (
            <p className={css.success}>Cambios guardados. Tu storefront se actualizó.</p>
          ) : null}

          <PrimaryButton
            className={css.submit}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
            ready={ready}
          >
            Guardar cambios
          </PrimaryButton>
        </Form>
      );
    }}
  />
);

export default ManageStoreForm;
