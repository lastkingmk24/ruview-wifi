/**
 * Evaluation — match pipeline estimates against ground truth (synthetic
 * mock worlds). Shared by scripts/ground-truth.mjs and tests.
 */

export const GATES = [
  ['recall (detectable) >= 0.95', (m) => m.recallDetectable >= 0.95],
  ['split rate <= 0.10', (m) => m.splitRate <= 0.10],
  ['false merges == 0', (m) => m.mergeCount === 0],
  ['phantoms == 0', (m) => m.phantomCount === 0],
];

/**
 * Match estimated identities to ground-truth devices via the anonymizer
 * mapping (the evaluator is given the anonymizer to invert its own output).
 */
export function evaluate(world, clusterer, counter, anonymizer) {
  const anonToDevice = new Map();
  for (const dev of world.groundTruth.devices) {
    for (const mac of dev.knownMacs) {
      anonToDevice.set(anonymizer.anonymizeMac(mac), dev.index);
    }
  }

  const identityMacs = new Map();
  for (const id of clusterer.snapshot()) {
    identityMacs.set(id.id, id.macs);
  }

  const estimatedIds = new Set(counter.devices.keys());
  const matchedIdsByDevice = new Map();
  const phantomIds = [];
  let mergeCount = 0;

  for (const [id, macs] of identityMacs) {
    if (!estimatedIds.has(id)) continue;
    const devicesForId = new Set();
    for (const mac of macs) {
      const devIdx = anonToDevice.get(mac);
      if (devIdx !== undefined) devicesForId.add(devIdx);
    }
    if (devicesForId.size === 0) {
      phantomIds.push(id);
    } else if (devicesForId.size > 1) {
      mergeCount += 1; // false merge → undercount
      for (const devIdx of devicesForId) {
        if (!matchedIdsByDevice.has(devIdx)) matchedIdsByDevice.set(devIdx, new Set());
        matchedIdsByDevice.get(devIdx).add(id);
      }
    } else {
      const devIdx = [...devicesForId][0];
      if (!matchedIdsByDevice.has(devIdx)) matchedIdsByDevice.set(devIdx, new Set());
      matchedIdsByDevice.get(devIdx).add(id);
    }
  }

  const detectable = world.groundTruth.devices.filter((d) => d.detectable);
  const detected = detectable.filter((d) => matchedIdsByDevice.has(d.index));

  let splits = 0;
  for (const [, ids] of matchedIdsByDevice) {
    if (ids.size > 1) splits += ids.size - 1;
  }

  return {
    recallDetectable: detected.length / Math.max(1, detectable.length),
    recallAllActive: detected.length / Math.max(1, world.groundTruth.activeCount),
    splitCount: splits,
    splitRate: splits / Math.max(1, detected.length),
    mergeCount,
    phantomCount: phantomIds.length,
    detectedCount: detected.length,
    detectableCount: detectable.length,
    activeActual: world.groundTruth.activeCount,
    detectableActual: detectable.length,
    estimatedActive: counter.report(world.durationMs).active,
  };
}

export function zoneAccuracy(world, report) {
  const actualByZone = new Map();
  for (const dev of world.groundTruth.devices) {
    if (dev.detectable) actualByZone.set(dev.zone, (actualByZone.get(dev.zone) ?? 0) + 1);
  }
  const rows = [];
  let totalAbsErr = 0;
  for (const [zone, actual] of actualByZone) {
    const estimated = report.byZone[zone] ?? 0;
    rows.push({ zone, actual, estimated });
    totalAbsErr += Math.abs(actual - estimated);
  }
  return { rows, zoneMAE: totalAbsErr / Math.max(1, rows.length) };
}
