import { wrapTemplate } from './base.template';

export interface CobroVencidoData {
  clienteNombre: string;
  cobroId: string;
  saldoPendiente: number;
  diasVencido: number;
  comprobanteUrl?: string;
}

export function cobroVencidoTemplate(data: CobroVencidoData): string {
  const severidad = data.diasVencido > 15 ? 'badge-danger' : 'badge-warning';
  const icono = data.diasVencido > 15 ? '🔴' : '⚠️';
  const url = data.comprobanteUrl || '#';

  return wrapTemplate(`
    <h2>Aviso de Cobro Vencido ${icono}</h2>
    <p>Hola <strong>${data.clienteNombre}</strong>,</p>
    <p>Te informamos que tienes un cobro pendiente que ha superado su fecha de vencimiento.</p>
    <div class="highlight">
      <strong>N° Cobro:</strong> ${data.cobroId}<br>
      <strong>Saldo Pendiente:</strong> <span class="badge ${severidad}">$${data.saldoPendiente.toFixed(2)}</span><br>
      <strong>Días Vencido:</strong> ${data.diasVencido} día(s)
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${url}" class="btn-comprobante" target="_blank" rel="noopener noreferrer">
        📥 Descarga aquí tu estado de cuenta y comprobante
      </a>
      <p class="link-alt">
        ¿Problemas con el botón? <a href="${url}" target="_blank" rel="noopener noreferrer">Descarga aquí tu comprobante</a>
      </p>
    </div>
    <p>Por favor, regulariza tu situación lo antes posible para mantener tu scoring crediticio.</p>
  `);
}
