import { useState, useCallback } from "react";

// ── Constantes ────────────────────────────────────────────────────────────────
const PARTES_PRELIM = [
  "Capuchón",
  "Palanca",
  "Bulones de ensamble",
  "Bonete",
  "Bridas/Roscas",
  "Tornillo de Ajuste",
  "Contratuerca",
  "Cuerpo",
  "Boquilla",
];
const PARTES_MTO = ["Vástago", "Asiento", "Resorte", "Guía", "Disco"];
const NIVELES = ["No", "Bajo", "Medio", "Alto"];

// ── Checkbox circular de selección única ─────────────────────────────────────
function RadioGroup({ name, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {NIVELES.map((lvl) => (
        <label
          key={lvl}
          title={lvl}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div
            onClick={() => onChange(lvl === value ? "" : lvl)}
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: `2px solid ${value === lvl ? "#3b82f6" : "#cbd5e1"}`,
              background: value === lvl ? "#3b82f6" : "transparent",
              transition: "all 0.15s",
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: 9, color: "#64748b" }}>{lvl}</span>
        </label>
      ))}
    </div>
  );
}

// ── Fila de inspección ────────────────────────────────────────────────────────
function InspRow({ parte, data, onChange }) {
  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
      <td
        style={{
          padding: "6px 8px",
          fontSize: 13,
          color: "#334155",
          minWidth: 150,
          whiteSpace: "nowrap",
        }}
      >
        {parte}
      </td>
      <td style={{ padding: "4px 8px" }}>
        <RadioGroup
          name={`dep-${parte}`}
          value={data.depositos || ""}
          onChange={(v) => onChange(parte, "depositos", v)}
        />
      </td>
      <td style={{ padding: "4px 8px" }}>
        <RadioGroup
          name={`cor-${parte}`}
          value={data.corrosion || ""}
          onChange={(v) => onChange(parte, "corrosion", v)}
        />
      </td>
      <td style={{ padding: "4px 8px", minWidth: 180 }}>
        <input
          type="text"
          placeholder="Nota del operario…"
          value={data.danio_mecanico || ""}
          onChange={(e) => onChange(parte, "danio_mecanico", e.target.value)}
          style={{
            width: "100%",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 12,
            background: "#f8fafc",
            outline: "none",
          }}
        />
      </td>
    </tr>
  );
}

// ── Campo de formulario ───────────────────────────────────────────────────────
function Field({ label, name, value, onChange, half = false, type = "text" }) {
  return (
    <div
      style={{
        flex: half ? "0 0 calc(50% - 6px)" : "0 0 calc(50% - 6px)",
        minWidth: 0,
      }}
    >
      <label
        style={{
          display: "block",
          fontSize: 11,
          color: "#64748b",
          marginBottom: 3,
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        style={{
          width: "100%",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "7px 10px",
          fontSize: 13,
          background: "#f8fafc",
          boxSizing: "border-box",
          outline: "none",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => (e.target.style.borderColor = "#3b82f6")}
        onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
      />
    </div>
  );
}

// ── Sección colapsable ────────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        marginBottom: 16,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          background: "#f8fafc",
          border: "none",
          borderBottom: open ? "1px solid #e2e8f0" : "none",
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 14,
          color: "#1e293b",
        }}
      >
        {title}
        <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 400 }}>
          {open ? "▲ ocultar" : "▼ mostrar"}
        </span>
      </button>
      {open && <div style={{ padding: "16px" }}>{children}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Componente principal
// ══════════════════════════════════════════════════════════════════════════════
export default function ReportForm({ onGeneratePDF }) {
  // ── Estado del formulario ─────────────────────────────────────────────────
  const [form, setForm] = useState({
    fecha_recepcion: "",
    peticionario: "",
    hoja: "1",
    cuaderno: "CEV-011",
    marca: "",
    modelo: "",
    n_serie: "",
    tag: "",
    ubicacion: "",
    diametro: "",
    presion_set: "",
    precinto_ant: "",
    estado_precinto: "",
    precinto_nuevo: "",
    vr: "",
    bd_check: "",
    pdf_check: "",
    imp: "",
    fecha_ensayo: "",
    procedimiento: "",
    certificado: "",
    patron: "",
    tipo_ensayo: "hidraulico",
    operador: "",
    temp_amb: "",
    humedad_relativa: "",
    registro_bd: "",
  });

  const allPartes = [...PARTES_PRELIM, ...PARTES_MTO];
  const [inspData, setInspData] = useState(
    Object.fromEntries(
      allPartes.map((p) => [
        p,
        { depositos: "", corrosion: "", danio_mecanico: "" },
      ]),
    ),
  );

  // Valores encontrados / finales: 4 celdas cada uno
  const [valEncontrados, setValEncontrados] = useState(["", "", "", ""]);
  const [valFinales, setValFinales] = useState(["", "", "", ""]);
  const [observaciones, setObservaciones] = useState(["", "", "", ""]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleField = useCallback((e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }, []);

  const handleInsp = useCallback((parte, campo, valor) => {
    setInspData((d) => ({ ...d, [parte]: { ...d[parte], [campo]: valor } }));
  }, []);

  const handleValor = useCallback((arr, setArr, idx, val) => {
    const next = [...arr];
    next[idx] = val;
    setArr(next);
  }, []);

  const handleSubmit = () => {
    const payload = {
      ...form,
      inspection_data: inspData,
      valores_encontrados: valEncontrados.filter(Boolean),
      valores_finales: valFinales.filter(Boolean),
      observaciones: observaciones.filter(Boolean),
    };
    if (onGeneratePDF) onGeneratePDF(payload);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const tableHeaderStyle = {
    padding: "8px 8px",
    background: "#e9f0fb",
    fontSize: 12,
    fontWeight: 600,
    color: "#334155",
    textAlign: "center",
    borderBottom: "2px solid #cbd5e1",
  };

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#1e293b",
      }}
    >
      {/* ── 1. Datos generales ─────────────────────────────────────────── */}
      <Section title="1. Datos generales del registro">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Field
            label="Fecha de Recepción"
            name="fecha_recepcion"
            value={form.fecha_recepcion}
            onChange={handleField}
            type="date"
          />
          <Field
            label="Peticionario"
            name="peticionario"
            value={form.peticionario}
            onChange={handleField}
          />
          <Field
            label="Hoja"
            name="hoja"
            value={form.hoja}
            onChange={handleField}
          />
          <Field
            label="Cuaderno"
            name="cuaderno"
            value={form.cuaderno}
            onChange={handleField}
          />
        </div>
      </Section>

      {/* ── 2. Datos del instrumento ───────────────────────────────────── */}
      <Section title="2. Datos del instrumento">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Field
            label="Marca"
            name="marca"
            value={form.marca}
            onChange={handleField}
          />
          <Field
            label="Modelo"
            name="modelo"
            value={form.modelo}
            onChange={handleField}
          />
          <Field
            label="Nº de Serie"
            name="n_serie"
            value={form.n_serie}
            onChange={handleField}
          />
          <Field
            label="TAG"
            name="tag"
            value={form.tag}
            onChange={handleField}
          />
          <Field
            label="Ubicación"
            name="ubicacion"
            value={form.ubicacion}
            onChange={handleField}
          />
          <Field
            label="Ø Entrada/Salida"
            name="diametro"
            value={form.diametro}
            onChange={handleField}
          />
          <Field
            label="Presión de Set"
            name="presion_set"
            value={form.presion_set}
            onChange={handleField}
          />
          <Field
            label="Precinto Ant. Nº"
            name="precinto_ant"
            value={form.precinto_ant}
            onChange={handleField}
          />
          <Field
            label="Estado Precinto"
            name="estado_precinto"
            value={form.estado_precinto}
            onChange={handleField}
          />
          <Field
            label="Precinto Nuevo Nº"
            name="precinto_nuevo"
            value={form.precinto_nuevo}
            onChange={handleField}
          />
        </div>
      </Section>

      {/* ── 3. Datos del ensayo ────────────────────────────────────────── */}
      <Section title="3. Datos del ensayo">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Field
            label="Fecha del Ensayo"
            name="fecha_ensayo"
            value={form.fecha_ensayo}
            onChange={handleField}
            type="date"
          />
          <Field
            label="Procedimiento"
            name="procedimiento"
            value={form.procedimiento}
            onChange={handleField}
          />
          <Field
            label="Certificado Nº"
            name="certificado"
            value={form.certificado}
            onChange={handleField}
          />
          <Field
            label="Patrón"
            name="patron"
            value={form.patron}
            onChange={handleField}
          />
          <Field
            label="Operador"
            name="operador"
            value={form.operador}
            onChange={handleField}
          />
          <Field
            label="Temp. Amb. (°C)"
            name="temp_amb"
            value={form.temp_amb}
            onChange={handleField}
          />
          <Field
            label="H.R. (%)"
            name="humedad_relativa"
            value={form.humedad_relativa}
            onChange={handleField}
          />
          <Field
            label="Registro B.D."
            name="registro_bd"
            value={form.registro_bd}
            onChange={handleField}
          />
        </div>

        {/* Tipo de ensayo */}
        <div style={{ marginTop: 16 }}>
          <p
            style={{
              fontSize: 11,
              color: "#64748b",
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Tipo de ensayo
          </p>
          <div style={{ display: "flex", gap: 16 }}>
            {[
              ["hidraulico", "HIDRÁULICO"],
              ["neumatico", "NEUMÁTICO"],
              ["ambos", "AMBOS"],
            ].map(([val, lbl]) => (
              <label
                key={val}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="tipo_ensayo"
                  value={val}
                  checked={form.tipo_ensayo === val}
                  onChange={handleField}
                  style={{ accentColor: "#3b82f6", width: 16, height: 16 }}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{lbl}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Checkboxes VR / BD / PDF / IMP */}
        <div
          style={{ marginTop: 16, display: "flex", gap: 20, flexWrap: "wrap" }}
        >
          {[
            ["vr", "V.R."],
            ["bd_check", "B.D."],
            ["pdf_check", "PDF"],
            ["imp", "IMP."],
          ].map(([key, lbl]) => (
            <label
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={form[key] === "✓"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.checked ? "✓" : "" }))
                }
                style={{ accentColor: "#3b82f6", width: 15, height: 15 }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{lbl}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* ── 4. Tabla de inspección ─────────────────────────────────────── */}
      <Section title="4. Inspección de partes">
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    ...tableHeaderStyle,
                    textAlign: "left",
                    minWidth: 150,
                  }}
                >
                  Parte
                </th>
                <th style={{ ...tableHeaderStyle, minWidth: 200 }} colSpan={1}>
                  Depósitos
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      justifyContent: "center",
                      marginTop: 4,
                    }}
                  >
                    {NIVELES.map((n) => (
                      <span
                        key={n}
                        style={{
                          fontSize: 10,
                          color: "#94a3b8",
                          minWidth: 20,
                          textAlign: "center",
                        }}
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </th>
                <th style={{ ...tableHeaderStyle, minWidth: 200 }} colSpan={1}>
                  Corrosión
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      justifyContent: "center",
                      marginTop: 4,
                    }}
                  >
                    {NIVELES.map((n) => (
                      <span
                        key={n}
                        style={{
                          fontSize: 10,
                          color: "#94a3b8",
                          minWidth: 20,
                          textAlign: "center",
                        }}
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </th>
                <th
                  style={{
                    ...tableHeaderStyle,
                    textAlign: "left",
                    minWidth: 200,
                  }}
                >
                  Daño Mecánico (nota)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: "6px 8px",
                    background: "#dbeafe",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#1d4ed8",
                  }}
                >
                  Inspección preliminar
                </td>
              </tr>
              {PARTES_PRELIM.map((p) => (
                <InspRow
                  key={p}
                  parte={p}
                  data={inspData[p]}
                  onChange={handleInsp}
                />
              ))}
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: "6px 8px",
                    background: "#dbeafe",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#1d4ed8",
                  }}
                >
                  Inspección de Mto.
                </td>
              </tr>
              {PARTES_MTO.map((p) => (
                <InspRow
                  key={p}
                  parte={p}
                  data={inspData[p]}
                  onChange={handleInsp}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 5. Valores encontrados / finales ──────────────────────────── */}
      <Section title="5. Valores encontrados y finales">
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}
        >
          {[
            ["Valor Encontrado", valEncontrados, setValEncontrados],
            ["Valor Final", valFinales, setValFinales],
          ].map(([title, arr, setArr]) => (
            <div key={title}>
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#475569",
                  marginBottom: 8,
                }}
              >
                {title}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {arr.map((val, i) => (
                  <input
                    key={i}
                    type="text"
                    placeholder={`Valor ${i + 1}`}
                    value={val}
                    onChange={(e) =>
                      handleValor(arr, setArr, i, e.target.value)
                    }
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "7px 10px",
                      fontSize: 13,
                      background: "#f8fafc",
                      outline: "none",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "#3b82f6")}
                    onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 6. Observaciones ──────────────────────────────────────────── */}
      <Section title="6. Observaciones">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {observaciones.map((obs, i) => (
            <input
              key={i}
              type="text"
              placeholder={`Observación ${i + 1}`}
              value={obs}
              onChange={(e) => {
                const next = [...observaciones];
                next[i] = e.target.value;
                setObservaciones(next);
              }}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 13,
                background: "#f8fafc",
                outline: "none",
                width: "100%",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#3b82f6")}
              onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
            />
          ))}
        </div>
      </Section>

      {/* ── Botón generar ─────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", padding: "8px 0 24px" }}>
        <button
          onClick={handleSubmit}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "13px 40px",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.02em",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.target.style.background = "#1d4ed8")}
          onMouseLeave={(e) => (e.target.style.background = "#2563eb")}
        >
          Generar Informe PDF
        </button>
      </div>
    </div>
  );
}
