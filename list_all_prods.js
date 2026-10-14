require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const models = await prisma.productModel.findMany({
    select: {
      id: true,
      brand: true,
      name: true,
      tenantId: true,
      tenant: { select: { name: true } },
      reordenAutomatica: true,
      supplierId: true,
      products: {
        select: {
          id: true,
          code: true,
          color: true,
          reordenAutomatica: true,
          supplierId: true,
          supplier: { select: { razonSocial: true } }
        }
      }
    }
  });

  console.log(`Total modelos en BD: ${models.length}`);
  models.forEach(m => {
    console.log(`\nModelo: [${m.brand}] ${m.name} | Tenant: ${m.tenant?.name} (${m.tenantId}) | ReordenAuto: ${m.reordenAutomatica}`);
    m.products.forEach(p => {
      console.log(`  Prod: ID=${p.id} | Code=${p.code} | Color=${p.color} | ReordenAuto=${p.reordenAutomatica} | Supplier=${p.supplier?.razonSocial || 'NULL'}`);
    });
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
