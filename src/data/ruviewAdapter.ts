import type {
  ObservatoryFrame,
  PoseEstimate,
  PoseKeypoint,
  PoseStatus,
  SensorNode,
  VitalEstimate,
} from '../types';

export const COCO_KEYPOINT_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
] as const;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const bounded = (value: unknown, min = 0, max = 1): number | null => {
  const number = finite(value);
  return number === null || number < min || number > max ? null : number;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const numericArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const values = value.map(finite);
  if (values.some((item) => item === null)) return null;
  return values as number[];
};

const amplitudeArray = (value: unknown): number[] | null => {
  const values = numericArray(value);
  return values && values.every((item) => item >= 0) ? values : null;
};

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const numeric = finite(value);
  if (numeric !== null) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return Date.now();
}

function parsePoint(point: unknown, index: number): PoseKeypoint | null {
  const item = record(point);
  if (item) {
    const x = finite(item.x);
    const y = finite(item.y);
    const z = finite(item.z) ?? 0; // The RuView API may provide a 2D COCO point.
    const confidence = bounded(item.confidence);
    if (x === null || y === null || confidence === null) return null;
    return {
      name: text(item.name) ?? COCO_KEYPOINT_NAMES[index] ?? `keypoint_${index}`,
      x,
      y,
      z,
      confidence,
    };
  }

  if (Array.isArray(point) && point.length >= 3) {
    const x = finite(point[0]);
    const y = finite(point[1]);
    const z = finite(point[2]) ?? 0;
    const confidence = bounded(point[3]);
    if (x === null || y === null || confidence === null) return null;
    return {
      name: COCO_KEYPOINT_NAMES[index] ?? `keypoint_${index}`,
      x,
      y,
      z,
      confidence,
    };
  }
  return null;
}

function poseFromPoints(candidatePoints: unknown, suppliedConfidence: unknown, source: string): {
  pose: PoseEstimate | null;
  status: PoseStatus;
} {
  if (!Array.isArray(candidatePoints) || candidatePoints.length === 0) {
    return { pose: null, status: 'unavailable' };
  }

  const parsedPoints = candidatePoints.map((point, index) => parsePoint(point, index));
  const validPoints = parsedPoints.filter((point): point is PoseKeypoint => point !== null);
  const usableCount = validPoints.filter((point) => point.confidence >= 0.2).length;
  const averageConfidence = validPoints.length
    ? validPoints.reduce((sum, point) => sum + point.confidence, 0) / validPoints.length
    : 0;
  const confidence = bounded(suppliedConfidence) ?? averageConfidence;
  // Keep source keypoint indices stable for COCO bone mapping. Invalid joints
  // become invisible placeholders rather than shifting later joints into other bones.
  const keypoints = parsedPoints.map((point, index) => point ?? ({
    name: COCO_KEYPOINT_NAMES[index] ?? `keypoint_${index}`,
    x: 0,
    y: 0,
    z: 0,
    confidence: 0,
  }));

  // Do not draw a plausible-looking skeleton from partial or malformed packets.
  if (validPoints.length < 5 || usableCount < 5 || confidence < 0.2) {
    return { pose: null, status: 'unreliable' };
  }
  return { pose: { keypoints, confidence, source }, status: 'valid' };
}

function poseFromPayload(root: Record<string, unknown>, source: string): {
  pose: PoseEstimate | null;
  poses: PoseEstimate[];
  status: PoseStatus;
} {
  const nestedPayload = record(root.payload);
  const nestedPose = record(nestedPayload?.pose);
  const candidates = Array.isArray(root.persons)
    ? root.persons
    : Array.isArray(nestedPose?.persons)
      ? nestedPose.persons
      : [];

  if (candidates.length) {
    const results = candidates.map((candidate, index) => {
      const person = record(candidate);
      return poseFromPoints(
        person?.keypoints ?? (index === 0 ? root.pose_keypoints : null),
        person?.confidence,
        `${source} · person ${index + 1}`,
      );
    });
    const poses = results.flatMap((result) => result.pose ? [result.pose] : []);
    const status: PoseStatus = poses.length
      ? 'valid'
      : results.some((result) => result.status === 'unreliable') ? 'unreliable' : 'unavailable';
    return { pose: poses[0] ?? null, poses, status };
  }

  const single = poseFromPoints(root.pose_keypoints, null, source);
  return { pose: single.pose, poses: single.pose ? [single.pose] : [], status: single.status };
}

function parseNodes(value: unknown): SensorNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const node = record(entry);
    if (!node) return [];
    const nodeId = finite(node.node_id ?? node.nodeId);
    if (nodeId === null || !Number.isInteger(nodeId) || nodeId < 0 || nodeId > 255) return [];
    const amplitude = amplitudeArray(node.amplitude) ?? [];
    const phase = numericArray(node.phase) ?? numericArray(node.phases);
    const rssi = finite(node.rssi_dbm ?? node.rssiDbm);
    const validRssi = rssi !== null && rssi < 0 && rssi >= -127 ? rssi : null;
    const lastSeen = finite(node.last_seen_ms ?? node.lastSeenMs);
    const rawStatus = text(node.status);
    const inferredStatus = amplitude.length || validRssi !== null ? 'active' : 'unknown';
    const initialStatus = rawStatus === 'active' || rawStatus === 'stale' ? rawStatus : inferredStatus;
    const stale = initialStatus === 'stale' || (lastSeen !== null && lastSeen > 5_000);
    const status = stale ? 'stale' : initialStatus;
    const count = finite(node.subcarrier_count ?? node.subcarrierCount);
    const subcarrierCount = count !== null && Number.isInteger(count) && count > 0 && count <= 4096
      ? count
      : amplitude.length || null;
    return [{
      nodeId,
      status,
      rssiDbm: stale ? null : validRssi,
      amplitude: stale ? [] : amplitude,
      phase: stale ? null : phase,
      subcarrierCount,
      lastSeenMs: lastSeen !== null && lastSeen >= 0 ? lastSeen : null,
    }];
  });
}

function parseVitals(root: Record<string, unknown>): VitalEstimate {
  const wrapper = record(root.vital_signs);
  const nestedPayload = record(root.payload);
  const values = wrapper ?? record(nestedPayload?.vital_signs) ?? {};
  const breathing = finite(values.breathing_rate_bpm);
  const heart = finite(values.heart_rate_bpm);
  const breathingConfidence = bounded(values.breathing_confidence);
  const heartConfidence = bounded(values.heartbeat_confidence);
  const signalQuality = bounded(values.signal_quality) ?? bounded(root.signal_quality_score);

  return {
    // Null and zero are not valid estimates. Keep unsupported values explicitly unavailable.
    breathingRateBpm: breathing !== null && breathing >= 4 && breathing <= 45 && breathing > 0 ? breathing : null,
    heartRateBpm: heart !== null && heart >= 35 && heart <= 180 && heart > 0 ? heart : null,
    breathingConfidence,
    heartConfidence,
    signalQuality,
  };
}

/**
 * Adapts the current RuView sensing-server SensingUpdate/REST JSON shape.
 * It consumes backend-produced pose only; RSSI/CSI features are never used to invent keypoints.
 */
export function parseRuViewSensingUpdate(value: unknown): ObservatoryFrame | null {
  const root = record(value);
  if (!root) return null;
  if (text(root.status)?.toLowerCase().includes('no data')) return null;

  const features = record(root.features) ?? {};
  const classification = record(root.classification) ?? {};
  const nodes = parseNodes(root.nodes);
  const source = text(root.source) ?? 'unknown';
  const simulated = /simulat|synthetic|sample|recorded/i.test(source);
  const rootAmplitude = amplitudeArray(root.amplitude);
  const nodeAmplitude = nodes.find((node) => node.amplitude.length > 0)?.amplitude ?? null;
  const rootPhase = numericArray(root.phase) ?? numericArray(root.phases);
  const nodePhase = nodes.find((node) => node.phase?.length)?.phase ?? null;
  const firstNodeRssi = nodes.find((node) => node.rssiDbm !== null)?.rssiDbm ?? null;
  const featureRssi = finite(features.mean_rssi);
  const rawRssi = firstNodeRssi ?? featureRssi;
  const rssiDbm = rawRssi !== null && rawRssi < 0 && rawRssi >= -127 ? rawRssi : null;
  const rawVariance = finite(features.variance);
  const variance = rawVariance !== null && rawVariance >= 0 ? rawVariance : null;
  const quality = bounded(root.signal_quality_score) ?? bounded(record(root.vital_signs)?.signal_quality);
  const rawPresence = classification.presence;
  const nestedPosePersons = record(record(root.payload)?.pose)?.persons;
  const persons = Array.isArray(root.persons)
    ? root.persons
    : Array.isArray(nestedPosePersons) ? nestedPosePersons : [];
  const presence = typeof rawPresence === 'boolean'
    ? rawPresence
    : (persons.length > 0 ? true : null);
  const personCount = presence === false ? 0 : persons.length > 0 ? persons.length : null;
  const parsedPose = poseFromPayload(root, source);
  const poseResult = presence === false
    ? { pose: null, poses: [], status: 'unavailable' as const }
    : parsedPose;
  const timestamp = normalizeTimestamp(root.timestamp);
  const rawConfidence = bounded(classification.confidence);
  const rawMovement = finite(features.motion_band_power);
  const movement = rawMovement !== null && rawMovement >= 0 ? rawMovement : null;
  const movementLabel = text(classification.motion_level)
    ?? text(record(root.payload)?.activity);
  const tick = finite(root.tick);

  // A pose-only response from /api/v1/pose/current can supplement the latest sensing packet.
  const poseOnly = Array.isArray(root.persons) && !record(root.classification) && !record(root.features);

  return {
    id: `${source}:${tick ?? timestamp}`,
    timestamp,
    tick,
    source,
    sourceIsSimulated: simulated,
    presence,
    personCount,
    detectionConfidence: rawConfidence ?? (poseOnly ? bounded(record(persons[0])?.confidence) : null),
    movementLabel,
    movementScore: movement,
    rssiDbm,
    csiAmplitude: rootAmplitude ?? nodeAmplitude,
    csiPhase: rootPhase ?? nodePhase,
    signalVariance: variance,
    signalQuality: quality,
    pose: poseResult.pose,
    poses: poseResult.poses,
    poseStatus: poseResult.status,
    vitals: parseVitals(root),
    nodes,
  };
}

export function toSignalHistoryPoint(frame: ObservatoryFrame, nodeId: number | null = null) {
  const selectedNode = nodeId === null ? null : frame.nodes.find((candidate) => candidate.nodeId === nodeId) ?? null;
  const selectedNodeView = nodeId !== null;
  const amplitudes = selectedNodeView ? selectedNode?.amplitude ?? null : frame.csiAmplitude;
  const phases = selectedNodeView ? selectedNode?.phase ?? null : frame.csiPhase;
  const mean = (values: number[] | null) => values?.length
    ? values.reduce((sum, item) => sum + item, 0) / values.length
    : null;
  return {
    timestamp: frame.timestamp,
    rssiDbm: selectedNodeView ? selectedNode?.rssiDbm ?? null : frame.rssiDbm,
    amplitude: mean(amplitudes),
    phase: mean(phases),
    variance: selectedNodeView ? null : frame.signalVariance,
  };
}

export function validateRuViewNodes(value: unknown): SensorNode[] {
  const root = record(value);
  return root ? parseNodes(root.nodes) : [];
}

export function parseBackendHealth(value: unknown) {
  const root = record(value);
  if (!root) return null;
  const status = text(root.status);
  if (!status || !['ok', 'healthy', 'ready', 'alive'].includes(status.toLowerCase())) return null;
  const source = text(root.source);
  const sourceOffline = Boolean(source && /offline|unavailable/i.test(source));
  return {
    status: sourceOffline ? 'degraded' as const : 'healthy' as const,
    source,
    tick: finite(root.tick),
    clients: finite(root.clients),
    error: sourceOffline ? `RuView source ${source} is not receiving sensor frames.` : null,
  };
}
