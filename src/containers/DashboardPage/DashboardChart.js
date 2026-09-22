import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

import { formatSubunitsAsMxn } from './dashboardUtils';

import css from './DashboardChart.module.css';

// XOLOLO F3 · Gráfica para el dashboard.
// Recibe la métrica activa (salesAmount / count / ticketAverage /
// providerAmount) y adapta el yAxis + tooltip. Standalone lazy — sólo
// se carga cuando el user entra a /dashboard (recharts ~90kb gzip).

const XOLOLO_PRIMARY = '#232d40'; // navy oficial Xololo

const CustomTooltip = ({ active, payload, metricKey, metricIsMoney }) => {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  const rawValue = b[metricKey] || 0;
  const displayValue = metricIsMoney ? formatSubunitsAsMxn(rawValue) : rawValue;
  return (
    <div className={css.tooltip}>
      <p className={css.tooltipLabel}>{b.label}</p>
      <p className={css.tooltipLine}>
        <span>Pedidos:</span> <strong>{b.count}</strong>
      </p>
      <p className={css.tooltipLine}>
        <span>Ventas:</span> <strong>{formatSubunitsAsMxn(b.salesAmount)}</strong>
      </p>
      <p className={css.tooltipLine}>
        <span>Neto:</span> <strong>{formatSubunitsAsMxn(b.providerAmount)}</strong>
      </p>
      {metricKey !== 'salesAmount' && metricKey !== 'count' && metricKey !== 'providerAmount' ? (
        <p className={css.tooltipLine}>
          <span>Ticket:</span> <strong>{displayValue}</strong>
        </p>
      ) : null}
    </div>
  );
};

// yTickFormatter: para money reducimos con k/M; para count devolvemos entero.
const buildYTickFormatter = metricIsMoney => value => {
  if (metricIsMoney) {
    const mxn = value / 100;
    if (mxn >= 1_000_000) return `${(mxn / 1_000_000).toFixed(1)}M`;
    if (mxn >= 1_000) return `${(mxn / 1_000).toFixed(1)}k`;
    return mxn.toFixed(0);
  }
  return Math.round(value).toString();
};

const DashboardChart = ({ buckets, metricKey = 'salesAmount', metricIsMoney = true }) => {
  const yTickFormatter = buildYTickFormatter(metricIsMoney);
  return (
    <div className={css.wrap}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={buckets} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={yTickFormatter}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
            width={48}
          />
          <Tooltip
            content={
              <CustomTooltip metricKey={metricKey} metricIsMoney={metricIsMoney} />
            }
            cursor={{ fill: 'rgba(35, 45, 64, 0.04)' }}
          />
          <Bar
            dataKey={metricKey}
            fill={XOLOLO_PRIMARY}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DashboardChart;
