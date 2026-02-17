import React from 'react';
import PropTypes from 'prop-types';
import './BudgetChart.css';
import { fmtDisplayNoCents } from '/imports/ui/Budget/utils/formatters.js';

export const BudgetChart = ({ items, width = 720, height = 180, padding = 28, yFormatter = fmtDisplayNoCents, yLabel = 'Total TTC' }) => {
  // Left padding larger to fit Y labels
  const leftPad = Math.max(44, padding);
  const bottomPad = padding;
  // Fill missing months to keep continuity
  const normalized = (() => {
    if (!items || items.length === 0) return [];
    const map = new Map(items);
    const keys = items.map(([k]) => k).sort();
    const first = keys[0];
    const last = keys[keys.length - 1];
    const parse = (s) => { const [y, m] = s.split('-').map(Number); return { y, m }; };
    const inc = ({ y, m }) => ({ y: m === 12 ? y + 1 : y, m: m === 12 ? 1 : m + 1 });
    const toKey = ({ y, m }) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
    const start = parse(first);
    const end = parse(last);
    const out = [];
    for (let cur = start; !(cur.y > end.y || (cur.y === end.y && cur.m > end.m)); cur = inc(cur)) {
      const key = toKey(cur);
      out.push([key, Number(map.get(key) || 0)]);
    }
    return out;
  })();
  const series = normalized.length ? normalized : items;
  const max = series.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  const barWidth = Math.max(8, Math.floor((width - leftPad * 2) / Math.max(1, series.length)) - 6);
  // Nice ticks (1/2/5 * 10^n)
  const niceStep = (() => {
    const rough = max / 4;
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough || 1)));
    const unit = rough / pow10;
    let base;
    if (unit <= 1) base = 1; else if (unit <= 2) base = 2; else if (unit <= 5) base = 5; else base = 10;
    return base * pow10;
  })();
  const niceMax = Math.ceil(max / niceStep) * niceStep || niceStep;
  const ticks = Math.max(1, Math.round(niceMax / niceStep));

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Monthly totals bar chart">
      {/* axes */}
      <line className="axis" x1={leftPad} y1={padding} x2={leftPad} y2={height - bottomPad} />
      <line className="axis" x1={leftPad} y1={height - bottomPad} x2={width - padding} y2={height - bottomPad} />
      {/* y-axis ticks, labels and gridlines */}
      {[...Array(ticks + 1)].map((_, i) => {
        const value = i * niceStep;
        const y = (height - bottomPad) - Math.round(((height - padding * 2) * value) / (niceMax || 1));
        return (
          <g key={`yt${i}`}>
            <line className="axis" x1={leftPad - 3} y1={y} x2={leftPad} y2={y} />
            <line className="grid" x1={leftPad} y1={y} x2={width - padding} y2={y} />
            <text x={leftPad - 6} y={y + 3} textAnchor="end">{yFormatter(value)}</text>
          </g>
        );
      })}
      {/* bars */}
      {series.map(([key, value], index) => {
        const x = leftPad + index * ((width - leftPad * 2) / Math.max(1, series.length)) + 3;
        const barHeight = Math.round(((height - padding * 2) * value) / (niceMax || 1));
        const y = (height - bottomPad) - barHeight;
        return <rect key={key} className="bar" x={x} y={y} width={barWidth} height={barHeight} rx="3" ry="3" />;
      })}
      {/* x labels (YYYY-MM) */}
      {series.map(([key], index) => {
        const x = leftPad + index * ((width - leftPad * 2) / Math.max(1, series.length)) + barWidth / 2;
        return <text key={`t${key}`} x={x} y={height - 10} textAnchor="middle">{key}</text>;
      })}
      {/* axis title */}
      <text x={leftPad - 8} y={padding - 6} textAnchor="end">{yLabel}</text>
    </svg>
  );
};

export default BudgetChart;

BudgetChart.propTypes = {
  items: PropTypes.arrayOf(PropTypes.array).isRequired,
  width: PropTypes.number,
  height: PropTypes.number,
  padding: PropTypes.number,
};


