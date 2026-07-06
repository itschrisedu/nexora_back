import { wrapTemplate } from './base.template';

export interface PedidoEntregadoData {
  numeroPedido: string;
  clienteNombre: string;
  montoFinal: number;
}

export function pedidoEntregadoTemplate(data: PedidoEntregadoData): string {
  return wrapTemplate(`
    <h2>Pedido Entregado 📦</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Tu pedido ha sido entregado satisfactoriamente.</p>
    <div class="highlight">
      <strong>N° Pedido:</strong> ${data.numeroPedido}<br>
      <strong>Monto Final:</strong> <span class="badge badge-success">$${data.montoFinal.toFixed(2)}</span>
    </div>
    <p>¡Gracias por tu compra! Esperamos que disfrutes tu calzado.</p>
  `);
}
