const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL no está configurada en las variables de entorno');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🔄 Registrando administrador con email válido...');
  const adminEmail = 'admin@nexora.com';
  const passwordHash = await bcrypt.hash('Admin123!', 12);

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: passwordHash,
      activo: true
    },
    create: {
      email: adminEmail,
      passwordHash: passwordHash,
      nombre: 'Administrador',
      rol: 'ROL_ADMIN',
      activo: true
    }
  });

  console.log(`✅ Administrador registrado exitosamente:`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Contraseña: Admin123!`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
