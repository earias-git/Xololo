// XOLOLO: lista canónica de los 32 estados de México, usando el naming
// que devuelve el endpoint /api/postal-code (mismo dataset SEPOMEX que
// consume el checkout via ShippingDetails para autocompletar por CP).
// Manteniendo el mismo naming aquí garantizamos que el matching entre
// "estados de cobertura del listing" y "recipientState del buyer" sea
// exacto sin normalización adicional.

export const MX_STATES = [
  'Aguascalientes',
  'Baja California',
  'Baja California Sur',
  'Campeche',
  'Chiapas',
  'Chihuahua',
  'Ciudad de México',
  'Coahuila',
  'Colima',
  'Durango',
  'Estado de México',
  'Guanajuato',
  'Guerrero',
  'Hidalgo',
  'Jalisco',
  'Michoacán',
  'Morelos',
  'Nayarit',
  'Nuevo León',
  'Oaxaca',
  'Puebla',
  'Querétaro',
  'Quintana Roo',
  'San Luis Potosí',
  'Sinaloa',
  'Sonora',
  'Tabasco',
  'Tamaulipas',
  'Tlaxcala',
  'Veracruz',
  'Yucatán',
  'Zacatecas',
];

// Set para lookup O(1) — se usa en validaciones del checkout.
export const MX_STATES_SET = new Set(MX_STATES);

// Normaliza un nombre de estado para comparar contra la lista canónica.
// Acepta variantes con/sin acentos, mayúsculas y variaciones comunes
// que el buyer pueda haber tecleado a mano en vez del CP autofill.
export const normalizeMxState = raw => {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const table = {
    aguascalientes: 'Aguascalientes',
    'baja california': 'Baja California',
    'baja california sur': 'Baja California Sur',
    campeche: 'Campeche',
    chiapas: 'Chiapas',
    chihuahua: 'Chihuahua',
    'ciudad de mexico': 'Ciudad de México',
    cdmx: 'Ciudad de México',
    'distrito federal': 'Ciudad de México',
    df: 'Ciudad de México',
    coahuila: 'Coahuila',
    'coahuila de zaragoza': 'Coahuila',
    colima: 'Colima',
    durango: 'Durango',
    'estado de mexico': 'Estado de México',
    edomex: 'Estado de México',
    'mexico': 'Estado de México',
    guanajuato: 'Guanajuato',
    guerrero: 'Guerrero',
    hidalgo: 'Hidalgo',
    jalisco: 'Jalisco',
    michoacan: 'Michoacán',
    'michoacan de ocampo': 'Michoacán',
    morelos: 'Morelos',
    nayarit: 'Nayarit',
    'nuevo leon': 'Nuevo León',
    oaxaca: 'Oaxaca',
    puebla: 'Puebla',
    queretaro: 'Querétaro',
    'queretaro de arteaga': 'Querétaro',
    'quintana roo': 'Quintana Roo',
    'san luis potosi': 'San Luis Potosí',
    sinaloa: 'Sinaloa',
    sonora: 'Sonora',
    tabasco: 'Tabasco',
    tamaulipas: 'Tamaulipas',
    tlaxcala: 'Tlaxcala',
    veracruz: 'Veracruz',
    'veracruz de ignacio de la llave': 'Veracruz',
    yucatan: 'Yucatán',
    zacatecas: 'Zacatecas',
  };
  return table[s] || null;
};
