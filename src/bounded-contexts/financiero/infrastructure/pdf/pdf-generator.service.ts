import { Injectable, Logger } from '@nestjs/common';
// pdfkit es un módulo CommonJS — se importa con require para evitar el error "not constructable"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import * as fs from 'fs';
import * as path from 'path';

export interface PdfSaleNoteLine {
  nombre: string;
  serie: string;
  talla: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface PdfSaleNoteData {
  numero: number;
  fecha: Date;
  clienteNombre: string;
  clienteRuc?: string;
  clienteDireccion?: string;
  negocioNombre: string;
  negocioRuc: string;
  negocioDireccion: string;
  negocioTelefono?: string;
  lines: PdfSaleNoteLine[];
  subtotal: number;
  descuento: number;
  total: number;
}

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);
  private readonly outputDir: string;

  constructor() {
    // Directorio donde se guardarán los PDF generados
    this.outputDir = path.join(process.cwd(), 'storage', 'notas-venta');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Genera una Nota de Venta en formato PDF y la guarda en el sistema de archivos.
   * El dominio NUNCA conoce PDFKit — esto es exclusivamente de infraestructura.
   * @returns La ruta del archivo PDF generado.
   */
  async generarNotaVenta(data: PdfSaleNoteData): Promise<string> {
    const filename = `nota-venta-${String(data.numero).padStart(6, '0')}.pdf`;
    const filePath = path.join(this.outputDir, filename);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // ── ENCABEZADO ──────────────────────────────────────────────────
        doc
          .fontSize(20)
          .fillColor('#1a1a2e')
          .font('Helvetica-Bold')
          .text('NEXORA', 50, 50);

        doc
          .fontSize(9)
          .fillColor('#555')
          .font('Helvetica')
          .text(data.negocioNombre, 50, 75)
          .text(`RUC: ${data.negocioRuc}`, 50, 87)
          .text(data.negocioDireccion, 50, 99);

        if (data.negocioTelefono) {
          doc.text(`Tel: ${data.negocioTelefono}`, 50, 111);
        }

        // ── TÍTULO NOTA DE VENTA ─────────────────────────────────────────
        doc
          .fontSize(14)
          .fillColor('#1a1a2e')
          .font('Helvetica-Bold')
          .text('NOTA DE VENTA', 350, 50, { align: 'right', width: 200 });

        doc
          .fontSize(10)
          .fillColor('#333')
          .font('Helvetica')
          .text(`N° ${String(data.numero).padStart(6, '0')}`, 350, 72, { align: 'right', width: 200 })
          .text(`Fecha: ${data.fecha.toLocaleDateString('es-EC')}`, 350, 86, { align: 'right', width: 200 });

        // ── DIVIDER ─────────────────────────────────────────────────────
        doc
          .moveTo(50, 135)
          .lineTo(545, 135)
          .strokeColor('#1a1a2e')
          .lineWidth(1.5)
          .stroke();

        // ── DATOS DEL CLIENTE ────────────────────────────────────────────
        doc
          .fontSize(9)
          .fillColor('#333')
          .font('Helvetica-Bold')
          .text('DATOS DEL CLIENTE', 50, 145);

        doc
          .font('Helvetica')
          .text(`Nombre: ${data.clienteNombre}`, 50, 158);

        if (data.clienteRuc) {
          doc.text(`RUC/CI: ${data.clienteRuc}`, 50, 170);
        }

        if (data.clienteDireccion) {
          doc.text(`Dirección: ${data.clienteDireccion}`, 50, 182);
        }

        // ── ENCABEZADO DE TABLA ──────────────────────────────────────────
        const tableTop = 215;
        const col = { prod: 50, serie: 200, talla: 270, qty: 320, price: 380, subtotal: 450 };

        doc
          .rect(50, tableTop - 5, 495, 18)
          .fillColor('#1a1a2e')
          .fill();

        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text('PRODUCTO', col.prod, tableTop)
          .text('SERIE', col.serie, tableTop)
          .text('TALLA', col.talla, tableTop)
          .text('CANT.', col.qty, tableTop)
          .text('P. UNIT.', col.price, tableTop)
          .text('SUBTOTAL', col.subtotal, tableTop);

        // ── FILAS DE TABLA ───────────────────────────────────────────────
        let rowY = tableTop + 20;
        doc.fillColor('#333').font('Helvetica').fontSize(8);

        data.lines.forEach((line, idx) => {
          if (idx % 2 === 0) {
            doc.rect(50, rowY - 3, 495, 14).fillColor('#f5f5f5').fill();
          }

          doc
            .fillColor('#333')
            .text(line.nombre.substring(0, 22), col.prod, rowY, { width: 145 })
            .text(line.serie, col.serie, rowY)
            .text(line.talla, col.talla, rowY)
            .text(String(line.cantidad), col.qty, rowY)
            .text(`$${line.precioUnitario.toFixed(2)}`, col.price, rowY)
            .text(`$${line.subtotal.toFixed(2)}`, col.subtotal, rowY);

          rowY += 16;
        });

        // ── DIVIDER INFERIOR ─────────────────────────────────────────────
        doc
          .moveTo(50, rowY + 5)
          .lineTo(545, rowY + 5)
          .strokeColor('#1a1a2e')
          .lineWidth(0.5)
          .stroke();

        // ── TOTALES ───────────────────────────────────────────────────────
        const totalsY = rowY + 20;

        doc
          .fillColor('#333')
          .font('Helvetica')
          .fontSize(9)
          .text('Subtotal:', 380, totalsY)
          .text(`$${data.subtotal.toFixed(2)}`, 460, totalsY, { align: 'right', width: 85 });

        if (data.descuento > 0) {
          doc
            .text('Descuento:', 380, totalsY + 15)
            .text(`-$${data.descuento.toFixed(2)}`, 460, totalsY + 15, { align: 'right', width: 85 });
        }

        doc
          .rect(375, totalsY + (data.descuento > 0 ? 30 : 15), 170, 18)
          .fillColor('#1a1a2e')
          .fill();

        const totalY = totalsY + (data.descuento > 0 ? 33 : 18);
        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('TOTAL:', 380, totalY)
          .text(`$${data.total.toFixed(2)}`, 460, totalY, { align: 'right', width: 85 });

        // ── PIE DE PÁGINA ─────────────────────────────────────────────────
        doc
          .fillColor('#999')
          .font('Helvetica')
          .fontSize(7)
          .text(
            'Este documento es una Nota de Venta — NEXORA Sistema de Gestión',
            50,
            750,
            { align: 'center', width: 495 },
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
