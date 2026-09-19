const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function run() {
  const client = await prisma.client.findFirst({
    where: { nombre: { contains: 'Christopher', mode: 'insensitive' } }
  });
  console.log('CLIENT:', client?.id, client?.nombre, client?.apellido, 'totalCompras:', client?.totalCompras, 'creditoUtilizado:', client?.creditoUtilizado);

  const saleNotes = await prisma.saleNote.findMany({
    where: { clientId: client?.id },
    include: { lines: true, cobro: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log('\nSALE NOTES COUNT:', saleNotes.length);
  for (const sn of saleNotes) {
    console.log('  NOTE #' + sn.numero + ' | Total: $' + sn.total + ' | Fecha: ' + sn.createdAt + ' | Cobro ID: ' + sn.cobro?.id + ' | Cobro Saldo: $' + sn.cobro?.saldoPendiente);
    for (const l of sn.lines) {
      console.log('    Line: ' + l.nombre + ' ' + l.serie + ' T' + l.talla + ' cant=' + l.cantidad + ' subtotal=$' + l.subtotal);
    }
  }

  const cobros = await prisma.cobro.findMany({
    where: { clientId: client?.id },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log('\nCOBROS COUNT:', cobros.length);
  for (const c of cobros) {
    console.log('  COBRO ' + c.id + ' | Tipo: ' + c.tipo + ' | Total: $' + c.montoTotal + ' | Saldo: $' + c.saldoPendiente + ' | Estado: ' + c.estado);
  }

  const orders = await prisma.order.findMany({
    where: { clientId: client?.id },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('\nORDERS COUNT:', orders.length);
  for (const o of orders) {
    console.log('  ORDER ' + o.id + ' | TipoPago: ' + o.tipoPago + ' | Estado: ' + o.estado + ' | MontoTotal: $' + o.montoTotal);
    for (const l of o.lines) {
      console.log('    Line ' + l.id + ' | cant=' + l.cantidad + ' entregada=' + l.cantidadEntregada);
    }
  }
}
run().finally(() => prisma.$disconnect());
