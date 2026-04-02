/**
 * scripts/setup-python.js
 *
 * Descarga Python embebido para Windows (python-embed) y
 * lo deja en vendor/python/ para que electron-builder lo empaquete.
 *
 * Uso: node scripts/setup-python.js
 *
 * Solo necesitás ejecutarlo UNA VEZ antes de hacer npm run dist.
 * El directorio vendor/ NO se sube a git (agrégalo a .gitignore).
 *
 * Python embebido (embed package) NO incluye pip por defecto.
 * Este script también instala reportlab usando get-pip.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const AdmZip = require("adm-zip"); // npm install adm-zip --save-dev

// ── Configuración ─────────────────────────────────────────────────
const PYTHON_VERSION = "3.12.9"; // versión a empaquetar
const PYTHON_ARCH = "amd64"; // amd64 | win32
const EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-${PYTHON_ARCH}.zip`;
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

const VENDOR_DIR = path.join(__dirname, "..", "vendor", "python");
const ZIP_PATH = path.join(VENDOR_DIR, "_embed.zip");
const GET_PIP_PATH = path.join(VENDOR_DIR, "get-pip.py");
const PYTHON_EXE = path.join(VENDOR_DIR, "python.exe");

// ─────────────────────────────────────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Descargando ${url}...`);
    const file = fs.createWriteStream(dest);
    function get(u) {
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", reject);
    }
    get(url);
  });
}

async function main() {
  // 1. Crear vendor/python/
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  // 2. Descargar Python embed
  if (!fs.existsSync(ZIP_PATH)) {
    await download(EMBED_URL, ZIP_PATH);
  } else {
    console.log("ZIP de Python embed ya existe, saltando descarga.");
  }

  // 3. Descomprimir
  console.log("Descomprimiendo Python embed...");
  const zip = new AdmZip(ZIP_PATH);
  zip.extractAllTo(VENDOR_DIR, true);
  fs.unlinkSync(ZIP_PATH);

  // 4. Habilitar importación de site-packages en el embed
  // El archivo pythonXY._pth tiene "import site" comentado → hay que descomentarlo
  const pthFile = fs
    .readdirSync(VENDOR_DIR)
    .find((f) => f.match(/python\d+\._pth$/));
  if (pthFile) {
    const pthPath = path.join(VENDOR_DIR, pthFile);
    let content = fs.readFileSync(pthPath, "utf8");
    content = content.replace("#import site", "import site");
    fs.writeFileSync(pthPath, content);
    console.log(`Habilitado import site en ${pthFile}`);
  }

  // 5. Descargar e instalar pip
  console.log("Instalando pip...");
  await download(GET_PIP_URL, GET_PIP_PATH);
  execSync(`"${PYTHON_EXE}" "${GET_PIP_PATH}" --no-warn-script-location`, {
    stdio: "inherit",
  });
  fs.unlinkSync(GET_PIP_PATH);

  // 6. Instalar reportlab
  console.log("Instalando reportlab...");
  execSync(
    `"${PYTHON_EXE}" -m pip install reportlab --no-warn-script-location --quiet`,
    { stdio: "inherit" },
  );

  console.log("\n✓ vendor/python/ listo para empaquetar.");
  console.log(`  Tamaño: ${getFolderSize(VENDOR_DIR)} MB`);
  console.log("\nAhora podés ejecutar: npm run dist\n");
}

function getFolderSize(dir) {
  let total = 0;
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    try {
      total += fs.statSync(path.join(dir, f)).size;
    } catch (_) {}
  }
  return (total / 1024 / 1024).toFixed(1);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
