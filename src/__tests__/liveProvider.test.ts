import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuViewLiveProvider } from '../data/liveProvider';
import type { LiveProviderCallbacks } from '../data/liveProvider';

const keypoints = Array.from({ length: 17 }, (_, index) => ({
  name: `kp_${index}`, x: 320 + index, y: 240 - index, z: 0, confidence: 0.82,
}));

const routes: Record<string, unknown> = {
  '/health': { status: 'ok', source: 'esp32', tick: 42, clients: 1 },
  '/api/v1/sensing/latest': {
    type: 'sensing_update', source: 'esp32', tick: 42, timestamp: 1_798_000_000,
    nodes: [{ node_id: 2, rssi_dbm: -49, amplitude: [9, 10, 11], subcarrier_count: 3 }],
    features: { mean_rssi: -49, variance: 1.7, motion_band_power: 4 },
    classification: { presence: true, confidence: 0.83, motion_level: 'present_still' },
    persons: [{ id: 1, confidence: 0.82, keypoints }],
    vital_signs: { breathing_rate_bpm: 14, heart_rate_bpm: 72, breathing_confidence: 0.7, heartbeat_confidence: 0.66, signal_quality: 0.8 },
  },
  '/api/v1/nodes': { nodes: [{ node_id: 2, status: 'active', last_seen_ms: 4, rssi_dbm: -49 }], total: 1 },
  '/api/v1/vital-signs': { vital_signs: { breathing_rate_bpm: 14, heart_rate_bpm: 72, breathing_confidence: 0.7, heartbeat_confidence: 0.66, signal_quality: 0.8 } },
  '/api/v1/pose/current': { persons: [{ id: 1, confidence: 0.82, keypoints }], total_persons: 1, source: 'esp32' },
};

function callbacks(): LiveProviderCallbacks {
  return {
    onFrame: vi.fn(), onNodes: vi.fn(), onHealth: vi.fn(), onStatus: vi.fn(), onError: vi.fn(), onEvent: vi.fn(),
  };
}

class FakeSocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn((_code?: number, _reason?: string) => { this.readyState = 3; });
}

afterEach(() => vi.useRealTimers());

describe('RuView live provider', () => {
  it('polls the verified RuView REST endpoints and adapts real backend fields', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const value = routes[path];
      if (value === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const handlers = callbacks();
    const provider = new RuViewLiveProvider(handlers, {
      fetcher,
      location: { href: 'http://observatory.test/', protocol: 'http:' } as Location,
      now: () => 1_800_000_000_000,
    });

    provider.start('polling');
    await vi.waitFor(() => expect(handlers.onFrame).toHaveBeenCalled());
    provider.disconnect(false);

    const calls = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([path]) => path);
    expect(calls).toContain('/health');
    expect(calls).toContain('/api/v1/sensing/latest');
    expect(calls).toContain('/api/v1/nodes');
    expect(calls).toContain('/api/v1/vital-signs');
    expect(calls).toContain('/api/v1/pose/current');
    const delivered = (handlers.onFrame as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(delivered.source).toBe('esp32');
    expect(delivered.presence).toBe(true);
    expect(delivered.pose.keypoints).toHaveLength(17);
    expect(delivered.vitals.heartRateBpm).toBe(72);
    expect(handlers.onHealth).toHaveBeenCalledWith(expect.objectContaining({ status: 'healthy', source: 'esp32' }));
    expect(handlers.onStatus).toHaveBeenCalledWith('connected');
  });

  it('streams live movement and CSI without requiring keypoints or a pose endpoint', async () => {
    const latest = routes['/api/v1/sensing/latest'] as Record<string, unknown>;
    const noPoseUpdate = Object.fromEntries(Object.entries(latest).filter(([key]) => key !== 'persons' && key !== 'pose_keypoints'));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/sensing/latest') {
        return new Response(JSON.stringify(noPoseUpdate), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/api/v1/pose/current') return new Response('not available', { status: 404 });
      return new Response(JSON.stringify(routes[path] ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const handlers = callbacks();
    const provider = new RuViewLiveProvider(handlers, {
      fetcher,
      location: { href: 'http://observatory.test/', protocol: 'http:' } as Location,
    });

    provider.start('polling');
    await vi.waitFor(() => expect(handlers.onFrame).toHaveBeenCalled());
    provider.disconnect(false);

    const delivered = (handlers.onFrame as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(delivered.source).toBe('esp32');
    expect(delivered.sourceIsSimulated).toBe(false);
    expect(delivered.presence).toBe(true);
    expect(delivered.movementLabel).toBe('present_still');
    expect(delivered.movementScore).toBe(4);
    expect(delivered.csiAmplitude).toEqual([9, 10, 11]);
    expect(delivered.pose).toBeNull();
    expect(delivered.poseStatus).toBe('unavailable');
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('reports an HTTP route error as degraded rather than claiming the whole backend is offline', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/sensing/latest') return new Response('route error', { status: 503 });
      return new Response(JSON.stringify(routes[path] ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const handlers = callbacks();
    const provider = new RuViewLiveProvider(handlers, {
      fetcher,
      location: { href: 'http://observatory.test/', protocol: 'http:' } as Location,
    });

    provider.start('polling');
    await vi.waitFor(() => expect(handlers.onHealth).toHaveBeenCalledWith(expect.objectContaining({
      status: 'degraded', error: expect.stringContaining('HTTP 503'),
    })));
    provider.disconnect(false);
  });

  it('reports backend failure and reconnects a dropped WebSocket with backoff', async () => {
    vi.useFakeTimers();
    const handlers = callbacks();
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const provider = new RuViewLiveProvider(handlers, {
      fetcher: vi.fn(async () => { throw new Error('connection refused'); }) as unknown as typeof fetch,
      webSocketFactory: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      location: { href: 'http://observatory.test/dashboard', protocol: 'http:' } as Location,
      now: () => 1_800_000_000_000,
    });

    provider.start('websocket');
    expect(urls[0]).toBe('ws://observatory.test/ws/sensing');
    sockets[0].onclose?.({ code: 1006, reason: 'network down' } as CloseEvent);
    expect(handlers.onStatus).toHaveBeenCalledWith('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onHealth).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline', error: expect.stringContaining('connection refused') }));

    provider.disconnect(false);
  });

  it('ignores malformed WebSocket messages without creating a pose', () => {
    const handlers = callbacks();
    const sockets: FakeSocket[] = [];
    const provider = new RuViewLiveProvider(handlers, {
      fetcher: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      location: { href: 'http://observatory.test/', protocol: 'http:' } as Location,
    });
    provider.start('websocket');
    sockets[0].onmessage?.({ data: '{broken json' } as MessageEvent);
    expect(handlers.onFrame).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(expect.stringContaining('parse'));
    provider.disconnect(false);
  });
});
