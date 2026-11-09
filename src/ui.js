/**
 * RuView Observatory — rendering layer.
 *
 * Canvas drawing for the tactical map, CSI spectrum and vitals sparklines,
 * plus DOM updates for the mesh table, alert feed, console and status pills.
 * No framework dependencies; all functions are stateless with respect to the
 * world — they only draw the world they are given.
 */

const COL_W = 8;
const ROW_H = 6;
const MAP_PAD = 2;

function cellSize(canvas) {
  return {
    w: (canvas.width - MAP_PAD * 2) / COL_W,
    h: (canvas.height - MAP_PAD * 2) / ROW_H,
  };
}

function cellToCanvas(x, y, size) {
  return { x: MAP_PAD + x * size.w, y: MAP_PAD + y * size.h };
}

/* ---------------- map ---------------- */

export function drawMap(ctx, world) {
  const canvas = ctx.canvas;
  const size = cellSize(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Sector grid
  ctx.strokeStyle = '#1a241e';
  ctx.lineWidth = 1;
  for (let col = 0; col <= COL_W; col++) {
    ctx.beginPath();
    ctx.moveTo(MAP_PAD + col * size.w, MAP_PAD);
    ctx.lineTo(MAP_PAD + col * size.w, canvas.height - MAP_PAD);
    ctx.stroke();
  }
  for (let row = 0; row <= ROW_H; row++) {
    ctx.beginPath();
    ctx.moveTo(MAP_PAD, MAP_PAD + row * size.h);
    ctx.lineTo(canvas.width - MAP_PAD, MAP_PAD + row * size.h);
    ctx.stroke();
  }

  // Sector labels + occupancy tint
  ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const sector of world.sectors) {
    const c = cellToCanvas(sector.col, sector.row, size);
    if (sector.occupancy > 0) {
      ctx.fillStyle = sector.motion
        ? 'rgba(245, 185, 74, 0.10)'
        : 'rgba(94, 224, 138, 0.10)';
      ctx.fillRect(c.x, c.y, size.w, size.h);
    }
    ctx.fillStyle = '#4a5b52';
    ctx.fillText(sector.id, c.x + 4, c.y + 4);
    if (sector.occupancy > 0) {
      ctx.fillStyle = sector.motion ? '#f5b94a' : '#5ee08a';
      ctx.fillText(`×${sector.occupancy}`, c.x + 4, c.y + size.h - 18);
    }
  }

  // Mesh nodes with coverage rings
  for (const node of world.nodes) {
    const c = cellToCanvas(node.x, node.y, size);
    const color =
      node.status === 'online' ? '#5ee08a'
      : node.status === 'degraded' ? '#f5b94a'
      : '#ff6b6b';
    ctx.strokeStyle = `rgba(${hexRgb(color)}, 0.18)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.4 * size.w, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
  }

  // Contacts: trails, detection circles, markers, velocity vectors
  for (const contact of world.contacts) {
    const c = cellToCanvas(contact.x, contact.y, size);

    // trail
    ctx.strokeStyle = 'rgba(79, 210, 232, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    contact.trail.forEach((p, i) => {
      const tp = cellToCanvas(p.x, p.y, size);
      if (i === 0) ctx.moveTo(tp.x, tp.y);
      else ctx.lineTo(tp.x, tp.y);
    });
    ctx.stroke();

    // detection circle
    ctx.strokeStyle = 'rgba(79, 210, 232, 0.30)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 1.15 * size.w, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // marker (triangle oriented along velocity)
    const moving = contact.vx !== 0 || contact.vy !== 0;
    const angle = moving ? Math.atan2(contact.vy, contact.vx) : -Math.PI / 2;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(angle);
    ctx.fillStyle = moving ? '#4fd2e8' : '#d7e3da';
    ctx.strokeStyle = '#0b0f0c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // contact id
    ctx.fillStyle = '#d7e3da';
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(contact.id, c.x + 12, c.y - 6);
  }
}

/* ---------------- CSI spectrum ---------------- */

export function drawCsi(ctx, world) {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const pad = 10;
  const n = world.subcarriers.length;
  const barW = (canvas.width - pad * 2) / n;
  const baseline = canvas.height - 16;

  // baseline
  ctx.strokeStyle = '#223027';
  ctx.beginPath();
  ctx.moveTo(pad, baseline);
  ctx.lineTo(canvas.width - pad, baseline);
  ctx.stroke();

  for (let i = 0; i < n; i++) {
    const sub = world.subcarriers[i];
    const x = pad + i * barW;
    const h = Math.max(2, sub.amplitude * (canvas.height - 40));
    const inBand = world.interference.active &&
      Math.abs(i - world.interference.band) < world.interference.width;
    ctx.fillStyle = inBand ? '#ff6b6b' : '#5ee08a';
    ctx.fillRect(x + 1, baseline - h, Math.max(2, barW - 2), h);
  }

  // interference label
  if (world.interference.active) {
    ctx.fillStyle = '#ff6b6b';
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('INTERFERENCE', canvas.width - pad, 14);
    ctx.textAlign = 'left';
  }

  // channel labels
  ctx.fillStyle = '#556b5e';
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('5.18 GHz', pad, baseline + 14);
  ctx.textAlign = 'right';
  ctx.fillText('5.70 GHz', canvas.width - pad, baseline + 14);
  ctx.textAlign = 'left';
}

/* ---------------- vitals sparklines ---------------- */

export function drawVitals(ctx, world) {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const half = (canvas.height - 8) / 2;

  drawSparkline(ctx, world, 'breathing', 0, half, '#4fd2e8', 'BREATH/MIN', 4);
  drawSparkline(ctx, world, 'heart', half + 8, half, '#ff8fa3', 'HR/MIN', 8);
}

function drawSparkline(ctx, world, key, y0, height, color, label, min) {
  const canvas = ctx.canvas;
  const telemetry = world.telemetry;
  const pad = 56;

  ctx.fillStyle = '#556b5e';
  ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, 6, y0 + 12);

  const current = telemetry.length ? telemetry[telemetry.length - 1][key] : null;
  ctx.fillStyle = color;
  ctx.font = '700 14px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(current === null ? '—' : String(Math.round(current)), 6, y0 + 30);

  if (telemetry.length < 2) return;

  const values = telemetry.map((t) => t[key]).filter((v) => v !== null);
  if (values.length < 2) return;
  const lo = Math.min(...values) * 0.8;
  const hi = Math.max(...values) * 1.2 || 1;

  const n = telemetry.length;
  const xOf = (i) => pad + ((i / (n - 1)) * (canvas.width - pad * 2));
  const yOf = (v) => y0 + height - 4 - ((v - lo) / (hi - lo || 1)) * (height - 12);

  // zero/min reference line
  ctx.strokeStyle = '#223027';
  ctx.beginPath();
  ctx.moveTo(pad, y0 + height - 4);
  ctx.lineTo(canvas.width - 4, y0 + height - 4);
  ctx.stroke();

  // sparkline
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  telemetry.forEach((t, i) => {
    const v = t[key];
    if (v === null) { started = false; return; }
    const x = xOf(i);
    const y = yOf(v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // last point dot
  const last = telemetry[n - 1][key];
  if (last !== null) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(xOf(n - 1), yOf(last), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------------- DOM panels ---------------- */

export function updateMeshTable(tbody, world) {
  const rows = world.nodes.slice(0, 12).map((n) => {
    const statusClass =
      n.status === 'online' ? 'ok' : n.status === 'degraded' ? 'degraded' : 'offline';
    const uptime = formatUptime(n.uptime);
    return `<tr>
      <td>${n.id}</td>
      <td>${n.x >= 0 && n.x < COL_W ? String.fromCharCode(65 + Math.floor(n.x)) + (Math.floor(n.y) + 1) : '—'}</td>
      <td>${n.rssi.toFixed(0)} dBm</td>
      <td>${n.battery.toFixed(1)}%</td>
      <td>${n.packetRate}</td>
      <td>${uptime}</td>
      <td class="${statusClass}">${n.status.toUpperCase()}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('');
}

export function updateAlerts(listEl, world) {
  const alerts = world.alerts.slice(-24).reverse();
  listEl.innerHTML = alerts.map((a) => `
    <div class="alert-item ${a.level}">
      <span class="t">${formatSimTime(a.t)}</span>
      <span class="lvl">${a.level.toUpperCase()}</span>
      <span class="msg">${a.message}</span>
      <span class="sector">${a.sectorId ?? ''}</span>
    </div>`).join('');
}

export function updatePills(refs, world) {
  const contacts = world.contacts.length;
  const online = world.nodes.filter((n) => n.status === 'online').length;
  const degraded = world.nodes.filter((n) => n.status !== 'online').length;
  const alerts = world.alerts.filter((a) => a.level !== 'info').length;

  refs.pillContacts.textContent = `CONTACTS ${contacts}`;
  refs.pillMesh.textContent = `MESH ${online}/${world.nodes.length}${degraded ? ` · ${degraded} BAD` : ''}`;
  refs.pillSpectrum.textContent = world.interference.active ? 'SPECTRUM NOISE' : 'SPECTRUM OK';
  refs.pillSpectrum.classList.toggle('pill-warn', world.interference.active);
  refs.pillAlerts.textContent = `ALERTS ${alerts}`;
  refs.pillAlerts.classList.toggle('pill-critical', alerts > 0);
}

/* ---------------- helpers ---------------- */

function hexRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return `${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}`;
}

export function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatSimTime(ms) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
