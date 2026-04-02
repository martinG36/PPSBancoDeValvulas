/**
 * main.js — PressureScope
 *
 * Python para generar PDFs:
 *   DEV  → detecta python3/python/py del sistema (asíncrono, sin bloquear)
 *   PROD → usa Python embebido en resources/python/ (empaquetado por electron-builder)
 *
 * IMPORTANTE: nunca se usa execSync → el hilo principal nunca se bloquea.
 */

const { app, BrowserWindow, session, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = process.env.NODE_ENV === "development";

// ── Resolver ejecutable Python ─────────────────────────────────────
function getEmbeddedPython() {
  // En producción electron-builder copia python/ dentro de resources/
  const win = path.join(process.resourcesPath, "python", "python.exe");
  const unix = path.join(process.resourcesPath, "python", "bin", "python3");
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(unix)) return unix;
  return null;
}

function detectSystemPython() {
  return new Promise((resolve) => {
    const candidates = ["python3", "python", "py"];
    let i = 0;
    function tryNext() {
      if (i >= candidates.length) return resolve(null);
      const cmd = candidates[i++];
      const p = spawn(cmd, ["--version"], { shell: true });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => {
        if (code === 0 && out.toLowerCase().includes("python")) resolve(cmd);
        else tryNext();
      });
      p.on("error", tryNext);
    }
    tryNext();
  });
}

function checkReportlab(pythonCmd) {
  return new Promise((resolve) => {
    const p = spawn(pythonCmd, ["-c", 'import reportlab; print("ok")'], {
      shell: true,
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve(code === 0 && out.includes("ok")));
    p.on("error", () => resolve(false));
  });
}

function installReportlab(pythonCmd) {
  return new Promise((resolve) => {
    const args = ["-m", "pip", "install", "reportlab", "--quiet"];
    // --break-system-packages solo en entornos Linux con PEP 668
    if (process.platform !== "win32") args.push("--break-system-packages");
    const p = spawn(pythonCmd, args, { shell: true });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

// ──────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "PressureScope",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Web Serial
  win.webContents.session.setDevicePermissionHandler(
    (d) => d.deviceType === "serial",
  );
  win.webContents.session.setPermissionRequestHandler((_wc, _p, cb) =>
    cb(true),
  );

  let serialPortCallback = null;
  win.webContents.session.on(
    "select-serial-port",
    (event, portList, _wc, callback) => {
      event.preventDefault();
      serialPortCallback = callback;
      win.webContents.send("serial-ports-list", portList);
    },
  );
  ipcMain.on("serial-port-selected", (_e, portId) => {
    if (serialPortCallback) {
      serialPortCallback(portId);
      serialPortCallback = null;
    }
  });
  ipcMain.on("serial-port-cancelled", () => {
    if (serialPortCallback) {
      serialPortCallback("");
      serialPortCallback = null;
    }
  });

  // Generación de PDF — 100% asíncrono
  ipcMain.handle("generate-pdf", async (_event, { formData, outputPath }) => {
    // 1. Determinar Python
    let pythonCmd = isDev ? null : getEmbeddedPython();
    if (!pythonCmd) pythonCmd = await detectSystemPython();
    if (!pythonCmd) {
      return {
        success: false,
        reason:
          'Python no encontrado.\nInstalá Python desde https://python.org marcando "Add to PATH".',
      };
    }

    // 2. Verificar / instalar reportlab
    const ok = await checkReportlab(pythonCmd);
    if (!ok) {
      win.webContents.send(
        "pdf-progress",
        "Instalando reportlab (primera vez, puede demorar)...",
      );
      const inst = await installReportlab(pythonCmd);
      if (!inst) {
        return {
          success: false,
          reason: `No se pudo instalar reportlab.\nEjecutá: ${pythonCmd} -m pip install reportlab`,
        };
      }
    }

    // 3. Diálogo de guardado
    if (!outputPath) {
      const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const result = await dialog.showSaveDialog(win, {
        title: "Guardar Informe REG EV-01",
        defaultPath: `REG_EV01_${fecha}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (result.canceled) return { success: false, reason: "cancelled" };
      outputPath = result.filePath;
    }

    // 4. Script Python
    const scriptPath = isDev
      ? path.join(__dirname, "..", "scripts", "generate_report.py")
      : path.join(process.resourcesPath, "scripts", "generate_report.py");

    if (!fs.existsSync(scriptPath)) {
      return { success: false, reason: `Script no encontrado:\n${scriptPath}` };
    }

    // 5. Ejecutar
    return new Promise((resolve) => {
      const py = spawn(pythonCmd, [scriptPath], {
        env: { ...process.env, OUTPUT_PATH: outputPath },
        shell: false,
      });

      py.stdin.write(JSON.stringify(formData), "utf8");
      py.stdin.end();

      let stderr = "",
        stdout = "";
      py.stdout.on("data", (d) => (stdout += d));
      py.stderr.on("data", (d) => (stderr += d));

      const t = setTimeout(() => {
        try {
          py.kill();
        } catch (_) {}
        resolve({
          success: false,
          reason: "Tiempo agotado (30s). El script Python no respondió.",
        });
      }, 30000);

      py.on("close", (code) => {
        clearTimeout(t);
        if (code === 0) resolve({ success: true, path: outputPath });
        else
          resolve({
            success: false,
            reason: (stderr || stdout || `Código ${code}`).trim(),
          });
      });
      py.on("error", (err) => {
        clearTimeout(t);
        resolve({
          success: false,
          reason: `No se pudo iniciar Python: ${err.message}`,
        });
      });
    });
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
