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

// XOLOLO F3 · Gráfica standalone para el bucketing del dashboard.
// Se carga lazy desde DashboardPage (Recharts pesa ~90kb gzip y sólo
// se necesita aquí).

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
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
    </div>
  );
};

const yTickFormatter = value => {
  const mxn = value / 100;
  if (mxn >= 1_000_000) return `${(mxn / 1_000_000).toFixed(1)}M`;
  if (mxn >= 1_000) return `${(mxn / 1_000).toFixed(1)}k`;
  return mxn.toFixed(0);
};

const DashboardChart = ({ buckets }) => {
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
            width={44}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(35, 45, 64, 0.04)' }} />
          <Bar
            dataKey="salesAmount"
            fill="#1f8f52"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DashboardChart;
