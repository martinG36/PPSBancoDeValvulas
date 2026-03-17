const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Escuchar la lista de puertos que envía main.js
  onSerialPortsList: (callback) => ipcRenderer.on('serial-ports-list', (_event, value) => callback(value)),
  
  // Enviar el ID del puerto seleccionado de vuelta a main.js
  selectSerialPort: (portId) => ipcRenderer.send('serial-port-selected', portId),
  
  // Cancelar la selección
  cancelSerialPortSelection: () => ipcRenderer.send('serial-port-cancelled')
})
