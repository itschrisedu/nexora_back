import { Injectable, Logger } from '@nestjs/common';
// pdfkit es un módulo CommonJS — se importa con require para evitar el error "not constructable"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import * as fs from 'fs';
import * as path from 'path';

export interface PdfSaleNoteLine {
  nombre: string;
  serie: string;
  color?: string;
  codigo?: string;
  imageUrl?: string | null;
  talla: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface PdfSaleNoteDevolucion {
  modelo: string;
  color?: string;
  serie?: string;
  cantidad: number;
  motivo?: string;
  subtotal: number;
}

export interface PdfSaleNoteData {
  numero: number;
  fecha: Date;
  clienteNombre: string;
  clienteRuc?: string;
  clienteDireccion?: string;
  clienteTelefono?: string;
  negocioNombre: string;
  negocioRuc: string;
  negocioDireccion: string;
  negocioTelefono?: string;
  lines: PdfSaleNoteLine[];
  devoluciones?: PdfSaleNoteDevolucion[];
  subtotal: number;
  descuento: number;
  total: number;
  adelanto?: number;
  saldoPendiente?: number;
}

interface GrupoModeloPdf {
  nombre: string;
  serie: string;
  color: string;
  codigo: string;
  imageUrl?: string | null;
  imageBuffer?: Buffer | null;
  tallas: { talla: string; cantidad: number }[];
  totalPares: number;
  precioUnitario: number;
  subtotal: number;
}

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);
  private readonly outputDir: string;

  constructor() {
    this.outputDir = path.join(process.cwd(), 'storage', 'notas-venta');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Carga de forma segura y resiliente una imagen a Buffer para PDFKit.
   * Si falla, timeout o no existe, retorna null sin provocar excepciones en Railway.
   */
  private async cargarBufferImagen(imageUrl?: string | null): Promise<Buffer | null> {
    if (!imageUrl || typeof imageUrl !== 'string') return null;

    try {
      // 1. Archivo en sistema de archivos local
      if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        const cleanPath = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
        const localPath = path.isAbsolute(imageUrl) ? imageUrl : path.join(process.cwd(), cleanPath);
        if (fs.existsSync(localPath)) {
          return fs.readFileSync(localPath);
        }
        return null;
      }

      // 2. URL remota (Cloudinary, S3, Vercel Blob, etc.)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(imageUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch {
      // Fallback silencioso y seguro
    }
    return null;
  }

  /**
   * Genera una Nota de Venta en formato PDF con diseño visual de tarjetas de calzado.
   */
  async generarNotaVenta(data: PdfSaleNoteData): Promise<string> {
    const filename = `nota-venta-${String(data.numero).padStart(6, '0')}.pdf`;
    const filePath = path.join(this.outputDir, filename);

    // 1. Agrupar las líneas por modelo, serie y color
    const gruposMap = new Map<string, GrupoModeloPdf>();
    for (const l of data.lines) {
      const key = `${l.nombre.toLowerCase().trim()}_${(l.color || '').toLowerCase().trim()}_${(l.serie || '').toLowerCase().trim()}_${Number(l.precioUnitario).toFixed(2)}`;
      if (!gruposMap.has(key)) {
        gruposMap.set(key, {
          nombre: l.nombre,
          serie: l.serie && l.serie !== '—' ? l.serie : 'Adulto',
          color: l.color || '',
          codigo: l.codigo || '',
          imageUrl: l.imageUrl,
          imageBuffer: null,
          tallas: [],
          totalPares: 0,
          precioUnitario: Number(l.precioUnitario),
          subtotal: 0,
        });
      }

      const g = gruposMap.get(key)!;
      g.totalPares += l.cantidad;
      g.subtotal += l.subtotal;
      const existTalla = g.tallas.find((t) => t.talla === l.talla);
      if (existTalla) {
        existTalla.cantidad += l.cantidad;
      } else {
        g.tallas.push({ talla: l.talla, cantidad: l.cantidad });
      }
    }

    const grupos = Array.from(gruposMap.values());

    // 2. Pre-cargar buffers de imágenes en paralelo
    await Promise.all(
      grupos.map(async (g) => {
        g.imageBuffer = await this.cargarBufferImagen(g.imageUrl);
      }),
    );

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const pageWidth = 595.28;
        const pageHeight = 841.89;
        const leftMargin = 40;
        const contentWidth = pageWidth - leftMargin * 2;

        // ── ENCABEZADO SUPERIOR ──────────────────────────────────────────
        doc
          .roundedRect(leftMargin, 35, contentWidth, 58, 4)
          .fillColor('#0f172a')
          .fill();

        // Barra decorativa verde esmeralda
        doc
          .rect(leftMargin, 91, contentWidth, 2)
          .fillColor('#059669')
          .fill();

        doc
          .fillColor('#ffffff')
          .fontSize(14)
          .font('Helvetica-Bold')
          .text(data.negocioNombre || 'COMPROBANTE COMERCIAL', leftMargin + 15, 45);

        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor('#cbd5e1')
          .text(`RUC: ${data.negocioRuc || '0000000000001'} | Ubicación: ${data.negocioDireccion || 'Cevallos, Tungurahua'}`, leftMargin + 15, 62);

        if (data.negocioTelefono) {
          doc.text(`Teléfono / Atención: ${data.negocioTelefono}`, leftMargin + 15, 74);
        }

        // Recuadro de Número de Nota (derecha)
        const boxW = 140;
        const boxX = leftMargin + contentWidth - boxW - 12;
        doc
          .roundedRect(boxX, 42, boxW, 44, 3)
          .fillColor('#ffffff')
          .fill();

        doc
          .fillColor('#0f172a')
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .text('NOTA DE ENTREGA', boxX, 49, { align: 'center', width: boxW });

        doc
          .fontSize(10)
          .fillColor('#059669')
          .text(`N° ${String(data.numero).padStart(6, '0')}`, boxX, 60, { align: 'center', width: boxW });

        doc
          .fontSize(7.5)
          .font('Helvetica')
          .fillColor('#64748b')
          .text(`Fecha: ${data.fecha.toLocaleDateString('es-EC')}`, boxX, 73, { align: 'center', width: boxW });

        // ── DATOS DEL CLIENTE ────────────────────────────────────────────
        let curY = 104;
        doc
          .roundedRect(leftMargin, curY, contentWidth, 42, 3)
          .fillColor('#f8fafc')
          .strokeColor('#e2e8f0')
          .lineWidth(1)
          .fillAndStroke();

        doc
          .fillColor('#334155')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text('DATOS DEL CLIENTE & DESPACHO', leftMargin + 12, curY + 8);

        doc
          .fillColor('#0f172a')
          .font('Helvetica')
          .fontSize(8)
          .text(`Cliente: ${data.clienteNombre}`, leftMargin + 12, curY + 20)
          .text(`RUC/CI: ${data.clienteRuc || 'Consumidor Final'}`, leftMargin + 12, curY + 30);

        if (data.clienteDireccion) {
          doc.text(`Dirección: ${data.clienteDireccion}`, leftMargin + 250, curY + 20);
        }
        if (data.clienteTelefono) {
          doc.text(`Teléfono: ${data.clienteTelefono}`, leftMargin + 250, curY + 30);
        }

        curY += 50;

        // ── CABECERA DE MODELOS ──────────────────────────────────────────
        const dibujarCabeceraTabla = (yPos: number) => {
          doc
            .roundedRect(leftMargin, yPos, contentWidth, 18, 2)
            .fillColor('#0f172a')
            .fill();

          doc
            .fillColor('#ffffff')
            .font('Helvetica-Bold')
            .fontSize(7.5)
            .text('MODELO DE CALZADO / CURVA DE TALLAS', leftMargin + 12, yPos + 6)
            .text('CANTIDAD', leftMargin + 310, yPos + 6, { align: 'center', width: 60 })
            .text('P. UNIT.', leftMargin + 380, yPos + 6, { align: 'right', width: 50 })
            .text('SUBTOTAL', leftMargin + 440, yPos + 6, { align: 'right', width: 60 });
        };

        dibujarCabeceraTabla(curY);
        curY += 22;

        // ── FILAS DE MODELOS (TARJETAS ESTÁNDAR) ─────────────────────────
        for (let i = 0; i < grupos.length; i++) {
          const g = grupos[i];
          const rowHeight = 44;

          if (curY + rowHeight > pageHeight - 80) {
            doc.addPage();
            curY = 40;
            dibujarCabeceraTabla(curY);
            curY += 22;
          }

          // Tarjeta con fondo alternado
          doc
            .roundedRect(leftMargin, curY, contentWidth, rowHeight, 3)
            .fillColor(i % 2 === 0 ? '#ffffff' : '#f8fafc')
            .strokeColor('#e2e8f0')
            .lineWidth(0.8)
            .fillAndStroke();

          // Miniatura de imagen
          const imgSize = 34;
          const imgX = leftMargin + 6;
          const imgY = curY + 5;

          let imageDrawn = false;
          if (g.imageBuffer) {
            try {
              doc.image(g.imageBuffer, imgX, imgY, { fit: [imgSize, imgSize], align: 'center', valign: 'center' });
              imageDrawn = true;
            } catch {
              imageDrawn = false;
            }
          }

          if (!imageDrawn) {
            doc
              .roundedRect(imgX, imgY, imgSize, imgSize, 3)
              .fillColor('#e2e8f0')
              .fill();
            doc
              .fillColor('#64748b')
              .font('Helvetica-Bold')
              .fontSize(6)
              .text('CALZADO', imgX, imgY + 14, { align: 'center', width: imgSize });
          }

          // Información del Modelo
          const infoX = leftMargin + 48;
          doc
            .fillColor('#0f172a')
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .text(g.nombre.toUpperCase(), infoX, curY + 7);

          const modelWidth = doc.widthOfString(g.nombre.toUpperCase());
          let subX = infoX + modelWidth + 6;

          if (g.color) {
            doc
              .font('Helvetica')
              .fontSize(7.5)
              .fillColor('#64748b')
              .text(`(${g.color})`, subX, curY + 7.5);
            subX += doc.widthOfString(`(${g.color})`) + 6;
          }

          // Pastilla de Serie
          doc
            .roundedRect(subX, curY + 6, 52, 10, 2)
            .fillColor('#ecfdf5')
            .strokeColor('#a7f3d0')
            .lineWidth(0.6)
            .fillAndStroke();

          doc
            .fillColor('#047857')
            .font('Helvetica-Bold')
            .fontSize(6)
            .text(`Serie: ${g.serie}`, subX, curY + 8, { align: 'center', width: 52 });

          // Curva de tallas consolidada
          const tallasStr = g.tallas
            .sort((a, b) => Number(a.talla) - Number(b.talla))
            .map((t) => `T${t.talla}: ${t.cantidad}p`)
            .join('  |  ');

          doc
            .fillColor('#475569')
            .font('Helvetica')
            .fontSize(7)
            .text(`Curva: ${tallasStr}`, infoX, curY + 22);

          // Cantidad y Docenas
          let docenasStr = `${g.totalPares} pares`;
          if (g.totalPares === 6) docenasStr = 'Media Docena';
          else if (g.totalPares === 12) docenasStr = '1 Docena';
          else if (g.totalPares > 0 && g.totalPares % 12 === 0) docenasStr = `${g.totalPares / 12} Docenas`;

          doc
            .fillColor('#0f172a')
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .text(`${g.totalPares} pares`, leftMargin + 310, curY + 12, { align: 'center', width: 60 });

          doc
            .fillColor('#64748b')
            .font('Helvetica')
            .fontSize(6.8)
            .text(docenasStr, leftMargin + 310, curY + 23, { align: 'center', width: 60 });

          // Precio Unitario
          doc
            .fillColor('#0f172a')
            .font('Helvetica-Bold')
            .fontSize(8)
            .text(`$${g.precioUnitario.toFixed(2)}`, leftMargin + 380, curY + 12, { align: 'right', width: 50 });

          doc
            .fillColor('#64748b')
            .font('Helvetica')
            .fontSize(6.5)
            .text('por par', leftMargin + 380, curY + 23, { align: 'right', width: 50 });

          // Subtotal
          doc
            .fillColor('#047857')
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .text(`$${g.subtotal.toFixed(2)}`, leftMargin + 440, curY + 16, { align: 'right', width: 60 });

          curY += rowHeight + 3;
        }

        // ── DEVOLUCIONES / GARANTÍAS SI EXISTEN ───────────────────────────
        if (data.devoluciones && data.devoluciones.length > 0) {
          curY += 4;
          doc
            .roundedRect(leftMargin, curY, contentWidth, 16, 2)
            .fillColor('#fef2f2')
            .strokeColor('#fecaca')
            .lineWidth(0.8)
            .fillAndStroke();

          doc
            .fillColor('#b91c1c')
            .font('Helvetica-Bold')
            .fontSize(7.5)
            .text('DEVOLUCIONES / AJUSTES POR GARANTÍA', leftMargin + 10, curY + 5);

          curY += 19;

          for (const dev of data.devoluciones) {
            doc
              .roundedRect(leftMargin, curY, contentWidth, 18, 2)
              .fillColor('#ffffff')
              .strokeColor('#fee2e2')
              .lineWidth(0.6)
              .fillAndStroke();

            doc
              .fillColor('#b91c1c')
              .font('Helvetica-Bold')
              .fontSize(7.5)
              .text(`• ${dev.modelo} (${dev.cantidad} pares devueltos) ${dev.motivo ? '- Motivo: ' + dev.motivo : ''}`, leftMargin + 10, curY + 5);

            doc
              .fillColor('#b91c1c')
              .font('Helvetica-Bold')
              .fontSize(8)
              .text(`-$${dev.subtotal.toFixed(2)}`, leftMargin + 440, curY + 5, { align: 'right', width: 60 });

            curY += 21;
          }
        }

        // ── TOTALES Y RESUMEN FINANCIERO ─────────────────────────────────
        curY += 8;
        const totW = 190;
        const totX = leftMargin + contentWidth - totW;

        doc
          .roundedRect(totX, curY, totW, 58, 3)
          .fillColor('#f8fafc')
          .strokeColor('#e2e8f0')
          .lineWidth(1)
          .fillAndStroke();

        let ty = curY + 8;
        doc
          .fillColor('#475569')
          .font('Helvetica')
          .fontSize(8)
          .text('Subtotal:', totX + 10, ty)
          .font('Helvetica-Bold')
          .fillColor('#0f172a')
          .text(`$${data.subtotal.toFixed(2)}`, totX + 90, ty, { align: 'right', width: 90 });

        if (data.descuento > 0) {
          ty += 12;
          doc
            .font('Helvetica')
            .fillColor('#b91c1c')
            .text('Descuento:', totX + 10, ty)
            .font('Helvetica-Bold')
            .text(`-$${data.descuento.toFixed(2)}`, totX + 90, ty, { align: 'right', width: 90 });
        }

        ty += 14;
        doc
          .rect(totX + 8, ty - 2, totW - 16, 18)
          .fillColor('#0f172a')
          .fill();

        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .text('TOTAL:', totX + 12, ty + 2)
          .text(`$${data.total.toFixed(2)}`, totX + 80, ty + 2, { align: 'right', width: 95 });

        // ── FIRMAS DE CONFORMIDAD ─────────────────────────────────────────
        const firmasY = pageHeight - 75;
        const colW = 160;

        doc
          .moveTo(leftMargin + 30, firmasY)
          .lineTo(leftMargin + 30 + colW, firmasY)
          .strokeColor('#94a3b8')
          .lineWidth(0.8)
          .stroke();

        doc
          .moveTo(leftMargin + contentWidth - colW - 30, firmasY)
          .lineTo(leftMargin + contentWidth - 30, firmasY)
          .strokeColor('#94a3b8')
          .lineWidth(0.8)
          .stroke();

        doc
          .fillColor('#334155')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text('ENTREGADO CONFORME', leftMargin + 30, firmasY + 5, { align: 'center', width: colW })
          .text('RECIBIDO CONFORME', leftMargin + contentWidth - colW - 30, firmasY + 5, { align: 'center', width: colW });

        doc
          .fillColor('#64748b')
          .font('Helvetica')
          .fontSize(6.8)
          .text(data.negocioNombre || 'Despacho de Bodega', leftMargin + 30, firmasY + 14, { align: 'center', width: colW })
          .text(data.clienteNombre, leftMargin + contentWidth - colW - 30, firmasY + 14, { align: 'center', width: colW });

        // ── PIE DE PÁGINA ─────────────────────────────────────────────────
        doc
          .fillColor('#94a3b8')
          .font('Helvetica-Oblique')
          .fontSize(6.5)
          .text(
            `Comprobante oficial de entrega y recepción emitido por ${data.negocioNombre || 'Comercial de Calzado'}`,
            leftMargin,
            pageHeight - 20,
            { align: 'center', width: contentWidth },
          );

        doc.end();

        stream.on('finish', () => {
          this.logger.log(`✅ PDF generado: ${filename}`);
          resolve(filePath);
        });

        stream.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }
}
