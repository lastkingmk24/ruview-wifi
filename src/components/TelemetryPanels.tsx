import {
  Activity,
  AlertTriangle,
  Antenna,
  Check,
  CircleDot,
  HeartPulse,
  Radio,
  ShieldCheck,
  UserRound,
  Wind,
  Wifi,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import type {
  BackendHealth,
  ConnectionState,
  DataMode,
  ObservatoryFrame,
  Scenario,
  SensorNode,
  SignalHistoryPoint,
  SystemEvent,
  TransportMode,
} from '../types';
import Panel from './Panel';
import type { ChartMetric } from './SignalChart';

const SignalChart = lazy(() => import('./SignalChart'));

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

function decibel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} dBm`;
}

function formatClock(timestamp: number | null | undefined): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function signalLabel(quality: number | null): string {
  if (quality === null) return 'NOT REPORTED';
  if (quality >= 0.72) return 'GOOD';
  if (quality >= 0.42) return 'FAIR';
  return 'LOW';
}

function heroProvenance(frame: ObservatoryFrame | null, mode: DataMode): string {
  if (!frame) return 'NO DATA';
  return frame.sourceIsSimulated || mode === 'simulation' ? 'DEMO · SYNTHETIC' : 'BACKEND OUTPUT';
}

export function HeroVitalsPanel({ frame, mode }: { frame: ObservatoryFrame | null; mode: DataMode }) {
  const vitals = frame?.vitals;
  const detectionConfidence = frame?.detectionConfidence ?? null;
  const breath = vitals?.breathingRateBpm;
  const heart = vitals?.heartRateBpm;
  const estimated = Boolean(frame && (mode === 'simulation' || frame.sourceIsSimulated));
  const heartConfidence = vitals?.heartConfidence ?? null;
  const breathingConfidence = vitals?.breathingConfidence ?? null;

  return (
    <section className="hero-card hero-vitals-card" aria-label="Vital signs">
      <div className="hero-card-heading">
        <span className="hero-card-title">VITAL SIGNS</span>
        <span className={`hero-provenance ${estimated ? 'is-demo' : ''}`}>{heroProvenance(frame, mode)}</span>
      </div>
      <div className="hero-vital-item">
        <HeartPulse size={16} className="hero-vital-icon hero-heart-icon" />
        <div className="hero-vital-copy">
          <span>HEART RATE</span>
          <div className="hero-vital-value"><strong>{heart === null || heart === undefined ? '—' : Math.round(heart)}</strong><small>BPM</small></div>
          <div className="hero-meter"><i style={{ width: `${Math.round((heartConfidence ?? 0) * 100)}%` }} /></div>
        </div>
      </div>
      <div className="hero-vital-item">
        <Wind size={16} className="hero-vital-icon hero-breath-icon" />
        <div className="hero-vital-copy">
          <span>RESPIRATION</span>
          <div className="hero-vital-value"><strong>{breath === null || breath === undefined ? '—' : Math.round(breath)}</strong><small>RPM</small></div>
          <div className="hero-meter"><i style={{ width: `${Math.round((breathingConfidence ?? 0) * 100)}%` }} /></div>
        </div>
      </div>
      <div className="hero-vital-foot">
        <span>{estimated ? 'SAMPLE QUALITY' : 'DETECTION CONFIDENCE'}</span>
        <strong>{percent(estimated ? vitals?.signalQuality : detectionConfidence)}</strong>
      </div>
      <p className="hero-card-note">{estimated ? 'Synthetic demo values · not medical readings.' : 'Experimental estimates only · not a medical device.'}</p>
    </section>
  );
}

export function HeroSignalPresencePanel({
  frame,
  history,
  mode,
}: {
  frame: ObservatoryFrame | null;
  history: SignalHistoryPoint[];
  mode: DataMode;
}) {
  const presence = frame?.presence ?? null;
  const personCount = frame?.personCount ?? (presence === false ? 0 : null);
  const readings = history.map((point) => point.rssiDbm).filter((value): value is number => value !== null);
  const latestWindow = readings.slice(-42);
  const min = latestWindow.length ? Math.min(...latestWindow) : 0;
  const max = latestWindow.length ? Math.max(...latestWindow) : 1;
  const range = Math.max(1, max - min);
  const linePoints = latestWindow.map((value, index) => {
    const x = latestWindow.length > 1 ? (index / (latestWindow.length - 1)) * 100 : 0;
    const y = 30 - ((value - min) / range) * 19;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const presenceLabel = presence === true ? 'ACTIVE' : presence === false ? 'ROOM CLEAR' : 'UNAVAILABLE';
  const presenceClass = presence === true ? 'is-active' : presence === false ? 'is-clear' : 'is-unknown';

  return (
    <section className="hero-card hero-signal-card" aria-label="Wi-Fi signal and presence">
      <div className="hero-card-heading">
        <span className="hero-card-title">WIFI SIGNAL</span>
        <span className={`hero-provenance ${(mode === 'simulation' || frame?.sourceIsSimulated) ? 'is-demo' : ''}`}>{heroProvenance(frame, mode)}</span>
      </div>
      <div className="hero-signal-rows">
        <div><span>RSSI</span><strong>{decibel(frame?.rssiDbm ?? null)}</strong></div>
        <div><span>Variance</span><strong>{frame?.signalVariance === null || frame?.signalVariance === undefined ? '—' : frame.signalVariance.toFixed(2)}</strong></div>
        <div><span>Motion</span><strong>{frame?.movementScore === null || frame?.movementScore === undefined ? '—' : frame.movementScore.toFixed(3)}</strong></div>
        <div><span>Persons</span><strong>{personCount === null ? '—' : personCount}</strong></div>
      </div>
      <div className={`hero-sparkline ${linePoints ? 'has-values' : ''}`} aria-label={readings.length ? `RSSI history, ${readings.length} samples` : 'No RSSI history received'}>
        {linePoints ? (
          <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="hero-signal-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3199ff" stopOpacity=".34" /><stop offset="100%" stopColor="#3199ff" stopOpacity="0" /></linearGradient></defs>
            <polygon points={`0,34 ${linePoints} 100,34`} fill="url(#hero-signal-fill)" />
            <polyline points={linePoints} fill="none" stroke="#2f9dff" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : <span>WAITING FOR BACKEND DATA</span>}
      </div>
      <div className="hero-presence-label"><span>PRESENCE</span><i className={`hero-presence-dot ${presenceClass}`} /><strong className={presenceClass}>{presenceLabel}</strong></div>
      <p className="hero-card-note">{frame ? 'Signal and person count from the selected source.' : 'Connect RuView to receive wireless sensor data.'}</p>
    </section>
  );
}

function sourceLabel(frame: ObservatoryFrame | null, mode: DataMode): string {
  if (mode === 'simulation') return 'SYNTHETIC SAMPLE';
  if (!frame) return 'WAITING FOR BACKEND';
  return frame.sourceIsSimulated ? `BACKEND · ${frame.source}` : frame.source;
}

interface PresenceProps {
  frame: ObservatoryFrame | null;
  alertEnabled: boolean;
  alertThreshold: number;
  onAlertEnabledChange: (enabled: boolean) => void;
  onAlertThresholdChange: (threshold: number) => void;
}

export function PresencePanel({ frame, alertEnabled, alertThreshold, onAlertEnabledChange, onAlertThresholdChange }: PresenceProps) {
  const presence = frame?.presence ?? null;
  const detected = presence === true;
  const personCount = frame?.personCount ?? (presence === false ? 0 : null);
  const confidence = frame?.detectionConfidence ?? null;
  const movement = frame?.movementLabel?.replaceAll('_', ' ') ?? 'not reported';
  return (
    <Panel title="Presence field" kicker="ZONE A · OCCUPANCY" icon={<UserRound size={15} />} className="presence-panel">
      <div className="presence-state-row">
        <span className={`presence-orb ${detected ? 'is-active' : presence === false ? 'is-clear' : ''}`} aria-hidden="true"><i /></span>
        <div className="presence-state-copy">
          <strong>{presence === null ? 'UNAVAILABLE' : detected ? 'PRESENCE DETECTED' : 'ROOM CLEAR'}</strong>
          <span>{movement} <i /> {frame?.presence === null || !frame ? 'no estimate' : 'motion class'}</span>
        </div>
        <div className={`presence-count ${detected ? 'is-lit' : ''}`}>{personCount === null ? '—' : String(personCount).padStart(2, '0')}<small>PERSONS</small></div>
      </div>
      <div className="meter-row">
        <div className="meter-label"><span>Detection confidence</span><b>{percent(confidence)}</b></div>
        <div className="meter-track"><span style={{ width: `${Math.max(0, Math.min(100, (confidence ?? 0) * 100))}%` }} /></div>
      </div>
      <div className="presence-meta">
        <span><Activity size={13} /> Motion activity</span>
        <b>{frame?.movementScore === null || frame?.movementScore === undefined ? 'Not available' : `${frame.movementScore.toFixed(2)} RF power`}</b>
      </div>
      <div className="alert-setting">
        <button
          className={`switch ${alertEnabled ? 'is-on' : ''}`}
          type="button"
          role="switch"
          aria-checked={alertEnabled}
          aria-label="Presence alerts"
          onClick={() => onAlertEnabledChange(!alertEnabled)}
        ><span /></button>
        <div className="alert-setting-copy"><b>Presence alert</b><small>{alertEnabled ? `Armed at ${Math.round(alertThreshold * 100)}% confidence` : 'Alerts muted'}</small></div>
        <AlertTriangle size={14} className="alert-glyph" />
      </div>
      <label className="threshold-control">
        <span>Alert threshold</span><span className="mono">{Math.round(alertThreshold * 100)}%</span>
        <input
          aria-label="Alert confidence threshold"
          type="range"
          min="0.5"
          max="0.98"
          step="0.02"
          value={alertThreshold}
          onChange={(event) => onAlertThresholdChange(Number(event.target.value))}
        />
      </label>
    </Panel>
  );
}

interface SignalProps {
  frame: ObservatoryFrame | null;
  history: SignalHistoryPoint[];
  mode: DataMode;
  metric: ChartMetric;
  onMetricChange: (metric: ChartMetric) => void;
}

export function SignalPanel({ frame, history, mode, metric, onMetricChange }: SignalProps) {
  const quality = frame?.signalQuality ?? null;
  const amplitude = frame?.csiAmplitude;
  const phase = frame?.csiPhase;
  const averageAmplitude = amplitude?.length
    ? amplitude.reduce((sum, value) => sum + value, 0) / amplitude.length
    : null;
  const phaseAvailable = Boolean(phase?.length);
  return (
    <Panel
      title="RF telemetry"
      kicker="CHANNEL STATE INFORMATION"
      icon={<Radio size={15} />}
      className="signal-panel"
      action={<span className={`quality-pill quality-${quality === null ? 'unknown' : quality >= 0.72 ? 'good' : quality >= 0.42 ? 'fair' : 'low'}`}><i />{signalLabel(quality)}</span>}
    >
      <div className="signal-readings">
        <div className="signal-reading signal-reading-primary">
          <span>RSSI</span>
          <strong>{decibel(frame?.rssiDbm ?? null)}</strong>
          <small>Received signal strength</small>
        </div>
        <div className="signal-reading">
          <span>CSI amplitude</span>
          <strong>{averageAmplitude === null ? '—' : averageAmplitude.toFixed(2)}</strong>
          <small>{amplitude?.length ? `${amplitude.length} subcarriers` : 'Not exposed'}</small>
        </div>
      </div>
      <div className="signal-vector" aria-label={amplitude?.length ? `Amplitude values for ${amplitude.length} subcarriers` : 'No CSI amplitude data'}>
        {amplitude?.length ? amplitude.slice(0, 56).map((value, index) => {
          const normalized = Math.max(6, Math.min(100, 18 + (value / Math.max(averageAmplitude ?? 1, 1)) * 35 + ((index * 13) % 21)));
          return <span key={index} style={{ height: `${normalized}%` }} />;
        }) : <span className="vector-empty">CSI amplitude unavailable</span>}
      </div>
      <div className="signal-chart-heading">
        <span>Signal history <i>·</i> live window</span>
        <span className="mono">VAR {frame?.signalVariance === null || frame?.signalVariance === undefined ? '—' : frame.signalVariance.toFixed(2)}</span>
      </div>
      <Suspense fallback={<div className="chart-unavailable" role="status">Loading signal chart…</div>}>
        <SignalChart points={history} metric={metric} onMetricChange={onMetricChange} phaseAvailable={phaseAvailable} />
      </Suspense>
      <div className="signal-footnote">
        <span><Antenna size={12} /> {sourceLabel(frame, mode)}</span>
        <span>{phaseAvailable ? `Phase ${phase?.length} sc` : 'Phase · not provided'}</span>
        <span>Updated {formatClock(frame?.timestamp)}</span>
      </div>
    </Panel>
  );
}

export function PosePanel({ frame, mode }: { frame: ObservatoryFrame | null; mode: DataMode }) {
  const pose = frame?.pose ?? null;
  const valid = Boolean(pose && frame?.poseStatus === 'valid');
  const confidence = pose?.confidence ?? null;
  const poseStatusText = valid
    ? '3D display is a projected backend pose'
    : !frame
      ? 'Waiting for source output'
      : frame.poseStatus === 'unreliable'
        ? 'Pose unavailable · keypoints are unreliable'
        : frame.presence === true
          ? 'Presence works without pose keypoints'
          : frame.movementLabel || frame.movementScore !== null
            ? 'Signal/movement available · no pose keypoints'
            : mode === 'live'
              ? 'Backend did not provide pose keypoints'
              : 'No pose in this sample';
  return (
    <Panel
      title="Pose estimation"
      kicker="17-POINT COCO · EXPERIMENTAL"
      icon={<CircleDot size={15} />}
      className="pose-panel"
      action={<span className={`tiny-status ${valid ? 'status-good' : 'status-muted'}`}><i />{valid ? 'VALID' : frame?.poseStatus === 'unreliable' ? 'LOW CONF.' : 'NO POSE'}</span>}
    >
      <div className="pose-summary">
        <div className="pose-confidence"><strong>{percent(confidence)}</strong><span>mean confidence</span></div>
        <div className="pose-source"><span>OUTPUT SOURCE</span><b>{valid ? (frame?.sourceIsSimulated || mode === 'simulation' ? 'SYNTHETIC' : 'RUView BACKEND') : '—'}</b></div>
      </div>
      <div className={`pose-mini-preview ${valid ? 'has-pose' : ''}`} aria-hidden="true">
        {valid && pose ? (
          <svg viewBox="0 0 140 130" role="presentation">
            <g className="mini-bones">
              {[[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]].map(([a, b]) => {
                const first = pose.keypoints[a];
                const second = pose.keypoints[b];
                if (!first || !second || first.confidence < 0.12 || second.confidence < 0.12) return null;
                const x = (point: number) => 70 + (point - 320) * 0.19;
                const y = (point: number) => 20 + (point - 70) * 0.23;
                return <line key={`${a}-${b}`} x1={x(first.x)} y1={y(first.y)} x2={x(second.x)} y2={y(second.y)} />;
              })}
              {pose.keypoints.map((point, index) => point.confidence >= 0.12 ? (
                <circle key={point.name} cx={70 + (point.x - 320) * 0.19} cy={20 + (point.y - 70) * 0.23} r={index === 0 ? 2.8 : 2} />
              ) : null)}
            </g>
          </svg>
        ) : <div className="pose-empty-mark"><span /><span /><span /></div>}
      </div>
      <div className="pose-details">
        <span><b>{valid ? pose?.keypoints.filter((point) => point.confidence >= 0.2).length : '—'}</b> keypoints</span>
        <span>{poseStatusText}</span>
      </div>
      <p className="subtle-note">Pose output is optional; live movement, presence and RF telemetry can continue without keypoints. No skeleton is inferred from RSSI.</p>
    </Panel>
  );
}

export function VitalPanel({ frame, mode }: { frame: ObservatoryFrame | null; mode: DataMode }) {
  const vitals = frame?.vitals;
  const hasAny = Boolean(vitals && (vitals.breathingRateBpm !== null || vitals.heartRateBpm !== null));
  const estimated = frame?.sourceIsSimulated || mode === 'simulation';
  return (
    <Panel
      title="Vital estimates"
      kicker="EXPERIMENTAL · NOT MEDICAL"
      icon={<HeartPulse size={15} />}
      className="vitals-panel"
      action={<span className={`tiny-status ${hasAny ? 'status-good' : 'status-muted'}`}><i />{hasAny ? (estimated ? 'SAMPLE' : 'ESTIMATE') : 'UNAVAILABLE'}</span>}
    >
      <div className="vitals-grid">
        <div className="vital-reading">
          <div className="vital-icon breathing"><Wind size={15} /></div>
          <div className="vital-value"><strong>{vitals?.breathingRateBpm === null || vitals?.breathingRateBpm === undefined ? '—' : vitals.breathingRateBpm.toFixed(1)}</strong><small>bpm</small></div>
          <span className="vital-label">Breathing</span>
          <div className="vital-confidence"><span>CONF.</span><b>{percent(vitals?.breathingConfidence)}</b></div>
        </div>
        <div className="vital-reading">
          <div className="vital-icon heart"><HeartPulse size={15} /></div>
          <div className="vital-value"><strong>{vitals?.heartRateBpm === null || vitals?.heartRateBpm === undefined ? '—' : Math.round(vitals.heartRateBpm)}</strong><small>bpm</small></div>
          <span className="vital-label">Heart rate</span>
          <div className="vital-confidence"><span>CONF.</span><b>{percent(vitals?.heartConfidence)}</b></div>
        </div>
      </div>
      <div className="vital-quality-row">
        <span>Signal quality</span>
        <div className="mini-quality-track"><i style={{ width: `${Math.round((vitals?.signalQuality ?? 0) * 100)}%` }} /></div>
        <b>{percent(vitals?.signalQuality)}</b>
      </div>
      <div className="medical-disclaimer"><ShieldCheck size={13} /><span>Experimental signal estimates only. Not a medical device or diagnosis.</span></div>
    </Panel>
  );
}

interface SensorProps {
  mode: DataMode;
  frame: ObservatoryFrame | null;
  nodes: SensorNode[];
  health: BackendHealth;
  connection: ConnectionState;
  selectedNodeId: string;
  onSelectedNodeChange: (id: string) => void;
  scenario: Scenario;
}

export function SensorPanel({ mode, frame, nodes, health, connection, selectedNodeId, onSelectedNodeChange, scenario }: SensorProps) {
  const live = mode === 'live';
  const available = live && health.status === 'healthy';
  return (
    <Panel
      title="Signal source"
      kicker="DATA PROVENANCE"
      icon={<Wifi size={15} />}
      className="source-panel"
      action={<span className={`tiny-status ${live ? (available ? 'status-good' : 'status-warn') : 'status-sim'}`}><i />{live ? health.status.toUpperCase() : 'SIMULATED'}</span>}
    >
      {live ? (
        <>
          <label className="select-label" htmlFor="sensor-node-select">Select sensor view</label>
          <select id="sensor-node-select" value={selectedNodeId} onChange={(event) => onSelectedNodeChange(event.target.value)}>
            <option value="all">Backend aggregate</option>
            {nodes.map((node) => <option value={String(node.nodeId)} key={node.nodeId}>Node {node.nodeId} · {node.status}</option>)}
          </select>
          <div className="source-value"><span>BACKEND SOURCE</span><b>{frame?.source ?? health.source ?? 'not reported'}</b></div>
          <div className="node-status-list">
            {nodes.length ? nodes.slice(0, 3).map((node) => (
              <div className="node-status-row" key={node.nodeId}>
                <span className={`node-led ${node.status === 'active' ? 'on' : ''}`} />
                <span>CSI node {String(node.nodeId).padStart(2, '0')}</span>
                <b>{decibel(node.rssiDbm)}</b>
              </div>
            )) : <div className="node-empty">No sensor nodes reported by backend.</div>}
          </div>
          <div className="last-update"><span>Last backend check</span><b>{formatClock(health.lastCheck)}</b></div>
        </>
      ) : (
        <>
          <div className="simulation-source-card">
            <span className="sim-wave"><Radio size={16} /></span>
            <div><b>Deterministic sample stream</b><small>{scenario.label} · values are synthetic</small></div>
            <span className="sim-badge">SIM</span>
          </div>
          <div className="node-status-list">
            {nodes.slice(0, 2).map((node) => (
              <div className="node-status-row" key={node.nodeId}>
                <span className="node-led on" /><span>Synthetic node {String(node.nodeId).padStart(2, '0')}</span><b>{decibel(node.rssiDbm)}</b>
              </div>
            ))}
          </div>
          <div className="last-update"><span>Data update</span><b>{frame ? formatClock(frame.timestamp) : '—'}</b></div>
        </>
      )}
      <div className="source-footnote"><i />{live ? `Viewer ${connection} · sensing is read-only here.` : 'No CSI hardware required for this scenario.'}</div>
    </Panel>
  );
}

export function EventsPanel({ events, onClear }: { events: SystemEvent[]; onClear: () => void }) {
  const visibleEvents = [...events].slice(-6).reverse();
  return (
    <Panel
      title="Event stream"
      kicker="SESSION ACTIVITY"
      icon={<Activity size={15} />}
      className="events-panel"
      action={<button className="text-button" type="button" onClick={onClear} disabled={!events.length}>Clear log</button>}
    >
      {visibleEvents.length ? (
        <ol className="event-list">
          {visibleEvents.map((event) => (
            <li className={`event-row event-${event.level}`} key={event.id}>
              <span className="event-marker" />
              <time>{formatClock(event.timestamp)}</time>
              <div><b>{event.title}</b><span>{event.detail}</span></div>
            </li>
          ))}
        </ol>
      ) : <div className="events-empty"><Check size={16} /> Session log cleared. New events will appear here.</div>}
    </Panel>
  );
}

interface SystemProps {
  mode: DataMode;
  transport: TransportMode;
  connection: ConnectionState;
  health: BackendHealth;
  onTransportChange: (transport: TransportMode) => void;
}

export function SystemPanel({ mode, transport, connection, health, onTransportChange }: SystemProps) {
  const live = mode === 'live';
  const connectionLabel = connection === 'connected' ? 'CONNECTED' : connection === 'connecting' ? 'CONNECTING' : connection === 'reconnecting' ? 'RECONNECTING' : connection === 'degraded' ? 'DEGRADED' : 'DISCONNECTED';
  const systemLabel = live && health.status === 'offline'
    ? 'BACKEND OFFLINE'
    : live && health.status === 'degraded'
      ? health.source && /offline|unavailable/i.test(health.source) ? 'SOURCE DEGRADED' : 'BACKEND DEGRADED'
      : connectionLabel;
  return (
    <Panel title="System health" kicker="OBSERVATORY STATUS" icon={<Antenna size={15} />} className="system-panel">
      <div className="system-health-row">
        <span className={`health-lamp ${!live ? 'is-sim' : health.status === 'healthy' ? 'is-good' : health.status === 'offline' ? 'is-bad' : health.status === 'degraded' ? 'is-warn' : ''}`} />
        <div><b>{live ? systemLabel : 'SIMULATION READY'}</b><small>{live ? (health.status === 'healthy' ? 'RuView backend responding' : health.error ?? 'Awaiting backend connection') : 'Local data provider active'}</small></div>
      </div>
      <div className="system-meta-grid">
        <div><span>MODE</span><b>{live ? 'LIVE BACKEND' : 'SYNTHETIC'}</b></div>
        <div><span>TRANSPORT</span><b>{live ? transport.toUpperCase() : 'LOCAL'}</b></div>
        <div><span>SERVER TICK</span><b>{live ? (health.tick ?? '—') : '—'}</b></div>
        <div><span>CLIENTS</span><b>{live ? (health.clients ?? '—') : '—'}</b></div>
      </div>
      {live ? (
        <div className="system-controls">
          <label className="select-label" htmlFor="transport-select">Live feed</label>
          <select id="transport-select" value={transport} onChange={(event) => onTransportChange(event.target.value as TransportMode)}>
            <option value="websocket">WebSocket · /ws/sensing</option>
            <option value="polling">REST polling · 1 sec</option>
          </select>
          <small className="system-disclaimer">Pose keypoints are optional. Disconnect stops this viewer only; stop the backend or sensor to end capture.</small>
        </div>
      ) : (
        <div className="system-controls">
          <span className="local-badge"><CircleDot size={12} /> Session is local · nothing is uploaded</span>
        </div>
      )}
    </Panel>
  );
}
