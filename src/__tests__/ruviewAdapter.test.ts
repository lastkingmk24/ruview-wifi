import { describe, expect, it } from 'vitest';
import { parseBackendHealth, parseRuViewSensingUpdate, validateRuViewNodes } from '../data/ruviewAdapter';

const keypoints = Array.from({ length: 17 }, (_, index) => ({
  name: `kp_${index}`,
  x: 320 + index,
  y: 240 - index,
  z: 0.02,
  confidence: 0.86,
}));

const validUpdate = {
  type: 'sensing_update',
  timestamp: 1_798_000_000,
  source: 'esp32',
  tick: 92,
  nodes: [{ node_id: 3, rssi_dbm: -47, amplitude: [12, 13, 14], subcarrier_count: 3 }],
  features: { mean_rssi: -47, variance: 2.4, motion_band_power: 11, breathing_band_power: 3 },
  classification: { motion_level: 'active', presence: true, confidence: 0.89 },
  vital_signs: {
    breathing_rate_bpm: 13.8,
    heart_rate_bpm: 71,
    breathing_confidence: 0.74,
    heartbeat_confidence: 0.68,
    signal_quality: 0.82,
  },
  persons: [{ id: 1, confidence: 0.88, keypoints, zone: 'zone_1' }],
};

describe('RuView sensing adapter', () => {
  it('parses the current sensing-server SensingUpdate message shape', () => {
    const frame = parseRuViewSensingUpdate(validUpdate);
    expect(frame).not.toBeNull();
    expect(frame?.source).toBe('esp32');
    expect(frame?.sourceIsSimulated).toBe(false);
    expect(frame?.presence).toBe(true);
    expect(frame?.personCount).toBe(1);
    expect(frame?.rssiDbm).toBe(-47);
    expect(frame?.csiAmplitude).toEqual([12, 13, 14]);
    expect(frame?.csiPhase).toBeNull(); // The current broadcast schema does not expose phase.
    expect(frame?.pose?.keypoints).toHaveLength(17);
    expect(frame?.vitals.breathingRateBpm).toBe(13.8);
  });

  it('parses and reports each valid pose when multiple backend detections are present', () => {
    const secondPerson = {
      ...validUpdate.persons[0],
      id: 2,
      keypoints: keypoints.map((point) => ({ ...point, x: point.x + 150 })),
    };
    const frame = parseRuViewSensingUpdate({
      ...validUpdate,
      persons: [validUpdate.persons[0], secondPerson],
    });
    expect(frame?.personCount).toBe(2);
    expect(frame?.poses).toHaveLength(2);
    expect(frame?.poses?.[0].source).toContain('person 1');
    expect(frame?.poses?.[1].keypoints[0].x).toBe(keypoints[0].x + 150);
  });

  it('keeps simulation provenance when the RuView server reports its simulator source', () => {
    const frame = parseRuViewSensingUpdate({
      ...validUpdate,
      source: 'simulate',
    });
    expect(frame?.sourceIsSimulated).toBe(true);
  });

  it('never fabricates a pose from RSSI or signal features alone', () => {
    const frame = parseRuViewSensingUpdate({
      source: 'esp32',
      nodes: [{ node_id: 1, rssi_dbm: -42, amplitude: [1, 2, 3] }],
      features: { mean_rssi: -42, variance: 12 },
      classification: { presence: true, confidence: 0.81, motion_level: 'active' },
    });
    expect(frame?.presence).toBe(true);
    expect(frame?.personCount).toBeNull();
    expect(frame?.pose).toBeNull();
    expect(frame?.poseStatus).toBe('unavailable');
  });

  it('preserves COCO keypoint indexes when malformed joints are omitted', () => {
    const partialKeypoints = [...keypoints];
    partialKeypoints[0] = { ...partialKeypoints[0], x: Number.NaN };
    const frame = parseRuViewSensingUpdate({
      ...validUpdate,
      persons: [{ id: 1, confidence: 0.88, keypoints: partialKeypoints }],
    });
    expect(frame?.poseStatus).toBe('valid');
    expect(frame?.pose?.keypoints).toHaveLength(17);
    expect(frame?.pose?.keypoints[0]).toEqual(expect.objectContaining({ name: 'nose', confidence: 0 }));
    expect(frame?.pose?.keypoints[1].name).toBe('kp_1');
  });

  it('rejects malformed or low-confidence keypoints and invalid vitals', () => {
    const frame = parseRuViewSensingUpdate({
      ...validUpdate,
      persons: [{ id: 2, confidence: 0.1, keypoints: keypoints.slice(0, 4) }],
      vital_signs: {
        breathing_rate_bpm: 0,
        heart_rate_bpm: 900,
        breathing_confidence: 4,
        heartbeat_confidence: -1,
        signal_quality: 0.4,
      },
    });
    expect(frame?.pose).toBeNull();
    expect(frame?.poseStatus).toBe('unreliable');
    expect(frame?.vitals.breathingRateBpm).toBeNull();
    expect(frame?.vitals.heartRateBpm).toBeNull();
    expect(frame?.vitals.breathingConfidence).toBeNull();
    expect(frame?.vitals.heartConfidence).toBeNull();
  });

  it('does not turn null or zero vitals into measurements', () => {
    const frame = parseRuViewSensingUpdate({
      source: 'esp32',
      vital_signs: { breathing_rate_bpm: null, heart_rate_bpm: 0 },
    });
    expect(frame?.vitals.breathingRateBpm).toBeNull();
    expect(frame?.vitals.heartRateBpm).toBeNull();
  });

  it('does not show a pose when the backend explicitly reports no presence', () => {
    const frame = parseRuViewSensingUpdate({
      ...validUpdate,
      classification: { motion_level: 'quiet', presence: false, confidence: 0.1 },
    });
    expect(frame?.presence).toBe(false);
    expect(frame?.personCount).toBe(0);
    expect(frame?.pose).toBeNull();
    expect(frame?.poseStatus).toBe('unavailable');
  });

  it('marks an otherwise healthy API with an offline sensing source as degraded', () => {
    expect(parseBackendHealth({ status: 'ok', source: 'esp32:offline', tick: 12 }))
      .toEqual(expect.objectContaining({ status: 'degraded', source: 'esp32:offline' }));
  });

  it('validates node identifiers and keeps missing measurements unavailable', () => {
    expect(validateRuViewNodes({ nodes: [
      { node_id: 5, status: 'active', last_seen_ms: 12, rssi_dbm: -51 },
      { node_id: 'bad', rssi_dbm: -50 },
      { node_id: 6, rssi_dbm: 9 },
      { node_id: 7, status: 'stale', last_seen_ms: 9000, rssi_dbm: -90, amplitude: [10, 11] },
      { node_id: 8, rssi_dbm: 0 },
    ] })).toEqual([
      expect.objectContaining({ nodeId: 5, status: 'active', rssiDbm: -51, amplitude: [] }),
      expect.objectContaining({ nodeId: 6, rssiDbm: null, amplitude: [] }),
      expect.objectContaining({ nodeId: 7, status: 'stale', rssiDbm: null, amplitude: [], phase: null }),
      expect.objectContaining({ nodeId: 8, status: 'unknown', rssiDbm: null, amplitude: [] }),
    ]);
  });
});
