import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

vi.mock('../components/ObservatoryScene', () => ({
  default: ({ resetToken, showSkeleton, showGrid, showWaves, wireframe, autoRotate, onFps }: {
    resetToken: number; showSkeleton: boolean; showGrid: boolean; showWaves: boolean; wireframe: boolean; autoRotate: boolean; onFps: (fps: number) => void;
  }) => {
    useEffect(() => { onFps(60); }, [onFps]);
    return <div
      data-testid="scene-mock"
      data-reset-token={resetToken}
      data-show-skeleton={String(showSkeleton)}
      data-show-grid={String(showGrid)}
      data-show-waves={String(showWaves)}
      data-wireframe={String(wireframe)}
      data-auto-rotate={String(autoRotate)}
    >3D room view</div>;
  },
}));

vi.mock('../components/SignalChart', () => ({
  default: () => <div data-testid="chart-mock">Signal plot</div>,
}));

vi.mock('../data/liveProvider', () => ({
  RuViewLiveProvider: class {
    constructor(private callbacks: { onStatus: (status: string) => void }) {}
    start() { this.callbacks.onStatus('connecting'); }
    disconnect() { this.callbacks.onStatus('disconnected'); }
  },
}));

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('observatory dashboard controls', () => {
  it('starts in clearly labeled simulation mode and changes scenarios', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Demo simulation' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('DEMO · SYNTHETIC')).toHaveLength(2);
    expect(screen.getByText('2 PERSONS REPORTED')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Simulation scenario'), { target: { value: 'quiet-room' } });
    expect(screen.getByRole('combobox', { name: 'Simulation scenario' })).toHaveValue('quiet-room');
    expect(screen.getAllByText('ROOM CLEAR')).toHaveLength(2);
  });

  it('pauses and resumes playback and applies the screenshot-inspired scene controls', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause visualization' }));
    expect(screen.getByRole('button', { name: 'Resume visualization' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume visualization' }));
    expect(screen.getByRole('button', { name: 'Pause visualization' })).toBeInTheDocument();

    const scene = await screen.findByTestId('scene-mock');
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    const controls = [
      ['Pose Fusion · backend keypoints only', 'data-show-skeleton'],
      ['Room wireframe', 'data-wireframe'],
      ['RF wave field visualization', 'data-show-waves'],
      ['Spatial floor grid', 'data-show-grid'],
    ] as const;
    for (const [label, attribute] of controls) {
      const checkbox = screen.getByRole('checkbox', { name: label });
      expect(checkbox).toBeChecked();
      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
      expect(scene).toHaveAttribute(attribute, 'false');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Reset camera' }));
    expect(scene).toHaveAttribute('data-reset-token', '1');

    const orbit = screen.getByRole('button', { name: /Orbit/ });
    fireEvent.click(orbit);
    expect(scene).toHaveAttribute('data-auto-rotate', 'true');

    const fpsToggle = screen.getByRole('button', { name: /FPS/ });
    fireEvent.click(fpsToggle);
    expect(fpsToggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('60 FPS · RENDERED')).toBeInTheDocument();
    fireEvent.click(fpsToggle);
    expect(fpsToggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Vital Sign Monitoring' }));
    expect(screen.queryByText('VITAL SIGNS')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vital Sign Monitoring' }));
    expect(screen.getByText('VITAL SIGNS')).toBeInTheDocument();
  });

  it('switches to live mode and exposes connection controls without claiming a sensor is connected', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Live backend/ }));
    expect(screen.getByText('LIVE DISCONNECTED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect to RuView' })).toBeInTheDocument();
    const transport = screen.getByLabelText('Live feed');
    fireEvent.change(transport, { target: { value: 'polling' } });
    expect(transport).toHaveValue('polling');
    expect(screen.getByText('Waiting for source output')).toBeInTheDocument();
  });

  it('uses the alert confidence threshold to arm and re-arm presence events', () => {
    render(<App />);
    const alertSwitch = screen.getByRole('switch', { name: 'Presence alerts' });
    expect(alertSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(alertSwitch);
    expect(alertSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(alertSwitch);
    expect(alertSwitch).toHaveAttribute('aria-checked', 'true');

    const threshold = screen.getByRole('slider', { name: 'Alert confidence threshold' });
    fireEvent.change(threshold, { target: { value: '0.94' } });
    fireEvent.change(threshold, { target: { value: '0.90' } });
    expect(screen.getAllByText('Presence threshold crossed').length).toBeGreaterThan(1);
  });

  it('clears and pauses the local simulation buffer until the user resumes it', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear local session' }));
    expect(screen.getByText('Local buffer cleared · simulation paused.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume visualization' })).toBeInTheDocument();
  });

  it('stops the live viewer when clearing a connected session', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Live backend/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect to RuView' }));
    expect(screen.getByRole('button', { name: 'Disconnect viewer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear local session' }));
    expect(screen.getByText('Local buffer cleared · backend stream disconnected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect to RuView' })).toBeInTheDocument();
  });
});
