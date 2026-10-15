const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // 1. Órdenes de compra
  const ords = await p.supplierOrder.findMany({ include: { lines: true, supplier: true } });
  console.log('===== ORDENES DE COMPRA =====');
  console.log('Total:', ords.length);
  for (const o of ords) {
    console.log(`\nOC #${o.numero} | Estado: ${o.estado} | Total: ${o.total} | Prov: ${o.supplier?.razonSocial}`);
    console.log('  Obs:', o.observaciones);
    for (const l of o.lines) {
      console.log(`  -> Linea: prodId=${l.productId.slice(0,8)} | cant=${l.cantidadPedida} | subtotal=${l.subtotal}`);
      console.log(`     obsLinea: ${l.observacionLinea}`);
    }
  }

  // 2. Pedidos cancelados
  const cancelados = await p.order.findMany({
    where: { status: 'CANCELADO' },
    select: { id: true, status: true, notas: true, createdAt: true }
  });
  console.log('\n===== PEDIDOS CANCELADOS =====');
  console.log('Total:', cancelados.length);
  for (const c of cancelados) {
    console.log(`Pedido: ${c.id.slice(0,8)}... | Estado: ${c.status} | Notas: ${c.notas}`);
  }

  // 3. Todos los pedidos con su estado
  const todos = await p.order.findMany({
    select: { id: true, status: true, notas: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log('\n===== ULTIMOS 20 PEDIDOS =====');
  for (const t of todos) {
    console.log(`${t.id.slice(0,8)}... | ${t.status} | Notas: ${(t.notas || '').slice(0, 100)}`);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
