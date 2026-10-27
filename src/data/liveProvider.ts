import type { BackendHealth, ConnectionState, ObservatoryFrame, SensorNode, SystemEvent, TransportMode } from '../types';
import {
  parseBackendHealth,
  parseRuViewSensingUpdate,
  validateRuViewNodes,
} from './ruviewAdapter';

const SNAPSHOT_PATH = '/api/v1/sensing/latest';
const POLL_INTERVAL_MS = 1_000;
const HEALTH_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 4_000;

export interface LiveProviderCallbacks {
  onFrame: (frame: ObservatoryFrame) => void;
  onNodes: (nodes: SensorNode[]) => void;
  onHealth: (health: BackendHealth) => void;
  onStatus: (status: ConnectionState) => void;
  onError: (message: string) => void;
  onEvent: (event: SystemEvent) => void;
}

export interface LiveProviderDependencies {
  fetcher?: typeof fetch;
  webSocketFactory?: (url: string) => WebSocket;
  location?: Location;
  now?: () => number;
}

function makeEvent(level: SystemEvent['level'], title: string, detail: string, now: () => number): SystemEvent {
  return { id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: now(), level, title, detail };
}

function mergeNodes(streamNodes: SensorNode[], statusNodes: SensorNode[]): SensorNode[] {
  const merged = new Map<number, SensorNode>();
  for (const node of statusNodes) merged.set(node.nodeId, node);
  for (const node of streamNodes) {
    const fromStatus = merged.get(node.nodeId);
    const status = fromStatus?.status ?? node.status;
    const stale = status === 'stale';
    merged.set(node.nodeId, {
      ...fromStatus,
      ...node,
      status,
      rssiDbm: stale ? null : node.rssiDbm ?? fromStatus?.rssiDbm ?? null,
      amplitude: stale ? [] : node.amplitude.length ? node.amplitude : fromStatus?.amplitude ?? [],
      phase: stale ? null : node.phase ?? fromStatus?.phase ?? null,
      lastSeenMs: fromStatus?.lastSeenMs ?? node.lastSeenMs,
    });
  }
  return [...merged.values()].sort((a, b) => a.nodeId - b.nodeId);
}

async function fetchJson(fetcher: typeof fetch, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    return await response.json() as unknown;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/** Live adapter for the current RuView sensing-server REST and WebSocket routes. */
export class RuViewLiveProvider {
  private readonly callbacks: LiveProviderCallbacks;
  private readonly fetcher: typeof fetch;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly location: Location;
  private readonly now: () => number;
  private active = false;
  private transport: TransportMode = 'websocket';
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private lastError = '';

  constructor(callbacks: LiveProviderCallbacks, dependencies: LiveProviderDependencies = {}) {
    this.callbacks = callbacks;
    this.fetcher = dependencies.fetcher ?? globalThis.fetch.bind(globalThis);
    this.webSocketFactory = dependencies.webSocketFactory ?? ((url) => new WebSocket(url));
    this.location = dependencies.location ?? window.location;
    this.now = dependencies.now ?? Date.now;
  }

  start(transport: TransportMode = 'websocket'): void {
    this.active = false;
    this.stopTimers();
    this.closeSocket();
    this.transport = transport;
    this.active = true;
    this.reconnectAttempts = 0;
    this.callbacks.onStatus('connecting');
    this.emitEvent('info', 'Backend connect requested', `Using ${transport === 'websocket' ? 'WebSocket' : 'REST polling'} through the same-origin proxy.`);

    if (transport === 'websocket') {
      void this.refreshSnapshot();
      this.openSocket();
      this.healthTimer = globalThis.setInterval(() => { void this.refreshSnapshot(); }, HEALTH_INTERVAL_MS);
    } else {
      this.schedulePoll(0);
    }
  }

  disconnect(notify = true): void {
    if (!this.active && !this.socket) return;
    this.active = false;
    this.stopTimers();
    this.closeSocket();
    this.callbacks.onStatus('disconnected');
    if (notify) this.emitEvent('warning', 'Viewer disconnected', 'The observatory stopped receiving data. The sensing backend may continue capturing until it is stopped there.');
  }

  private stopTimers(): void {
    if (this.reconnectTimer) globalThis.clearTimeout(this.reconnectTimer);
    if (this.pollTimer) globalThis.clearTimeout(this.pollTimer);
    if (this.healthTimer) globalThis.clearInterval(this.healthTimer);
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.healthTimer = null;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) {
      socket.close(1000, 'Observatory viewer disconnect');
    }
  }

  private socketUrl(): string {
    const url = new URL('/ws/sensing', this.location.href);
    url.protocol = this.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  private openSocket(): void {
    if (!this.active || this.transport !== 'websocket') return;
    this.callbacks.onStatus(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');

    try {
      const socket = this.webSocketFactory(this.socketUrl());
      this.socket = socket;
      socket.onopen = () => {
        if (!this.active || this.socket !== socket) return;
        this.reconnectAttempts = 0;
        this.lastError = '';
        this.callbacks.onStatus('connected');
        this.emitEvent('success', 'RuView stream connected', 'Receiving /ws/sensing updates.');
        void this.refreshSnapshot();
      };
      socket.onmessage = (event) => {
        if (!this.active || this.socket !== socket) return;
        try {
          const decoded: unknown = JSON.parse(String(event.data));
          const frame = parseRuViewSensingUpdate(decoded);
          if (frame) {
            this.callbacks.onFrame(frame);
            if (frame.nodes.length) this.callbacks.onNodes(frame.nodes);
          } else if (decoded && typeof decoded === 'object' && 'type' in decoded) {
            const type = String((decoded as { type?: unknown }).type ?? '');
            if (!['sensing_update', 'pose_data', 'connection_established', 'pong'].includes(type)) {
              this.reportError(`Ignored unrecognized RuView message type: ${type || '(empty)'}`);
            }
          } else {
            this.reportError('Ignored malformed or unsupported WebSocket payload.');
          }
        } catch {
          this.reportError('Could not parse a RuView WebSocket JSON message.');
        }
      };
      socket.onerror = () => {
        if (this.active && this.socket === socket) this.reportError('WebSocket transport error. Check backend health and proxy settings.');
      };
      socket.onclose = (event) => {
        if (this.socket !== socket) return;
        this.socket = null;
        if (!this.active) return;
        const reason = event.reason ? ` (${event.reason})` : '';
        this.reportError(`WebSocket closed with code ${event.code}${reason}. Reconnecting automatically.`);
        this.callbacks.onStatus('reconnecting');
        this.scheduleReconnect();
      };
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : 'Could not create WebSocket connection.');
      this.callbacks.onStatus('degraded');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.active || this.transport !== 'websocket' || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts - 1, 5));
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private schedulePoll(delay = POLL_INTERVAL_MS): void {
    if (!this.active || this.transport !== 'polling') return;
    this.pollTimer = globalThis.setTimeout(async () => {
      this.pollTimer = null;
      await this.refreshSnapshot();
      this.schedulePoll(POLL_INTERVAL_MS);
    }, delay);
  }

  private async refreshSnapshot(): Promise<void> {
    if (!this.active) return;
    try {
      const [healthValue, latestValue, nodesValue, vitalsValue, poseValue] = await Promise.all([
        fetchJson(this.fetcher, '/health'),
        fetchJson(this.fetcher, SNAPSHOT_PATH),
        fetchJson(this.fetcher, '/api/v1/nodes').catch(() => null),
        fetchJson(this.fetcher, '/api/v1/vital-signs').catch(() => null),
        fetchJson(this.fetcher, '/api/v1/pose/current').catch(() => null),
      ]);
      if (!this.active) return;

      const parsedHealth = parseBackendHealth(healthValue);
      if (parsedHealth) {
        if (parsedHealth.status === 'healthy') this.lastError = '';
        else this.lastError = parsedHealth.error ?? 'RuView source is degraded.';
        this.callbacks.onHealth({
          ...parsedHealth,
          lastCheck: this.now(),
        });
      } else {
        this.callbacks.onHealth({
          status: 'degraded', source: null, tick: null, clients: null,
          lastCheck: this.now(), error: 'Backend health response did not match the RuView schema.',
        });
      }

      const nodes = mergeNodes(validateRuViewNodes(latestValue), validateRuViewNodes(nodesValue));
      this.callbacks.onNodes(nodes);
      const latest = latestValue && typeof latestValue === 'object' && !Array.isArray(latestValue)
        ? latestValue as Record<string, unknown>
        : {};
      const vitals = vitalsValue && typeof vitalsValue === 'object' && !Array.isArray(vitalsValue)
        ? vitalsValue as Record<string, unknown>
        : {};
      const pose = poseValue && typeof poseValue === 'object' && !Array.isArray(poseValue)
        ? poseValue as Record<string, unknown>
        : {};
      const health = healthValue && typeof healthValue === 'object' && !Array.isArray(healthValue)
        ? healthValue as Record<string, unknown>
        : {};
      const merged = {
        ...latest,
        source: latest.source ?? health.source,
        tick: latest.tick ?? health.tick,
        nodes,
        persons: latest.persons ?? pose.persons,
        vital_signs: latest.vital_signs ?? vitals.vital_signs,
      };
      const frame = parseRuViewSensingUpdate(merged);
      if (frame) this.callbacks.onFrame(frame);

      if (this.transport === 'polling') {
        this.callbacks.onStatus('connected');
      }
    } catch (error) {
      if (!this.active) return;
      const message = error instanceof Error ? error.message : 'Unknown backend connection error.';
      const backendOffline = error instanceof TypeError
        || (error instanceof Error && error.name === 'AbortError')
        || /connection refused|network error|fetch failed|timed out/i.test(message);
      this.callbacks.onHealth({
        status: backendOffline ? 'offline' : 'degraded', source: null, tick: null, clients: null,
        lastCheck: this.now(), error: message,
      });
      this.reportError(`Backend request failed: ${message}`);
      if (this.transport === 'polling') this.callbacks.onStatus('degraded');
    }
  }

  private reportError(message: string): void {
    this.callbacks.onError(message);
    if (this.lastError !== message) {
      this.lastError = message;
      this.emitEvent('error', 'Live connection diagnostic', message);
    }
  }

  private emitEvent(level: SystemEvent['level'], title: string, detail: string): void {
    this.callbacks.onEvent(makeEvent(level, title, detail, this.now));
  }
}
