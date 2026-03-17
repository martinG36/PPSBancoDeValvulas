const { app, BrowserWindow, session, ipcMain } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'PressureScope',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // IMPORTANTE: Necesitas un preload para comunicar Electron con React de forma segura
      preload: path.join(__dirname, 'preload.js'), 
    },
  })

  // ── Habilitar Web Serial API ──────────────────────────────────
  win.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial') return true
    return false
  })

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
  })

  // ── Selector de puerto serial (CORREGIDO) ─────────────────────
  let serialPortCallback = null;

  // Nota: El evento select-serial-port se escucha mejor en la session
  win.webContents.session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault()
    
    // Guardamos el callback en memoria para ejecutarlo más tarde
    serialPortCallback = callback
    
    // Enviamos la lista de puertos a la interfaz de React
    win.webContents.send('serial-ports-list', portList)
  })

  // Escuchamos la respuesta desde la interfaz cuando seleccionas un puerto
  ipcMain.on('serial-port-selected', (event, portId) => {
    if (serialPortCallback) {
      // Le pasamos el ID elegido a Electron y limpiamos la variable
      serialPortCallback(portId)
      serialPortCallback = null
    }
  })

  // Si el usuario cancela la selección en la interfaz
  ipcMain.on('serial-port-cancelled', () => {
    if (serialPortCallback) {
      serialPortCallback('') // String vacío cancela la petición
      serialPortCallback = null
    }
  })

  // ── Permisos de puerto serial ya seleccionado ─────────────────
  win.webContents.session.on('serial-port-revoked', (event, ports) => {
    console.log('Puerto serial revocado:', ports)
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
