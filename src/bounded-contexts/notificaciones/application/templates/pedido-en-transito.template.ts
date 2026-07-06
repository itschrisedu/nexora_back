import { wrapTemplate } from './base.template';

export interface PedidoEnTransitoData {
  numeroPedido: string;
  clienteNombre: string;
}

export function pedidoEnTransitoTemplate(data: PedidoEnTransitoData): string {
  return wrapTemplate(`
    <h2>Pedido en Tránsito 🚚</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Tu pedido está en camino.</p>
    <div class="highlight">
      <strong>N° Pedido:</strong> ${data.numeroPedido}<br>
      <strong>Estado:</strong> <span class="badge badge-info">EN TRÁNSITO</span>
    </div>
    <p>Pronto recibirás la confirmación de entrega.</p>
  `);
}
