import { useRef, useState, useEffect, useCallback } from 'react'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'

// ─── CONSTANTES ───────────────────────────────────────────────────
const SAMPLE_RATE            = 100
const DISPLAY_WINDOW_DEFAULT = 500
const MAX_BUFFER_PER_CURVE   = 1_000_000
const BAUD_RATE              = 115200
const ADC_MIN = 0, ADC_MAX = 32767, BAR_MIN = 0, BAR_MAX = 16

function adcToBar(raw) {
  return BAR_MIN + ((raw - ADC_MIN) / (ADC_MAX - ADC_MIN)) * (BAR_MAX - BAR_MIN)
}

// ─── PALETA DE COLORES PARA LAS CURVAS ───────────────────────────
const CURVE_COLORS_DARK = [
  '#00d4aa', '#ff6b6b', '#ffd93d', '#6bcbff',
  '#c77dff', '#ff9f43', '#a8e063', '#fd79a8',
]
const CURVE_COLORS_LIGHT = [
  '#0a7c68', '#c0392b', '#b7950b', '#1565c0',
  '#6a1b9a', '#e65100', '#2e7d32', '#ad1457',
]

function getCurveColor(index, isLight) {
  const palette = isLight ? CURVE_COLORS_LIGHT : CURVE_COLORS_DARK
  return palette[index % palette.length]
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── HELPERS DE TEMA ─────────────────────────────────────────────
function getThemeColors(isLight) {
  if (isLight) return {
    gridColor: 'rgba(208,215,222,0.8)', tickColor: '#8c959f', labelColor: '#57606a',
    tooltipBg: '#eaedf0', tooltipBorder: '#d0d7de', tooltipTitle: '#57606a', tooltipBody: '#1f2328',
  }
  return {
    gridColor: 'rgba(48,54,61,0.6)', tickColor: '#484f58', labelColor: '#8b949e',
    tooltipBg: '#21262d', tooltipBorder: '#30363d', tooltipTitle: '#8b949e', tooltipBody: '#e6edf3',
  }
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────
export default function App() {

  // ── Estado de UI ──────────────────────────────────────────────
  const [isLight, setIsLight]             = useState(false)
  const [isRecording, setIsRecording]     = useState(false)
  const [isSim, setIsSim]                 = useState(false)
  const [isConnected, setIsConnected]     = useState(false)
  const [countdown, setCountdown]         = useState(null)
  const [displayWindow, setDisplayWindow] = useState(DISPLAY_WINDOW_DEFAULT)
  const [logs, setLogs]                   = useState([])
  const [metrics, setMetrics]             = useState({
    current: '—', max: '—', min: '—', avg: '—', totalSamples: 0, time: '00:00'
  })
  const [chartInfo, setChartInfo]         = useState('Esperando medición...')
  const [statusState, setStatusState]     = useState('disconnected')
  const [curveCount, setCurveCount]       = useState(0)
  const [curveList, setCurveList]         = useState([])  // para re-renderizar la leyenda

  // Estados nuevos para el diálogo del Puerto Serial
  const [availablePorts, setAvailablePorts] = useState([])
  const [isDialogVisible, setIsDialogVisible] = useState(false)
  const [selectedPortId, setSelectedPortId]   = useState('')

  // ── Refs ──────────────────────────────────────────────────────
  const canvasRef            = useRef(null)
  const chartRef             = useRef(null)
  const curvesRef            = useRef([])       // [{ id, color, samples: [{n,value,time}] }]
  const activeCurveRef       = useRef(null)
  const globalLabelsRef      = useRef([])       // todos los timestamps como strings
  const startTimeRef         = useRef(null)
  const globalSampleCountRef = useRef(0)
  const simIntervalRef       = useRef(null)
  const timerIntervalRef     = useRef(null)
  const portRef              = useRef(null)
  const serialBufRef         = useRef('')
  const isRecordingRef       = useRef(false)
  const isSimRef             = useRef(false)
  const isLightRef           = useRef(false)
  const displayWindowRef     = useRef(DISPLAY_WINDOW_DEFAULT)
  const simPhaseRef          = useRef(0)
  const logPanelRef          = useRef(null)

  // ── Sincronizar refs ──────────────────────────────────────────
  useEffect(() => { isRecordingRef.current = isRecording },     [isRecording])
  useEffect(() => { isSimRef.current = isSim },                 [isSim])
  useEffect(() => { isLightRef.current = isLight },             [isLight])
  useEffect(() => { displayWindowRef.current = displayWindow }, [displayWindow])

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    initChart()
    addLog('PressureScope v1.0 iniciado.', 'info')
    if ('serial' in navigator) {
      addLog('Web Serial API disponible. Conectate a la ESP32 o activá Simulación.', 'info')
    } else {
      addLog('Web Serial API no disponible. Usá Chrome o Edge.', 'warn')
      addLog('Activá el Modo Simulación para probar sin ESP32.', 'warn')
    }

    // NUEVO: Escuchar la lista de puertos desde Electron
    if (window.electronAPI) {
      window.electronAPI.onSerialPortsList((portList) => {
        setAvailablePorts(portList);
        setIsDialogVisible(true);
        if (portList.length > 0) setSelectedPortId(portList[0].portId);
      });
    }

    return () => chartRef.current?.destroy()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('light', isLight)
    if (chartRef.current) updateChartTheme(isLight)
  }, [isLight])

  useEffect(() => {
    if (logPanelRef.current)
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight
  }, [logs])

  // ─── LOG ──────────────────────────────────────────────────────
  const addLog = useCallback((msg, type = '') => {
    const d = new Date()
    const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`
    setLogs(prev => {
      const next = [...prev, { ts, msg, type }]
      return next.length > 200 ? next.slice(-200) : next
    })
  }, [])

  // ─── CHART INIT ───────────────────────────────────────────────
  function initChart() {
    if (chartRef.current) chartRef.current.destroy()
    const c = getThemeColors(false)
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: false,
            labels: { color: c.labelColor, font: { family: 'Courier New', size: 11 }, boxWidth: 20, padding: 12 }
          },
          tooltip: {
            backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
            titleColor: c.tooltipTitle, bodyColor: c.tooltipBody,
            titleFont: { family: 'Courier New', size: 10 },
            bodyFont:  { family: 'Courier New', size: 13 },
            padding: 10,
            callbacks: {
              title: items => `t = ${items[0].label} s`,
              label: item  => {
                const val = item.raw !== null && item.raw !== undefined
                  ? Number(item.raw).toFixed(4) + ' bar' : '—'
                return ` Curva ${item.datasetIndex + 1}: ${val}`
              },
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            grid: { color: c.gridColor, lineWidth: 0.5 },
            ticks: { color: c.tickColor, font: { family: 'Courier New', size: 10 }, maxTicksLimit: 10, maxRotation: 0 },
            title: { display: true, text: 'Tiempo (s)', color: c.labelColor, font: { family: 'Courier New', size: 10 } }
          },
          y: {
            grid: { color: c.gridColor, lineWidth: 0.5 },
            ticks: { color: c.tickColor, font: { family: 'Courier New', size: 10 }, callback: v => v.toFixed(2) + ' bar' },
            title: { display: true, text: 'Presión (bar)', color: c.labelColor, font: { family: 'Courier New', size: 10 } }
          }
        }
      }
    })
  }

  function addCurveDataset(curveIndex, color) {
    if (!chartRef.current) return
    chartRef.current.data.datasets.push({
      label: `Curva ${curveIndex + 1}`,
      data: [],
      borderColor: color,
      borderWidth: 1.5,
      backgroundColor: hexToRgba(color, 0.06),
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: color,
      pointHoverBorderWidth: 2,
      tension: 0.3,
      spanGaps: false,
    })
    chartRef.current.options.plugins.legend.display = curveIndex >= 1
    chartRef.current.update('none')
  }

  function updateChartTheme(light) {
    if (!chartRef.current) return
    const c = getThemeColors(light)
    chartRef.current.data.datasets.forEach((ds, i) => {
      const col = getCurveColor(i, light)
      ds.borderColor = col
      ds.backgroundColor = hexToRgba(col, 0.06)
      ds.pointHoverBackgroundColor = col
    })
    curvesRef.current.forEach((curve, i) => { curve.color = getCurveColor(i, light) })
    setCurveList([...curvesRef.current])

    const opts = chartRef.current.options
    opts.plugins.legend.labels.color     = c.labelColor
    opts.plugins.tooltip.backgroundColor = c.tooltipBg
    opts.plugins.tooltip.borderColor     = c.tooltipBorder
    opts.plugins.tooltip.titleColor      = c.tooltipTitle
    opts.plugins.tooltip.bodyColor       = c.tooltipBody
    opts.scales.x.grid.color  = c.gridColor;  opts.scales.x.ticks.color = c.tickColor;  opts.scales.x.title.color = c.labelColor
    opts.scales.y.grid.color  = c.gridColor;  opts.scales.y.ticks.color = c.tickColor;  opts.scales.y.title.color = c.labelColor
    chartRef.current.update('none')
  }

  // ─── SERIAL (ACTUALIZADO) ─────────────────────────────────────
  async function connectSerial() {
    if (!('serial' in navigator)) {
      addLog('Web Serial API no disponible. Usá Chrome o Edge.', 'err')
      return
    }
    try {
      addLog('Buscando dispositivos... elegí el puerto COM de la ESP32.', 'info')
      // Esto ahora pausa la ejecución y levanta nuestro menú custom en Electron
      const port = await navigator.serial.requestPort()
      
      addLog('Puerto seleccionado. Intentando abrir conexión...', 'info')
      await port.open({ baudRate: BAUD_RATE })
      portRef.current = port
      setIsConnected(true)
      setIsSim(false)
      setStatusState('connected')
      addLog(`Conectado a ESP32 @ ${BAUD_RATE} baud.`, 'info')
      readSerial(port)
    } catch (e) {
      if (e.name === 'NotFoundError') {
        addLog('Selección de puerto cancelada.', 'warn')
      } else if (e.name === 'NetworkError') {
        addLog(`No se pudo abrir el puerto. ¿Está siendo usado por otro programa?`, 'err')
      } else {
        addLog(`Error al conectar: ${e.name} — ${e.message}`, 'err')
      }
    }
  }

  function handleConfirmPort() {
    if (window.electronAPI) window.electronAPI.selectSerialPort(selectedPortId);
    setIsDialogVisible(false);
  }

  function handleCancelPort() {
    if (window.electronAPI) window.electronAPI.cancelSerialPortSelection();
    setIsDialogVisible(false);
  }

  async function readSerial(port) {
    const decoder = new TextDecoderStream()
    port.readable.pipeTo(decoder.writable)
    const reader = decoder.readable.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        serialBufRef.current += value
        const lines = serialBufRef.current.split('\n')
        serialBufRef.current = lines.pop()
        for (const line of lines) {
          const raw = parseFloat(line.trim())
          if (!isNaN(raw) && isRecordingRef.current) addSample(adcToBar(raw))
        }
      }
    } catch (e) { if (isRecordingRef.current) addLog('Error leyendo serial: ' + e.message, 'err') }
  }

  // ─── SIMULACIÓN ───────────────────────────────────────────────
  function toggleSim() {
    if (isSimRef.current) {
      setIsSim(false); setStatusState('disconnected')
      addLog('Modo simulación desactivado.', 'warn')
    } else {
      setIsSim(true); setIsConnected(false); setStatusState('sim')
      addLog('Modo simulación activado.', 'info')
    }
  }

  function generateSimSample() {
    simPhaseRef.current += (2 * Math.PI * 0.3) / SAMPLE_RATE
    return Math.max(0, 5.0 + 1.2 * Math.sin(simPhaseRef.current) + (Math.random() - 0.5) * 0.15 + (Math.random() < 0.003 ? Math.random() * 3 : 0))
  }

  function startSimInterval() {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current)
    simIntervalRef.current = setInterval(() => {
      if (isRecordingRef.current && isSimRef.current) addSample(generateSimSample())
    }, 1000 / SAMPLE_RATE)
  }

  // ─── AGREGAR MUESTRA ──────────────────────────────────────────
  function addSample(bar) {
    if (!isRecordingRef.current || !activeCurveRef.current) return

    globalSampleCountRef.current++
    const elapsed   = parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(3))
    const timeLabel = elapsed.toFixed(3)

    const activeCurve = activeCurveRef.current
    if (activeCurve.samples.length < MAX_BUFFER_PER_CURVE)
      activeCurve.samples.push({ n: globalSampleCountRef.current, value: bar, time: elapsed })

    globalLabelsRef.current.push(timeLabel)

    const allLabels  = globalLabelsRef.current
    const windowSize = displayWindowRef.current
    const visibleLabels = allLabels.length > windowSize
      ? allLabels.slice(allLabels.length - windowSize)
      : [...allLabels]

    const firstVisibleTime = parseFloat(visibleLabels[0])

    chartRef.current.data.labels = visibleLabels

    curvesRef.current.forEach((curve, dsIndex) => {
      const map = new Map()
      for (const s of curve.samples) {
        const k = s.time.toFixed(3)
        if (s.time >= firstVisibleTime) map.set(k, s.value)
      }
      chartRef.current.data.datasets[dsIndex].data = visibleLabels.map(lbl =>
        map.has(lbl) ? map.get(lbl) : null
      )
    })

    if (globalSampleCountRef.current % 5 === 0) {
      chartRef.current.update('none')
      setChartInfo(`${curvesRef.current.length} curva(s) | ${visibleLabels.length} pts visibles | 100 Hz`)
    }

    if (globalSampleCountRef.current % 10 === 0) {
      const vals = activeCurve.samples.map(s => s.value)
      const maxV = Math.max(...vals), minV = Math.min(...vals)
      const avgV = vals.reduce((a, b) => a + b, 0) / vals.length
      setMetrics(m => ({
        ...m,
        current: bar.toFixed(4),
        max: maxV.toFixed(4),
        min: minV.toFixed(4),
        avg: avgV.toFixed(4),
        totalSamples: globalSampleCountRef.current,
      }))
    }
  }

  // ─── TIMER ────────────────────────────────────────────────────
  function startTimer() {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    timerIntervalRef.current = setInterval(() => {
      if (!startTimeRef.current) return
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0')
      const s = String(elapsed % 60).padStart(2, '0')
      setMetrics(prev => ({ ...prev, time: `${m}:${s}` }))
    }, 500)
  }

  // ─── COUNTDOWN ────────────────────────────────────────────────
  function startCountdown() {
    setCountdown(3)
    let count = 3
    const tick = setInterval(() => {
      count--
      if (count <= 0) { clearInterval(tick); setCountdown(null); beginMeasurement() }
      else setCountdown(count)
    }, 1000)
  }

  function beginMeasurement() {
    if (curvesRef.current.length === 0) {
      startTimeRef.current = Date.now()
      startTimer()
    }

    const curveIndex = curvesRef.current.length
    const color      = getCurveColor(curveIndex, isLightRef.current)
    const newCurve   = { id: curveIndex + 1, color, samples: [] }

    curvesRef.current.push(newCurve)
    activeCurveRef.current = newCurve
    addCurveDataset(curveIndex, color)

    isRecordingRef.current = true
    setIsRecording(true)
    setCurveCount(curvesRef.current.length)
    setCurveList([...curvesRef.current])
    addLog(`▶ Curva ${newCurve.id} iniciada.`, 'info')
    if (isSimRef.current) startSimInterval()
  }

  // ─── DETENER ──────────────────────────────────────────────────
  function stopMeasurement() {
    if (!isRecordingRef.current) return
    isRecordingRef.current = false
    setIsRecording(false)
    if (simIntervalRef.current) { clearInterval(simIntervalRef.current); simIntervalRef.current = null }
    const curve = activeCurveRef.current
    addLog(`■ Curva ${curve?.id ?? '?'} detenida. ${curve?.samples.length.toLocaleString() ?? 0} muestras.`, 'warn')
    setCurveList([...curvesRef.current])
  }

  // ─── LIMPIAR TODO ─────────────────────────────────────────────
  function clearData() {
    if (isRecordingRef.current) {
      if (!window.confirm('¿Detener medición y borrar todas las curvas?')) return
      stopMeasurement()
    }
    curvesRef.current      = []
    activeCurveRef.current = null
    globalLabelsRef.current = []
    globalSampleCountRef.current = 0
    startTimeRef.current   = null
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null }

    chartRef.current.data.labels   = []
    chartRef.current.data.datasets = []
    chartRef.current.options.plugins.legend.display = false
    chartRef.current.update()

    setCurveCount(0)
    setCurveList([])
    setMetrics({ current: '—', max: '—', min: '—', avg: '—', totalSamples: 0, time: '00:00' })
    setChartInfo('Esperando medición...')
    addLog('Todas las curvas borradas.', 'warn')
  }

  // ─── EXPORTAR EXCEL ───────────────────────────────────────────
  function exportExcel() {
    if (curvesRef.current.length === 0) { addLog('No hay curvas para exportar.', 'warn'); return }
    const curves = curvesRef.current
    addLog(`Generando Excel con ${curves.length} curva(s)...`, 'info')
    const wb = XLSX.utils.book_new()

    const timeMap = new Map()
    curves.forEach((curve, ci) => {
      curve.samples.forEach(s => {
        const key = s.time.toFixed(3)
        if (!timeMap.has(key)) timeMap.set(key, { time: s.time, values: new Map() })
        timeMap.get(key).values.set(ci, s.value)
      })
    })

    const sorted = Array.from(timeMap.entries()).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))

    const header = ['N° Muestra', 'Tiempo (s)', ...curves.map((_, i) => `Curva ${i + 1} (bar)`)]
    const wsData = [header]
    sorted.forEach(([, entry], idx) => {
      wsData.push([
        idx + 1,
        entry.time,
        ...curves.map((_, ci) => entry.values.has(ci) ? parseFloat(entry.values.get(ci).toFixed(6)) : '')
      ])
    })

    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch: 14 }, { wch: 14 }, ...curves.map(() => ({ wch: 16 }))]
    XLSX.utils.book_append_sheet(wb, ws, 'Mediciones')

    const summaryRows = [['Parámetro', 'Valor', 'Unidad']]
    summaryRows.push(['Total curvas', curves.length, '—'])
    summaryRows.push(['Total muestras (global)', globalSampleCountRef.current, '—'])
    summaryRows.push(['Frecuencia de muestreo', SAMPLE_RATE, 'Hz'])
    summaryRows.push(['Fecha exportación', new Date().toLocaleString('es-AR'), '—'])
    summaryRows.push(['', '', ''])
    curves.forEach((curve, i) => {
      if (!curve.samples.length) return
      const vals = curve.samples.map(s => s.value)
      const maxV = Math.max(...vals), minV = Math.min(...vals)
      const avgV = vals.reduce((a, b) => a + b, 0) / vals.length
      const dur  = curve.samples[curve.samples.length - 1].time - curve.samples[0].time
      summaryRows.push([`── Curva ${i + 1} ──`, '', ''])
      summaryRows.push([`Curva ${i+1} — Muestras`,  curve.samples.length,                        '—'])
      summaryRows.push([`Curva ${i+1} — Inicio`,    parseFloat(curve.samples[0].time.toFixed(3)), 's'])
      summaryRows.push([`Curva ${i+1} — Fin`,       parseFloat(curve.samples[curve.samples.length-1].time.toFixed(3)), 's'])
      summaryRows.push([`Curva ${i+1} — Duración`,  parseFloat(dur.toFixed(3)),                   's'])
      summaryRows.push([`Curva ${i+1} — Máximo`,    parseFloat(maxV.toFixed(6)),                  'bar'])
      summaryRows.push([`Curva ${i+1} — Mínimo`,    parseFloat(minV.toFixed(6)),                  'bar'])
      summaryRows.push([`Curva ${i+1} — Promedio`,  parseFloat(avgV.toFixed(6)),                  'bar'])
      summaryRows.push([`Curva ${i+1} — Rango`,     parseFloat((maxV - minV).toFixed(6)),         'bar'])
      summaryRows.push(['', '', ''])
    })
    const ws2 = XLSX.utils.aoa_to_sheet(summaryRows)
    ws2['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumen')

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    XLSX.writeFile(wb, `presion_${ts}.xlsx`)
    addLog(`Excel exportado: ${curves.length} curva(s), ${sorted.length} filas.`, 'info')
  }

  // ─── VENTANA ──────────────────────────────────────────────────
  function handleSetWindow(val) {
    const n = parseInt(val)
    setDisplayWindow(n); displayWindowRef.current = n
    addLog(`Ventana de visualización: ${val} puntos.`)
  }

  // ─── RENDER ───────────────────────────────────────────────────
  const totalSamples = curvesRef.current.reduce((acc, c) => acc + c.samples.length, 0)
  const bufferPct    = Math.min(100, (totalSamples / MAX_BUFFER_PER_CURVE) * 100)

  return (
    <>
      {/* OVERLAY DEL CONTADOR */}
      {countdown !== null && (
        <div className="overlay active">
          <div className="countdown-num">{countdown}</div>
          <div className="countdown-label">COMENZANDO MEDICIÓN...</div>
        </div>
      )}

      {/* NUEVO: OVERLAY PARA SELECCIÓN DE PUERTO SERIAL */}
      {isDialogVisible && (
        <div className="overlay active" style={{ zIndex: 9999 }}>
          <div style={{ background: 'var(--bg2)', padding: '24px', borderRadius: '8px', minWidth: '320px', border: '1px solid var(--border)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '16px', color: 'var(--text)' }}>Seleccionar Puerto COM</h3>
            
            {availablePorts.length === 0 ? (
              <p style={{ color: 'var(--warn)', fontSize: '14px', marginBottom: '20px' }}>No se encontraron dispositivos conectados.</p>
            ) : (
              <select 
                value={selectedPortId} 
                onChange={(e) => setSelectedPortId(e.target.value)}
                style={{ width: '100%', padding: '10px', marginBottom: '24px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '14px' }}
              >
                {availablePorts.map((p, index) => (
                  <option key={index} value={p.portId}>
                    {p.displayName || p.portName || `Dispositivo USB ${index + 1}`}
                  </option>
                ))}
              </select>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={handleCancelPort}>Cancelar</button>
              <button className="btn success" onClick={handleConfirmPort} disabled={availablePorts.length === 0}>
                Conectar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="header">
        <div className="header-left">
          <div className="logo">PressureScope <span>v1.0</span></div>
          <div>
            <span className={['status-dot', statusState === 'connected' ? 'connected' : statusState === 'sim' ? 'sim' : '', isRecording ? 'recording' : ''].filter(Boolean).join(' ')}></span>
            <span className="status-label" style={{ color: statusState === 'connected' ? 'var(--green)' : statusState === 'sim' ? 'var(--warn)' : 'var(--text2)' }}>
              {statusState === 'connected' ? 'CONECTADO' : statusState === 'sim' ? 'SIMULACIÓN' : 'DESCONECTADO'}
            </span>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {isSim && <div className="status-label" style={{ color:'var(--warn)', border:'1px solid var(--warn)', padding:'3px 10px', borderRadius:'4px', letterSpacing:'1px' }}>SIMULACIÓN</div>}
          {isRecording
            ? <div className="status-label" style={{ color:'var(--danger)', border:'1px solid var(--danger)', padding:'3px 10px', borderRadius:'4px', letterSpacing:'1px' }}>● REC — Curva {curveCount}</div>
            : curveCount > 0 && <div className="status-label" style={{ color:'var(--text2)', border:'1px solid var(--border)', padding:'3px 10px', borderRadius:'4px', letterSpacing:'1px' }}>{curveCount} curva(s)</div>
          }
          <button className="theme-toggle" onClick={() => setIsLight(v => !v)} title="Cambiar tema">
            {isLight ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="toolbar">
        <div>
          <div className="section-label">Puerto COM</div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            <button className="btn success" onClick={connectSerial}>Conectar ESP32</button>
            <button className="btn warn" onClick={toggleSim}>{isSim ? 'Desactivar Sim.' : 'Modo Simulación'}</button>
          </div>
        </div>
        <div className="separator" />
        <div>
          <div className="section-label">Control</div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button className="btn primary" onClick={startCountdown} disabled={isRecording || countdown !== null || (!isConnected && !isSim)}>¡Empecemos!</button>
            <button className="btn danger" onClick={stopMeasurement} disabled={!isRecording}>Detener</button>
            <button className="btn" onClick={clearData}>Limpiar</button>
          </div>
        </div>
        <div className="separator" />
        <div>
          <div className="section-label">Exportar</div>
          <button className="btn" onClick={exportExcel} disabled={curveCount === 0}>Exportar Excel</button>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'6px' }}>
          <span className="toolbar-label">VENTANA:</span>
          <select value={displayWindow} onChange={e => handleSetWindow(e.target.value)} style={{ minWidth:'90px' }}>
            <option value="200">200 pts</option>
            <option value="500">500 pts</option>
            <option value="1000">1000 pts</option>
            <option value="2000">2000 pts</option>
          </select>
        </div>
      </div>

      {/* MAIN */}
      <div className="main">

        {/* MÉTRICAS */}
        <div className="metrics">
          {[
            { label: 'Presión actual',     value: metrics.current, unit: 'bar', cls: '' },
            { label: 'Máx. curva activa',  value: metrics.max,     unit: 'bar', cls: 'warn' },
            { label: 'Mín. curva activa',  value: metrics.min,     unit: 'bar', cls: '', style: { color:'var(--accent2)' } },
            { label: 'Prom. curva activa', value: metrics.avg,     unit: 'bar', cls: 'neutral' },
            { label: 'Muestras totales',   value: typeof metrics.totalSamples === 'number' ? metrics.totalSamples.toLocaleString() : '0', unit: '', cls: 'neutral' },
            { label: 'Tiempo total',       value: metrics.time,    unit: '', cls: 'neutral' },
          ].map(({ label, value, unit, cls, style }) => (
            <div className="metric-card" key={label}>
              <div className="metric-label">{label}</div>
              <div className={`metric-value ${cls}`} style={style}>
                {value}{unit && <small>{unit}</small>}
              </div>
            </div>
          ))}
        </div>

        {/* LEYENDA DE CURVAS */}
        {curveList.length > 0 && (
          <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'8px 16px', alignItems:'center' }}>
            <span className="toolbar-label" style={{ marginRight:'4px' }}>CURVAS:</span>
            {curveList.map((curve, i) => (
              <div key={curve.id} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <div style={{ width:'20px', height:'3px', background: curve.color, borderRadius:'2px' }} />
                <span style={{ fontSize:'11px', color:'var(--text2)', letterSpacing:'0.5px' }}>
                  Curva {curve.id}
                  {i === curveList.length - 1 && isRecording ? ' ●' : ''}
                  <span style={{ color:'var(--text3)', marginLeft:'4px' }}>({curve.samples.length.toLocaleString()} pts)</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* GRÁFICA */}
        <div className="chart-container">
          <div className="chart-header">
            <span className="chart-title">Presión vs Tiempo — ADS1115</span>
            <span className="chart-info">{chartInfo}</span>
          </div>
          <div style={{ position:'relative', height:'calc(100% - 40px)', minHeight:'260px' }}>
            <canvas ref={canvasRef}></canvas>
          </div>
        </div>

        {/* BUFFER BAR */}
        <div className="buffer-bar">
          <span className="toolbar-label">BUFFER:</span>
          <div className="buffer-track">
            <div className="buffer-fill" style={{ width:`${bufferPct}%` }}></div>
          </div>
          <span className="buffer-text">{totalSamples.toLocaleString()} pts · {curveCount} curva(s)</span>
        </div>

        {/* LOG */}
        <div>
          <div className="section-label">LOG DEL SISTEMA</div>
          <div className="log-panel" ref={logPanelRef}>
            {logs.map((entry, i) => (
              <div key={i} className={`log-entry ${entry.type}`}>[{entry.ts}] {entry.msg}</div>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
