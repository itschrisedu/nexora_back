import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ords = await p.supplierOrder.findMany({ include: { lines: true, supplier: true } });
  console.log('TOTAL_OC:', ords.length);
  for (const o of ords) {
    console.log('OC#' + o.numero + '|' + o.estado + '|T:' + o.total);
    console.log('Obs:', o.observaciones);
    for (const l of o.lines) { console.log('L:' + l.productId.slice(0,8) + '|c:' + l.cantidadPedida + '|o:' + l.observacionLinea); }
  }
  const cx = await p.order.findMany({ where: { estado: 'CANCELADO' }, select: { id: true, estado: true, notas: true } });
  console.log('CANCELADOS:', cx.length);
  for (const c of cx) { console.log(c.id.slice(0,8) + '|' + c.estado + '|' + c.notas); }
}
main().catch(console.error).finally(function(){ p.$disconnect() });
