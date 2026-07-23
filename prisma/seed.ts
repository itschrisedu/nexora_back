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
  // 0. INQUILINO POR DEFECTO (TENANT)
  // ══════════════════════════════
  let defaultTenant = await prisma.tenant.findFirst();
  if (!defaultTenant) {
    defaultTenant = await prisma.tenant.create({
      data: {
        name: 'NEXORA Sucursal Matriz',
      },
    });
    console.log('✅ Inquilino por defecto creado: NEXORA Sucursal Matriz');
  } else {
    console.log('⏭️  Inquilino por defecto ya existe');
  }

  // ══════════════════════════════
  // 1. CONFIGURACIÓN DE NEGOCIO (BUSINESS CONFIG)
  // ══════════════════════════════
  const config = await prisma.businessConfig.findFirst({ where: { tenantId: defaultTenant.id } });
  if (!config) {
    await prisma.businessConfig.create({
      data: {
        tenantId: defaultTenant.id,
        nombre: 'NEXORA Sucursal Matriz',
        ruc: '1792945281001',
        direccion: 'Av. Amazonas N24-123, Quito',
        telefono: '022555666',
        email: 'sucursal1@nexora.app',
      },
    });
    console.log('✅ Configuración de negocio creada para el Tenant');
  }

  // ══════════════════════════════
  // 2. USUARIOS (SUPER ADMIN Y ADMIN)
  // ══════════════════════════════
  const superAdminUsers = [
    { email: 'superadmin@nexora.com', pass: 'SuperAdmin2026!' },
    { email: 'superadmin@nexora.app', pass: 'SuperAdmin123!' },
  ];

  for (const sa of superAdminUsers) {
    const passwordHash = await bcrypt.hash(sa.pass, 12);
    await prisma.user.upsert({
      where: { email: sa.email },
      update: {
        passwordHash,
        rol: Rol.ROL_SUPER_ADMIN,
        activo: true,
      },
      create: {
        email: sa.email,
        passwordHash,
        nombre: 'Super Administrador',
        rol: Rol.ROL_SUPER_ADMIN,
        tenantId: null, // Global
        activo: true,
      },
    });
    console.log(`✅ Super Admin configurado: ${sa.email} / ${sa.pass}`);
  }

  const adminUsers = [
    { email: 'admin@cevallos-calzado.com', pass: 'Admin1234!', nombre: 'Administrador Cevallos Calzado' },
    { email: 'admin@nexora.app', pass: 'Admin123!', nombre: 'Administrador de Sucursal' },
  ];

  for (const adm of adminUsers) {
    const passwordHash = await bcrypt.hash(adm.pass, 12);
    await prisma.user.upsert({
      where: { email: adm.email },
      update: {
        passwordHash,
        rol: Rol.ROL_ADMIN,
        activo: true,
      },
      create: {
        email: adm.email,
        passwordHash,
        nombre: adm.nombre,
        rol: Rol.ROL_ADMIN,
        tenantId: defaultTenant.id,
        activo: true,
      },
    });
    console.log(`✅ Usuario Admin configurado: ${adm.email} / ${adm.pass}`);
  }

  // ══════════════════════════════
  // 2. SERIES Y TALLAS DE CALZADO
  // ══════════════════════════════
  const seriesData: { nombre: string; tallasDesde: number; tallasHasta: number }[] = [
    { nombre: 'ADULTO',         tallasDesde: 37, tallasHasta: 43 },
    { nombre: 'JUVENIL',        tallasDesde: 34, tallasHasta: 38 },
    { nombre: 'NINO',           tallasDesde: 27, tallasHasta: 32 },
    { nombre: 'NINO_PEQUENO_A', tallasDesde: 21, tallasHasta: 26 },
    { nombre: 'BEBE',           tallasDesde: 18, tallasHasta: 20 },
    { nombre: 'TALLA_GRANDE',   tallasDesde: 43, tallasHasta: 45 },
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
      console.log(`Log: Serie ya existe en base de datos: ${serieData.nombre}`);
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

  // Eliminar NINO_PEQUENO_B si existe para no duplicar Niño A y Niño B
  try {
    const bExists = await prisma.seriesConfig.findUnique({ where: { nombre: 'NINO_PEQUENO_B' } });
    if (bExists) {
      await prisma.seriesConfig.delete({ where: { nombre: 'NINO_PEQUENO_B' } });
      console.log('🗑️  Serie duplicada NINO_PEQUENO_B eliminada.');
    }
  } catch (err) {
    console.log('NINO_PEQUENO_B no se pudo eliminar o no existe:', err);
  }

  // ══════════════════════════════
  // 3. CONFIGURACIÓN DE NIVELES DE CRÉDITO (Fase 3)
  // ══════════════════════════════
  const creditLevels = [
    { nivel: 'SIN_CREDITO', comprasRequeridas: 0,  limiteDolares: 0,    plazoDias: 0 },
    { nivel: 'NIVEL_1',     comprasRequeridas: 10, limiteDolares: 300,  plazoDias: 15 },
    { nivel: 'NIVEL_2',     comprasRequeridas: 15, limiteDolares: 700,  plazoDias: 30 },
    { nivel: 'NIVEL_3',     comprasRequeridas: 25, limiteDolares: 1500, plazoDias: 30 },
    { nivel: 'NIVEL_4',     comprasRequeridas: 40, limiteDolares: 3000, plazoDias: 45 },
  ];

  for (const level of creditLevels) {
    const existingLevel = await prisma.creditLevelConfig.findUnique({
      where: { nivel: level.nivel as any },
    });

    if (!existingLevel) {
      await prisma.creditLevelConfig.create({
        data: {
          nivel: level.nivel as any,
          comprasRequeridas: level.comprasRequeridas,
          limiteDolares: level.limiteDolares,
          plazoDias: level.plazoDias,
        },
      });
      console.log(`✅ Nivel de crédito creado: ${level.nivel}`);
    } else {
      await prisma.creditLevelConfig.update({
        where: { nivel: level.nivel as any },
        data: {
          comprasRequeridas: level.comprasRequeridas,
          limiteDolares: level.limiteDolares,
          plazoDias: level.plazoDias,
        },
      });
      console.log(`⏭️  Nivel de crédito actualizado: ${level.nivel}`);
    }
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

