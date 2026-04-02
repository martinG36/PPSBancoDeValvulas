import { useRef, useState, useEffect, useCallback } from "react";
import Chart from "chart.js/auto";
import * as XLSX from "xlsx";
import ReportForm from "./components/ReportForm";

// ─── CONSTANTES ───────────────────────────────────────────────────
const SAMPLE_RATE = 20; // Hz (ESP32 @ 20 Hz)
const RENDER_MS = 500; // ms entre cada redibujado
const MAX_DISPLAY_POINTS = 800; // pts/curva para LTTB
const BAUD_RATE = 115200;
const MA_WINDOW = 100; // ventana promedio móvil (muestras)
const SLOPE_THRESH = 0.3; // Pa/muestra — umbral pendiente "estable"
const MIN_STABLE_RUN = 10; // muestras consecutivas bajo umbral

// Conversión ADC → Pascal
// Sensor 4–20 mA con R=220 Ω → 0.88 V – 4.4 V
// Rango del sensor: 0 – 10 bar = 0 – 1 000 000 Pa (ajustá según tu sensor)
const V_REF = 6.144; // tensión de referencia ADS1115 (V)
const ADC_FS = 32767; // fondo de escala ADC (15 bits con signo)
const R_SHUNT = 220; // ohmios
const I_MIN = 0.004; // 4 mA
const I_MAX = 0.02; // 20 mA
const P_MIN_PA = 0; // Pa mínimo del sensor
const P_MAX_PA = 1_000_000; // Pa máximo del sensor (10 bar)

function adcToPascal(raw) {
  const v = (raw / ADC_FS) * V_REF;
  const i = v / R_SHUNT;
  const ratio = Math.max(0, Math.min(1, (i - I_MIN) / (I_MAX - I_MIN)));
  return P_MIN_PA + ratio * (P_MAX_PA - P_MIN_PA);
}

// ─── LTTB ─────────────────────────────────────────────────────────
function lttb(data, threshold) {
  const len = data.length;
  if (threshold >= len || threshold <= 2) return data;
  const sampled = [data[0]];
  let a = 0;
  const bs = (len - 2) / (threshold - 2);
  for (let i = 0; i < threshold - 2; i++) {
    const ns = Math.floor((i + 1) * bs) + 1;
    const ne = Math.min(Math.floor((i + 2) * bs) + 1, len);
    let ax = 0,
      ay = 0;
    const nl = ne - ns;
    for (let j = ns; j < ne; j++) {
      ax += data[j].x;
      ay += data[j].y;
    }
    ax /= nl;
    ay /= nl;
    const bst = Math.floor(i * bs) + 1,
      ben = Math.floor((i + 1) * bs) + 1;
    const pax = data[a].x,
      pay = data[a].y;
    let maxA = -1,
      maxI = bst;
    for (let j = bst; j < ben; j++) {
      const area =
        Math.abs(
          (pax - ax) * (data[j].y - pay) - (pax - data[j].x) * (ay - pay),
        ) * 0.5;
      if (area > maxA) {
        maxA = area;
        maxI = j;
      }
    }
    sampled.push(data[maxI]);
    a = maxI;
  }
  sampled.push(data[len - 1]);
  return sampled;
}

// ─── PALETA ───────────────────────────────────────────────────────
const DARK = [
  "#00d4aa",
  "#ff6b6b",
  "#ffd93d",
  "#6bcbff",
  "#c77dff",
  "#ff9f43",
  "#a8e063",
  "#fd79a8",
];
const LIGHT = [
  "#0a7c68",
  "#c0392b",
  "#b7950b",
  "#1565c0",
  "#6a1b9a",
  "#e65100",
  "#2e7d32",
  "#ad1457",
];
const getColor = (i, light) => (light ? LIGHT : DARK)[i % 8];
const toRgba = (hex, a) => {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n, z = 2) => String(n).padStart(z, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function fmtHHMMSS(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtPa(pa) {
  if (pa === null || pa === undefined || isNaN(pa)) return "—";
  if (pa >= 1_000_000) return (pa / 1_000_000).toFixed(4) + " MPa";
  if (pa >= 1_000) return (pa / 1_000).toFixed(2) + " kPa";
  return pa.toFixed(1) + " Pa";
}

function getTheme(light) {
  return light
    ? {
        grid: "rgba(208,215,222,0.8)",
        tick: "#8c959f",
        lbl: "#57606a",
        ttBg: "#eaedf0",
        ttBdr: "#d0d7de",
        ttTtl: "#57606a",
        ttBdy: "#1f2328",
      }
    : {
        grid: "rgba(48,54,61,0.6)",
        tick: "#484f58",
        lbl: "#8b949e",
        ttBg: "#21262d",
        ttBdr: "#30363d",
        ttTtl: "#8b949e",
        ttBdy: "#e6edf3",
      };
}

// ─── PROMEDIO MÓVIL + DETECCIÓN DE APERTURA / CIERRE ─────────────
function computeMovingAverage(samples, window) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i].value;
    if (i >= window) sum -= samples[i - window].value;
    const len = Math.min(i + 1, window);
    out.push(sum / len);
  }
  return out; // mismo largo que samples
}

/**
 * Detecta índice de apertura (máximo) y cierre (estabilización post-pico)
 * en la curva suavizada. Devuelve índices relativos a samples[].
 */
function detectKeyPoints(samples, maValues) {
  if (samples.length < MA_WINDOW + 10) return { openIdx: null, closeIdx: null };

  // 1. Máximo en la curva original
  let openIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].value > samples[openIdx].value) openIdx = i;
  }

  // 2. Buscar estabilización POST-pico en la curva suavizada
  // La curva MA tiene un desplazamiento temporal de (MA_WINDOW-1)/2 muestras
  const maOffset = Math.floor((MA_WINDOW - 1) / 2); // índice en original = maIdx - maOffset
  let closeIdx = null;
  let stableRun = 0;
  for (let i = openIdx + 1; i < maValues.length - 1; i++) {
    const slope = Math.abs(maValues[i + 1] - maValues[i]);
    if (slope < SLOPE_THRESH) {
      stableRun++;
      if (stableRun >= MIN_STABLE_RUN && closeIdx === null) {
        // Corrección temporal: restar el desplazamiento de la MA
        const correctedIdx = Math.max(openIdx + 1, i - stableRun - maOffset);
        closeIdx = Math.min(correctedIdx, samples.length - 1);
      }
    } else {
      stableRun = 0;
    }
  }

  return { openIdx, closeIdx };
}

// ─── SIMULACIÓN — curva realista de válvula de alivio ─────────────
// Fases: rampa_up → pico → caída → estabilización
// Devuelve el valor en Pa para la muestra #n de esa curva
function simValue(n) {
  const BASE = 200_000; // Pa inicial (2 bar)
  const PEAK = 750_000; // Pa pico (7.5 bar)
  const STABLE = 480_000; // Pa estable post-apertura (4.8 bar)
  const NOISE = 5_000; // ruido ±5 kPa
  const noise = () => (Math.random() - 0.5) * 2 * NOISE;

  const RAMP_SAMPLES = SAMPLE_RATE * 25; // 25 s subiendo
  const FALL_SAMPLES = SAMPLE_RATE * 5; // 5 s cayendo

  if (n < RAMP_SAMPLES) {
    // Subida lenta con ligera curva (exponencial suavizada)
    const t = n / RAMP_SAMPLES;
    return BASE + (PEAK - BASE) * (t * t * (3 - 2 * t)) + noise();
  } else if (n < RAMP_SAMPLES + FALL_SAMPLES) {
    // Caída relativamente rápida (exponencial)
    const t = (n - RAMP_SAMPLES) / FALL_SAMPLES;
    return PEAK - (PEAK - STABLE) * (1 - Math.exp(-5 * t)) + noise();
  } else {
    // Estabilización con pequeñas fluctuaciones
    return STABLE + noise() * 0.3;
  }
}

// ─── APP ──────────────────────────────────────────────────────────
export default function App() {
  const [isLight, setIsLight] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSim, setIsSim] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [logs, setLogs] = useState([]);
  const [metrics, setMetrics] = useState({
    current: "—",
    max: "—",
    totalSamples: 0,
    time: "00:00",
  });
  const [chartInfo, setChartInfo] = useState("Esperando medición...");
  const [statusState, setStatusState] = useState("disconnected");
  const [curveCount, setCurveCount] = useState(0);
  const [curveList, setCurveList] = useState([]);
  const [curveResults, setCurveResults] = useState([]); // [{id, color, openPa, closePa, openMs, closeMs}]
  const [availablePorts, setAvailablePorts] = useState([]);
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [selectedPortId, setSelectedPortId] = useState("");
  const [activeTab, setActiveTab] = useState("chart");
  const [pdfStatus, setPdfStatus] = useState(null);
  const [pdfMsg, setPdfMsg] = useState("");
  const [isInteractive, setIsInteractive] = useState(false); // tooltip activo post-stop

  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const chartWrapRef = useRef(null);
  const curvesRef = useRef([]); // [{id, color, startTimeMs, samples:[{realTimeMs, value}], openIdx, closeIdx}]
  const activeCurveRef = useRef(null);
  const simCountRef = useRef(0); // contador de muestras de simulación
  const simIntervalRef = useRef(null);
  const renderIntervalRef = useRef(null); // intervalo de 500 ms para render
  const timerIntervalRef = useRef(null);
  const portRef = useRef(null);
  const serialBufRef = useRef("");
  const isRecordingRef = useRef(false);
  const isSimRef = useRef(false);
  const isLightRef = useRef(false);
  const logPanelRef = useRef(null);
  // Para drag de marcadores
  const draggingRef = useRef(null); // {curveIdx, type:'open'|'close'}
  const curveResultsRef = useRef([]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  useEffect(() => {
    isSimRef.current = isSim;
  }, [isSim]);
  useEffect(() => {
    isLightRef.current = isLight;
  }, [isLight]);
  useEffect(() => {
    curveResultsRef.current = curveResults;
  }, [curveResults]);

  useEffect(() => {
    initChart();
    addLog("PressureScope v2.0 iniciado.", "info");
    if ("serial" in navigator) addLog("Web Serial API disponible.", "info");
    else addLog("Web Serial API no disponible. Usá Chrome/Edge.", "warn");
    if (window.electronAPI) {
      window.electronAPI.onSerialPortsList((list) => {
        setAvailablePorts(list);
        setIsDialogVisible(true);
        if (list.length) setSelectedPortId(list[0].portId);
      });
    }
    return () => {
      chartRef.current?.destroy();
      if (renderIntervalRef.current) clearInterval(renderIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", isLight);
    if (chartRef.current) updateChartTheme(isLight);
  }, [isLight]);

  useEffect(() => {
    if (logPanelRef.current)
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (chartWrapRef.current)
      chartWrapRef.current.style.display =
        activeTab === "chart" ? "flex" : "none";
  }, [activeTab]);

  const addLog = useCallback((msg, type = "") => {
    const ts = fmtTime(Date.now());
    setLogs((p) => {
      const n = [...p, { ts, msg, type }];
      return n.length > 200 ? n.slice(-200) : n;
    });
  }, []);

  // ─── CHART ────────────────────────────────────────────────────
  function initChart() {
    if (chartRef.current) chartRef.current.destroy();
    const c = getTheme(isLightRef.current);

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { datasets: [] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "none", intersect: false }, // se activa post-grabación
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false, // se habilita post-grabación
            backgroundColor: c.ttBg,
            borderColor: c.ttBdr,
            borderWidth: 1,
            titleColor: c.ttTtl,
            bodyColor: c.ttBdy,
            titleFont: { family: "Courier New", size: 11, weight: "bold" },
            bodyFont: { family: "Courier New", size: 12 },
            padding: 10,
            callbacks: {
              title: (items) => {
                if (!items.length) return "";
                const ms = items[0].raw?.realTimeMs;
                return ms
                  ? `⏱ ${fmtHHMMSS(ms)}`
                  : `t = ${items[0].parsed.x.toFixed(2)}s`;
              },
              label: (item) => {
                const pa = item.parsed.y;
                const ms = item.raw?.realTimeMs;
                const timeStr = ms ? fmtTime(ms) : "--";
                return ` Curva ${item.datasetIndex + 1}: ${fmtPa(pa)}  [${timeStr}]`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            display: true,
            grid: { color: c.grid, lineWidth: 0.5 },
            ticks: {
              color: c.tick,
              font: { family: "Courier New", size: 10 },
              maxTicksLimit: 12,
              callback: (val) => val.toFixed(1) + "s",
            },
            title: {
              display: true,
              text: "Tiempo transcurrido (s) — eje X alineado por inicio de curva",
              color: c.lbl,
              font: { family: "Courier New", size: 11, weight: "bold" },
            },
          },
          y: {
            display: true,
            grid: { color: c.grid, lineWidth: 0.5 },
            ticks: {
              color: c.tick,
              font: { family: "Courier New", size: 10 },
              callback: (v) => {
                if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + " MPa";
                if (v >= 1_000) return (v / 1_000).toFixed(1) + " kPa";
                return v.toFixed(0) + " Pa";
              },
            },
            title: {
              display: true,
              text: "Presión (Pa)",
              color: c.lbl,
              font: { family: "Courier New", size: 11, weight: "bold" },
            },
          },
        },
        // Plugin personalizado para dibujar marcadores de apertura/cierre
        // y permitir arrastrarlos
        onHover: (event, elements, chart) => {
          if (!isInteractiveRef.current) return;
          chart.canvas.style.cursor = elements.length ? "crosshair" : "default";
        },
      },
      plugins: [markerPlugin],
    });

    // Evento de click para arrastre de marcadores
    canvasRef.current.addEventListener("mousedown", onMarkerMouseDown);
    canvasRef.current.addEventListener("mousemove", onMarkerMouseMove);
    canvasRef.current.addEventListener("mouseup", onMarkerMouseUp);
  }

  // ─── PLUGIN DE MARCADORES ─────────────────────────────────────
  // Dibuja diamantes en los puntos de apertura y cierre post-medición
  const isInteractiveRef = useRef(false);
  useEffect(() => {
    isInteractiveRef.current = isInteractive;
  }, [isInteractive]);

  const markerPlugin = {
    id: "markerPlugin",
    afterDraw(chart) {
      if (!isInteractiveRef.current) return;
      const results = curveResultsRef.current;
      if (!results.length) return;
      const ctx = chart.ctx;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;

      results.forEach((res, ci) => {
        const curve = curvesRef.current[ci];
        if (!curve) return;
        const dt = 1 / SAMPLE_RATE;

        // Marcador de apertura
        if (res.openIdx !== null && res.openIdx < curve.samples.length) {
          const s = curve.samples[res.openIdx];
          const xSec = (s.realTimeMs - curve.startTimeMs) / 1000;
          const px = xScale.getPixelForValue(xSec);
          const py = yScale.getPixelForValue(s.value);
          drawDiamond(ctx, px, py, "#ffd93d", `▲ Apertura C${ci + 1}`);
        }
        // Marcador de cierre
        if (res.closeIdx !== null && res.closeIdx < curve.samples.length) {
          const s = curve.samples[res.closeIdx];
          const xSec = (s.realTimeMs - curve.startTimeMs) / 1000;
          const px = xScale.getPixelForValue(xSec);
          const py = yScale.getPixelForValue(s.value);
          drawDiamond(ctx, px, py, "#6bcbff", `▼ Cierre C${ci + 1}`);
        }
      });
    },
  };

  function drawDiamond(ctx, px, py, color, label) {
    const S = 10;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px, py - S);
    ctx.lineTo(px + S, py);
    ctx.lineTo(px, py + S);
    ctx.lineTo(px - S, py);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = "bold 10px Courier New";
    ctx.fillText(label, px + 13, py + 4);
    ctx.restore();
  }

  // ─── ARRASTRE DE MARCADORES ───────────────────────────────────
  function onMarkerMouseDown(e) {
    if (!isInteractiveRef.current || !chartRef.current) return;
    const chart = chartRef.current;
    const rect = chart.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const SNAP = 18; // px

    curveResultsRef.current.forEach((res, ci) => {
      const curve = curvesRef.current[ci];
      if (!curve) return;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;

      ["openIdx", "closeIdx"].forEach((key) => {
        const idx = res[key];
        if (idx === null || idx >= curve.samples.length) return;
        const s = curve.samples[idx];
        const xSec = (s.realTimeMs - curve.startTimeMs) / 1000;
        const px = xScale.getPixelForValue(xSec);
        const py = yScale.getPixelForValue(s.value);
        if (Math.abs(mx - px) < SNAP && Math.abs(my - py) < SNAP) {
          draggingRef.current = { ci, key };
          e.preventDefault();
        }
      });
    });
  }

  function onMarkerMouseMove(e) {
    if (!draggingRef.current || !chartRef.current) return;
    const chart = chartRef.current;
    const rect = chart.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const xScale = chart.scales.x;
    const xSec = xScale.getValueForPixel(mx);

    const { ci, key } = draggingRef.current;
    const curve = curvesRef.current[ci];
    if (!curve) return;

    // Encontrar el sample más cercano a xSec
    const targetMs = curve.startTimeMs + xSec * 1000;
    let best = 0;
    let bestDiff = Infinity;
    curve.samples.forEach((s, i) => {
      const diff = Math.abs(s.realTimeMs - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });

    setCurveResults((prev) => {
      const next = prev.map((r, i) => {
        if (i !== ci) return r;
        const updated = { ...r, [key]: best };
        return {
          ...updated,
          openPa: curve.samples[updated.openIdx]?.value ?? r.openPa,
          closePa:
            updated.closeIdx !== null
              ? (curve.samples[updated.closeIdx]?.value ?? r.closePa)
              : r.closePa,
          openMs: curve.samples[updated.openIdx]?.realTimeMs ?? r.openMs,
          closeMs:
            updated.closeIdx !== null
              ? (curve.samples[updated.closeIdx]?.realTimeMs ?? r.closeMs)
              : r.closeMs,
        };
      });
      curveResultsRef.current = next;
      return next;
    });

    chart.update("none");
  }

  function onMarkerMouseUp() {
    draggingRef.current = null;
  }

  // ─── AGREGAR CURVA AL CHART ───────────────────────────────────
  function addCurveDataset(idx, color) {
    if (!chartRef.current) return;
    chartRef.current.data.datasets.push({
      label: `Curva ${idx + 1}`,
      data: [],
      yAxisID: "y",
      borderColor: color,
      backgroundColor: toRgba(color, 0.07),
      borderWidth: 1.8,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: color,
      tension: 0.2,
    });
    chartRef.current.update("none");
  }

  // ─── RENDER PERIÓDICO (500 ms) ────────────────────────────────
  function startRenderInterval() {
    if (renderIntervalRef.current) clearInterval(renderIntervalRef.current);
    renderIntervalRef.current = setInterval(() => {
      if (
        !isRecordingRef.current ||
        !activeCurveRef.current ||
        !chartRef.current
      )
        return;
      const curve = activeCurveRef.current;
      const dsIdx = curvesRef.current.length - 1;

      // Construir puntos para esta curva (tiempo relativo en segundos)
      const raw = curve.samples.map((s) => ({
        x: (s.realTimeMs - curve.startTimeMs) / 1000,
        y: s.value,
        realTimeMs: s.realTimeMs,
      }));
      // LTTB si hay muchos puntos, para no saturar el canvas
      chartRef.current.data.datasets[dsIdx].data = lttb(
        raw,
        MAX_DISPLAY_POINTS,
      );
      chartRef.current.update("none");

      const n = curve.samples.length;
      if (n > 0) {
        const last = curve.samples[n - 1].value;
        const vals = curve.samples.map((s) => s.value);
        const maxV = Math.max(...vals);
        setMetrics((m) => ({
          ...m,
          current: fmtPa(last),
          max: fmtPa(maxV),
          totalSamples: n,
        }));
        setChartInfo(
          `Curva ${curvesRef.current.length} en vivo — ${n.toLocaleString()} muestras`,
        );
      }
    }, RENDER_MS);
  }

  function stopRenderInterval() {
    if (renderIntervalRef.current) {
      clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
  }

  // Reconstruye todas las curvas con LTTB (vista completa)
  function rebuildFullChart() {
    if (!chartRef.current || !curvesRef.current.length) return;
    curvesRef.current.forEach((curve, i) => {
      const raw = curve.samples.map((s) => ({
        x: (s.realTimeMs - curve.startTimeMs) / 1000,
        y: s.value,
        realTimeMs: s.realTimeMs,
      }));
      chartRef.current.data.datasets[i].data = lttb(raw, MAX_DISPLAY_POINTS);
    });
    chartRef.current.update("none");
    const total = curvesRef.current.reduce((a, c) => a + c.samples.length, 0);
    setChartInfo(
      `Vista completa · ${total.toLocaleString()} pts → máx ${MAX_DISPLAY_POINTS} pts/curva (LTTB)`,
    );
  }

  function updateChartTheme(light) {
    if (!chartRef.current) return;
    const c = getTheme(light);
    chartRef.current.data.datasets.forEach((ds, i) => {
      const col = getColor(i, light);
      ds.borderColor = col;
      ds.backgroundColor = toRgba(col, 0.07);
      ds.pointHoverBackgroundColor = col;
    });
    curvesRef.current.forEach((curve, i) => {
      curve.color = getColor(i, light);
    });
    setCurveList([...curvesRef.current]);
    const o = chartRef.current.options;
    o.plugins.tooltip.backgroundColor = c.ttBg;
    o.plugins.tooltip.borderColor = c.ttBdr;
    o.plugins.tooltip.titleColor = c.ttTtl;
    o.plugins.tooltip.bodyColor = c.ttBdy;
    o.scales.x.grid.color = c.grid;
    o.scales.x.ticks.color = c.tick;
    o.scales.x.title.color = c.lbl;
    o.scales.y.grid.color = c.grid;
    o.scales.y.ticks.color = c.tick;
    o.scales.y.title.color = c.lbl;
    chartRef.current.update("none");
  }

  // Activa interactividad del tooltip y marcadores post-grabación
  function enableInteractivity() {
    if (!chartRef.current) return;
    chartRef.current.options.interaction = { mode: "index", intersect: false };
    chartRef.current.options.plugins.tooltip.enabled = true;
    chartRef.current.update("none");
    setIsInteractive(true);
    isInteractiveRef.current = true;
  }
  function disableInteractivity() {
    if (!chartRef.current) return;
    chartRef.current.options.interaction = { mode: "none", intersect: false };
    chartRef.current.options.plugins.tooltip.enabled = false;
    chartRef.current.update("none");
    setIsInteractive(false);
    isInteractiveRef.current = false;
  }

  // ─── SERIAL ───────────────────────────────────────────────────
  async function connectSerial() {
    if (!("serial" in navigator))
      return addLog("Web Serial no disponible.", "err");
    try {
      addLog("Buscando dispositivos...", "info");
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      portRef.current = port;
      setIsConnected(true);
      setIsSim(false);
      setStatusState("connected");
      addLog(`Conectado @ ${BAUD_RATE} baud.`, "info");
      readSerial(port);
    } catch (e) {
      if (e.name === "NotFoundError") addLog("Selección cancelada.", "warn");
      else addLog(`Error: ${e.message}`, "err");
    }
  }
  const handleConfirmPort = () => {
    window.electronAPI?.selectSerialPort(selectedPortId);
    setIsDialogVisible(false);
  };
  const handleCancelPort = () => {
    window.electronAPI?.cancelSerialPortSelection();
    setIsDialogVisible(false);
  };

  async function readSerial(port) {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        serialBufRef.current += value;
        const lines = serialBufRef.current.split("\n");
        serialBufRef.current = lines.pop();
        for (const line of lines) {
          if (line.trim().startsWith("#")) continue;
          const raw = parseFloat(line.trim());
          if (!isNaN(raw) && isRecordingRef.current)
            addSample(adcToPascal(raw));
        }
      }
    } catch (e) {
      if (isRecordingRef.current) addLog("Error serial: " + e.message, "err");
    }
  }

  // ─── SIMULACIÓN ───────────────────────────────────────────────
  function toggleSim() {
    if (isSimRef.current) {
      setIsSim(false);
      setStatusState("disconnected");
      addLog("Simulación OFF", "warn");
    } else {
      setIsSim(true);
      setIsConnected(false);
      setStatusState("sim");
      addLog("Simulación ON — curva realista de válvula de alivio", "info");
    }
  }

  function startSimInterval() {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    simCountRef.current = 0;
    simIntervalRef.current = setInterval(() => {
      if (!isRecordingRef.current || !isSimRef.current) return;
      addSample(simValue(simCountRef.current));
      simCountRef.current++;
    }, 1000 / SAMPLE_RATE);
  }

  // ─── AGREGAR MUESTRA ──────────────────────────────────────────
  function addSample(pa) {
    if (!isRecordingRef.current || !activeCurveRef.current) return;
    activeCurveRef.current.samples.push({ value: pa, realTimeMs: Date.now() });
  }

  // ─── TIMER ────────────────────────────────────────────────────
  function startTimer() {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      if (!activeCurveRef.current) return;
      const e = Math.floor(
        (Date.now() - activeCurveRef.current.startTimeMs) / 1000,
      );
      setMetrics((p) => ({
        ...p,
        time: `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`,
      }));
    }, 500);
  }

  // ─── CONTROL ──────────────────────────────────────────────────
  function startCountdown() {
    setCountdown(3);
    let c = 3;
    const t = setInterval(() => {
      c--;
      if (c <= 0) {
        clearInterval(t);
        setCountdown(null);
        beginMeasurement();
      } else setCountdown(c);
    }, 1000);
  }

  function beginMeasurement() {
    disableInteractivity();
    const startTimeMs = Date.now(),
      idx = curvesRef.current.length;
    const color = getColor(idx, isLightRef.current);
    const curve = { id: idx + 1, color, startTimeMs, samples: [] };
    curvesRef.current.push(curve);
    activeCurveRef.current = curve;
    addCurveDataset(idx, color);
    startTimer();
    startRenderInterval();
    isRecordingRef.current = true;
    setIsRecording(true);
    setCurveCount(curvesRef.current.length);
    setCurveList([...curvesRef.current]);
    addLog(
      `▶ Curva ${curve.id} — ${new Date(startTimeMs).toLocaleTimeString()}`,
      "info",
    );
    if (isSimRef.current) startSimInterval();
  }

  function stopMeasurement() {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    stopRenderInterval();
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    const curve = activeCurveRef.current;
    addLog(
      `■ Curva ${curve?.id} — ${curve?.samples.length.toLocaleString()} muestras`,
      "warn",
    );

    // Calcular promedio móvil y detectar puntos clave
    if (curve && curve.samples.length > MA_WINDOW) {
      const maVals = computeMovingAverage(curve.samples, MA_WINDOW);
      const { openIdx, closeIdx } = detectKeyPoints(curve.samples, maVals);
      curve.openIdx = openIdx;
      curve.closeIdx = closeIdx;

      const openSample = openIdx !== null ? curve.samples[openIdx] : null;
      const closeSample = closeIdx !== null ? curve.samples[closeIdx] : null;

      const result = {
        id: curve.id,
        color: curve.color,
        openIdx,
        closeIdx,
        openPa: openSample?.value ?? null,
        closePa: closeSample?.value ?? null,
        openMs: openSample?.realTimeMs ?? null,
        closeMs: closeSample?.realTimeMs ?? null,
      };

      setCurveResults((prev) => {
        const next = [...prev.filter((r) => r.id !== curve.id), result];
        curveResultsRef.current = next;
        return next;
      });

      if (openSample)
        addLog(
          `↑ Apertura Curva ${curve.id}: ${fmtPa(openSample.value)} @ ${fmtTime(openSample.realTimeMs)}`,
          "info",
        );
      if (closeSample)
        addLog(
          `↓ Cierre  Curva ${curve.id}: ${fmtPa(closeSample.value)} @ ${fmtTime(closeSample.realTimeMs)}`,
          "info",
        );
    }

    setCurveList([...curvesRef.current]);
    rebuildFullChart();
    enableInteractivity();
  }

  function clearData() {
    if (isRecordingRef.current) {
      if (!window.confirm("¿Detener y borrar todos los datos?")) return;
      isRecordingRef.current = false;
      setIsRecording(false);
      stopRenderInterval();
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    disableInteractivity();
    curvesRef.current = [];
    activeCurveRef.current = null;
    chartRef.current.data.datasets = [];
    chartRef.current.update();
    setCurveCount(0);
    setCurveList([]);
    setCurveResults([]);
    curveResultsRef.current = [];
    setMetrics({ current: "—", max: "—", totalSamples: 0, time: "00:00" });
    setChartInfo("Esperando medición...");
    addLog("Gráfica limpia.", "warn");
  }

  // ─── EXCEL ────────────────────────────────────────────────────
  function exportExcel() {
    if (!curvesRef.current.length) return addLog("No hay datos.", "warn");
    const curves = curvesRef.current;
    const header = ["N° Muestra"];
    const cols = [{ wch: 12 }];
    curves.forEach((_, i) => {
      header.push(`Hora Curva ${i + 1}`, `Presión Curva ${i + 1} (Pa)`);
      cols.push({ wch: 16 }, { wch: 22 });
    });
    const rows = [header];
    const maxS = Math.max(...curves.map((c) => c.samples.length));
    for (let i = 0; i < maxS; i++) {
      const row = [i];
      curves.forEach((c) => {
        if (i < c.samples.length) {
          const s = c.samples[i];
          row.push(fmtTime(s.realTimeMs), parseFloat(s.value.toFixed(2)));
        } else row.push("", "");
      });
      rows.push(row);
    }
    const wb = XLSX.utils.book_new(),
      ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = cols;
    XLSX.utils.book_append_sheet(wb, ws, "Datos");
    XLSX.writeFile(
      wb,
      `PPS_BancoValvulas_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.xlsx`,
    );
    addLog("Excel exportado.", "info");
  }

  // ─── PDF ──────────────────────────────────────────────────────
  async function handleGeneratePDF(formData) {
    if (!window.electronAPI?.generatePDF) {
      addLog("electronAPI no disponible.", "err");
      return;
    }
    setPdfStatus("generating");
    setPdfMsg("Generando informe...");
    addLog("Generando PDF REG EV-01...", "info");
    try {
      const r = await window.electronAPI.generatePDF(formData);
      if (r.success) {
        setPdfStatus("ok");
        setPdfMsg(`Guardado: ${r.path}`);
        addLog(`✓ PDF: ${r.path}`, "info");
      } else if (r.reason === "cancelled") {
        setPdfStatus(null);
        addLog("PDF cancelado.", "warn");
      } else {
        setPdfStatus("error");
        setPdfMsg(`Error: ${r.reason}`);
        addLog(`Error PDF: ${r.reason}`, "err");
      }
    } catch (e) {
      setPdfStatus("error");
      setPdfMsg("Error inesperado.");
      addLog(`Error PDF: ${e.message}`, "err");
    }
    setTimeout(() => setPdfStatus(null), 6000);
  }

  // ─── ESTILOS ──────────────────────────────────────────────────
  const tabStyle = (tab) => ({
    padding: "8px 22px",
    borderRadius: "6px 6px 0 0",
    border: "1px solid var(--border)",
    borderBottom:
      activeTab === tab ? "1px solid var(--bg2)" : "1px solid var(--border)",
    background: activeTab === tab ? "var(--bg2)" : "transparent",
    color: activeTab === tab ? "var(--text)" : "var(--text2)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: activeTab === tab ? 600 : 400,
    marginBottom: -1,
    transition: "all 0.15s",
  });

  const bufferPct = activeCurveRef.current
    ? Math.min(100, (activeCurveRef.current.samples.length / 30_000) * 100)
    : 0;

  // ─── RENDER ───────────────────────────────────────────────────
  return (
    <>
      {/* Countdown */}
      {countdown !== null && (
        <div className="overlay active">
          <div className="countdown-num">{countdown}</div>
          <div className="countdown-label">INICIANDO...</div>
        </div>
      )}

      {/* Selector puerto */}
      {isDialogVisible && (
        <div className="overlay active" style={{ zIndex: 9999 }}>
          <div
            style={{
              background: "var(--bg2)",
              padding: "24px",
              borderRadius: "8px",
              minWidth: "320px",
              border: "1px solid var(--border)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            }}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: "16px",
                color: "var(--text)",
              }}
            >
              Seleccionar Puerto COM
            </h3>
            {!availablePorts.length ? (
              <p
                style={{ color: "var(--warn)", fontSize: 14, marginBottom: 20 }}
              >
                No se encontraron dispositivos.
              </p>
            ) : (
              <select
                value={selectedPortId}
                onChange={(e) => setSelectedPortId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  marginBottom: "24px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                }}
              >
                {availablePorts.map((p, i) => (
                  <option key={i} value={p.portId}>
                    {p.displayName || p.portName || `USB ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            <div
              style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}
            >
              <button className="btn" onClick={handleCancelPort}>
                Cancelar
              </button>
              <button
                className="btn success"
                onClick={handleConfirmPort}
                disabled={!availablePorts.length}
              >
                Conectar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notificación PDF */}
      {pdfStatus && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9998,
            background:
              pdfStatus === "ok"
                ? "#1a7f37"
                : pdfStatus === "error"
                  ? "#cf222e"
                  : "#0969da",
            color: "#fff",
            borderRadius: 8,
            padding: "12px 20px",
            fontSize: 13,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: 460,
          }}
        >
          <span style={{ fontSize: 16 }}>
            {pdfStatus === "generating" ? "⟳" : pdfStatus === "ok" ? "✓" : "✕"}
          </span>
          <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{pdfMsg}</span>
          <button
            onClick={() => setPdfStatus(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div className="header">
        <div className="header-left">
          <div className="logo">
            PressureScope <span>v2.0</span>
          </div>
          <div>
            <span
              className={[
                "status-dot",
                statusState === "connected"
                  ? "connected"
                  : statusState === "sim"
                    ? "sim"
                    : "",
                isRecording ? "recording" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
            <span
              className="status-label"
              style={{
                color:
                  statusState === "connected"
                    ? "var(--green)"
                    : statusState === "sim"
                      ? "var(--warn)"
                      : "var(--text2)",
              }}
            >
              {statusState === "connected"
                ? "CONECTADO"
                : statusState === "sim"
                  ? "SIMULACIÓN"
                  : "DESCONECTADO"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isSim && (
            <div
              className="status-label"
              style={{
                color: "var(--warn)",
                border: "1px solid var(--warn)",
                padding: "3px 10px",
                borderRadius: 4,
              }}
            >
              SIMULACIÓN
            </div>
          )}
          {isRecording ? (
            <div
              className="status-label"
              style={{
                color: "var(--danger)",
                border: "1px solid var(--danger)",
                padding: "3px 10px",
                borderRadius: 4,
              }}
            >
              ● REC — Curva {curveCount}
            </div>
          ) : (
            curveCount > 0 && (
              <div
                className="status-label"
                style={{
                  color: "var(--text2)",
                  border: "1px solid var(--border)",
                  padding: "3px 10px",
                  borderRadius: 4,
                }}
              >
                {curveCount} curva(s)
              </div>
            )
          )}
          <button
            className="theme-toggle"
            onClick={() => setIsLight((v) => !v)}
          >
            {isLight ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="toolbar"
        style={{ display: activeTab === "chart" ? undefined : "none" }}
      >
        <div>
          <div className="section-label">Puerto COM</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn success" onClick={connectSerial}>
              Conectar ESP32
            </button>
            <button className="btn warn" onClick={toggleSim}>
              {isSim ? "Desactivar Sim." : "Modo Simulación"}
            </button>
          </div>
        </div>
        <div className="separator" />
        <div>
          <div className="section-label">Control</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn primary"
              onClick={startCountdown}
              disabled={
                isRecording || countdown !== null || (!isConnected && !isSim)
              }
            >
              ▶ Nueva Curva
            </button>
            <button
              className="btn danger"
              onClick={stopMeasurement}
              disabled={!isRecording}
            >
              ■ Detener
            </button>
            <button className="btn" onClick={clearData}>
              Limpiar todo
            </button>
          </div>
        </div>
        <div className="separator" />
        <div>
          <div className="section-label">Exportar</div>
          <button className="btn" onClick={exportExcel} disabled={!curveCount}>
            Excel
          </button>
        </div>
        {!isRecording && curveCount > 0 && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: isInteractive ? "var(--green)" : "var(--text3)",
              }}
            >
              {isInteractive
                ? "● Tooltip activo — movés el cursor para inspeccionar"
                : "○ Tooltip desactivado durante grabación"}
            </span>
          </div>
        )}
      </div>

      {/* Pestañas */}
      <div
        style={{
          display: "flex",
          padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <button style={tabStyle("chart")} onClick={() => setActiveTab("chart")}>
          📈 Gráfica
        </button>
        <button
          style={tabStyle("report")}
          onClick={() => setActiveTab("report")}
        >
          📄 Informe REG EV-01
        </button>
      </div>

      {/* ── Gráfica — NUNCA se desmonta ── */}
      <div
        ref={chartWrapRef}
        className="main"
        style={{ flexDirection: "column" }}
      >
        {/* Métricas (simplificadas) */}
        <div className="metrics">
          {[
            { label: "Presión actual", value: metrics.current, cls: "" },
            { label: "Pico curva activa", value: metrics.max, cls: "warn" },
            {
              label: "Muestras totales",
              value: metrics.totalSamples.toLocaleString(),
              cls: "neutral",
            },
            { label: "Duración", value: metrics.time, cls: "neutral" },
          ].map(({ label, value, cls }) => (
            <div className="metric-card" key={label}>
              <div className="metric-label">{label}</div>
              <div className={`metric-value ${cls}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Leyenda de curvas */}
        {curveList.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "8px 16px",
              alignItems: "center",
            }}
          >
            <span className="toolbar-label" style={{ marginRight: 4 }}>
              CURVAS:
            </span>
            {curveList.map((curve, i) => (
              <div
                key={curve.id}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <div
                  style={{
                    width: 20,
                    height: 3,
                    background: curve.color,
                    borderRadius: 2,
                  }}
                />
                <span style={{ fontSize: 11, color: "var(--text2)" }}>
                  Curva {curve.id}
                  {i === curveList.length - 1 && isRecording ? " ●" : ""}
                  <span style={{ color: "var(--text3)", marginLeft: 4 }}>
                    ({new Date(curve.startTimeMs).toLocaleTimeString()})
                  </span>
                </span>
              </div>
            ))}
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--text3)",
                fontStyle: "italic",
              }}
            >
              eje X = tiempo relativo (s) desde inicio de cada curva · LTTB{" "}
              {MAX_DISPLAY_POINTS} pts/curva
            </span>
          </div>
        )}

        {/* Canvas */}
        <div className="chart-container">
          <div className="chart-header">
            <span className="chart-title">
              Presión en tiempo real — solapado por tiempo relativo (Pa)
            </span>
            <span className="chart-info">{chartInfo}</span>
          </div>
          <div
            style={{
              position: "relative",
              height: "calc(100% - 40px)",
              minHeight: "380px",
            }}
          >
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* ── Panel de resultados por curva ── */}
        {curveResults.length > 0 && (
          <div
            style={{
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "12px 20px",
            }}
          >
            <div className="section-label" style={{ marginBottom: 8 }}>
              PARÁMETROS DE CALIBRACIÓN
            </div>
            {!isRecording && (
              <p
                style={{
                  fontSize: 11,
                  color: "var(--text3)",
                  margin: "0 0 10px 0",
                }}
              >
                💡 Arrastrá los marcadores ◆ en la gráfica para ajustar los
                puntos de apertura y cierre manualmente.
              </p>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                gap: 12,
              }}
            >
              {curveResults
                .sort((a, b) => a.id - b.id)
                .map((res) => {
                  const curve = curvesRef.current.find((c) => c.id === res.id);
                  return (
                    <div
                      key={res.id}
                      style={{
                        border: `1px solid ${res.color}40`,
                        borderRadius: 6,
                        padding: "10px 14px",
                        background: "var(--bg)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            width: 16,
                            height: 3,
                            background: res.color,
                            borderRadius: 2,
                          }}
                        />
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 13,
                            color: "var(--text)",
                          }}
                        >
                          Curva {res.id}
                        </span>
                        {curve && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text3)",
                              marginLeft: "auto",
                            }}
                          >
                            {new Date(curve.startTimeMs).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            background: "rgba(255,217,61,0.1)",
                            border: "1px solid rgba(255,217,61,0.3)",
                            borderRadius: 4,
                            padding: "6px 10px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              color: "#ffd93d",
                              marginBottom: 2,
                              fontWeight: 600,
                            }}
                          >
                            ◆ PRESIÓN DE APERTURA
                          </div>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "var(--text)",
                              fontFamily: "monospace",
                            }}
                          >
                            {res.openPa !== null ? fmtPa(res.openPa) : "—"}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--text3)",
                              marginTop: 2,
                            }}
                          >
                            {res.openMs ? fmtTime(res.openMs) : "—"}
                          </div>
                        </div>
                        <div
                          style={{
                            background: "rgba(107,203,255,0.1)",
                            border: "1px solid rgba(107,203,255,0.3)",
                            borderRadius: 4,
                            padding: "6px 10px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              color: "#6bcbff",
                              marginBottom: 2,
                              fontWeight: 600,
                            }}
                          >
                            ◆ PRESIÓN DE CIERRE
                          </div>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "var(--text)",
                              fontFamily: "monospace",
                            }}
                          >
                            {res.closePa !== null ? fmtPa(res.closePa) : "—"}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--text3)",
                              marginTop: 2,
                            }}
                          >
                            {res.closeMs ? fmtTime(res.closeMs) : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Buffer bar */}
        <div className="buffer-bar">
          <span className="toolbar-label">BUFFER CURVA ACTIVA:</span>
          <div className="buffer-track">
            <div className="buffer-fill" style={{ width: `${bufferPct}%` }} />
          </div>
          <span className="buffer-text">{metrics.totalSamples} pts</span>
        </div>

        {/* Log */}
        <div>
          <div className="section-label">LOG DEL SISTEMA</div>
          <div className="log-panel" ref={logPanelRef}>
            {logs.map((e, i) => (
              <div key={i} className={`log-entry ${e.type}`}>
                [{e.ts}] {e.msg}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Informe */}
      {activeTab === "report" && (
        <div
          style={{
            padding: "24px",
            overflowY: "auto",
            maxHeight: "calc(100vh - 130px)",
          }}
        >
          <ReportForm onGeneratePDF={handleGeneratePDF} />
        </div>
      )}
    </>
  );
}
