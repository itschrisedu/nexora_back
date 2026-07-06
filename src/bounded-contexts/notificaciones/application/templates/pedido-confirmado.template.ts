import { wrapTemplate } from './base.template';

export interface PedidoConfirmadoData {
  numeroPedido: string;
  clienteNombre: string;
  montoTotal: number;
  tipoPago: string;
  lineas: { producto: string; cantidad: number; precioUnitario: number }[];
}

export function pedidoConfirmadoTemplate(data: PedidoConfirmadoData): string {
  const lineasHtml = data.lineas
    .map(
      (l) =>
        `<tr><td>${l.producto}</td><td style="text-align:center">${l.cantidad}</td><td style="text-align:right">$${l.precioUnitario.toFixed(2)}</td></tr>`,
    )
    .join('');

  return wrapTemplate(`
    <h2>Pedido Confirmado ✅</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Tu pedido ha sido confirmado exitosamente.</p>
    <div class="highlight">
      <strong>N° Pedido:</strong> ${data.numeroPedido}<br>
      <strong>Tipo de Pago:</strong> <span class="badge badge-info">${data.tipoPago}</span>
    </div>
    <table class="detail">
      <thead><tr><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">P. Unit.</th></tr></thead>
      <tbody>
        ${lineasHtml}
        <tr class="total-row"><td colspan="2">TOTAL</td><td style="text-align:right">$${data.montoTotal.toFixed(2)}</td></tr>
      </tbody>
    </table>
    <p>Te mantendremos informado sobre el progreso de tu pedido.</p>
  `);
}
