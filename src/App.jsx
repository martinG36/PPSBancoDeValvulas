import { useRef, useState, useEffect, useCallback } from 'react'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'

// ─── CONSTANTES ───────────────────────────────────────────────────
const SAMPLE_RATE   = 100
const DISPLAY_WINDOW_DEFAULT = 500
const MAX_BUFFER    = 1_000_000
const BAUD_RATE     = 115200
const ADC_MIN = 0, ADC_MAX = 32767, BAR_MIN = 0, BAR_MAX = 16

function adcToBar(raw) {
  return BAR_MIN + ((raw - ADC_MIN) / (ADC_MAX - ADC_MIN)) * (BAR_MAX - BAR_MIN)
}

// ─── HELPERS DE TEMA ─────────────────────────────────────────────
function getThemeColors(isLight) {
  if (isLight) return {
    accent: '#0a7c68', accent2: '#0550ae',
    gridColor: 'rgba(208,215,222,0.8)', tickColor: '#8c959f', labelColor: '#57606a',
    tooltipBg: '#eaedf0', tooltipBorder: '#d0d7de', tooltipTitle: '#57606a', tooltipBody: '#1f2328',
    hoverBg: '#f4f6f8', fillBg: 'rgba(10,124,104,0.07)',
  }
  return {
    accent: '#00d4aa', accent2: '#0080ff',
    gridColor: 'rgba(48,54,61,0.6)', tickColor: '#484f58', labelColor: '#8b949e',
    tooltipBg: '#21262d', tooltipBorder: '#30363d', tooltipTitle: '#8b949e', tooltipBody: '#e6edf3',
    hoverBg: '#0d1117', fillBg: 'rgba(0,212,170,0.06)',
  }
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────
export default function App() {

  // ── Estado de UI ──────────────────────────────────────────────
  const [isLight, setIsLight]         = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isSim, setIsSim]             = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [countdown, setCountdown]     = useState(null)   // null=oculto, 3/2/1
  const [displayWindow, setDisplayWindow] = useState(DISPLAY_WINDOW_DEFAULT)
  const [bufferLen, setBufferLen]     = useState(0)
  const [logs, setLogs]               = useState([])
  const [metrics, setMetrics]         = useState({
    current: '—', max: '—', min: '—', avg: '—', total: 0, time: '00:00'
  })
  const [chartInfo, setChartInfo]     = useState('Esperando medición...')
  const [statusState, setStatusState] = useState('disconnected') // 'connected'|'sim'|'disconnected'

  // ── Refs (valores que necesitan closures pero no re-renderizan) ──
  const canvasRef        = useRef(null)
  const chartRef         = useRef(null)
  const fullBufferRef    = useRef([])          // buffer completo para exportar
  const displayDataRef   = useRef({ labels: [], values: [] }) // ventana visible
  const startTimeRef     = useRef(null)
  const sampleCountRef   = useRef(0)
  const simIntervalRef   = useRef(null)
  const timerIntervalRef = useRef(null)
  const portRef          = useRef(null)
  const serialBufRef     = useRef('')
  const isRecordingRef   = useRef(false)   // espejo ref del estado (para setInterval)
  const isSimRef         = useRef(false)
  const isLightRef       = useRef(false)
  const displayWindowRef = useRef(DISPLAY_WINDOW_DEFAULT)
  const simPhaseRef      = useRef(0)
  const logPanelRef      = useRef(null)

  // ── Sincronizar refs con estados ──────────────────────────────
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
  useEffect(() => { isSimRef.current = isSim }, [isSim])
  useEffect(() => { isLightRef.current = isLight }, [isLight])
  useEffect(() => { displayWindowRef.current = displayWindow }, [displayWindow])

  // ── Inicializar chart al montar ───────────────────────────────
  useEffect(() => {
    initChart()
    addLog('PressureScope v1.0 iniciado.', 'info')
    if ('serial' in navigator) {
      addLog('Web Serial API disponible. Conéctate a la ESP32 o activa Simulación.', 'info')
      scanPorts()
    } else {
      addLog('Web Serial API no disponible. Usa Google Chrome o Edge.', 'warn')
      addLog('Activa el Modo Simulación para probar sin ESP32.', 'warn')
    }
    return () => chartRef.current?.destroy()
  }, [])

  // ── Aplicar tema ──────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('light', isLight)
    if (chartRef.current) updateChartTheme(isLight)
  }, [isLight])

  // ── Auto-scroll del log ───────────────────────────────────────
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

  // ─── CHART ────────────────────────────────────────────────────
  function initChart() {
    if (chartRef.current) chartRef.current.destroy()
    const c = getThemeColors(false)
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: displayDataRef.current.labels,
        datasets: [{
          label: 'Presión',
          data: displayDataRef.current.values,
          borderColor: c.accent,
          borderWidth: 1.5,
          backgroundColor: c.fillBg,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: c.accent,
          pointHoverBorderColor: c.hoverBg,
          pointHoverBorderWidth: 2,
          tension: 0.3,
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
            titleColor: c.tooltipTitle, bodyColor: c.tooltipBody,
            titleFont: { family: 'Courier New', size: 10 },
            bodyFont: { family: 'Courier New', size: 13 },
            padding: 10,
            callbacks: {
              title: items => `t = ${items[0].label} s`,
              label: item => ` ${Number(item.raw).toFixed(4)} bar`,
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

  function updateChartTheme(light) {
    if (!chartRef.current) return
    const c = getThemeColors(light)
    const ds = chartRef.current.data.datasets[0]
    ds.borderColor = c.accent
    ds.backgroundColor = c.fillBg
    ds.pointHoverBackgroundColor = c.accent
    ds.pointHoverBorderColor = c.hoverBg
    const opts = chartRef.current.options
    opts.plugins.tooltip.backgroundColor  = c.tooltipBg
    opts.plugins.tooltip.borderColor      = c.tooltipBorder
    opts.plugins.tooltip.titleColor       = c.tooltipTitle
    opts.plugins.tooltip.bodyColor        = c.tooltipBody
    opts.scales.x.grid.color  = c.gridColor
    opts.scales.x.ticks.color = c.tickColor
    opts.scales.x.title.color = c.labelColor
    opts.scales.y.grid.color  = c.gridColor
    opts.scales.y.ticks.color = c.tickColor
    opts.scales.y.title.color = c.labelColor
    chartRef.current.update('none')
  }

  // ─── SERIAL ───────────────────────────────────────────────────
  async function scanPorts() {
    if (!('serial' in navigator)) return
    try {
      const ports = await navigator.serial.getPorts()
      if (ports.length === 0) {
        addLog('No hay puertos registrados. Usá "Conectar" para elegir manualmente.', 'warn')
      } else {
        addLog(`${ports.length} puerto(s) encontrado(s).`, 'info')
      }
    } catch (e) {
      addLog('Error escaneando puertos: ' + e.message, 'err')
    }
  }

  async function connectSerial() {
    if (!('serial' in navigator)) {
      addLog('Web Serial no disponible. Activá el modo simulación.', 'err')
      return
    }
    try {
      addLog('Solicitando acceso al puerto serial...', 'info')
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: BAUD_RATE })
      portRef.current = port
      setIsConnected(true)
      setIsSim(false)
      setStatusState('connected')
      addLog(`Conectado a ESP32 @ ${BAUD_RATE} baud.`, 'info')
      readSerial(port)
    } catch (e) {
      addLog('No se pudo conectar: ' + e.message, 'err')
    }
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
          if (!isNaN(raw) && isRecordingRef.current) {
            addSample(adcToBar(raw))
          }
        }
      }
    } catch (e) {
      if (isRecordingRef.current) addLog('Error leyendo serial: ' + e.message, 'err')
    }
  }

  // ─── SIMULACIÓN ───────────────────────────────────────────────
  function toggleSim() {
    if (isSimRef.current) {
      setIsSim(false)
      setStatusState('disconnected')
      addLog('Modo simulación desactivado.', 'warn')
    } else {
      setIsSim(true)
      setIsConnected(false)
      setStatusState('sim')
      addLog('Modo simulación activado. Datos sintéticos de presión.', 'info')
    }
  }

  function generateSimSample() {
    simPhaseRef.current += (2 * Math.PI * 0.3) / SAMPLE_RATE
    const base  = 5.0
    const sine  = 1.2 * Math.sin(simPhaseRef.current)
    const noise = (Math.random() - 0.5) * 0.15
    const spike = Math.random() < 0.003 ? (Math.random() * 3) : 0
    return Math.max(0, base + sine + noise + spike)
  }

  function startSimInterval() {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current)
    simIntervalRef.current = setInterval(() => {
      if (isRecordingRef.current && isSimRef.current)
        addSample(generateSimSample())
    }, 1000 / SAMPLE_RATE)
  }

  // ─── DATOS ────────────────────────────────────────────────────
  function addSample(bar) {
    if (!isRecordingRef.current) return
    const elapsed = parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(3))
    sampleCountRef.current++

    // Buffer completo
    if (fullBufferRef.current.length < MAX_BUFFER)
      fullBufferRef.current.push({ n: sampleCountRef.current, value: bar, time: elapsed })

    // Ventana de visualización
    displayDataRef.current.labels.push(elapsed.toString())
    displayDataRef.current.values.push(bar)
    if (displayDataRef.current.labels.length > displayWindowRef.current) {
      displayDataRef.current.labels.shift()
      displayDataRef.current.values.shift()
    }

    // Actualizar gráfica cada 5 muestras
    if (sampleCountRef.current % 5 === 0) {
      chartRef.current?.update('none')
      setChartInfo(`Mostrando últimas ${displayDataRef.current.labels.length} muestras | 100 Hz`)
    }

    // Actualizar métricas cada 10 muestras
    if (sampleCountRef.current % 10 === 0) {
      const vals = displayDataRef.current.values
      const max  = Math.max(...vals)
      const min  = Math.min(...vals)
      const avg  = vals.reduce((a, b) => a + b, 0) / vals.length
      setMetrics(m => ({
        ...m,
        current: bar.toFixed(4),
        max: max.toFixed(4),
        min: min.toFixed(4),
        avg: avg.toFixed(4),
        total: sampleCountRef.current,
      }))
      setBufferLen(fullBufferRef.current.length)
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
      if (count <= 0) {
        clearInterval(tick)
        setCountdown(null)
        beginMeasurement()
      } else {
        setCountdown(count)
      }
    }, 1000)
  }

  function beginMeasurement() {
    startTimeRef.current = Date.now()
    isRecordingRef.current = true
    setIsRecording(true)
    addLog('▶ Medición iniciada.', 'info')
    startTimer()
    if (isSimRef.current) startSimInterval()
  }

  // ─── DETENER / LIMPIAR ────────────────────────────────────────
  function stopMeasurement() {
    isRecordingRef.current = false
    setIsRecording(false)
    if (simIntervalRef.current)  { clearInterval(simIntervalRef.current);  simIntervalRef.current  = null }
    if (timerIntervalRef.current){ clearInterval(timerIntervalRef.current); timerIntervalRef.current = null }
    addLog(`■ Medición detenida. ${fullBufferRef.current.length.toLocaleString()} muestras en buffer.`, 'warn')
  }

  function clearData() {
    if (isRecordingRef.current) {
      if (!window.confirm('¿Detener medición y borrar todos los datos?')) return
      stopMeasurement()
    }
    fullBufferRef.current = []
    displayDataRef.current = { labels: [], values: [] }
    sampleCountRef.current = 0
    startTimeRef.current = null
    setMetrics({ current: '—', max: '—', min: '—', avg: '—', total: 0, time: '00:00' })
    setBufferLen(0)
    setChartInfo('Esperando medición...')
    chartRef.current?.update()
    addLog('Datos borrados.', 'warn')
  }

  // ─── EXPORTAR EXCEL ───────────────────────────────────────────
  function exportExcel() {
    if (fullBufferRef.current.length === 0) {
      addLog('No hay datos para exportar.', 'warn')
      return
    }
    addLog(`Generando Excel con ${fullBufferRef.current.length.toLocaleString()} muestras...`, 'info')
    const wb = XLSX.utils.book_new()

    // Hoja de mediciones
    const wsData = [['N° Muestra', 'Presión (bar)', 'Tiempo (s)']]
    for (const row of fullBufferRef.current) wsData.push([row.n, row.value, row.time])
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Mediciones')

    // Hoja resumen
    const vals    = fullBufferRef.current.map(r => r.value)
    const maxV    = Math.max(...vals), minV = Math.min(...vals)
    const avgV    = vals.reduce((a, b) => a + b, 0) / vals.length
    const totalT  = fullBufferRef.current[fullBufferRef.current.length - 1]?.time ?? 0
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Parámetro', 'Valor', 'Unidad'],
      ['Total muestras',         fullBufferRef.current.length,      '—'],
      ['Tiempo total',           totalT,                             's'],
      ['Frecuencia de muestreo', SAMPLE_RATE,                        'Hz'],
      ['Presión máxima',         parseFloat(maxV.toFixed(6)),        'bar'],
      ['Presión mínima',         parseFloat(minV.toFixed(6)),        'bar'],
      ['Presión promedio',       parseFloat(avgV.toFixed(6)),        'bar'],
      ['Rango',                  parseFloat((maxV - minV).toFixed(6)), 'bar'],
      ['Fecha exportación',      new Date().toLocaleString('es-AR'), '—'],
    ])
    ws2['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumen')

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    XLSX.writeFile(wb, `presion_${ts}.xlsx`)
    addLog('Excel exportado exitosamente.', 'info')
  }

  // ─── VENTANA ──────────────────────────────────────────────────
  function handleSetWindow(val) {
    const n = parseInt(val)
    setDisplayWindow(n)
    displayWindowRef.current = n
    addLog(`Ventana de visualización: ${val} puntos.`)
  }

  // ─── RENDER ───────────────────────────────────────────────────
  const bufferPct = Math.min(100, (bufferLen / MAX_BUFFER) * 100)

  return (
    <>
      {/* ── OVERLAY COUNTDOWN ── */}
      {countdown !== null && (
        <div className="overlay active">
          <div className="countdown-num">{countdown}</div>
          <div className="countdown-label">COMENZANDO MEDICIÓN...</div>
        </div>
      )}

      {/* ── HEADER ── */}
      <div className="header">
        <div className="header-left">
          <div className="logo">PressureScope <span>v1.0</span></div>
          <div>
            <span className={`status-dot${statusState === 'connected' ? ' connected' : statusState === 'sim' ? ' sim' : ''}${isRecording ? ' recording' : ''}`}></span>
            <span className="status-label" style={{
              color: statusState === 'connected' ? 'var(--green)' : statusState === 'sim' ? 'var(--warn)' : 'var(--text2)'
            }}>
              {statusState === 'connected' ? 'CONECTADO' : statusState === 'sim' ? 'SIMULACIÓN' : 'DESCONECTADO'}
            </span>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {isSim && (
            <div className="status-label" style={{ color:'var(--warn)', border:'1px solid var(--warn)', padding:'3px 10px', borderRadius:'4px', letterSpacing:'1px' }}>SIMULACIÓN</div>
          )}
          {isRecording && (
            <div className="status-label" style={{ color:'var(--danger)', border:'1px solid var(--danger)', padding:'3px 10px', borderRadius:'4px', letterSpacing:'1px' }}>● REC</div>
          )}
          <button className="theme-toggle" onClick={() => setIsLight(v => !v)} title="Cambiar tema">
            {isLight ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="toolbar">
        {/* Puerto COM */}
        <div>
          <div className="section-label">Puerto COM</div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            <select id="port-select" defaultValue="">
              <option value="">-- seleccionar --</option>
            </select>
            <button className="btn" onClick={scanPorts}>Escanear</button>
            <button className="btn success" onClick={connectSerial}>Conectar</button>
            <button className={`btn warn${isSim ? ' active-sim' : ''}`} onClick={toggleSim}>
              {isSim ? 'Desactivar Sim.' : 'Modo Simulación'}
            </button>
          </div>
        </div>

        <div className="separator" />

        {/* Controles */}
        <div>
          <div className="section-label">Control</div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button className="btn primary" onClick={startCountdown}
              disabled={isRecording || countdown !== null || (!isConnected && !isSim)}>
              ¡Empecemos!
            </button>
            <button className="btn danger" onClick={stopMeasurement} disabled={!isRecording}>
              Detener
            </button>
            <button className="btn" onClick={clearData}>
              Limpiar
            </button>
          </div>
        </div>

        <div className="separator" />

        {/* Exportar */}
        <div>
          <div className="section-label">Exportar</div>
          <button className="btn" onClick={exportExcel}>Exportar Excel</button>
        </div>

        {/* Ventana */}
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

      {/* ── MAIN ── */}
      <div className="main">

        {/* MÉTRICAS */}
        <div className="metrics">
          {[
            { label: 'Presión actual',      value: metrics.current, unit: 'bar', cls: '' },
            { label: 'Máximo',              value: metrics.max,     unit: 'bar', cls: 'warn' },
            { label: 'Mínimo',              value: metrics.min,     unit: 'bar', cls: '', style: { color:'var(--accent2)' } },
            { label: 'Promedio',            value: metrics.avg,     unit: 'bar', cls: 'neutral' },
            { label: 'Muestras totales',    value: typeof metrics.total === 'number' ? metrics.total.toLocaleString() : metrics.total, unit: '', cls: 'neutral' },
            { label: 'Tiempo transcurrido', value: metrics.time,    unit: '', cls: 'neutral' },
          ].map(({ label, value, unit, cls, style }) => (
            <div className="metric-card" key={label}>
              <div className="metric-label">{label}</div>
              <div className={`metric-value ${cls}`} style={style}>
                {value}{unit && <small>{unit}</small>}
              </div>
            </div>
          ))}
        </div>

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
          <span className="toolbar-label">BUFFER TOTAL:</span>
          <div className="buffer-track">
            <div className="buffer-fill" style={{ width: `${bufferPct}%` }}></div>
          </div>
          <span className="buffer-text">{bufferLen.toLocaleString()} pts almacenados</span>
        </div>

        {/* LOG */}
        <div>
          <div className="section-label">LOG DEL SISTEMA</div>
          <div className="log-panel" ref={logPanelRef}>
            {logs.map((entry, i) => (
              <div key={i} className={`log-entry ${entry.type}`}>
                [{entry.ts}] {entry.msg}
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
