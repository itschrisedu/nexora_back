import { wrapTemplate } from './base.template';

export interface PedidoEnTransitoData {
  numeroPedido: string;
  clienteNombre: string;
  urlSeguimiento?: string;
}

export function pedidoEnTransitoTemplate(data: PedidoEnTransitoData): string {
  const url = data.urlSeguimiento || '#';
  return wrapTemplate(`
    <h2>Pedido en Tránsito 🚚</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Tu pedido está en camino.</p>
    <div class="highlight">
      <strong>N° Pedido:</strong> ${data.numeroPedido}<br>
      <strong>Estado:</strong> <span class="badge badge-info">EN TRÁNSITO</span>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${url}" class="btn-comprobante" target="_blank" rel="noopener noreferrer">
        📥 Descarga aquí tu comprobante de despacho
      </a>
      <p class="link-alt">
        ¿Problemas con el botón? <a href="${url}" target="_blank" rel="noopener noreferrer">Descarga aquí tu comprobante</a>
      </p>
    </div>
    <p>Pronto recibirás la confirmación de entrega.</p>
  `);
}
