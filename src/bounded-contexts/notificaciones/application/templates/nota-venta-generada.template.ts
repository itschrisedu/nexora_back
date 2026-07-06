import { wrapTemplate } from './base.template';

export interface NotaVentaData {
  clienteNombre: string;
  numeroNota: number;
  total: number;
}

export function notaVentaGeneradaTemplate(data: NotaVentaData): string {
  return wrapTemplate(`
    <h2>Nota de Venta Generada 🧾</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Se ha generado tu nota de venta.</p>
    <div class="highlight">
      <strong>N° Nota:</strong> ${data.numeroNota}<br>
      <strong>Total:</strong> <span class="badge badge-success">$${data.total.toFixed(2)}</span>
    </div>
    <p>Conserva esta referencia como comprobante de tu compra.</p>
  `);
}
