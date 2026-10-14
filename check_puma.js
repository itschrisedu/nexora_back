require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('=== BUSCANDO PUMA 180 EN LA BASE DE DATOS ===');
  const prods = await prisma.product.findMany({
    where: {
      OR: [
        { model: { name: { contains: '180', mode: 'insensitive' } } },
        { model: { brand: { contains: 'Puma', mode: 'insensitive' } } },
        { code: { contains: 'pum', mode: 'insensitive' } }
      ]
    },
    include: {
      model: {
        include: {
          tenant: true
        }
      },
      supplier: true,
      serie: {
        include: {
          tallas: true
        }
      },
      stockByTalla: {
        include: {
          talla: true
        }
      }
    }
  });

  console.log(`Encontrados: ${prods.length} productos`);
  for (const p of prods) {
    console.log(`\n-----------------------------------------`);
    console.log(`Product ID: ${p.id}`);
    console.log(`Code: ${p.code}`);
    console.log(`Color: ${p.color}`);
    console.log(`Model: ${p.model?.brand} ${p.model?.name} (ModelID: ${p.modelId})`);
    console.log(`Tenant Model: ${p.model?.tenant?.name} (${p.model?.tenantId})`);
    console.log(`Product reordenAutomatica: ${p.reordenAutomatica}`);
    console.log(`Model reordenAutomatica: ${p.model?.reordenAutomatica}`);
    console.log(`Product supplierId: ${p.supplierId} (${p.supplier?.razonSocial || 'NULL'})`);
    console.log(`Model supplierId: ${p.model?.supplierId}`);
    console.log(`Serie: ${p.serie?.nombre}`);
    console.log(`StockByTalla count: ${p.stockByTalla.length}`);
    p.stockByTalla.forEach(s => {
      console.log(`  Talla ${s.talla?.numero}: Qty=${s.quantity}, Reserved=${s.reservedQuantity}`);
    });
  }

  // Also check suppliers in that tenant
  if (prods.length > 0) {
    const tenantId = prods[0].model?.tenantId;
    const suppliers = await prisma.supplier.findMany({
      where: { tenantId }
    });
    console.log(`\n=== PROVEEDORES DEL TENANT ${tenantId} ===`);
    suppliers.forEach(s => {
      console.log(`Supplier ID=${s.id}, RazónSocial=${s.razonSocial}, Activo=${s.activo}`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
