const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: 'postgresql://neondb_owner:npg_dLih8KotmTN2@ep-fragrant-darkness-ai73ojd0.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require' });
const prisma = new PrismaClient({ adapter });

async function run() {
  const tenants = await prisma.tenant.findMany({
    include: {
      users: {
        select: { id: true, nombre: true, email: true, rol: true, esAdminGeneral: true, activo: true, tenantId: true }
      }
    }
  });
  for (const t of tenants) {
    console.log(`\n=== SUCURSAL: ${t.name} (ID: ${t.id}) ===`);
    console.log(`Total users in DB: ${t.users.length}`);
    for (const u of t.users) {
      console.log(`  - ${u.nombre} (${u.email}) [${u.rol}] esAdminGen:${u.esAdminGeneral} activo:${u.activo}`);
    }
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
