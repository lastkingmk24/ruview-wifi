import type {
  ObservatoryFrame,
  PoseKeypoint,
  Scenario,
  ScenarioId,
  SensorNode,
} from '../types';

export const SIMULATION_SCENARIOS: Scenario[] = [
  { id: 'multi-person', label: 'Multi-Person', description: 'Two synthetic people move through the demo room.' },
  { id: 'walking-person', label: 'Walk-through', description: 'One synthetic person moves across the room.' },
  { id: 'resting-vitals', label: 'Resting + vitals', description: 'Synthetic resting presence with experimental sample estimates.' },
  { id: 'quiet-room', label: 'Quiet room', description: 'No person detected; low-variance sample signal.' },
];

const COCO_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

const BASE_TIME = Date.UTC(2026, 9, 27, 12, 0, 0);

function makePose(tick: number, scenario: ScenarioId, personIndex = 0): PoseKeypoint[] {
  const seconds = tick * 0.25;
  const walking = scenario === 'walking-person' || scenario === 'multi-person';
  const phase = seconds * 2.8 + personIndex * 1.35;
  const stride = walking ? Math.sin(phase) : 0;
  const drift = walking ? Math.sin(seconds * 0.42 + personIndex * 1.2) * 42 : 4;
  const breath = scenario === 'resting-vitals' || scenario === 'multi-person' ? Math.sin(seconds * 1.45 + personIndex * 0.7) * 1.5 : 0;
  const personOffset = scenario === 'multi-person' ? (personIndex === 0 ? -82 : 98) : 0;
  const hipX = 320 + drift + personOffset;
  const hipY = 246;
  const offsets: Array<[number, number]> = [
    [0, -151], [-9, -159], [9, -159], [-17, -153], [17, -153],
    [-31, -112], [31, -112], [-48 - stride * 4, -77], [48 + stride * 4, -77],
    [-52 - stride * 8, -38], [52 + stride * 8, -38], [-21, -39], [21, -39],
    [-24 - stride * 4, 14 + Math.max(0, stride) * 10],
    [24 + stride * 4, 14 + Math.max(0, -stride) * 10],
    [-27 - stride * 12, 69 + Math.max(0, stride) * 17],
    [27 + stride * 12, 69 + Math.max(0, -stride) * 17],
  ];

  return offsets.map(([dx, dy], index) => ({
    name: COCO_NAMES[index],
    x: hipX + dx + (index === 5 || index === 6 ? breath : 0),
    y: hipY + dy + (index === 5 || index === 6 ? -breath : 0),
    z: Math.sin(seconds * 0.7 + index * 0.15) * 0.03,
    confidence: 0.86 + ((index * 7 + tick) % 9) * 0.012,
  }));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Deterministic, explicitly synthetic sample frames for demos and tests. */
export function createSimulationFrame(
  tick: number,
  scenario: ScenarioId,
  timestamp = BASE_TIME + tick * 250,
): ObservatoryFrame {
  const t = tick * 0.25;
  const quiet = scenario === 'quiet-room';
  const walking = scenario === 'walking-person' || scenario === 'multi-person';
  const multiPerson = scenario === 'multi-person';
  const present = !quiet;
  const rssi = quiet
    ? -67 + Math.sin(t * 0.35) * 0.9
    : -49 + Math.sin(t * 0.42) * 4.2 + Math.cos(t * 0.19) * 1.1;
  const amplitudes = Array.from({ length: 56 }, (_, index) => {
    const carrier = 15 + Math.sin(index * 0.13 + t * (walking ? 0.9 : 0.42)) * (quiet ? 1.3 : 4.2);
    const movement = walking ? Math.sin(index * 0.29 + t * 2.3) * 2.8 : Math.sin(t * 0.4 + index * 0.1) * 0.6;
    const ripple = Math.sin(index * 7.13 + tick * 0.41) * 0.5;
    return Math.max(0.4, carrier + movement + ripple);
  });
  const phases = Array.from({ length: 56 }, (_, index) =>
    Math.sin(index * 0.17 + t * 0.64) * Math.PI * 0.62 + Math.cos(index * 0.37 - t * 0.22) * 0.08,
  );
  const variance = quiet ? 0.42 + Math.abs(Math.sin(t * 0.3)) * 0.12 : 3.8 + Math.abs(Math.sin(t * 0.7)) * (walking ? 4.2 : 0.8);
  const sampleQuality = quiet ? 0.64 : walking ? 0.82 : 0.89;
  const nodeOne: SensorNode = {
    nodeId: 1,
    status: 'active',
    rssiDbm: rssi,
    amplitude: amplitudes,
    phase: phases,
    subcarrierCount: 56,
    lastSeenMs: 0,
  };
  const nodeTwo: SensorNode = {
    nodeId: 2,
    status: 'active',
    rssiDbm: rssi - 5.5 + Math.sin(t * 0.31) * 1.5,
    amplitude: amplitudes.map((value, index) => value * (0.92 + Math.cos(index * 0.14) * 0.035)),
    phase: phases.map((value) => value + 0.12),
    subcarrierCount: 56,
    lastSeenMs: 0,
  };
  const confidence = quiet ? null : walking ? 0.91 : 0.88;
  const poseCount = present ? (multiPerson ? 2 : 1) : 0;
  const poses = Array.from({ length: poseCount }, (_, personIndex) => ({
    keypoints: makePose(tick, scenario, personIndex),
    confidence: confidence ?? 0.88,
    source: `Synthetic demo pose · person ${personIndex + 1}`,
  }));
  const pose = poses[0] ?? null;
  const sampleVitals = scenario === 'resting-vitals' || multiPerson;
  const vitals = {
    breathingRateBpm: sampleVitals ? (multiPerson ? 18 : 14.2) + Math.sin(t * 0.16) * (multiPerson ? 0.15 : 0.45) : null,
    heartRateBpm: sampleVitals ? (multiPerson ? 85 : 68) + Math.sin(t * 0.21) * (multiPerson ? 0.8 : 2.2) : null,
    breathingConfidence: sampleVitals ? (multiPerson ? 0.82 : 0.78) + Math.sin(t * 0.11) * 0.02 : null,
    heartConfidence: sampleVitals ? (multiPerson ? 0.82 : 0.71) + Math.cos(t * 0.13) * 0.03 : null,
    signalQuality: sampleVitals ? sampleQuality : null,
  };
  const nodeAverage = mean([nodeOne.rssiDbm ?? rssi, nodeTwo.rssiDbm ?? rssi]);

  return {
    id: `synthetic:${scenario}:${tick}`,
    timestamp,
    tick,
    source: 'SIMULATION · deterministic sample',
    sourceIsSimulated: true,
    presence: present,
    personCount: poseCount,
    detectionConfidence: confidence,
    movementLabel: quiet ? 'quiet' : walking ? 'walking' : 'present_still',
    movementScore: quiet ? 0.04 : multiPerson ? 0.339 + Math.abs(Math.sin(t * 2)) * 0.05 : walking ? 0.67 + Math.abs(Math.sin(t * 2)) * 0.16 : 0.12,
    rssiDbm: nodeAverage,
    csiAmplitude: amplitudes,
    csiPhase: phases,
    signalVariance: variance,
    signalQuality: sampleQuality,
    pose,
    poses,
    poseStatus: pose ? 'valid' : 'unavailable',
    vitals,
    nodes: [nodeOne, nodeTwo],
  };
}
