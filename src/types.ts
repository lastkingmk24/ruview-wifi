export type DataMode = 'simulation' | 'live';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'degraded';
export type TransportMode = 'websocket' | 'polling';
export type PoseStatus = 'valid' | 'unreliable' | 'unavailable';
export type ScenarioId = 'quiet-room' | 'walking-person' | 'resting-vitals' | 'multi-person';

export interface PoseKeypoint {
  name: string;
  x: number;
  y: number;
  z: number;
  confidence: number;
}

export interface PoseEstimate {
  keypoints: PoseKeypoint[];
  confidence: number;
  source: string;
}

export interface VitalEstimate {
  breathingRateBpm: number | null;
  heartRateBpm: number | null;
  breathingConfidence: number | null;
  heartConfidence: number | null;
  signalQuality: number | null;
}

export interface SensorNode {
  nodeId: number;
  status: 'active' | 'stale' | 'unknown';
  rssiDbm: number | null;
  amplitude: number[];
  phase: number[] | null;
  subcarrierCount: number | null;
  lastSeenMs: number | null;
}

export interface ObservatoryFrame {
  id: string;
  timestamp: number;
  tick: number | null;
  source: string;
  sourceIsSimulated: boolean;
  presence: boolean | null;
  personCount: number | null;
  detectionConfidence: number | null;
  movementLabel: string | null;
  movementScore: number | null;
  rssiDbm: number | null;
  csiAmplitude: number[] | null;
  csiPhase: number[] | null;
  signalVariance: number | null;
  signalQuality: number | null;
  pose: PoseEstimate | null;
  /** All valid backend/demo person poses when the source supplies multiple people. */
  poses?: PoseEstimate[];
  poseStatus: PoseStatus;
  vitals: VitalEstimate;
  nodes: SensorNode[];
}

export interface SignalHistoryPoint {
  timestamp: number;
  rssiDbm: number | null;
  amplitude: number | null;
  phase: number | null;
  variance: number | null;
}

export interface SystemEvent {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warning' | 'error' | 'detection';
  title: string;
  detail: string;
}

export interface BackendHealth {
  status: 'unknown' | 'healthy' | 'degraded' | 'offline';
  source: string | null;
  tick: number | null;
  clients: number | null;
  lastCheck: number | null;
  error: string | null;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
}
