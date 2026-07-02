import { PrismaClient, Rol } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL no está configurada en las variables de entorno');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/**
 * Seed de NEXORA — Inicializa datos obligatorios:
 * 1. Usuario Admin por defecto
 * 2. Series de calzado con sus rangos de tallas
 */
async function main() {
  console.log('🌱 Iniciando seed de NEXORA...\n');

  // ══════════════════════════════
  // 1. USUARIO ADMIN
  // ══════════════════════════════
  const adminEmail = 'admin@nexora.app';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('Admin123!', 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        nombre: 'Administrador',
        rol: Rol.ROL_ADMIN,
      },
    });
    console.log('✅ Usuario admin creado: admin@nexora.app / Admin123!');
  } else {
    console.log('⏭️  Usuario admin ya existe');
  }

  // ══════════════════════════════
  // 2. SERIES Y TALLAS DE CALZADO
  // ══════════════════════════════
  const seriesData: { nombre: string; tallasDesde: number; tallasHasta: number }[] = [
    { nombre: 'BEBE',           tallasDesde: 18, tallasHasta: 20 },
    { nombre: 'NINO_PEQUENO_A', tallasDesde: 21, tallasHasta: 26 },
    { nombre: 'NINO_PEQUENO_B', tallasDesde: 21, tallasHasta: 26 },
    { nombre: 'NINO',           tallasDesde: 27, tallasHasta: 32 },
    { nombre: 'JUVENIL',        tallasDesde: 34, tallasHasta: 38 },
    { nombre: 'ADULTO',         tallasDesde: 38, tallasHasta: 42 },
    { nombre: 'TALLA_GRANDE',   tallasDesde: 43, tallasHasta: 46 },
  ];

  for (const serieData of seriesData) {
    let serie = await prisma.seriesConfig.findUnique({
      where: { nombre: serieData.nombre },
    });

    if (!serie) {
      serie = await prisma.seriesConfig.create({
        data: { nombre: serieData.nombre },
      });
      console.log(`✅ Serie creada: ${serieData.nombre}`);
    } else {
      console.log(`⏭️  Serie ya existe: ${serieData.nombre}`);
    }

    // Crear tallas para esta serie
    for (let num = serieData.tallasDesde; num <= serieData.tallasHasta; num++) {
      const existingTalla = await prisma.tallaConfig.findFirst({
        where: { serieId: serie.id, numero: num },
      });

      if (!existingTalla) {
        await prisma.tallaConfig.create({
          data: { numero: num, serieId: serie.id },
        });
      }
    }
    console.log(`   Tallas ${serieData.tallasDesde}-${serieData.tallasHasta} configuradas`);
  }

  console.log('\n🎉 Seed completado exitosamente');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
