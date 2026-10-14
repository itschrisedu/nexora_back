require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const schemas = await prisma.$queryRawUnsafe('SELECT schema_name FROM information_schema.schemata');
  console.log('Schemas:', schemas);

  const databases = await prisma.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datistemplate = false');
  console.log('Databases:', databases);

  const productModelsRaw = await prisma.$queryRawUnsafe('SELECT id, name, brand, "tenantId" FROM product_models');
  console.log('ProductModels count:', productModelsRaw.length);
  productModelsRaw.forEach(pm => console.log(`  [${pm.brand}] ${pm.name} (${pm.tenantId})`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
