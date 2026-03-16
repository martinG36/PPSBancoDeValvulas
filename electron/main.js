const { app, BrowserWindow } = require('electron')
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
      // Habilitar Web Serial API en Electron
      enableBlinkFeatures: 'Serial',
    },
    // Sin frame nativo si querés estilo propio (opcional)
    // frame: false,
  })

  if (isDev) {
    // En desarrollo carga desde Vite dev server
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    // En producción carga el build estático
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
