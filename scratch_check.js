require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('./node_modules/@prisma/client');
const { PrismaPg } = require('./node_modules/@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const client = await prisma.client.findFirst({
    where: {
      OR: [
        { nombre: { contains: 'Eduardo', mode: 'insensitive' } },
        { apellido: { contains: 'Paucar', mode: 'insensitive' } }
      ]
    }
  });

  if (!client) {
    console.log('Cliente Eduardo no encontrado');
    return;
  }

  console.log(`Cliente: ${client.nombre} ${client.apellido} (ID: ${client.id})`);
  console.log(`Credito Utilizado: $${client.creditoUtilizado}`);
  console.log(`Limite Credito: $${client.limiteCredito}`);

  const cobros = await prisma.cobro.findMany({
    where: { clientId: client.id },
    include: { saleNote: true, abonos: true },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\nCobros del cliente (${cobros.length}):`);
  for (const c of cobros) {
    console.log(`Cobro ID: ${c.id} | SaleNote: ${c.saleNoteId} (Order: ${c.saleNote?.orderId}) | Monto: $${c.montoTotal} | Saldo: $${c.saldoPendiente} | Estado: ${c.estado} | Tipo: ${c.tipo}`);
    for (const ab of c.abonos) {
      console.log(`   -> Abono: $${ab.monto} | Metodo: ${ab.metodo} | Notas: ${ab.notas}`);
    }
  }

  const orders = await prisma.order.findMany({
    where: { clientId: client.id },
    include: { lines: true },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\nPedidos del cliente (${orders.length}):`);
  for (const o of orders) {
    console.log(`Pedido ${o.id} | Estado: ${o.estado} | MontoTotal: $${o.montoTotal} | TipoPago: ${o.tipoPago}`);
    for (const l of o.lines) {
      console.log(`   -> Linea ${l.id}: Cant=${l.cantidad}, Entregada=${l.cantidadEntregada}, pUnit=$${l.precioUnitario}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
