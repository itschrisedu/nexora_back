require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function run() {
  const latestOrders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      lines: true,
      tenant: true
    }
  });

  console.log('--- LATEST 5 ORDERS ---');
  for (const o of latestOrders) {
    console.log(`Order ID: ${o.id}, Estado: ${o.estado}, Monto: ${o.montoTotal}, Tenant: ${o.tenant?.name} (${o.tenantId}), Created: ${o.createdAt}`);
    for (const l of o.lines) {
      const prod = await prisma.product.findUnique({
        where: { id: l.productId },
        include: { model: true, serie: true }
      });
      console.log(`  Line: prodId=${l.productId}, prodCode=${prod?.code}, model=${prod?.model?.name}, cant=${l.cantidad}, tallaId=${l.tallaId}, serie=${prod?.serie?.nombre}`);
    }
  }

  const latestSupplierOrders = await prisma.supplierOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { lines: true, supplier: true }
  });
  console.log('\n--- LATEST 5 SUPPLIER ORDERS ---');
  for (const so of latestSupplierOrders) {
    console.log(`SO #${so.numero} (ID: ${so.id}): Estado=${so.estado}, Total=${so.total}, Supplier=${so.supplier?.razonSocial || so.supplier?.nombreComercial}, Lines=${so.lines.length}, Created=${so.createdAt}`);
    for (const sol of so.lines) {
      console.log(`  SO Line: prodId=${sol.productId}, cantPedida=${sol.cantidadPedida}, costo=${sol.precioCosto}, subtotal=${sol.subtotal}`);
    }
  }
}
run().finally(() => prisma.$disconnect());
