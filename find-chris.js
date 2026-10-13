require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function run() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { nombre: { contains: 'Chris', mode: 'insensitive' } },
        { nombre: { contains: 'Paucar', mode: 'insensitive' } }
      ]
    }
  });
  console.log('USERS:', users.map(u => ({ id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, tenantId: u.tenantId })));
}
run().finally(() => prisma.$disconnect());
