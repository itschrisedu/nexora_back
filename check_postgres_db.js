require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const connPostgres = process.env.DATABASE_URL.replace('/neondb', '/postgres');
const adapter = new PrismaPg({ connectionString: connPostgres });
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const models = await prisma.$queryRawUnsafe('SELECT id, name, brand FROM product_models');
    console.log('ProductModels in postgres DB:', models);
  } catch (e) {
    console.log('Error in postgres DB:', e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
