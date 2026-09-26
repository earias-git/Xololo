import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { setCartUser } from '../../ducks/cart.duck';

// XOLOLO Bug 1: sincroniza la storage del carrito con la identidad
// del user logueado.
//
// Contexto: cart.duck.js almacena bySellerId en localStorage con una
// key scopeada por userId. Cuando cambia la identidad (login, logout,
// switch de cuenta en el mismo browser), este componente detecta el
// cambio y dispatchea `setCartUser` para re-hidratar desde la key
// correcta.
//
// Sin esto, un proveedor que se loguea en un browser donde antes
// hubo un comprador vería el carrito del comprador en su topbar
// (bug reportado por el usuario). Ver docs/LOGISTICS_V1.md §7.
//
// Se monta una sola vez en <ClientApp>. No renderiza nada.

const CartUserSync = () => {
  const dispatch = useDispatch();
  const currentUserId = useSelector(state =>
    state.user?.currentUser?.id?.uuid || null
  );

  useEffect(() => {
    dispatch(setCartUser({ userId: currentUserId }));
  }, [currentUserId, dispatch]);

  return null;
};

export default CartUserSync;
