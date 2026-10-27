import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseRuViewSensingUpdate } from '../data/ruviewAdapter';
import { PosePanel } from '../components/TelemetryPanels';

const movementWithoutPose = parseRuViewSensingUpdate({
  type: 'sensing_update',
  timestamp: 1_798_000_000,
  source: 'esp32',
  tick: 7,
  features: { mean_rssi: -54, variance: 2.3, motion_band_power: 6.4 },
  classification: { presence: true, confidence: 0.84, motion_level: 'walking' },
});

describe('live pose-optional display', () => {
  it('keeps live presence/movement usable when the backend omits keypoints', () => {
    expect(movementWithoutPose).not.toBeNull();
    render(<PosePanel frame={movementWithoutPose} mode="live" />);

    expect(screen.getByText('NO POSE')).toBeInTheDocument();
    expect(screen.getByText('Presence works without pose keypoints')).toBeInTheDocument();
    expect(screen.getByText(/live movement, presence and RF telemetry can continue without keypoints/i)).toBeInTheDocument();
  });
});
