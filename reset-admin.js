require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  console.log('═══════════════════════════════════════════════════════');
  console.log(' REPARANDO CUENTAS SUPER ADMIN');
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Corregir chrispaucar49@gmail.com: quitar tenantId
  const chris = await prisma.user.findUnique({ where: { email: 'chrispaucar49@gmail.com' } });
  if (chris) {
    if (chris.tenantId) {
      await prisma.user.update({
        where: { email: 'chrispaucar49@gmail.com' },
        data: {
          tenantId: null,
          rol: 'ROL_SUPER_ADMIN',
          activo: true,
          bloqueadoHasta: null,
          intentosFallidos: 0,
          activeSessionId: null,
          sessionOtp: null,
          sessionOtpExpiresAt: null,
        },
      });
      console.log('✅ chrispaucar49@gmail.com → tenantId removido, rol forzado a ROL_SUPER_ADMIN, desbloqueada.');
    } else {
      console.log('ℹ️ chrispaucar49@gmail.com → ya tiene tenantId: null (correcto).');
    }
  } else {
    console.log('❌ chrispaucar49@gmail.com → NO existe en la BD');
  }

  // 2. Forzar TODAS las cuentas Super Admin a estar libres
  const result = await prisma.user.updateMany({
    where: { rol: 'ROL_SUPER_ADMIN' },
    data: {
      activo: true,
      bloqueadoHasta: null,
      intentosFallidos: 0,
      activeSessionId: null,
      sessionOtp: null,
      sessionOtpExpiresAt: null,
    },
  });
  console.log(`\n🔓 ${result.count} cuentas Super Admin desbloqueadas y sesiones limpiadas.`);

  // 3. Verificar resultado
  const superAdmins = await prisma.user.findMany({
    where: { rol: 'ROL_SUPER_ADMIN' },
    select: { email: true, rol: true, activo: true, tenantId: true, bloqueadoHasta: true, intentosFallidos: true },
  });
  console.log('\n📋 Estado final de Super Admins:');
  for (const sa of superAdmins) {
    console.log(`  ${sa.email} → Rol: ${sa.rol} | Activo: ${sa.activo} | TenantId: ${sa.tenantId || 'null'} | Bloqueado: ${sa.bloqueadoHasta ? 'SÍ' : 'NO'}`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Reparación completada.');
}

main().catch(console.error);
