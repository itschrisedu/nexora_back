require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const models = await prisma.productModel.findMany({
    include: {
      products: true,
      tenant: true
    }
  });
  console.log(`Modelos totales: ${models.length}`);
  models.forEach(m => console.log(`ID=${m.id} | Brand=${m.brand} | Name=${m.name} | Tenant=${m.tenant?.name}`));

  const allProds = await prisma.product.findMany({
    select: { id: true, code: true, color: true }
  });
  console.log(`Productos totales: ${allProds.length}`);
  allProds.forEach(p => console.log(`  Code: ${p.code} | Color: ${p.color}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
