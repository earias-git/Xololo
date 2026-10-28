import React from 'react';
import classNames from 'classnames';

import { Modal } from '..';
import { methodLabel } from '../../util/xololoShippingMethods';

import css from './IncompatibleShippingModal.module.css';

// XOLOLO Cart #21: modal preventivo que aparece cuando el buyer intenta
// agregar al carrito un listing cuyos métodos de envío NO comparten
// ninguno con los items que ya tiene del mismo seller. Al confirmar,
// Option D del backend crea 2 (o más) grupos de compatibilidad y el buyer
// termina pagando 2 checkouts separados — este modal lo previene de la
// sorpresa.
//
// Props:
//   isOpen             — bool, controla el modal
//   onClose            — llamado al cancelar o al cerrar
//   onConfirm          — llamado al "Agregar de todas formas (2 pagos)"
//   currentGroupKeys   — array de method keys compartidos por los items ya en carrito
//   newItemKeys        — array de method keys del nuevo listing
//   newItemTitle       — string, título del listing nuevo
//   sellerDisplayName  — string, nombre del seller (contexto en el copy)

const MethodChips = ({ keys, emptyLabel }) => {
  if (!keys || keys.length === 0) {
    return <span className={css.chipEmpty}>{emptyLabel}</span>;
  }
  return (
    <ul className={css.chipList}>
      {keys.map(k => (
        <li key={k} className={css.chip}>
          {methodLabel(k)}
        </li>
      ))}
    </ul>
  );
};

const IncompatibleShippingModal = ({
  isOpen,
  onClose,
  onConfirm,
  currentGroupKeys = [],
  newItemKeys = [],
  newItemTitle = 'este producto',
  sellerDisplayName,
}) => {
  const onManageDisableScrolling = () => {}; // no-op; Modal lo requiere pero no bloqueamos scroll

  return (
    <Modal
      id="IncompatibleShippingModal"
      isOpen={isOpen}
      onClose={onClose}
      onManageDisableScrolling={onManageDisableScrolling}
      usePortal
    >
      <div className={css.root}>
        <h2 className={css.title}>Habrá 2 pagos separados</h2>
        <p className={css.lede}>
          <strong>{newItemTitle}</strong> no comparte método de envío con
          los productos que ya tienes en tu carrito
          {sellerDisplayName ? (
            <>
              {' '}de <strong>{sellerDisplayName}</strong>
            </>
          ) : null}
          . Si lo agregas, tendrás que completar <strong>2 checkouts</strong>:
          uno por cada grupo de productos.
        </p>

        <div className={css.compare}>
          <div className={css.col}>
            <div className={css.colHeader}>En tu carrito</div>
            <MethodChips
              keys={currentGroupKeys}
              emptyLabel="Sin método compartido"
            />
          </div>
          <div className={css.divider} aria-hidden="true">
            ⇆
          </div>
          <div className={css.col}>
            <div className={css.colHeader}>{newItemTitle}</div>
            <MethodChips
              keys={newItemKeys}
              emptyLabel="Sin métodos habilitados"
            />
          </div>
        </div>

        <p className={css.hint}>
          Cada pago tiene su propio envío, cobro y confirmación. Puedes
          seguir con los dos, o cancelar y quitar algo del carrito para
          que todo salga en un solo pago.
        </p>

        <div className={css.actions}>
          <button
            type="button"
            className={classNames(css.btn, css.btnSecondary)}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={classNames(css.btn, css.btnPrimary)}
            onClick={onConfirm}
          >
            Agregar de todas formas (2 pagos)
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default IncompatibleShippingModal;
