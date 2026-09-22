// XOLOLO F3 · dashboard utilities (period presets + bucketing + formatting).

// ---------- period presets ----------
// Todos usan "hoy" como referencia y devuelven {from, to} en YYYY-MM-DD.

const toYmd = date => date.toISOString().slice(0, 10);

const startOfMonth = date => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = date => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const startOfQuarter = date => {
  const q = Math.floor(date.getMonth() / 3);
  return new Date(date.getFullYear(), q * 3, 1);
};
const endOfQuarter = date => {
  const q = Math.floor(date.getMonth() / 3);
  return new Date(date.getFullYear(), q * 3 + 3, 0);
};
const startOfYear = date => new Date(date.getFullYear(), 0, 1);
const endOfYear = date => new Date(date.getFullYear(), 11, 31);
const addMonths = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, date.getDate());
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

export const PERIOD_PRESETS = [
  {
    key: 'month',
    label: 'Este mes',
    range: () => {
      const now = new Date();
      return { from: toYmd(startOfMonth(now)), to: toYmd(now) };
    },
  },
  {
    key: 'lastMonth',
    label: 'Mes anterior',
    range: () => {
      const now = new Date();
      const prev = addMonths(now, -1);
      return { from: toYmd(startOfMonth(prev)), to: toYmd(endOfMonth(prev)) };
    },
  },
  {
    key: 'last3',
    label: 'Últimos 3 meses',
    range: () => {
      const now = new Date();
      const start = addMonths(now, -3);
      return { from: toYmd(start), to: toYmd(now) };
    },
  },
  {
    key: 'quarter',
    label: 'Este trimestre',
    range: () => {
      const now = new Date();
      return { from: toYmd(startOfQuarter(now)), to: toYmd(now) };
    },
  },
  {
    key: 'year',
    label: 'Este año',
    range: () => {
      const now = new Date();
      return { from: toYmd(startOfYear(now)), to: toYmd(now) };
    },
  },
  {
    key: 'last12',
    label: 'Últimos 12 meses',
    range: () => {
      const now = new Date();
      const start = addMonths(now, -12);
      return { from: toYmd(start), to: toYmd(now) };
    },
  },
];

// ---------- granularidad ----------
// Auto según rango: día si <60d, semana si <180d, mes si más.
export const autoGranularity = (fromYmd, toYmd) => {
  const days = (new Date(toYmd) - new Date(fromYmd)) / (24 * 60 * 60 * 1000);
  if (days <= 60) return 'day';
  if (days <= 180) return 'week';
  return 'month';
};

// ---------- bucketing ----------
// Recibe transactions ya filtradas y devuelve buckets:
//   [{ key, label, from, to, count, salesAmount, providerAmount, commissionAmount }]

const monthLabels = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const bucketKeyFor = (date, granularity) => {
  if (granularity === 'day') {
    return toYmd(date);
  }
  if (granularity === 'week') {
    // Bucket = lunes de la semana ISO.
    const d = new Date(date);
    const day = d.getDay(); // 0 dom, 1 lun...
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toYmd(d);
  }
  // month
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return toYmd(d);
};

const labelFor = (bucketKey, granularity) => {
  const d = new Date(bucketKey);
  if (granularity === 'day') {
    return `${d.getDate()} ${monthLabels[d.getMonth()]}`;
  }
  if (granularity === 'week') {
    const end = addDays(d, 6);
    return `${d.getDate()} ${monthLabels[d.getMonth()]} – ${end.getDate()} ${monthLabels[end.getMonth()]}`;
  }
  return `${monthLabels[d.getMonth()]} ${d.getFullYear()}`;
};

export const bucketTransactions = (transactions, fromYmd, toYmd, granularity) => {
  const buckets = new Map();
  // Semilla: recorremos el rango completo por granularidad para tener
  // buckets vacíos (los meses/semanas sin ventas también aparecen).
  const cursor = new Date(fromYmd);
  const end = new Date(toYmd);
  while (cursor <= end) {
    const key = bucketKeyFor(cursor, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: labelFor(key, granularity),
        count: 0,
        salesAmount: 0,
        providerAmount: 0,
        commissionAmount: 0,
      });
    }
    // Avanzar el cursor según granularidad para no iterar días innecesariamente.
    if (granularity === 'day') cursor.setDate(cursor.getDate() + 1);
    else if (granularity === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const tx of transactions) {
    if (tx.isCanceled) continue;
    if (!tx.createdAt) continue;
    const d = new Date(tx.createdAt);
    const key = bucketKeyFor(d, granularity);
    let bucket = buckets.get(key);
    if (!bucket) {
      // fuera del rango sembrado — puede ocurrir por edge de zona horaria
      bucket = {
        key,
        label: labelFor(key, granularity),
        count: 0,
        salesAmount: 0,
        providerAmount: 0,
        commissionAmount: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.salesAmount += tx.payinAmount || 0;
    bucket.providerAmount += tx.providerTotalAmount || 0;
    bucket.commissionAmount += tx.xololoCommissionAmount || 0;
  }

  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
};

// ---------- money formatting ----------
// Recharts prefers plain numbers; formateamos con separadores para
// mostrar en el UI. Los montos vienen en subunits (centavos).
export const formatSubunitsAsMxn = subunits => {
  const value = (subunits || 0) / 100;
  return value.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

// ---------- período previo comparable ----------
// Recibe {from, to} en YYYY-MM-DD y devuelve el rango previo del mismo
// número de días. Ej: {from:'2026-07-01', to:'2026-09-30'} (92 días)
// → {from:'2026-03-31', to:'2026-06-30'} (92 días anteriores).
// Se usa para calcular delta% vs período anterior en los KPIs.
export const previousPeriodOf = ({ from, to }) => {
  const fromD = new Date(from);
  const toD = new Date(to);
  const spanMs = toD.getTime() - fromD.getTime();
  const prevTo = new Date(fromD.getTime() - 24 * 60 * 60 * 1000); // día antes del from
  const prevFrom = new Date(prevTo.getTime() - spanMs);
  return { from: toYmd(prevFrom), to: toYmd(prevTo) };
};

// ---------- delta helper ----------
// Devuelve {pct, direction:'up'|'down'|'flat', isNew:bool}.
// isNew=true cuando el previo era 0 y ahora hay valor → sin base de
// comparación, mostrar como "nuevo" en vez de +∞.
export const computeDelta = (current, previous) => {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0 && cur === 0) return { pct: 0, direction: 'flat', isNew: false };
  if (prev === 0 && cur > 0) return { pct: null, direction: 'up', isNew: true };
  const pct = Math.round(((cur - prev) / prev) * 100);
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { pct, direction, isNew: false };
};

// ---------- date validation para rango custom ----------
export const isValidYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export const clampCustomRange = (from, to) => {
  if (!isValidYmd(from) || !isValidYmd(to)) return null;
  const fromD = new Date(from);
  const toD = new Date(to);
  if (isNaN(fromD) || isNaN(toD)) return null;
  if (fromD > toD) return null;
  // Máximo 24 meses (mismo límite que el server).
  const maxMs = 24 * 31 * 24 * 60 * 60 * 1000;
  if (toD.getTime() - fromD.getTime() > maxMs) return null;
  // No permitir "to" en el futuro.
  const now = new Date();
  if (toD > now) return { from, to: toYmd(now) };
  return { from, to };
};
