"""
generate_report.py — versión para integración IPC con Electron
Lee el JSON de formData por stdin, genera el PDF en OUTPUT_PATH.
Uso desde main.js:
    py = spawn('python3', ['generate_report.py'])
    py.stdin.write(JSON.stringify(formData))
    py.stdin.end()
"""
import sys
import os
import json

# Asegurar que el directorio del script esté en el path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib import colors

UNT_LOGO_PATH = os.environ.get("UNT_LOGO_PATH", "")
LII_LOGO_PATH = os.environ.get("LII_LOGO_PATH", "")


def draw_logos(c, page_w, margin_l, y_top):
    logo_h = 16 * mm
    logo_w = 30 * mm
    if UNT_LOGO_PATH and os.path.exists(UNT_LOGO_PATH):
        c.drawImage(UNT_LOGO_PATH, margin_l, y_top - logo_h,
                    width=logo_w, height=logo_h, preserveAspectRatio=True, mask='auto')
    else:
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(colors.HexColor("#003366"))
        c.drawString(margin_l, y_top - 5*mm, "UNIVERSIDAD NACIONAL DE TUCUMÁN")
        c.setFont("Helvetica", 6)
        c.drawString(margin_l, y_top - 8.5*mm, "FACULTAD DE CIENCIAS")
        c.drawString(margin_l, y_top - 11.5*mm, "EXACTAS Y TECNOLOGÍA")

    right_x = page_w - margin_l - logo_w
    if LII_LOGO_PATH and os.path.exists(LII_LOGO_PATH):
        c.drawImage(LII_LOGO_PATH, right_x, y_top - logo_h,
                    width=logo_w, height=logo_h, preserveAspectRatio=True, mask='auto')
    else:
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(colors.HexColor("#003366"))
        c.drawString(right_x, y_top - 5*mm,  "Laboratorio de")
        c.drawString(right_x, y_top - 9*mm,  "Instrumentación")
        c.drawString(right_x, y_top - 13*mm, "Industrial")
    c.setFillColor(colors.black)


def draw_header(c, page_w, margin_l, y):
    table_w = page_w - 2 * margin_l
    cell_h  = 7 * mm
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.5)
    c.rect(margin_l, y - cell_h, table_w * 0.75, cell_h)
    c.rect(margin_l + table_w * 0.75, y - cell_h, table_w * 0.25, cell_h)
    c.setFont("Helvetica", 8)
    c.drawCentredString(margin_l + table_w * 0.375, y - cell_h + 2.5*mm, "Registro")
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(margin_l + table_w * 0.875, y - cell_h + 2*mm, "REG EV-01")
    c.rect(margin_l, y - 2 * cell_h, table_w * 0.75, cell_h)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(margin_l + table_w * 0.375, y - 2 * cell_h + 2*mm, "Ensayos de Válvulas")
    return y - 2 * cell_h


def labeled_row(c, margin_l, table_w, y, pairs, row_h=6.5*mm):
    total = sum(p[2] for p in pairs)
    x = margin_l
    c.setLineWidth(0.3)
    for (lbl, val, parts) in pairs:
        w = (parts / total) * table_w
        c.rect(x, y - row_h, w, row_h, stroke=1, fill=0)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawString(x + 1.5*mm, y - row_h + 2*mm, lbl + (":" if lbl else ""))
        lw = c.stringWidth(lbl + ":", "Helvetica-Bold", 7.5) + 2*mm
        c.setFont("Helvetica", 7.5)
        c.drawString(x + 1.5*mm + lw, y - row_h + 2*mm, str(val) if val else "")
        x += w
    return y - row_h


def draw_section_header(c, margin_l, page_w, y, title, row_h=5.5*mm):
    table_w = page_w - 2 * margin_l
    c.setFillColor(colors.HexColor("#d9e1f2"))
    c.rect(margin_l, y - row_h, table_w, row_h, fill=1, stroke=1)
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(margin_l + 2*mm, y - row_h + 1.5*mm, title)
    return y - row_h


def draw_inspection_table(c, margin_l, page_w, y, partes, inspection_data):
    table_w = page_w - 2 * margin_l
    col_w   = [40*mm, 9*mm, 9*mm, 9*mm, 9*mm, 9*mm, 9*mm, 9*mm, 9*mm, table_w - 40*mm - 72*mm]
    row_h   = 5*mm
    c.setLineWidth(0.3)

    x_positions = []
    xc = margin_l
    for w in col_w:
        x_positions.append(xc)
        xc += w
    x_positions.append(xc)

    def hcell(s, e, txt):
        x1, x2 = x_positions[s], x_positions[e]
        w = x2 - x1
        c.setFillColor(colors.HexColor("#d9e1f2"))
        c.rect(x1, y - row_h, w, row_h, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(x1 + w/2, y - row_h + 1.5*mm, txt)

    for (s, e, t) in [(0,1,"Partes"),(1,5,"Depósitos"),(5,9,"Corrosión"),(9,10,"Daño Mecánico")]:
        hcell(s, e, t)
    y -= row_h

    sub = ["","No","Bajo","Medio","Alto","No","Bajo","Medio","Alto",""]
    for ci, txt in enumerate(sub):
        x1 = x_positions[ci]; w = col_w[ci]
        c.setFillColor(colors.HexColor("#eef2fa"))
        c.rect(x1, y - row_h, w, row_h, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 6.5)
        c.drawCentredString(x1 + w/2, y - row_h + 1.5*mm, txt)
    y -= row_h

    for parte in partes:
        data = inspection_data.get(parte, {})
        row_vals = [
            parte,
            "x" if data.get("depositos") == "No"    else "",
            "x" if data.get("depositos") == "Bajo"  else "",
            "x" if data.get("depositos") == "Medio" else "",
            "x" if data.get("depositos") == "Alto"  else "",
            "x" if data.get("corrosion") == "No"    else "",
            "x" if data.get("corrosion") == "Bajo"  else "",
            "x" if data.get("corrosion") == "Medio" else "",
            "x" if data.get("corrosion") == "Alto"  else "",
            data.get("danio_mecanico", ""),
        ]
        for ci, val in enumerate(row_vals):
            x1 = x_positions[ci]; w = col_w[ci]
            c.setFillColor(colors.white)
            c.rect(x1, y - row_h, w, row_h, fill=1, stroke=1)
            c.setFillColor(colors.black)
            if ci == 9:
                c.setFont("Helvetica", 6)
                c.drawString(x1 + 1*mm, y - row_h + 1.5*mm, str(val)[:60])
            elif ci == 0:
                c.setFont("Helvetica", 7)
                c.drawString(x1 + 1.5*mm, y - row_h + 1.5*mm, val)
            else:
                c.setFont("Helvetica-Bold", 9)
                c.drawCentredString(x1 + w/2, y - row_h + 1.2*mm, val)
        y -= row_h
    return y


def draw_valores_table(c, margin_l, page_w, y, encontrados, finales):
    table_w = page_w - 2 * margin_l
    half    = table_w / 2
    col_w   = half / 4
    row_h   = 6 * mm
    c.setLineWidth(0.3)
    for i, h in enumerate(["VALOR ENCONTRADO", "VALOR FINAL"]):
        x = margin_l + i * half
        c.setFillColor(colors.HexColor("#d9e1f2"))
        c.rect(x, y - row_h, half, row_h, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(x + half/2, y - row_h + 2*mm, h)
    y -= row_h
    max_rows = max(len(encontrados), len(finales), 4)
    for i in range(max_rows):
        for cg in range(2):
            src = encontrados if cg == 0 else finales
            for j in range(4):
                xc  = margin_l + cg * half + j * col_w
                idx = i * 4 + j
                val = src[idx] if idx < len(src) else ""
                c.setFillColor(colors.white)
                c.rect(xc, y - row_h, col_w, row_h, fill=1, stroke=1)
                c.setFillColor(colors.black)
                c.setFont("Helvetica", 7)
                c.drawString(xc + 1*mm, y - row_h + 2*mm, str(val))
        y -= row_h
    return y


def draw_observations(c, margin_l, page_w, y, obs_lines, row_h=5.5*mm):
    table_w = page_w - 2 * margin_l
    c.setFont("Helvetica-Bold", 8); c.setLineWidth(0.3)
    c.rect(margin_l, y - row_h, table_w, row_h, stroke=1, fill=0)
    c.drawString(margin_l + 2*mm, y - row_h + 1.5*mm, "OBSERVACIONES:")
    y -= row_h
    for line in obs_lines[:4]:
        c.setFillColor(colors.white)
        c.rect(margin_l, y - row_h, table_w, row_h, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 7.5)
        c.drawString(margin_l + 2*mm, y - row_h + 1.5*mm, str(line))
        y -= row_h
    for _ in range(4 - len(obs_lines)):
        c.setDash(1, 2)
        c.line(margin_l, y - row_h/2, margin_l + table_w, y - row_h/2)
        c.setDash()
        y -= row_h
    return y


def draw_footer(c, margin_l, page_w, y):
    table_w = page_w - 2 * margin_l
    row_h   = 5.5 * mm
    cols    = [25*mm, 45*mm, 45*mm, 45*mm, table_w - 160*mm]
    xs = [margin_l]
    for w in cols:
        xs.append(xs[-1] + w)
    texts = ["Edición 04", "Preparó: R. Vilte", "Revisó: O. Sánchez", "Aprobó: R. Vilte", "Pág. 1 de 1"]
    c.setLineWidth(0.3)
    for i, txt in enumerate(texts):
        c.setFillColor(colors.HexColor("#f0f4fc"))
        c.rect(xs[i], y - row_h, cols[i], row_h, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 7)
        c.drawCentredString(xs[i] + cols[i]/2, y - row_h + 1.5*mm, txt)
    y -= row_h
    c.setFont("Helvetica", 5.5)
    c.setFillColor(colors.HexColor("#333333"))
    nota = ("NOTA: Este documento es propiedad de la UNT y se reservan todos los derechos legales sobre él. "
            "No está permitido hacer reproducciones y entregarlas a terceros, o la explotación, transferencia "
            "o liberación de ninguna información en el contenido sin un acuerdo previo y escrito de la UNT.")
    c.drawString(margin_l, y - 3.5*mm, nota[:140])
    c.drawString(margin_l, y - 6*mm,   nota[140:])
    return y


def generate_report(form_data: dict, output_path: str):
    page_w, page_h = A4
    margin_l = 14 * mm
    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle("REG EV-01 — Ensayos de Válvulas")
    table_w = page_w - 2 * margin_l
    half    = table_w / 2

    y = page_h - 8 * mm
    draw_logos(c, page_w, margin_l, y)
    y -= 17 * mm
    y = draw_header(c, page_w, margin_l, y)
    y -= 1 * mm

    y = labeled_row(c, margin_l, table_w, y, [
        ("FECHA DE RECEPCION", form_data.get("fecha_recepcion",""), 3),
        ("HOJA", form_data.get("hoja","1"), 0.5),
    ])
    y = labeled_row(c, margin_l, table_w, y, [
        ("PETICIONARIO", form_data.get("peticionario",""), 3),
        ("CUADERNO", form_data.get("cuaderno","CEV-011"), 0.5),
    ])

    # Sección doble
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(colors.HexColor("#d9e1f2"))
    c.rect(margin_l,        y-5*mm, half, 5*mm, fill=1, stroke=1)
    c.rect(margin_l + half, y-5*mm, half, 5*mm, fill=1, stroke=1)
    c.setFillColor(colors.black)
    c.drawCentredString(margin_l + half/2,        y-5*mm+1.2*mm, "DATOS DEL INSTRUMENTO")
    c.drawCentredString(margin_l + half + half/2, y-5*mm+1.2*mm, "DATOS DEL ENSAYO")
    y -= 5*mm

    def two_col(y, ll, vl, lr, vr, rh=6*mm):
        c.setLineWidth(0.3)
        for (x, lbl, val) in [(margin_l, ll, vl), (margin_l+half, lr, vr)]:
            c.rect(x, y-rh, half, rh, stroke=1, fill=0)
            c.setFont("Helvetica-Bold", 7.5)
            c.drawString(x+1.5*mm, y-rh+2*mm, lbl+":")
            lw = c.stringWidth(lbl+":", "Helvetica-Bold", 7.5)+3*mm
            c.setFont("Helvetica", 7.5)
            c.drawString(x+1.5*mm+lw, y-rh+2*mm, str(val) if val else "")
        return y-rh

    y = two_col(y, "MARCA",           form_data.get("marca",""),    "FECHA DE ENSAYO", form_data.get("fecha_ensayo",""))
    y = two_col(y, "MODELO",          form_data.get("modelo",""),   "PROCEDIMIENTO",   form_data.get("procedimiento",""))
    y = two_col(y, "Nº SERIE",        form_data.get("n_serie",""),  "CERTIFICADO N°",  form_data.get("certificado",""))
    y = two_col(y, "TAG",             form_data.get("tag",""),      "PATRON",          form_data.get("patron",""))
    y = two_col(y, "UBICACIÓN",       form_data.get("ubicacion",""),"TIPO DE ENSAYO",  "")

    # Checkboxes tipo ensayo
    tipo = form_data.get("tipo_ensayo","").lower()
    by   = y + 6*mm - 4.5*mm
    bx1  = margin_l + half + 30*mm
    bx2  = bx1 + 28*mm
    bsz  = 3*mm
    c.setFont("Helvetica", 7.5)
    c.rect(bx1, by, bsz, bsz, stroke=1, fill=0)
    if "hidraulico" in tipo or "hidráulico" in tipo:
        c.setFont("Helvetica-Bold", 8); c.drawString(bx1+0.3*mm, by+0.3*mm, "X"); c.setFont("Helvetica", 7.5)
    c.drawString(bx1+4*mm, by+0.5*mm, "HIDRÁULICO")
    c.rect(bx2, by, bsz, bsz, stroke=1, fill=0)
    if "neumatico" in tipo or "neumático" in tipo or "ambos" in tipo:
        c.setFont("Helvetica-Bold", 8); c.drawString(bx2+0.3*mm, by+0.3*mm, "X"); c.setFont("Helvetica", 7.5)
    c.drawString(bx2+4*mm, by+0.5*mm, "NEUMÁTICO")

    y = two_col(y, "Ø ENTRADA/SALIDA", form_data.get("diametro",""),  "OPERADOR", form_data.get("operador",""))

    rh = 6*mm; c.setLineWidth(0.3)
    c.rect(margin_l, y-rh, half, rh, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7.5); c.drawString(margin_l+1.5*mm, y-rh+2*mm, "PRESION DE SET:")
    c.setFont("Helvetica", 7.5);     c.drawString(margin_l+26*mm,   y-rh+2*mm, str(form_data.get("presion_set","")))
    sub_w = half/3
    for i, (lbl, key) in enumerate([("TEMP. AMB.(°C)","temp_amb"),("H.R. (%)","humedad_relativa"),("REGISTRO B.D","registro_bd")]):
        xc = margin_l + half + i*sub_w
        c.rect(xc, y-rh, sub_w, rh, stroke=1, fill=0)
        c.setFont("Helvetica-Bold", 6.5); c.drawString(xc+1*mm, y-rh+3.5*mm, lbl)
        c.setFont("Helvetica", 7);        c.drawString(xc+1*mm, y-rh+1*mm,   str(form_data.get(key,"")))
    y -= rh

    rh = 6*mm
    c.rect(margin_l, y-rh, half*0.55, rh, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7.5); c.drawString(margin_l+1.5*mm, y-rh+2*mm, "PRECINTO ANT. N°")
    c.setFont("Helvetica", 7.5);      c.drawString(margin_l+28*mm,  y-rh+2*mm, str(form_data.get("precinto_ant","")))
    c.rect(margin_l+half*0.55, y-rh, half*0.45, rh, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7.5); c.drawString(margin_l+half*0.55+1.5*mm, y-rh+2*mm, "ESTADO")
    c.setFont("Helvetica", 7.5);      c.drawString(margin_l+half*0.55+18*mm,  y-rh+2*mm, str(form_data.get("estado_precinto","")))
    sub_w2 = half/4
    for i, (lbl, key) in enumerate([("V.R.","vr"),("B.D.","bd_check"),("PDF","pdf_check"),("IMP.","imp")]):
        xc = margin_l + half + i*sub_w2
        c.rect(xc, y-rh, sub_w2, rh, stroke=1, fill=0)
        c.setFont("Helvetica-Bold", 7); c.drawString(xc+1*mm, y-rh+3.5*mm, lbl)
        c.setFont("Helvetica", 7);      c.drawString(xc+1*mm, y-rh+1*mm,   str(form_data.get(key,"")))
    y -= rh

    c.rect(margin_l, y-rh, half*0.55, rh, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7.5); c.drawString(margin_l+1.5*mm, y-rh+2*mm, "PRECINTO NUEVO N°")
    c.setFont("Helvetica", 7.5);      c.drawString(margin_l+32*mm,  y-rh+2*mm, str(form_data.get("precinto_nuevo","")))
    y -= rh
    y -= 1*mm

    insp = form_data.get("inspection_data", {})
    PARTES_PRELIM = ["Capuchón","Palanca","Bulones de ensamble","Bonete","Bridas/Roscas","Tornillo de Ajuste","Contratuerca","Cuerpo","Boquilla"]
    PARTES_MTO    = ["Vástago","Asiento","Resorte","Guía","Disco"]

    y = draw_section_header(c, margin_l, page_w, y, "Inspección preliminar")
    y = draw_inspection_table(c, margin_l, page_w, y, PARTES_PRELIM, insp)
    y = draw_section_header(c, margin_l, page_w, y, "Inspección de Mto.")
    y = draw_inspection_table(c, margin_l, page_w, y, PARTES_MTO, insp)
    y -= 1*mm

    y = draw_valores_table(c, margin_l, page_w, y,
        form_data.get("valores_encontrados",[]),
        form_data.get("valores_finales",[]))
    y -= 1*mm
    y = draw_observations(c, margin_l, page_w, y, form_data.get("observaciones",[]))
    y -= 2*mm
    draw_footer(c, margin_l, page_w, y)
    c.save()


if __name__ == "__main__":
    raw = sys.stdin.read().strip()
    if not raw:
        print("ERROR: No se recibió formData por stdin", file=sys.stderr)
        sys.exit(1)
    form_data   = json.loads(raw)
    output_path = os.environ.get("OUTPUT_PATH", "REG_EV01_output.pdf")
    generate_report(form_data, output_path)
    print(f"[OK] {output_path}")
    