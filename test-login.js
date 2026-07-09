const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = 'admin@nexora.com';
  const plainPassword = 'Admin123!';

  console.log(`🔍 Buscando usuario: ${email}`);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.log('❌ Error: Usuario no encontrado en la base de datos.');
    return;
  }

  console.log('✅ Usuario encontrado:', {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    rol: user.rol,
    activo: user.activo,
    passwordHashLength: user.passwordHash.length
  });

  console.log('🔑 Comparando contraseña...');
  const isValid = await bcrypt.compare(plainPassword, user.passwordHash);
  console.log(`➡️  Resultado de bcrypt.compare: ${isValid}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
