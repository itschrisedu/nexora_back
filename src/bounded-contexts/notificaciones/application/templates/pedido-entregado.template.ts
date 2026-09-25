import { wrapTemplate } from './base.template';

export interface PedidoEntregadoData {
  numeroPedido: string;
  clienteNombre: string;
  montoFinal: number;
  pdfUrl?: string;
}

export function pedidoEntregadoTemplate(data: PedidoEntregadoData): string {
  const url = data.pdfUrl || '#';
  return wrapTemplate(`
    <h2>Pedido Entregado 📦</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Tu pedido ha sido entregado satisfactoriamente.</p>
    <div class="highlight">
      <strong>N° Pedido:</strong> ${data.numeroPedido}<br>
      <strong>Monto Final:</strong> <span class="badge badge-success">$${data.montoFinal.toFixed(2)}</span>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${url}" class="btn-comprobante" target="_blank" rel="noopener noreferrer">
        📥 Descarga aquí tu comprobante oficial
      </a>
      <p class="link-alt">
        ¿Problemas con el botón? <a href="${url}" target="_blank" rel="noopener noreferrer">Descarga aquí tu comprobante</a>
      </p>
    </div>
    <p>¡Gracias por tu compra! Esperamos que disfrutes tu calzado.</p>
  `);
}
