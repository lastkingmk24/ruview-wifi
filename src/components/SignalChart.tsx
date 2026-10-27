import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import type { SignalHistoryPoint } from '../types';

export type ChartMetric = 'rssi' | 'amplitude' | 'variance' | 'phase';

interface Props {
  points: SignalHistoryPoint[];
  metric: ChartMetric;
  onMetricChange: (metric: ChartMetric) => void;
  phaseAvailable: boolean;
}

const METRICS: Array<{ id: ChartMetric; label: string; unit: string; color: string }> = [
  { id: 'rssi', label: 'RSSI', unit: 'dBm', color: '#54dfff' },
  { id: 'amplitude', label: 'CSI amp', unit: 'mean', color: '#9b87ff' },
  { id: 'variance', label: 'Variance', unit: 'RF', color: '#7de3a6' },
  { id: 'phase', label: 'Phase', unit: 'rad', color: '#f1bb70' },
];

function metricValue(point: SignalHistoryPoint, metric: ChartMetric): number | null {
  switch (metric) {
    case 'rssi': return point.rssiDbm;
    case 'amplitude': return point.amplitude;
    case 'variance': return point.variance;
    case 'phase': return point.phase;
  }
}

function chartData(points: SignalHistoryPoint[], metric: ChartMetric): uPlot.AlignedData {
  return [
    points.map((_, index) => index),
    points.map((point) => metricValue(point, metric)),
  ];
}

export default function SignalChart({ points, metric, onMetricChange, phaseAvailable }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const data = useMemo(() => chartData(points, metric), [points, metric]);
  const selection = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const hasData = points.some((point) => metricValue(point, metric) !== null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasData) return;
    const width = Math.max(160, host.clientWidth || 360);
    const options: uPlot.Options = {
      width,
      height: 106,
      padding: [8, 8, 0, 0],
      scales: { x: { time: false }, y: { auto: true } },
      series: [
        {},
        {
          label: selection.label,
          stroke: selection.color,
          width: 1.7,
          fill: `${selection.color}14`,
          points: { show: false },
          spanGaps: false,
        },
      ],
      axes: [
        { show: false },
        {
          size: 40,
          stroke: '#778794',
          grid: { stroke: 'rgba(121, 151, 169, .10)', width: 1 },
          ticks: { stroke: 'rgba(121, 151, 169, .18)', width: 1, size: 4 },
          font: '9px "IBM Plex Mono", monospace',
          values: (_plot, values) => values.map((value) => Number(value).toFixed(metric === 'variance' ? 1 : 0)),
        },
      ],
      legend: { show: false },
      cursor: { show: false },
      class: 'ruview-uplot',
    };

    const chart = new uPlot(options, data, host);
    plotRef.current = chart;
    const resize = () => chart.setSize({ width: Math.max(160, host.clientWidth || 360), height: 106 });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    return () => {
      observer?.disconnect();
      chart.destroy();
      plotRef.current = null;
    };
  }, [hasData, metric, selection.color, selection.label]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <div className="signal-chart-wrap">
      <div className="chart-toolbar" role="tablist" aria-label="Signal chart measurement">
        {METRICS.map((item) => {
          const disabled = item.id === 'phase' && !phaseAvailable;
          return (
            <button
              className={`chart-tab ${metric === item.id ? 'is-selected' : ''}`}
              key={item.id}
              type="button"
              role="tab"
              aria-selected={metric === item.id}
              disabled={disabled}
              title={disabled ? 'Phase is not included in this live RuView stream.' : `${item.label} (${item.unit})`}
              onClick={() => onMetricChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
        <span className="chart-unit">{selection.unit}</span>
      </div>
      {hasData ? <div className="chart-host" ref={hostRef} aria-label={`${selection.label} live signal chart`} /> : (
        <div className="chart-unavailable" role="status">
          <span className="chart-baseline" />
          <span>No {selection.label.toLowerCase()} samples received</span>
        </div>
      )}
    </div>
  );
}
