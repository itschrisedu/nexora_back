require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  
  console.log('═══════════════════════════════════════════════════════');
  console.log(' DIAGNÓSTICO DE SUPER ADMINS Y CUENTAS BLOQUEADAS');
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Listar TODOS los usuarios con rol ROL_SUPER_ADMIN
  const superAdmins = await prisma.user.findMany({
    where: { rol: 'ROL_SUPER_ADMIN' },
    select: {
      id: true,
      email: true,
      nombre: true,
      rol: true,
      activo: true,
      bloqueadoHasta: true,
      intentosFallidos: true,
      tenantId: true,
      createdAt: true,
    }
  });
  
  console.log(`🔑 Super Admins encontrados: ${superAdmins.length}`);
  for (const sa of superAdmins) {
    const bloqueado = sa.bloqueadoHasta && sa.bloqueadoHasta > new Date();
    console.log(`  → ${sa.email}`);
    console.log(`    Nombre: ${sa.nombre}`);
    console.log(`    Rol: ${sa.rol}`);
    console.log(`    Activo: ${sa.activo}`);
    console.log(`    Bloqueado: ${bloqueado ? `SÍ (hasta ${sa.bloqueadoHasta})` : 'NO'}`);
    console.log(`    Intentos fallidos: ${sa.intentosFallidos}`);
    console.log(`    TenantId: ${sa.tenantId || '(null - correcto para Super Admin)'}`);
    console.log('');
  }

  // 2. Listar TODAS las cuentas bloqueadas
  const bloqueados = await prisma.user.findMany({
    where: { 
      OR: [
        { bloqueadoHasta: { gt: new Date() } },
        { intentosFallidos: { gte: 3 } },
        { activo: false },
      ]
    },
    select: {
      id: true,
      email: true,
      nombre: true,
      rol: true,
      activo: true,
      bloqueadoHasta: true,
      intentosFallidos: true,
    }
  });

  console.log(`\n🚫 Cuentas bloqueadas/inactivas: ${bloqueados.length}`);
  for (const b of bloqueados) {
    console.log(`  → ${b.email} | Rol: ${b.rol} | Activo: ${b.activo} | Intentos: ${b.intentosFallidos} | Bloqueado hasta: ${b.bloqueadoHasta || 'N/A'}`);
  }

  // 3. Verificar si hay cuentas con emails de super admin pero con roles incorrectos
  const expectedSuperAdminEmails = [
    'superadmin@nexora.com',
    'chrispaucar49@gmail.com',
    'superadmin@nexora.app',
  ];

  console.log('\n📋 Verificación de cuentas maestras esperadas:');
  for (const email of expectedSuperAdminEmails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      console.log(`  ✅ ${email} → Rol: ${user.rol} | Activo: ${user.activo} | Bloqueado: ${user.bloqueadoHasta && user.bloqueadoHasta > new Date() ? 'SÍ' : 'NO'}`);
    } else {
      console.log(`  ❌ ${email} → NO EXISTE en la base de datos`);
    }
  }

  // 4. Contar total de usuarios
  const totalUsers = await prisma.user.count();
  console.log(`\n📊 Total de usuarios en la BD: ${totalUsers}`);

  await prisma.$disconnect();
}

main().catch(console.error);
