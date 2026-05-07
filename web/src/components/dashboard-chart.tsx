"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function DashboardChart({
  data,
}: {
  data: Array<{ name: string; validas: number; invalidas: number }>;
}) {
  return (
    <div className="h-72 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-4 text-sm font-medium text-neutral-800">
        Validações recentes
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="validas" fill="#16a34a" radius={[4, 4, 0, 0]} />
          <Bar dataKey="invalidas" fill="#dc2626" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
