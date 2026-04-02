const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Serial port ─────────────────────────────────────────────────
  onSerialPortsList: (cb) =>
    ipcRenderer.on("serial-ports-list", (_event, value) => cb(value)),
  selectSerialPort: (portId) =>
    ipcRenderer.send("serial-port-selected", portId),
  cancelSerialPortSelection: () => ipcRenderer.send("serial-port-cancelled"),

  // ── PDF generation ──────────────────────────────────────────────
  // Returns Promise<{ success: boolean, path?: string, reason?: string }>
  generatePDF: (formData, outputPath = null) =>
    ipcRenderer.invoke("generate-pdf", { formData, outputPath }),
});
