import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ConnectionState, DataMode, ObservatoryFrame, PoseEstimate, PoseKeypoint } from '../types';

interface Props {
  frame: ObservatoryFrame | null;
  mode: DataMode;
  liveRequested: boolean;
  connection: ConnectionState;
  showSkeleton: boolean;
  showGrid: boolean;
  showWaves: boolean;
  wireframe: boolean;
  autoRotate: boolean;
  onFps?: (fps: number) => void;
  resetToken: number;
}

interface SceneGraph {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  solidRoom: THREE.Mesh;
  waveRings: THREE.Mesh[];
  waveSpheres: THREE.Mesh[];
  skeleton: THREE.Group;
  resizeObserver: ResizeObserver | null;
  animationId: number;
}

const BONES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
];

function pointToWorld(point: PoseKeypoint): THREE.Vector3 {
  // RuView COCO points are image-space x/y with an optional z component.
  // This is a display projection only; it does not infer unprovided depth.
  return new THREE.Vector3(
    THREE.MathUtils.clamp((point.x - 320) * 0.018, -2.6, 2.6),
    THREE.MathUtils.clamp(3.0 - (point.y - 70) * 0.011, 0.05, 3.55),
    THREE.MathUtils.clamp(point.z * 2, -1.4, 1.4),
  );
}

function disposeGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line || child instanceof THREE.Points) {
      if (!geometries.has(child.geometry)) {
        child.geometry.dispose();
        geometries.add(child.geometry);
      }
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      childMaterials.forEach((material) => materials.add(material));
    }
    group.remove(child);
  }
  materials.forEach((material) => material.dispose());
}

function buildSkeleton(group: THREE.Group, poses: PoseEstimate[]): void {
  disposeGroup(group);
  poses.forEach((pose, personIndex) => {
    const points = pose.keypoints;
    const positions = points.map(pointToWorld);
    const tint = personIndex % 2 === 0 ? 0x18ff8b : 0x24f6d0;
    const linePositions: number[] = [];
    const jointPositions: number[] = [];
    for (const [from, to] of BONES) {
      const a = points[from];
      const b = points[to];
      if (!a || !b || a.confidence < 0.12 || b.confidence < 0.12) continue;
      linePositions.push(...positions[from].toArray(), ...positions[to].toArray());
    }
    points.forEach((point, index) => {
      if (point.confidence >= 0.12) jointPositions.push(...positions[index].toArray());
    });

    if (linePositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: tint,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      })));
    }
    if (jointPositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(jointPositions, 3));
      group.add(new THREE.Points(geometry, new THREE.PointsMaterial({
        color: 0x49ffb0,
        size: 0.16,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        depthWrite: false,
      })));
      group.add(new THREE.Points(geometry, new THREE.PointsMaterial({
        color: tint,
        size: 0.36,
        transparent: true,
        opacity: 0.23,
        sizeAttenuation: true,
        depthWrite: false,
      })));
    }
  });
}

function createRoom(scene: THREE.Scene) {
  const shellGeometry = new THREE.BoxGeometry(12, 4.2, 12);
  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x0e2634,
    transparent: true,
    opacity: 0.13,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const solidRoom = new THREE.Mesh(shellGeometry, shellMaterial);
  solidRoom.position.set(0, 2.1, 0);
  scene.add(solidRoom);

  const edgeGeometry = new THREE.EdgesGeometry(shellGeometry);
  const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
    color: 0x2a839f,
    transparent: true,
    opacity: 0.55,
  }));
  edges.position.copy(solidRoom.position);
  scene.add(edges);

  const floorGrid = new THREE.GridHelper(12, 30, 0x19718b, 0x16303e);
  floorGrid.position.y = 0.012;
  const gridMaterials = Array.isArray(floorGrid.material) ? floorGrid.material : [floorGrid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.42;
  });
  scene.add(floorGrid);

  // Sensing-zone rings.
  for (const [x, z, color] of [[-1.4, 0, 0x185b6e], [1.4, 0, 0x22295f]] as const) {
    const zone = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.75, 56),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(x, 0.025, z);
    scene.add(zone);
  }

  // Two illustrative RF endpoints; these are not detected people.
  const endpoints: Array<[number, number, number, number]> = [
    [-3.35, 1.05, -2.7, 0x36d9ff],
    [3.35, 1.05, 2.7, 0x8f7cff],
  ];
  const waveRings: THREE.Mesh[] = [];
  endpoints.forEach(([x, y, z, color]) => {
    const anchor = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.38, 0.22),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.58, roughness: 0.38 }),
    );
    anchor.position.set(x, y, z);
    scene.add(anchor);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 14),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 }),
    );
    beacon.position.set(x, y + 0.27, z);
    scene.add(beacon);

    for (let index = 0; index < 3; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.22, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.04 + index * 0.004, z);
      ring.userData.phase = index / 3;
      ring.userData.baseScale = 0.55 + index * 0.06;
      scene.add(ring);
      waveRings.push(ring);
    }
  });

  // A wireframe CSI field volume gives the scene its observatory-style RF envelope.
  // It is a visualization layer, not a range measurement or detected-person outline.
  const waveSpheres: THREE.Mesh[] = [];
  const waveCenter = new THREE.Vector3(-0.65, 1.35, -0.45);
  for (const [index, radius] of [0.65, 1.35, 2.2, 3.3].entries()) {
    const opacity = 0.18 - index * 0.025;
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 36, 24),
      new THREE.MeshBasicMaterial({
        color: index === 0 ? 0x1970ff : 0x214fc8,
        wireframe: true,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    shell.position.copy(waveCenter);
    shell.userData.baseOpacity = opacity;
    shell.userData.phase = index * 0.23;
    scene.add(shell);
    waveSpheres.push(shell);
  }
  const fieldSource = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x2f67ff, transparent: true, opacity: 0.96 }),
  );
  fieldSource.position.copy(waveCenter);
  scene.add(fieldSource);

  return { solidRoom, floorGrid, waveRings, waveSpheres };
}

export default function ObservatoryScene({ frame, mode, liveRequested, connection, showSkeleton, showGrid, showWaves, wireframe, autoRotate, onFps, resetToken }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<SceneGraph | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setSceneError('WebGL is unavailable in this browser. Signal, presence and event panels remain usable.');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D sensing room. Drag to orbit and scroll to zoom.');
    renderer.domElement.setAttribute('role', 'img');
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030609);
    scene.fog = new THREE.FogExp2(0x030609, 0.025);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 80);
    camera.position.set(0.7, 4.9, 9.1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.15, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.8;
    controls.minDistance = 5.5;
    controls.maxDistance = 17;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    controls.saveState();

    scene.add(new THREE.HemisphereLight(0x9dd8ed, 0x111825, 1.2));
    const keyLight = new THREE.DirectionalLight(0xbdeeff, 2.1);
    keyLight.position.set(-3, 7, 5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x5e49ff, 16, 18, 2);
    rimLight.position.set(3, 3.2, -3);
    scene.add(rimLight);

    const { solidRoom, floorGrid, waveRings, waveSpheres } = createRoom(scene);
    const skeleton = new THREE.Group();
    scene.add(skeleton);

    const resize = () => {
      if (!mount.isConnected) return;
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(mount);

    let animationId = 0;
    let fpsWindowStart = 0;
    let fpsFrames = 0;
    const animate = (time: number) => {
      animationId = window.requestAnimationFrame(animate);
      controls.update();
      fpsFrames += 1;
      if (!fpsWindowStart) fpsWindowStart = time;
      if (time - fpsWindowStart >= 1_000) {
        onFps?.(Math.round(fpsFrames * 1_000 / (time - fpsWindowStart)));
        fpsWindowStart = time;
        fpsFrames = 0;
      }
      for (const [index, ring] of waveRings.entries()) {
        const phase = ((time * 0.00022 + Number(ring.userData.phase)) % 1 + 1) % 1;
        const base = Number(ring.userData.baseScale);
        ring.scale.setScalar(base + phase * 1.75);
        (ring.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.38;
        ring.position.x = index < 3 ? -3.35 : 3.35;
      }
      for (const shell of waveSpheres) {
        const phase = time * 0.00035 + Number(shell.userData.phase);
        const pulse = 1 + Math.sin(phase) * 0.012;
        shell.scale.setScalar(pulse);
        (shell.material as THREE.MeshBasicMaterial).opacity = Number(shell.userData.baseOpacity) * (0.84 + 0.16 * Math.sin(phase));
      }
      renderer.render(scene, camera);
    };
    animationId = window.requestAnimationFrame(animate);
    graphRef.current = {
      scene, camera, renderer, controls, grid: floorGrid, solidRoom, waveRings, waveSpheres, skeleton,
      resizeObserver, animationId,
    };
    setSceneError(null);

    return () => {
      window.cancelAnimationFrame(animationId);
      resizeObserver?.disconnect();
      controls.dispose();
      disposeGroup(skeleton);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      graphRef.current = null;
    };
    // The scene graph is intentionally created once; mutable display settings are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.grid.visible = showGrid;
    graph.solidRoom.visible = !wireframe;
    graph.waveRings.forEach((ring) => { ring.visible = showWaves; });
    graph.waveSpheres.forEach((sphere) => { sphere.visible = showWaves; });
    graph.controls.autoRotate = autoRotate;
    graph.skeleton.visible = showSkeleton && Boolean((frame?.poses?.length || frame?.pose) && frame.poseStatus === 'valid');
  }, [showGrid, showWaves, showSkeleton, wireframe, autoRotate, frame]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.controls.reset();
  }, [resetToken]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const poses = frame?.poses?.length ? frame.poses : frame?.pose ? [frame.pose] : [];
    if (poses.length && frame?.poseStatus === 'valid') {
      buildSkeleton(graph.skeleton, poses);
    } else {
      disposeGroup(graph.skeleton);
    }
    graph.skeleton.visible = showSkeleton && Boolean(poses.length && frame?.poseStatus === 'valid');
  }, [frame?.pose, frame?.poses, frame?.poseStatus, showSkeleton]);

  const hasPose = Boolean(frame?.pose && frame.poseStatus === 'valid');
  const hasMovementData = Boolean(frame && (frame.movementLabel || frame.movementScore !== null));
  const provenance = frame?.sourceIsSimulated ? 'SYNTHETIC SAMPLE' : frame ? 'BACKEND OUTPUT' : 'NO SOURCE';
  const emptyTitle = !frame
    ? mode === 'live'
      ? liveRequested ? 'Waiting for RuView frame' : 'Live backend disconnected'
      : 'No sample in the local buffer'
    : frame.poseStatus === 'unreliable'
      ? 'Pose keypoints below threshold'
      : frame.presence === false
        ? 'Room currently clear'
        : frame.presence === true
          ? 'Presence data received'
          : hasMovementData
            ? 'Movement signal received'
            : 'Awaiting validated pose';
  const emptyDetail = !frame
    ? mode === 'live'
      ? liveRequested
        ? `${connection.toUpperCase()} · waiting for backend data. Pose keypoints are optional for movement, presence and RF telemetry.`
        : 'Use Connect to RuView above to start the feed. Physical sensing requires a supported CSI sensor and running backend.'
      : 'Resume the local simulation to generate clearly labeled synthetic samples.'
    : frame.poseStatus === 'unreliable'
      ? 'Keypoints failed validation; signal, presence and movement data remain available. No skeleton is drawn.'
      : frame.presence === true
        ? 'Live movement and presence do not require keypoints. This source did not provide a reliable pose.'
        : hasMovementData
          ? 'Signal or movement data is available without keypoints. No pose is inferred from RSSI.'
          : 'A skeleton is shown only when the selected source provides valid keypoints.';

  return (
    <div className="scene-stage">
      <div className="scene-canvas" ref={mountRef} />
      {sceneError ? (
        <div className="scene-webgl-fallback" role="status">
          <div className="fallback-orbit" aria-hidden="true" />
          <strong>3D renderer unavailable</strong>
          <span>{sceneError}</span>
        </div>
      ) : null}
      {!hasPose ? (
        <div className="scene-empty-state" aria-live="polite">
          <span className="empty-radar" aria-hidden="true"><i /><i /><i /></span>
          <strong>{emptyTitle}</strong>
          <span>{emptyDetail}</span>
        </div>
      ) : null}
      <div className="scene-provenance">{provenance}</div>
      <div className="scene-scale" aria-hidden="true">
        <span>01</span><span>02</span><span>03</span><span>04 m</span>
      </div>
      <div className="scene-bottom-caption">
        <span className="signal-dot" />
        <span>{!frame && mode === 'live' ? liveRequested ? 'WAITING FOR BACKEND' : 'BACKEND DISCONNECTED' : frame?.presence === true ? 'PRESENCE REPORTED' : 'SPATIAL FIELD MONITORING'}</span>
        <span className="caption-divider" />
        <span>{frame?.pose ? `${frame.pose.keypoints.filter((point) => point.confidence >= 0.2).length} KEYPOINTS` : frame ? 'POSE OPTIONAL · UNAVAILABLE' : 'NO FRAME RECEIVED'}</span>
      </div>
    </div>
  );
}
