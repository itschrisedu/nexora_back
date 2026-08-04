import { PrismaClient, Rol, MovimientoTipo, EstadoPedido, CanalEntrada, TipoPago, TipoVenta, TipoCobro, CobroEstado, NivelCredito } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import { createCipheriv, randomBytes } from 'crypto';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL no está configurada en las variables de entorno');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function encryptData(text: string): string {
  const masterKey = process.env.AES_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const key = Buffer.from(masterKey.slice(0, 64), 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

async function main() {
  console.log('🌱 Iniciando Seed Completo para NEXORA...\n');

  // ══════════════════════════════
  // 1. SUPER ADMINISTRADORES
  // ══════════════════════════════
  const superAdminUsers = [
    { email: 'superadmin@nexora.com', pass: 'SuperAdmin2026!', nombre: 'Super Administrador Global' },
    { email: 'superadmin@nexora.app', pass: 'SuperAdmin123!', nombre: 'Super Admin Soporte' },
  ];

  for (const sa of superAdminUsers) {
    const passwordHash = await bcrypt.hash(sa.pass, 12);
    await prisma.user.upsert({
      where: { email: sa.email },
      update: { passwordHash, rol: Rol.ROL_SUPER_ADMIN, activo: true },
      create: {
        email: sa.email,
        passwordHash,
        nombre: sa.nombre,
        rol: Rol.ROL_SUPER_ADMIN,
        tenantId: null,
        activo: true,
      },
    });
    console.log(`🔑 Super Admin configurado: ${sa.email} / ${sa.pass}`);
  }

  // ══════════════════════════════
  // 2. SERIES Y TALLAS DE CALZADO
  // ══════════════════════════════
  const seriesData: { nombre: string; tallasDesde: number; tallasHasta: number }[] = [
    { nombre: 'ADULTO',         tallasDesde: 38, tallasHasta: 43 },
    { nombre: 'JUVENIL',        tallasDesde: 34, tallasHasta: 38 },
    { nombre: 'NINO',           tallasDesde: 27, tallasHasta: 32 },
    { nombre: 'NINO_PEQUENO_A', tallasDesde: 21, tallasHasta: 26 },
    { nombre: 'BEBE',           tallasDesde: 18, tallasHasta: 20 },
    { nombre: 'TALLA_GRANDE',   tallasDesde: 43, tallasHasta: 45 },
  ];

  const seriesMap: Record<string, { id: string; tallas: { id: string; numero: number }[] }> = {};

  for (const serieData of seriesData) {
    let serie = await prisma.seriesConfig.findUnique({
      where: { nombre: serieData.nombre },
    });

    if (!serie) {
      serie = await prisma.seriesConfig.create({
        data: { nombre: serieData.nombre },
      });
    }

    const tallas: { id: string; numero: number }[] = [];
    for (let num = serieData.tallasDesde; num <= serieData.tallasHasta; num++) {
      let existingTalla = await prisma.tallaConfig.findFirst({
        where: { serieId: serie.id, numero: num },
      });

      if (!existingTalla) {
        existingTalla = await prisma.tallaConfig.create({
          data: { numero: num, serieId: serie.id },
        });
      }
      tallas.push({ id: existingTalla.id, numero: existingTalla.numero });
    }

    seriesMap[serieData.nombre] = { id: serie.id, tallas };
  }
  console.log('✅ Series y Tallas de Calzado listas');

  // NIVELES DE CRÉDITO
  const creditLevels = [
    { nivel: NivelCredito.SIN_CREDITO, comprasRequeridas: 0,  limiteDolares: 0,    plazoDias: 0 },
    { nivel: NivelCredito.NIVEL_1,     comprasRequeridas: 10, limiteDolares: 300,  plazoDias: 15 },
    { nivel: NivelCredito.NIVEL_2,     comprasRequeridas: 15, limiteDolares: 700,  plazoDias: 30 },
    { nivel: NivelCredito.NIVEL_3,     comprasRequeridas: 25, limiteDolares: 1500, plazoDias: 30 },
    { nivel: NivelCredito.NIVEL_4,     comprasRequeridas: 40, limiteDolares: 3000, plazoDias: 45 },
  ];

  for (const level of creditLevels) {
    await prisma.creditLevelConfig.upsert({
      where: { nivel: level.nivel },
      update: level,
      create: level,
    });
  }
  console.log('✅ Niveles de Crédito listos');

  // ══════════════════════════════
  // 3. DEFINICIÓN DE LOS 3 NEGOCIOS / TENANTS
  // ══════════════════════════════
  const negociosData = [
    {
      nombre: 'Calzados Cevallos Matriz',
      ruc: '1890123456001',
      direccion: 'Av. 24 de Mayo y 10 de Agosto, Cevallos, Tungurahua',
      telefono: '032870123',
      email: 'contacto@cevallos-calzado.com',
      usuarios: [
        { email: 'admin@cevallos-calzado.com', pass: 'Admin1234!', nombre: 'Administrador Cevallos', rol: Rol.ROL_ADMIN },
        { email: 'vendedor@cevallos-calzado.com', pass: 'Vendedor1234!', nombre: 'Carlos Vendedor', rol: Rol.ROL_VENDEDOR },
        { email: 'bodega@cevallos-calzado.com', pass: 'Bodega1234!', nombre: 'Manuel Bodeguero', rol: Rol.ROL_BODEGUERO },
      ],
      modelos: [
        {
          code: 'MC-101', name: 'Mocasín Ejecutivo Cuero', brand: 'Cevallos Premium', material: 'Cuero Vacuno',
          productos: [
            { color: 'Negro', costo: 22.50, venta: 45.00, serie: 'ADULTO' },
            { color: 'Café', costo: 22.50, venta: 45.00, serie: 'ADULTO' },
            { color: 'Miel', costo: 24.00, venta: 48.00, serie: 'ADULTO' },
          ]
        },
        {
          code: 'BT-202', name: 'Botín Industrial Dieléctrico', brand: 'Cevallos Safety', material: 'Cuero Robusto + Punta de Acero',
          productos: [
            { color: 'Negro', costo: 32.00, venta: 65.00, serie: 'ADULTO' },
            { color: 'Café', costo: 32.00, venta: 65.00, serie: 'ADULTO' },
          ]
        },
        {
          code: 'ES-404', name: 'Zapato Escolar Cuero Reforzado', brand: 'Cevallos School', material: 'Cuero Sintético de Alta Durabilidad',
          productos: [
            { color: 'Negro', costo: 14.00, venta: 28.00, serie: 'JUVENIL' },
            { color: 'Negro', costo: 12.00, venta: 24.00, serie: 'NINO' },
          ]
        }
      ],
      clientes: [
        { nombre: 'Don Luis', apellido: 'Zapaterías', cedula: '1803456789', ruc: '1803456789001', nivel: NivelCredito.NIVEL_3, limite: 1500 },
        { nombre: 'Comercializadora', apellido: 'Andrade', cedula: '1809876543', ruc: '1809876543001', nivel: NivelCredito.NIVEL_2, limite: 700 },
        { nombre: 'Distribuidora', apellido: 'El Calzado', cedula: '1805554443', ruc: '1805554443001', nivel: NivelCredito.NIVEL_1, limite: 300 },
      ],
      proveedores: [
        { razonSocial: 'Cueros del Ecuador S.A.', ruc: '1890001122001', contacto: 'Ing. Fernando Ramos', telefono: '0991234567' },
        { razonSocial: 'Curtiduría Ambato Cía. Ltda.', ruc: '1890003344001', contacto: 'Lcda. Patricia Cruz', telefono: '0997654321' },
      ]
    },
    {
      nombre: 'Calzado Deportivo Ambato (FitShoes)',
      ruc: '1890987654001',
      direccion: 'Av. Cevallos y Montalvo, Ambato, Tungurahua',
      telefono: '032412890',
      email: 'ventas@ambato-fitshoes.com',
      usuarios: [
        { email: 'admin@ambato-fitshoes.com', pass: 'FitShoes2026!', nombre: 'Admin FitShoes Ambato', rol: Rol.ROL_ADMIN },
        { email: 'ventas@ambato-fitshoes.com', pass: 'Ventas2026!', nombre: 'Lorena Ventas Sport', rol: Rol.ROL_VENDEDOR },
      ],
      modelos: [
        {
          code: 'DP-303', name: 'Deportivo Running Air Flex', brand: 'FitShoes Sport', material: 'Malla Transpirable + Suela EVA',
          productos: [
            { color: 'Blanco / Azul', costo: 18.00, venta: 38.00, serie: 'ADULTO' },
            { color: 'Negro / Rojo', costo: 18.00, venta: 38.00, serie: 'ADULTO' },
            { color: 'Gris / Verde', costo: 19.50, venta: 42.00, serie: 'JUVENIL' },
          ]
        },
        {
          code: 'DP-304', name: 'Sneaker Urbano Street Casual', brand: 'FitShoes Urban', material: 'Sintético + Cuero Vacuno',
          productos: [
            { color: 'Blanco', costo: 21.00, venta: 45.00, serie: 'ADULTO' },
            { color: 'Negro', costo: 21.00, venta: 45.00, serie: 'ADULTO' },
          ]
        }
      ],
      clientes: [
        { nombre: 'Club Deportivo', apellido: 'Tungurahua', cedula: '1802223334', ruc: '1802223334001', nivel: NivelCredito.NIVEL_3, limite: 1500 },
        { nombre: 'Gimnasio Olimpo', apellido: 'Ambato', cedula: '1804445556', ruc: '1804445556001', nivel: NivelCredito.NIVEL_2, limite: 700 },
      ],
      proveedores: [
        { razonSocial: 'Suelas & Moldes Cevallos', ruc: '1890005566001', contacto: 'Roberto Moldes', telefono: '0984443322' },
        { razonSocial: 'Importadora Textil Ecuador', ruc: '1790009988001', contacto: 'Jorge Textil', telefono: '0981112233' },
      ]
    },
    {
      nombre: 'Calzados Tungurahua Elegance',
      ruc: '1890554433001',
      direccion: 'Calle Bolivar y Castillo, Ambato, Tungurahua',
      telefono: '032824567',
      email: 'info@tungurahua-elegance.com',
      usuarios: [
        { email: 'admin@tungurahua-elegance.com', pass: 'Elegance2026!', nombre: 'Admin Elegance', rol: Rol.ROL_ADMIN },
        { email: 'ventas@tungurahua-elegance.com', pass: 'EleganceVentas2026!', nombre: 'Sofía Asesora Moda', rol: Rol.ROL_VENDEDOR },
      ],
      modelos: [
        {
          code: 'EG-501', name: 'Zapato de Gala Charol Premium', brand: 'Elegance Elite', material: 'Cuero Charol Importado',
          productos: [
            { color: 'Negro brillante', costo: 28.00, venta: 62.00, serie: 'ADULTO' },
            { color: 'Vino Tinto', costo: 29.50, venta: 65.00, serie: 'ADULTO' },
          ]
        },
        {
          code: 'EG-502', name: 'Tacón Estiletto Elegante Femenino', brand: 'Elegance Woman', material: 'Cuero Gamuza Premium',
          productos: [
            { color: 'Nude / Beige', costo: 25.00, venta: 58.00, serie: 'ADULTO' },
            { color: 'Negro', costo: 25.00, venta: 58.00, serie: 'ADULTO' },
          ]
        }
      ],
      clientes: [
        { nombre: 'Boutique Ambato', apellido: 'Chic', cedula: '1807778889', ruc: '1807778889001', nivel: NivelCredito.NIVEL_4, limite: 3000 },
        { nombre: 'Distribuidora Moda', apellido: 'Calzado', cedula: '1808889990', ruc: '180888999001', nivel: NivelCredito.NIVEL_1, limite: 300 },
      ],
      proveedores: [
        { razonSocial: 'Cuero Fino de Exportación S.A.', ruc: '1890007788001', contacto: 'Gabriel Fino', telefono: '0993334455' },
      ]
    }
  ];

  // ══════════════════════════════
  // 4. CREAR CADA NEGOCIO CON SUS DATOS REALES
  // ══════════════════════════════
  for (const n of negociosData) {
    console.log(`\n🏢 Procesando Negocio: ${n.nombre}...`);

    let tenant = await prisma.tenant.findFirst({ where: { name: n.nombre } });
    if (!tenant) {
      tenant = await prisma.tenant.create({ data: { name: n.nombre } });
    }

    await prisma.businessConfig.upsert({
      where: { tenantId: tenant.id },
      update: {
        nombre: n.nombre,
        ruc: encryptData(n.ruc),
        direccion: n.direccion,
        telefono: n.telefono,
        email: n.email,
      },
      create: {
        tenantId: tenant.id,
        nombre: n.nombre,
        ruc: encryptData(n.ruc),
        direccion: n.direccion,
        telefono: n.telefono,
        email: n.email,
      },
    });

    let adminUserId = '';
    for (const u of n.usuarios) {
      const passwordHash = await bcrypt.hash(u.pass, 12);
      const usr = await prisma.user.upsert({
        where: { email: u.email },
        update: { passwordHash, rol: u.rol, tenantId: tenant.id, activo: true },
        create: {
          email: u.email,
          passwordHash,
          nombre: u.nombre,
          rol: u.rol,
          tenantId: tenant.id,
          activo: true,
        },
      });
      if (u.rol === Rol.ROL_ADMIN) adminUserId = usr.id;
      console.log(`   👤 Usuario configurado: ${u.email} (${u.rol})`);
    }

    // Proveedores
    for (const prov of n.proveedores) {
      let supplier = await prisma.supplier.findFirst({
        where: { tenantId: tenant.id, ruc: prov.ruc },
      });
      if (!supplier) {
        supplier = await prisma.supplier.create({
          data: {
            tenantId: tenant.id,
            razonSocial: prov.razonSocial,
            ruc: prov.ruc,
            contacto: prov.contacto,
            direccion: n.direccion,
            email: n.email,
          },
        });
      }
    }
    console.log(`   📦 Proveedores registrados`);

    // Clientes
    const clienteIds: string[] = [];
    for (const cli of n.clientes) {
      let client = await prisma.client.findFirst({
        where: { tenantId: tenant.id, nombre: cli.nombre },
      });
      if (!client) {
        client = await prisma.client.create({
          data: {
            tenantId: tenant.id,
            nombre: cli.nombre,
            apellido: cli.apellido,
            cedula: cli.cedula,
            ruc: encryptData(cli.ruc),
            telefono: n.telefono,
            direccion: n.direccion,
            nivelCredito: cli.nivel,
            limiteCredito: cli.limite,
            totalCompras: 5,
          },
        });
      }
      clienteIds.push(client.id);
    }
    console.log(`   👥 Clientes y niveles registrados`);

    // Modelos, Productos y Stock por Talla
    const productosCreados: { id: string; serieId: string; tallaId: string; precio: number }[] = [];

    for (const m of n.modelos) {
      const baseCodeStr = `${n.nombre.slice(0, 2).toUpperCase()}-${m.code}`;
      let model = await prisma.productModel.findUnique({
        where: { baseCode: baseCodeStr },
      });

      if (!model) {
        model = await prisma.productModel.create({
          data: {
            tenantId: tenant.id,
            baseCode: baseCodeStr,
            name: m.name,
            brand: m.brand,
            material: m.material,
          },
        });
      }

      for (const p of m.productos) {
        const serieInfo = seriesMap[p.serie];
        if (!serieInfo) continue;

        const prodCode = `${model.baseCode}-${p.color.slice(0, 3).toUpperCase()}-${p.serie.slice(0, 3)}`;

        let product = await prisma.product.findUnique({
          where: { code: prodCode },
        });

        if (!product) {
          product = await prisma.product.create({
            data: {
              modelId: model.id,
              code: prodCode,
              color: p.color,
              costPrice: p.costo,
              salePrice: p.venta,
              serieId: serieInfo.id,
            },
          });
        }

        for (const t of serieInfo.tallas) {
          const cantidadStock = 12;
          const stock = await prisma.stockByTalla.findUnique({
            where: { productId_tallaId: { productId: product.id, tallaId: t.id } },
          });

          if (!stock) {
            await prisma.stockByTalla.create({
              data: {
                productId: product.id,
                tallaId: t.id,
                quantity: cantidadStock,
                minStock: 3,
              },
            });

            await prisma.stockMovement.create({
              data: {
                productId: product.id,
                tallaId: t.id,
                type: MovimientoTipo.ENTRADA_MERCANCIA,
                quantity: cantidadStock,
                reason: 'Inventario Inicial de Producción Cevallos',
                userId: adminUserId || 'system',
              },
            });
          }

          productosCreados.push({
            id: product.id,
            serieId: serieInfo.id,
            tallaId: t.id,
            precio: p.venta,
          });
        }
      }
    }
    console.log(`   👟 Catálogo de modelos, productos y stock inicial cargados`);

    // Pedidos, Notas de Venta y Cobros
    if (clienteIds.length > 0 && productosCreados.length > 0) {
      const firstClient = clienteIds[0];
      const prodSample = productosCreados[0];

      const orderExist = await prisma.order.findFirst({ where: { tenantId: tenant.id } });
      if (!orderExist) {
        const order1 = await prisma.order.create({
          data: {
            tenantId: tenant.id,
            clientId: firstClient,
            userId: adminUserId || 'system',
            estado: EstadoPedido.ENTREGADO,
            canal: CanalEntrada.MANUAL,
            tipoPago: TipoPago.CONTADO,
            montoTotal: prodSample.precio * 2,
            notas: 'Venta directa en mostrador',
            lines: {
              create: [
                {
                  productId: prodSample.id,
                  serieId: prodSample.serieId,
                  tallaId: prodSample.tallaId,
                  cantidad: 2,
                  precioUnitario: prodSample.precio,
                  tipoVenta: TipoVenta.TALLA_ESPECIFICA,
                },
              ],
            },
          },
        });

        const saleNote1 = await tx_saleNote(prisma, tenant.id, order1.id, firstClient, prodSample);
        await tx_cobro(prisma, tenant.id, firstClient, saleNote1.id, prodSample.precio * 2, CobroEstado.SALDADO, 0);

        const order2 = await prisma.order.create({
          data: {
            tenantId: tenant.id,
            clientId: clienteIds[1] || firstClient,
            userId: adminUserId || 'system',
            estado: EstadoPedido.PENDIENTE,
            canal: CanalEntrada.MANUAL,
            tipoPago: TipoPago.CREDITO,
            montoTotal: prodSample.precio * 6,
            notas: 'Pedido a crédito por temporada',
            lines: {
              create: [
                {
                  productId: prodSample.id,
                  serieId: prodSample.serieId,
                  tallaId: prodSample.tallaId,
                  cantidad: 6,
                  precioUnitario: prodSample.precio,
                  tipoVenta: TipoVenta.SERIE_COMPLETA,
                },
              ],
            },
          },
        });

        const saleNote2 = await tx_saleNote(prisma, tenant.id, order2.id, clienteIds[1] || firstClient, prodSample, 6);
        await tx_cobro(prisma, tenant.id, clienteIds[1] || firstClient, saleNote2.id, prodSample.precio * 6, CobroEstado.PENDIENTE, prodSample.precio * 6);
      }
    }
    console.log(`   🛒 Pedidos, Notas de Venta y Cuentas por Cobrar listos`);

    // Caja Abierta POS
    const cajaExist = await prisma.cierreCaja.findFirst({ where: { tenantId: tenant.id } });
    if (!cajaExist) {
      await prisma.cierreCaja.create({
        data: {
          tenantId: tenant.id,
          userId: adminUserId || 'system',
          montoInicial: 100.00,
          ventasEfectivo: 90.00,
          totalVentas: 90.00,
          montoEsperadoEfectivo: 190.00,
          notas: 'Apertura de turno de ventas',
        },
      });
      console.log(`   💵 Turno de Caja POS aperturado`);
    }
  }

  console.log('\n🎉 ¡Seed con 3 Negocios y Datos Reales completado con éxito!');
}

async function tx_saleNote(prismaClient: any, tenantId: string, orderId: string, clientId: string, prodSample: any, qty = 2) {
  return prismaClient.saleNote.create({
    data: {
      tenantId,
      orderId,
      clientId,
      subtotal: prodSample.precio * qty,
      descuento: 0,
      total: prodSample.precio * qty,
      lines: {
        create: [
          {
            productId: prodSample.id,
            nombre: 'Calzado Elegante Cevallos',
            serie: prodSample.serieId,
            talla: prodSample.tallaId,
            cantidad: qty,
            precioUnitario: prodSample.precio,
            subtotal: prodSample.precio * qty,
          },
        ],
      },
    },
  });
}

async function tx_cobro(prismaClient: any, tenantId: string, clientId: string, saleNoteId: string, monto: number, estado: CobroEstado, saldo: number) {
  return prismaClient.cobro.create({
    data: {
      tenantId,
      clientId,
      saleNoteId,
      tipo: TipoCobro.CONTADO,
      montoTotal: monto,
      saldoPendiente: saldo,
      estado,
      abonos: saldo === 0 ? {
        create: {
          monto,
          metodo: 'EFECTIVO',
          userId: 'system',
          notas: 'Cobro total registrado',
        }
      } : undefined,
    },
  });
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
