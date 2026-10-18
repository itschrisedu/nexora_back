require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const recentOrders = await prisma.order.findMany({
    take: 3,
    orderBy: { createdAt: 'desc' },
    include: {
      lines: true
    }
  });
  console.log('--- RECENT ORDERS ---');
  console.log(JSON.stringify(recentOrders, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
