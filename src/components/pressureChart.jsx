import { useRef, useEffect, useState, useCallback } from "react";

/**
 * PressureChart — Gráfica de presión con vista completa + zoom/scroll
 *
 * Props:
 *   data         : Float32Array | number[]  — valores ADC crudos
 *   sampleRate   : number  — Hz (default 100)
 *   voltageRef   : number  — tensión de referencia ADS1115 (default 6.144)
 *   adcBits      : number  — resolución ADC (default 16)
 *   psiPerVolt   : number  — factor del sensor (default 100)
 *   running      : boolean — si está capturando en tiempo real
 */
export default function PressureChart({
  data = [],
  sampleRate = 100,
  voltageRef = 6.144,
  adcBits = 16,
  psiPerVolt = 100,
  running = false,
}) {
  const overviewRef = useRef(null);
  const detailRef = useRef(null);
  const animRef = useRef(null);

  // ventana visible: [startIdx, endIdx]
  const WINDOW_SAMPLES = sampleRate * 10; // 10 segundos visibles
  const [window, setWindow] = useState({ start: 0, end: WINDOW_SAMPLES });
  const [isDragging, setDrag] = useState(false);
  const dragStart = useRef(null);
  const [zoom, setZoom] = useState(1);

  // ADC raw → PSI
  const toPsi = useCallback(
    (raw) => (raw / (Math.pow(2, adcBits - 1) - 1)) * voltageRef * psiPerVolt,
    [voltageRef, adcBits, psiPerVolt],
  );

  // Seguir el final si estamos capturando
  useEffect(() => {
    if (running && data.length > 0) {
      const end = data.length;
      const start = Math.max(0, end - Math.round(WINDOW_SAMPLES / zoom));
      setWindow({ start, end });
    }
  }, [data.length, running, zoom, WINDOW_SAMPLES]);

  // ── Dibuja canvas overview (barra de contexto) ────────────────
  useEffect(() => {
    const canvas = overviewRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width,
      H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Fondo
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    if (data.length < 2) return;

    const psiVals = Array.from(data).map(toPsi);
    const minP = Math.min(...psiVals);
    const maxP = Math.max(...psiVals);
    const range = maxP - minP || 1;

    // Línea completa
    ctx.beginPath();
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    for (let i = 0; i < psiVals.length; i++) {
      const x = (i / (psiVals.length - 1)) * W;
      const y = H - ((psiVals[i] - minP) / range) * (H - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Región visible (highlight)
    const x1 = (window.start / data.length) * W;
    const x2 = (window.end / data.length) * W;
    ctx.fillStyle = "rgba(59,130,246,0.25)";
    ctx.fillRect(x1, 0, x2 - x1, H);
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x1, 0, x2 - x1, H);
  }, [data, window, toPsi]);

  // ── Dibuja canvas detalle ─────────────────────────────────────
  useEffect(() => {
    const canvas = detailRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width,
      H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    const slice = Array.from(data).slice(window.start, window.end).map(toPsi);
    if (slice.length < 2) {
      ctx.fillStyle = "#475569";
      ctx.font = "14px monospace";
      ctx.fillText("Esperando datos...", W / 2 - 70, H / 2);
      return;
    }

    const minP = Math.min(...slice);
    const maxP = Math.max(...slice);
    const pad = (maxP - minP) * 0.1 || 1;
    const lo = minP - pad;
    const hi = maxP + pad;
    const rangeY = hi - lo;

    // Grid horizontal
    const gridLines = 5;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px monospace";
    for (let i = 0; i <= gridLines; i++) {
      const y = H - (i / gridLines) * (H - 30) - 15;
      const val = lo + (i / gridLines) * rangeY;
      ctx.beginPath();
      ctx.moveTo(50, y);
      ctx.lineTo(W - 10, y);
      ctx.stroke();
      ctx.fillText(val.toFixed(1), 4, y + 4);
    }

    // Grid vertical (tiempo)
    const totalSec = slice.length / sampleRate;
    const startSec = window.start / sampleRate;
    const ticksSec = Math.ceil(totalSec / 8);
    ctx.fillStyle = "#64748b";
    for (let s = 0; s <= totalSec; s += ticksSec) {
      const x = 50 + (s / totalSec) * (W - 60);
      ctx.beginPath();
      ctx.strokeStyle = "#1e293b";
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 15);
      ctx.stroke();
      ctx.fillText(`${(startSec + s).toFixed(1)}s`, x - 12, H - 2);
    }

    // Línea de presión
    ctx.beginPath();
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    for (let i = 0; i < slice.length; i++) {
      const x = 50 + (i / (slice.length - 1)) * (W - 60);
      const y = H - 15 - ((slice[i] - lo) / rangeY) * (H - 30);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Área bajo la curva
    ctx.lineTo(50 + (W - 60), H - 15);
    ctx.lineTo(50, H - 15);
    ctx.closePath();
    ctx.fillStyle = "rgba(59,130,246,0.08)";
    ctx.fill();

    // Stats
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    const peak = Math.max(...slice);

    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`AVG: ${avg.toFixed(2)} PSI`, W - 170, 20);
    ctx.fillStyle = "#f59e0b";
    ctx.fillText(`PEAK: ${peak.toFixed(2)} PSI`, W - 170, 36);
  }, [data, window, toPsi, sampleRate]);

  // ── Interacción en overview: clic/drag para mover ventana ─────
  const onOverviewClick = useCallback(
    (e) => {
      const rect = overviewRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const half = (window.end - window.start) / 2;
      const center = Math.round(ratio * data.length);
      const start = Math.max(0, Math.min(center - half, data.length - 1));
      const end = Math.min(data.length, start + (window.end - window.start));
      setWindow({ start: Math.round(start), end: Math.round(end) });
    },
    [data.length, window],
  );

  // ── Zoom con rueda en detalle ─────────────────────────────────
  const onWheel = useCallback(
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 0.833;
      const newZoom = Math.min(50, Math.max(0.5, zoom * factor));
      setZoom(newZoom);
      const visibleLen = Math.round(WINDOW_SAMPLES / newZoom);
      const center = Math.round((window.start + window.end) / 2);
      const start = Math.max(0, center - Math.round(visibleLen / 2));
      const end = Math.min(data.length || visibleLen, start + visibleLen);
      setWindow({ start, end });
    },
    [zoom, window, data.length, WINDOW_SAMPLES],
  );

  const windowSec = ((window.end - window.start) / sampleRate).toFixed(1);

  return (
    <div style={{ fontFamily: "monospace" }}>
      {/* Detail canvas */}
      <div
        style={{
          position: "relative",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid #1e293b",
        }}
      >
        <canvas
          ref={detailRef}
          width={900}
          height={340}
          style={{
            width: "100%",
            height: 340,
            display: "block",
            cursor: "crosshair",
          }}
          onWheel={onWheel}
        />
        {/* Etiqueta zoom */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: "rgba(15,23,42,0.85)",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 11,
            color: "#94a3b8",
          }}
        >
          {windowSec}s visibles · scroll para zoom
        </div>
        {running && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "rgba(239,68,68,0.15)",
              border: "1px solid #ef4444",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 11,
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#ef4444",
                animation: "blink 1s infinite",
              }}
            />
            EN VIVO
          </div>
        )}
      </div>

      {/* Overview canvas */}
      <div
        style={{
          marginTop: 6,
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid #1e293b",
        }}
      >
        <canvas
          ref={overviewRef}
          width={900}
          height={48}
          style={{
            width: "100%",
            height: 48,
            display: "block",
            cursor: "pointer",
          }}
          onClick={onOverviewClick}
        />
      </div>

      {/* Leyenda eje Y */}
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          color: "#475569",
          textAlign: "right",
        }}
      >
        eje Y: PSI · eje X: tiempo (s) · rueda del ratón para zoom · clic en
        resumen para desplazar
      </div>

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
