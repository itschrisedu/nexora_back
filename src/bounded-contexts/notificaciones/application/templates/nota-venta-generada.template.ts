import { wrapTemplate } from './base.template';

export interface NotaVentaData {
  clienteNombre: string;
  numeroNota: number;
  total: number;
  pdfUrl?: string;
}

export function notaVentaGeneradaTemplate(data: NotaVentaData): string {
  const url = data.pdfUrl || '#';
  return wrapTemplate(`
    <h2>Nota de Venta Generada 🧾</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Se ha generado formalmente tu nota de venta.</p>
    <div class="highlight">
      <strong>N° Nota:</strong> ${data.numeroNota}<br>
      <strong>Total:</strong> <span class="badge badge-success">$${data.total.toFixed(2)}</span>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${url}" class="btn-comprobante" target="_blank" rel="noopener noreferrer">
        📥 Descarga aquí tu comprobante oficial
      </a>
      <p class="link-alt">
        ¿Problemas con el botón? <a href="${url}" target="_blank" rel="noopener noreferrer">Descarga aquí tu comprobante</a>
      </p>
    </div>
    <p>Conserva este documento digital como respaldo de tu compra.</p>
  `);
}
