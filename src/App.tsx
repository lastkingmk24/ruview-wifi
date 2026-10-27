import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  FileDown,
  Gauge,
  HeartPulse,
  Orbit,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type {
  BackendHealth,
  ConnectionState,
  DataMode,
  ObservatoryFrame,
  ScenarioId,
  SignalHistoryPoint,
  SystemEvent,
  TransportMode,
} from './types';
import { toSignalHistoryPoint } from './data/ruviewAdapter';
import { createSimulationFrame, SIMULATION_SCENARIOS } from './data/simulationProvider';
import { RuViewLiveProvider } from './data/liveProvider';
import type { ChartMetric } from './components/SignalChart';
import Panel from './components/Panel';
import {
  EventsPanel,
  HeroSignalPresencePanel,
  HeroVitalsPanel,
  PosePanel,
  PresencePanel,
  SensorPanel,
  SignalPanel,
  SystemPanel,
  VitalPanel,
} from './components/TelemetryPanels';

const ObservatoryScene = lazy(() => import('./components/ObservatoryScene'));

const MAX_HISTORY = 180;
const MAX_EVENTS = 100;
const INITIAL_HEALTH: BackendHealth = {
  status: 'unknown', source: null, tick: null, clients: null, lastCheck: null, error: null,
};

function makeEvent(level: SystemEvent['level'], title: string, detail: string): SystemEvent {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, timestamp: Date.now(), level, title, detail };
}

function saveJson(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

function displayFrameForNode(frame: ObservatoryFrame | null, selectedNodeId: string): ObservatoryFrame | null {
  if (!frame || selectedNodeId === 'all') return frame;
  const node = frame.nodes.find((candidate) => String(candidate.nodeId) === selectedNodeId);
  if (!node) return frame;
  return {
    ...frame,
    rssiDbm: node.rssiDbm,
    csiAmplitude: node.amplitude.length ? node.amplitude : null,
    csiPhase: node.phase,
    signalVariance: null,
    signalQuality: null,
  };
}

export default function App() {
  const [mode, setMode] = useState<DataMode>('simulation');
  const [scenarioId, setScenarioId] = useState<ScenarioId>('multi-person');
  const [isPlaying, setIsPlaying] = useState(true);
  const [transport, setTransport] = useState<TransportMode>('websocket');
  const [liveRequested, setLiveRequested] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [health, setHealth] = useState<BackendHealth>(INITIAL_HEALTH);
  const [nodes, setNodes] = useState<ObservatoryFrame['nodes']>([]);
  const [frame, setFrame] = useState<ObservatoryFrame | null>(() => createSimulationFrame(0, 'multi-person', Date.now()));
  const [historyFrames, setHistoryFrames] = useState<ObservatoryFrame[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>(() => [
    makeEvent('success', 'Simulation source active', 'Synthetic deterministic data is clearly separated from live sensor input.'),
    makeEvent('info', 'Local session started', 'No sensing hardware is being accessed in simulation mode.'),
  ]);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showWaves, setShowWaves] = useState(true);
  const [wireframe, setWireframe] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showFps, setShowFps] = useState(false);
  const [fps, setFps] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showVitalsCard, setShowVitalsCard] = useState(true);
  const [showSignalCard, setShowSignalCard] = useState(true);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertThreshold, setAlertThreshold] = useState(0.72);
  const [selectedNodeId, setSelectedNodeId] = useState('all');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('rssi');
  const [resetToken, setResetToken] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [toast, setToast] = useState<string | null>(null);
  const [sessionStartedAt] = useState(() => new Date().toISOString());
  const simulationTick = useRef(0);
  const previousAlertState = useRef(false);
  const frozenFrame = useRef<ObservatoryFrame | null>(null);
  const frozenHistory = useRef<ObservatoryFrame[] | null>(null);
  const providerRef = useRef<RuViewLiveProvider | null>(null);
  const scenarioSelectRef = useRef<HTMLSelectElement>(null);
  const scenario = SIMULATION_SCENARIOS.find((candidate) => candidate.id === scenarioId) ?? SIMULATION_SCENARIOS[0];

  const pushEvent = useCallback((event: SystemEvent) => {
    setEvents((current) => [...current, event].slice(-MAX_EVENTS));
  }, []);

  const acceptFrame = useCallback((next: ObservatoryFrame) => {
    setFrame(next);
    setHistoryFrames((current) => {
      if (current[current.length - 1]?.id === next.id) return current;
      return [...current, next].slice(-MAX_HISTORY);
    });
    if (next.nodes.length) setNodes(next.nodes);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode !== 'simulation' || !isPlaying) return;
    const advance = () => {
      const next = createSimulationFrame(simulationTick.current, scenarioId, Date.now());
      simulationTick.current += 1;
      acceptFrame(next);
    };
    advance();
    const timer = window.setInterval(advance, 300);
    return () => window.clearInterval(timer);
  }, [mode, scenarioId, isPlaying, acceptFrame]);

  useEffect(() => {
    if (mode !== 'live' || !liveRequested) {
      providerRef.current = null;
      return;
    }

    const provider = new RuViewLiveProvider({
      onFrame: acceptFrame,
      onNodes: setNodes,
      onHealth: setHealth,
      onStatus: setConnection,
      onError: (message) => setHealth((current) => ({ ...current, error: message })),
      onEvent: pushEvent,
    });
    providerRef.current = provider;
    provider.start(transport);
    return () => {
      provider.disconnect(false);
      if (providerRef.current === provider) providerRef.current = null;
    };
  }, [mode, liveRequested, transport, acceptFrame, pushEvent]);

  useEffect(() => {
    const alertActive = Boolean(
      frame
      && frame.presence === true
      && alertEnabled
      && (frame.detectionConfidence ?? 0) >= alertThreshold,
    );
    if (alertActive && !previousAlertState.current && frame) {
      const label = frame.sourceIsSimulated ? 'Synthetic sample' : frame.source;
      pushEvent(makeEvent('detection', 'Presence threshold crossed', `${label} · ${Math.round((frame.detectionConfidence ?? 0) * 100)}% confidence.`));
    }
    previousAlertState.current = alertActive;
  }, [frame?.id, frame?.presence, frame?.detectionConfidence, frame?.source, frame?.sourceIsSimulated, alertEnabled, alertThreshold, pushEvent]);

  const displayFrame = displayFrameForNode(isPlaying ? frame : frozenFrame.current, selectedNodeId);
  const displayHistory = isPlaying ? historyFrames : (frozenHistory.current ?? historyFrames);
  const signalHistory: SignalHistoryPoint[] = useMemo(
    () => displayHistory.map((sample) => toSignalHistoryPoint(sample, selectedNodeId === 'all' ? null : Number(selectedNodeId))),
    [displayHistory, selectedNodeId],
  );
  const modeIsLive = mode === 'live';

  const switchMode = (nextMode: DataMode) => {
    if (nextMode === mode) return;
    providerRef.current?.disconnect();
    setLiveRequested(false);
    setConnection('disconnected');
    setHealth(INITIAL_HEALTH);
    setHistoryFrames([]);
    setNodes([]);
    setFrame(nextMode === 'simulation' ? createSimulationFrame(0, scenarioId, Date.now()) : null);
    simulationTick.current = 0;
    previousAlertState.current = false;
    frozenFrame.current = null;
    frozenHistory.current = null;
    setMode(nextMode);
    setIsPlaying(true);
    pushEvent(makeEvent('info', nextMode === 'simulation' ? 'Switched to simulation' : 'Live mode selected', nextMode === 'simulation'
      ? 'Synthetic scenario data is active; no sensor is being read.'
      : 'Connect to a RuView sensing-server to receive live backend output.'));
  };

  const togglePlayback = () => {
    if (isPlaying) {
      frozenFrame.current = frame;
      frozenHistory.current = historyFrames;
      setIsPlaying(false);
      pushEvent(makeEvent('warning', 'Visualization paused', modeIsLive
        ? 'Only this viewer is paused; backend sensing may continue.'
        : 'The deterministic simulation clock is paused.'));
    } else {
      frozenFrame.current = null;
      frozenHistory.current = null;
      setIsPlaying(true);
      pushEvent(makeEvent('info', 'Visualization resumed', 'The observatory display is updating again.'));
    }
  };

  const connectLive = () => {
    frozenFrame.current = null;
    frozenHistory.current = null;
    setIsPlaying(true);
    setHistoryFrames([]);
    setFrame(null);
    setHealth(INITIAL_HEALTH);
    setLiveRequested(true);
  };

  const disconnectLive = () => {
    providerRef.current?.disconnect();
    setLiveRequested(false);
    setConnection('disconnected');
  };

  const handleScenarioChange = (value: string) => {
    const next = value as ScenarioId;
    setScenarioId(next);
    simulationTick.current = 0;
    setHistoryFrames([]);
    previousAlertState.current = false;
    const nextScenario = SIMULATION_SCENARIOS.find((candidate) => candidate.id === next);
    if (nextScenario) pushEvent(makeEvent('info', 'Simulation scenario changed', `${nextScenario.label}: ${nextScenario.description}`));
  };

  const handleClearSession = () => {
    const stoppedLiveStream = mode === 'live' && liveRequested;
    if (stoppedLiveStream) {
      providerRef.current?.disconnect();
      setLiveRequested(false);
      setConnection('disconnected');
      setHealth(INITIAL_HEALTH);
    } else if (mode === 'simulation') {
      setIsPlaying(false);
    }
    frozenFrame.current = null;
    frozenHistory.current = null;
    previousAlertState.current = false;
    setHistoryFrames([]);
    setEvents([]);
    setFrame(null);
    setNodes([]);
    setToast(stoppedLiveStream
      ? 'Local buffer cleared · backend stream disconnected.'
      : mode === 'simulation'
        ? 'Local buffer cleared · simulation paused.'
        : 'Local session buffer cleared.');
    window.setTimeout(() => setToast(null), 2_400);
  };

  const exportSettings = () => {
    saveJson('ruview-observatory-settings.json', {
      schema: 'ruview-observatory-settings/v1',
      exportedAt: new Date().toISOString(),
      mode,
      scenario: scenarioId,
      transport,
      selectedNodeId,
      alerts: { enabled: alertEnabled, confidenceThreshold: alertThreshold },
      visualization: { showSkeleton, showGrid, showWaves, wireframe, autoRotate, showFps, isPlaying, showVitalsCard, showSignalCard },
    });
    pushEvent(makeEvent('success', 'Settings exported', 'Observatory preferences downloaded as JSON.'));
  };

  const exportSession = () => {
    saveJson('ruview-observatory-session.json', {
      schema: 'ruview-observatory-session/v1',
      label: mode === 'simulation' || frame?.sourceIsSimulated ? 'synthetic sample data' : 'RuView backend output',
      exportedAt: new Date().toISOString(),
      sessionStartedAt,
      mode,
      scenario: mode === 'simulation' ? scenarioId : undefined,
      sampleCount: historyFrames.length,
      frames: historyFrames.slice(-120),
    });
    pushEvent(makeEvent('success', 'Session sample downloaded', `${Math.min(historyFrames.length, 120)} in-memory frames exported by explicit user request.`));
  };

  const exportDiagnostics = () => {
    saveJson('ruview-observatory-diagnostics.json', {
      schema: 'ruview-observatory-diagnostics/v1',
      exportedAt: new Date().toISOString(),
      mode,
      transport: mode === 'live' ? transport : 'local simulation',
      connection,
      backendHealth: health,
      source: frame?.source ?? null,
      lastFrameAt: frame?.timestamp ?? null,
      sensorNodeCount: nodes.length,
      events: events.slice(-MAX_EVENTS),
      note: 'Diagnostic export excludes pose keypoints, raw CSI arrays and vital values.',
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.code === 'KeyA') {
        setAutoRotate((current) => !current);
      } else if (event.code === 'KeyD') {
        event.preventDefault();
        scenarioSelectRef.current?.focus();
      } else if (event.code === 'KeyF') {
        setShowFps((current) => !current);
      } else if (event.code === 'KeyS') {
        setShowSettings((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlayback]);

  const titleMode = mode === 'simulation' ? 'SIMULATION ENVIRONMENT' : 'LIVE BACKEND VIEW';
  const liveIndicator = mode === 'live' && liveRequested && connection === 'connected' && health.status === 'healthy';
  const liveBadgeClass = mode === 'simulation' || (liveIndicator && displayFrame?.sourceIsSimulated)
    ? 'is-sim'
    : liveIndicator ? 'is-live' : '';
  const liveBadgeText = mode === 'simulation'
    ? 'SIMULATION'
    : !liveRequested
      ? 'LIVE DISCONNECTED'
      : connection !== 'connected'
        ? connection.toUpperCase()
        : health.status === 'healthy'
          ? displayFrame?.sourceIsSimulated ? 'BACKEND SIM' : 'LIVE BACKEND'
          : health.status === 'degraded'
            ? health.source && /offline|unavailable/i.test(health.source) ? 'SOURCE DEGRADED' : 'BACKEND DEGRADED'
            : `SOURCE ${health.status.toUpperCase()}`;
  const sceneStatusLabel = mode === 'simulation'
    ? 'SIMULATION FIELD'
    : !liveRequested
      ? 'BACKEND DISCONNECTED'
      : health.status === 'healthy'
        ? 'BACKEND LINK ACTIVE'
        : 'BACKEND WAITING';

  return (
    <div className="observatory-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">π</div>
          <div className="brand-wordmark"><b>RuView</b><small>WIFI DENSEPOSE SENSING OBSERVATORY</small></div>
        </div>
        <div className="topbar-actions">
          <div className="mode-switch hero-mode-switch" role="group" aria-label="Data mode">
            <button type="button" className={mode === 'simulation' ? 'selected' : ''} aria-label="Demo simulation" aria-pressed={mode === 'simulation'} onClick={() => switchMode('simulation')}><i /> DEMO</button>
            <button type="button" className={mode === 'live' ? 'selected' : ''} aria-label="Live backend" aria-pressed={mode === 'live'} onClick={() => switchMode('live')}><Wifi size={13} /> LIVE</button>
          </div>
          {mode === 'live' ? <span className={`topbar-live ${liveBadgeClass}`} role="status"><i />{liveBadgeText}</span> : null}
          {mode === 'simulation' ? (
            <label className="scenario-picker hero-scenario-picker">
              <span>SCENARIO</span>
              <select ref={scenarioSelectRef} aria-label="Simulation scenario" value={scenarioId} onChange={(event) => handleScenarioChange(event.target.value)}>
                {SIMULATION_SCENARIOS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
          ) : (
            <button
              className={`button live-connect-button ${liveRequested ? 'button-danger' : 'button-primary'}`}
              type="button"
              aria-label={liveRequested ? 'Disconnect viewer' : 'Connect to RuView'}
              onClick={liveRequested ? disconnectLive : connectLive}
            >
              <Radio size={13} />{liveRequested ? 'Disconnect viewer' : 'Connect to RuView'}
            </button>
          )}
          <button className={`hero-pose-button ${showSkeleton ? 'is-active' : ''}`} type="button" aria-pressed={showSkeleton} onClick={() => setShowSkeleton((value) => !value)}><Activity size={14} /><span>Pose Fusion</span></button>
          <button className="icon-button hero-settings-button" type="button" aria-label={showSettings ? 'Close settings' : 'Open settings'} aria-expanded={showSettings} title="Visualization settings" onClick={() => setShowSettings((value) => !value)}><Settings size={16} /></button>
          <span className="topbar-clock">{clock.toLocaleTimeString([], { hour12: false })}</span>
        </div>
      </header>

      <main className="observatory-main">
        <section className="hero-stage" aria-label="Live RuView sensing observatory">
          <div className="hero-scene-canvas">
            <Suspense fallback={<div className="scene-loading" role="status">Preparing the 3D sensing room…</div>}>
              <ObservatoryScene
                frame={displayFrame}
                mode={mode}
                liveRequested={liveRequested}
                connection={connection}
                showSkeleton={showSkeleton}
                showGrid={showGrid}
                showWaves={showWaves}
                wireframe={wireframe}
                autoRotate={autoRotate}
                onFps={setFps}
                resetToken={resetToken}
              />
            </Suspense>
          </div>
          <div className="hero-stage-meta">
            <span className={`hero-link-state ${mode === 'simulation' ? 'is-demo' : liveIndicator ? 'is-live' : ''}`}><i />{mode === 'simulation' ? 'SYNTHETIC DEMO FIELD' : sceneStatusLabel}</span>
            <span className="hero-stage-readouts"><span>RF FIELD · ILLUSTRATIVE</span><span>{displayFrame?.personCount === null || displayFrame?.personCount === undefined ? 'PERSON COUNT —' : `${displayFrame.personCount} PERSON${displayFrame.personCount === 1 ? '' : 'S'} REPORTED`}</span></span>
          </div>
          {showFps ? <div className="hero-fps" role="status"><Gauge size={12} />{fps || '—'} FPS · RENDERED</div> : null}

          {showVitalsCard ? <HeroVitalsPanel frame={displayFrame} mode={mode} /> : null}
          {showSignalCard ? <HeroSignalPresencePanel frame={displayFrame} history={signalHistory} mode={mode} /> : null}

          <div className="hero-bottom-row">
            <div className="hero-feature-dock" role="group" aria-label="Overlay visibility">
              <button type="button" className={showSkeleton ? 'is-active' : ''} aria-pressed={showSkeleton} onClick={() => setShowSkeleton((value) => !value)}><Activity size={14} /><span>Human Pose Estimation</span></button>
              <i />
              <button type="button" className={showVitalsCard ? 'is-active' : ''} aria-pressed={showVitalsCard} onClick={() => setShowVitalsCard((value) => !value)}><HeartPulse size={14} /><span>Vital Sign Monitoring</span></button>
              <i />
              <button type="button" className={showSignalCard ? 'is-active' : ''} aria-pressed={showSignalCard} onClick={() => setShowSignalCard((value) => !value)}><Users size={14} /><span>Presence Detection</span></button>
            </div>
            <div className="hero-command-bar" role="group" aria-label="Observatory controls">
              <button type="button" className={autoRotate ? 'is-active' : ''} aria-pressed={autoRotate} onClick={() => setAutoRotate((value) => !value)}><Orbit size={12} /><kbd>A</kbd><span>Orbit</span></button>
              <button type="button" onClick={() => scenarioSelectRef.current?.focus()} disabled={mode !== 'simulation'}><SlidersHorizontal size={12} /><kbd>D</kbd><span>Scenario</span></button>
              <button type="button" className={showFps ? 'is-active' : ''} aria-pressed={showFps} onClick={() => setShowFps((value) => !value)}><Gauge size={12} /><kbd>F</kbd><span>FPS</span></button>
              <button type="button" onClick={() => setShowSettings((value) => !value)}><Settings size={12} /><kbd>S</kbd><span>Settings</span></button>
              <button type="button" aria-label={isPlaying ? 'Pause visualization' : 'Resume visualization'} onClick={togglePlayback}><kbd>SPACE</kbd>{isPlaying ? <Pause size={12} /> : <Play size={12} />}<span>{isPlaying ? 'Pause' : 'Resume'}</span></button>
            </div>
          </div>
          <div className="hero-consent"><ShieldCheck size={12} /><span>AUTHORIZED · CONSENT-BASED · NO ID TRACKING</span></div>
        </section>

        <section className="detail-dashboard" aria-label="Detailed telemetry and system status">
          <header className="detail-heading">
            <div>
              <span className="detail-kicker">{titleMode} · FIELD 01</span>
              <h2>Observatory <em>telemetry</em></h2>
              <p>{mode === 'simulation' ? 'Deterministic sample stream · explicitly synthetic, not physical sensor data.' : 'RuView backend output only · missing measurements remain unavailable.'}</p>
            </div>
            <div className="detail-actions">
              <button type="button" className="button" onClick={exportDiagnostics}><Download size={13} />Diagnostics</button>
              <button type="button" className="button" onClick={exportSession}><FileDown size={13} />Export session</button>
              <button type="button" className="button button-danger" onClick={handleClearSession}>Clear session</button>
            </div>
          </header>

          <div className="details-grid">
            <SensorPanel
              mode={mode}
              frame={displayFrame}
              nodes={nodes}
              health={health}
              connection={connection}
              selectedNodeId={selectedNodeId}
              onSelectedNodeChange={setSelectedNodeId}
              scenario={scenario}
            />
            <PresencePanel
              frame={displayFrame}
              alertEnabled={alertEnabled}
              alertThreshold={alertThreshold}
              onAlertEnabledChange={setAlertEnabled}
              onAlertThresholdChange={setAlertThreshold}
            />
            <SignalPanel
              frame={displayFrame}
              history={signalHistory}
              mode={mode}
              metric={chartMetric}
              onMetricChange={setChartMetric}
            />
            <PosePanel frame={displayFrame} mode={mode} />
            <VitalPanel frame={displayFrame} mode={mode} />
            <Panel title="Processing path" kicker="SIGNAL → ESTIMATE" icon={<Radio size={15} />} className="pipeline-panel">
              <div className="pipeline-steps">
                <div className={`pipeline-step ${displayFrame ? 'is-complete' : 'is-pending'}`}><span>01</span><b>Frame input</b><i>{displayFrame ? <Check size={10} /> : <AlertCircle size={10} />}</i></div>
                <div className="pipeline-step-line" />
                <div className={`pipeline-step ${mode === 'simulation' ? (displayFrame ? 'is-complete' : 'is-pending') : health.status === 'healthy' ? 'is-complete' : 'is-pending'}`}><span>02</span><b>{mode === 'simulation' ? 'Local simulator' : 'RuView backend'}</b><i>{mode === 'simulation' ? (displayFrame ? <Check size={10} /> : <AlertCircle size={10} />) : health.status === 'healthy' ? <Check size={10} /> : <AlertCircle size={10} />}</i></div>
                <div className="pipeline-step-line" />
                <div className={`pipeline-step ${displayFrame?.pose ? 'is-complete' : 'is-pending'}`}><span>03</span><b>Pose output</b><i>{displayFrame?.pose ? <Check size={10} /> : <AlertCircle size={10} />}</i></div>
              </div>
              <div className="pipeline-note">{mode === 'live' ? 'This client consumes RuView output; signal processing stays in the backend.' : 'Synthetic values are generated locally for interface preview.'}</div>
            </Panel>
          </div>

          <section className="lower-grid" aria-label="Events and backend health">
            <EventsPanel events={events} onClear={() => setEvents([])} />
            <SystemPanel mode={mode} transport={transport} connection={connection} health={health} onTransportChange={setTransport} />
          </section>
          <footer className="page-footer">
            <div className="privacy-note"><ShieldCheck size={14} /><span>AUTHORIZED, CONSENT-BASED SENSING ONLY</span><i />Browser buffer stays in memory unless explicitly exported.</div>
            <div className="footer-actions">
              <button type="button" className="text-button" onClick={exportSettings}>Download settings</button>
              <button type="button" className="text-button text-button-warning" onClick={handleClearSession}>Clear local session</button>
            </div>
          </footer>
        </section>
      </main>

      {showSettings ? (
        <div className="settings-popover" role="dialog" aria-label="Observatory settings">
          <div className="settings-popover-heading"><div><span>VISUALIZATION</span><strong>Scene settings</strong></div><button type="button" aria-label="Close settings" onClick={() => setShowSettings(false)}><X size={14} /></button></div>
          <label><input type="checkbox" checked={showSkeleton} onChange={(event) => setShowSkeleton(event.target.checked)} /> Pose Fusion · backend keypoints only</label>
          <label><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /> Spatial floor grid</label>
          <label><input type="checkbox" checked={showWaves} onChange={(event) => setShowWaves(event.target.checked)} /> RF wave field visualization</label>
          <label><input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} /> Room wireframe</label>
          <label><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /> Auto-orbit camera</label>
          <div className="settings-divider" />
          <button type="button" className="settings-action" onClick={() => setResetToken((value) => value + 1)}><RotateCcw size={13} /> Reset camera</button>
          <button type="button" className="settings-action" onClick={exportSettings}><Download size={13} /> Export settings</button>
          <span className="settings-source-note">{mode === 'simulation' ? 'DEMO DATA · SYNTHETIC VALUES' : 'LIVE MODE · BACKEND DATA ONLY'}</span>
        </div>
      ) : null}
      {toast ? <div className="toast" role="status"><Check size={15} />{toast}</div> : null}
    </div>
  );
}
