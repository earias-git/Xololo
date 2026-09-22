import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

import css from './AdminGrowthChart.module.css';

// XOLOLO F3 · ampliación admin: gráfica de crecimiento del catálogo
// (productos vs servicios publicados por mes). Lazy-loaded desde
// AdminCatalogView (recharts ~90kb gzip, sólo se carga en esta vista).

const XOLOLO_PRODUCTS_COLOR = '#232d40'; // navy oficial
const XOLOLO_SERVICES_COLOR = '#5DCAA5'; // verde del logo

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className={css.tooltip}>
      <p className={css.tooltipLabel}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className={css.tooltipLine}>
          <span>{p.name}:</span> <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
};

const AdminGrowthChart = ({ growth }) => {
  return (
    <div className={css.wrap}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={growth} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(35, 45, 64, 0.04)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="products"
            name="Productos"
            stackId="a"
            fill={XOLOLO_PRODUCTS_COLOR}
            radius={[0, 0, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
          <Bar
            dataKey="services"
            name="Servicios"
            stackId="a"
            fill={XOLOLO_SERVICES_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AdminGrowthChart;
