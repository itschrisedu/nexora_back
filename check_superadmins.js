require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      nombre: true,
      rol: true,
      activo: true,
      tenantId: true,
      esAdminGeneral: true,
    }
  });
  console.log("Total users in database:", users.length);
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
