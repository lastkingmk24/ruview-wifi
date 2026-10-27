import { describe, expect, it } from 'vitest';
import { createSimulationFrame } from '../data/simulationProvider';

describe('deterministic simulation provider', () => {
  it('creates repeatable synthetic CSI signal and pose samples for a fixed tick', () => {
    const first = createSimulationFrame(24, 'walking-person', 1234);
    const second = createSimulationFrame(24, 'walking-person', 1234);
    expect(first.sourceIsSimulated).toBe(true);
    expect(first.source).toContain('SIMULATION');
    expect(first.csiAmplitude).toEqual(second.csiAmplitude);
    expect(first.csiPhase).toEqual(second.csiPhase);
    expect(first.detectionConfidence).toBe(second.detectionConfidence);
    expect(first.pose?.keypoints).toHaveLength(17);
  });

  it('shows an informative empty-room sample without inventing pose', () => {
    const frame = createSimulationFrame(8, 'quiet-room', 1234);
    expect(frame.presence).toBe(false);
    expect(frame.pose).toBeNull();
    expect(frame.poseStatus).toBe('unavailable');
    expect(frame.vitals.heartRateBpm).toBeNull();
  });

  it('creates a two-person synthetic demo scene with clearly marked sample metrics', () => {
    const frame = createSimulationFrame(20, 'multi-person', 1234);
    expect(frame.sourceIsSimulated).toBe(true);
    expect(frame.personCount).toBe(2);
    expect(frame.poses).toHaveLength(2);
    expect(frame.poses?.every((pose) => pose.keypoints.length === 17)).toBe(true);
    expect(frame.vitals.heartRateBpm).toBeGreaterThan(80);
    expect(frame.vitals.breathingRateBpm).toBeGreaterThan(17);
  });

  it('labels sample vital values as synthetic through the scenario provenance', () => {
    const frame = createSimulationFrame(19, 'resting-vitals', 1234);
    expect(frame.sourceIsSimulated).toBe(true);
    expect(frame.vitals.breathingRateBpm).toBeGreaterThan(6);
    expect(frame.vitals.heartRateBpm).toBeGreaterThan(40);
    expect(frame.vitals.signalQuality).toBeGreaterThan(0);
  });
});
