import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../shared/infrastructure/encryption/encryption.service';
import * as bcrypt from 'bcryptjs';
import { Rol, PlanTipo, EstadoSuscripcion } from '@prisma/client';

export const PLAN_DEFAULTS: Record<PlanTipo, { maxSucursales: number; maxUsuarios: number; precioMensual: number; name: string }> = {
  PLAN_BASICO: {
    maxSucursales: 1,
    maxUsuarios: 2,
    precioMensual: 30.0,
    name: 'Plan Básico (1 Sucursal / 2 Usuarios)',
  },
  PLAN_COMERCIAL: {
    maxSucursales: 3,
    maxUsuarios: 6,
    precioMensual: 50.0,
    name: 'Plan Comercial (3 Sucursales / 6 Usuarios)',
  },
  PLAN_MAYORISTA: {
    maxSucursales: 999,
    maxUsuarios: 999,
    precioMensual: 90.0,
    name: 'Plan Mayorista (Ilimitado / Multi-Bodega / ML Scoring)',
  },
};

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Listar todos los tenants con estadísticas y estado de suscripción.
   */
  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      include: {
        _count: {
          select: {
            users: true,
            productModels: true,
            clients: true,
            orders: true,
          },
        },
        users: {
          where: { rol: Rol.ROL_ADMIN },
          select: { id: true, email: true, nombre: true, activo: true },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return tenants.map((t) => {
      const now = new Date();
      let diasRestantes = 0;
      if (t.fechaVencimientoPlan) {
        const diffMs = new Date(t.fechaVencimientoPlan).getTime() - now.getTime();
        diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      }

      return {
        id: t.id,
        name: t.name,
        active: t.active,
        plan: t.plan,
        estadoSuscripcion: t.estadoSuscripcion,
        fechaVencimientoPlan: t.fechaVencimientoPlan,
        diasPruebaGratis: t.diasPruebaGratis,
        maxSucursales: t.maxSucursales,
        maxUsuarios: t.maxUsuarios,
        precioMensualPlan: Number(t.precioMensualPlan),
        diasRestantes,
        createdAt: t.createdAt,
        stats: {
          users: t._count.users,
          models: t._count.productModels,
          clients: t._count.clients,
          orders: t._count.orders,
        },
        admins: t.users,
      };
    });
  }

  /**
   * Crear un nuevo tenant con un admin inicial y configuración de plan SaaS.
   */
  async createTenant(data: {
    name: string;
    adminEmail: string;
    adminNombre: string;
    adminPassword: string;
    plan?: PlanTipo;
    diasPruebaGratis?: number;
    maxSucursales?: number;
    maxUsuarios?: number;
    precioMensualPlan?: number;
  }) {
    // Validar formato y arroba única en el correo del administrador
    const cleanEmail = (data.adminEmail || '').trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail) || (cleanEmail.match(/@/g) || []).length !== 1) {
      throw new BadRequestException('El correo del administrador debe ser un email válido y contener exactamente un arroba (@).');
    }
    data.adminEmail = cleanEmail;

    // Verificar que no exista un tenant con el mismo nombre
    const existing = await this.prisma.tenant.findFirst({
      where: { name: data.name },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un tenant con el nombre "${data.name}".`);
    }

    // Verificar que el email del admin no esté en uso
    const emailExists = await this.prisma.user.findUnique({
      where: { email: data.adminEmail },
    });
    if (emailExists) {
      throw new ConflictException(`El correo "${data.adminEmail}" ya está registrado.`);
    }

    const plan = data.plan || PlanTipo.PLAN_COMERCIAL;
    const defaults = PLAN_DEFAULTS[plan];
    const diasPrueba = data.diasPruebaGratis !== undefined ? data.diasPruebaGratis : 15;
    const maxSucursales = data.maxSucursales ?? defaults.maxSucursales;
    const maxUsuarios = data.maxUsuarios ?? defaults.maxUsuarios;
    const precioMensual = data.precioMensualPlan !== undefined && data.precioMensualPlan !== null ? Number(data.precioMensualPlan) : defaults.precioMensual;

    // Calcular fecha de vencimiento inicial por días de prueba
    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(fechaVencimiento.getDate() + diasPrueba);

    const passwordHash = await bcrypt.hash(data.adminPassword, this.BCRYPT_ROUNDS);

    // Crear tenant + admin + businessConfig en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          active: true,
          plan,
          estadoSuscripcion: EstadoSuscripcion.EN_PRUEBA,
          diasPruebaGratis: diasPrueba,
          fechaVencimientoPlan: fechaVencimiento,
          maxSucursales,
          maxUsuarios,
          precioMensualPlan: precioMensual,
        },
      });

      const admin = await tx.user.create({
        data: {
          email: data.adminEmail,
          nombre: data.adminNombre,
          rol: Rol.ROL_ADMIN,
          esAdminGeneral: true,
          passwordHash,
          activo: true,
          tenantId: tenant.id,
        },
        select: {
          id: true,
          email: true,
          nombre: true,
          rol: true,
          esAdminGeneral: true,
          activo: true,
        },
      });

      // Crear configuración de negocio por defecto para el tenant
      await tx.businessConfig.create({
        data: {
          tenantId: tenant.id,
          nombre: data.name,
          ruc: '0000000000001',
          direccion: 'Ecuador',
        },
      });

      return { tenant, admin };
    });

    this.logger.log(`Tenant "${data.name}" creado con plan ${plan} y prueba de ${diasPrueba} días.`);

    return {
      id: result.tenant.id,
      name: result.tenant.name,
      active: result.tenant.active,
      plan: result.tenant.plan,
      estadoSuscripcion: result.tenant.estadoSuscripcion,
      fechaVencimientoPlan: result.tenant.fechaVencimientoPlan,
      diasPruebaGratis: result.tenant.diasPruebaGratis,
      maxSucursales: result.tenant.maxSucursales,
      maxUsuarios: result.tenant.maxUsuarios,
      precioMensualPlan: Number(result.tenant.precioMensualPlan),
      createdAt: result.tenant.createdAt,
      admin: result.admin,
    };
  }

  /**
   * Activar/Desactivar un tenant.
   */
  async toggleTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${tenantId}" no encontrado.`);
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { active: !tenant.active },
    });

    // Si se desactiva el tenant, desactivar todos sus usuarios
    if (!updated.active) {
      await this.prisma.user.updateMany({
        where: { tenantId },
        data: { activo: false },
      });
      this.logger.warn(`Tenant "${tenant.name}" desactivado. Todos sus usuarios fueron desactivados.`);
    } else {
      // Si se reactiva el tenant, reactivar solo los admins
      await this.prisma.user.updateMany({
        where: { tenantId, rol: Rol.ROL_ADMIN },
        data: { activo: true },
      });
      this.logger.log(`Tenant "${tenant.name}" reactivado. Sus admins fueron reactivados.`);
    }

    return {
      id: updated.id,
      name: updated.name,
      active: updated.active,
    };
  }

  /**
   * Obtener detalles de un tenant específico con todos sus usuarios y pagos de suscripción.
   */
  async getTenantDetail(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            users: true,
            productModels: true,
            clients: true,
            orders: true,
            suppliers: true,
            saleNotes: true,
          },
        },
        users: {
          select: {
            id: true,
            email: true,
            nombre: true,
            rol: true,
            activo: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        businessConfig: {
          select: {
            nombre: true,
            ruc: true,
            direccion: true,
            telefono: true,
          },
        },
        subscriptionPayments: {
          orderBy: { createdAt: 'desc' },
          take: 12,
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${tenantId}" no encontrado.`);
    }

    const businessConfig = tenant.businessConfig
      ? {
          ...tenant.businessConfig,
          ruc: tenant.businessConfig.ruc ? this.encryption.decrypt(tenant.businessConfig.ruc) : '',
        }
      : null;

    const now = new Date();
    let diasRestantes = 0;
    if (tenant.fechaVencimientoPlan) {
      const diffMs = new Date(tenant.fechaVencimientoPlan).getTime() - now.getTime();
      diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    return {
      id: tenant.id,
      name: tenant.name,
      active: tenant.active,
      plan: tenant.plan,
      estadoSuscripcion: tenant.estadoSuscripcion,
      fechaVencimientoPlan: tenant.fechaVencimientoPlan,
      diasPruebaGratis: tenant.diasPruebaGratis,
      maxSucursales: tenant.maxSucursales,
      maxUsuarios: tenant.maxUsuarios,
      precioMensualPlan: Number(tenant.precioMensualPlan),
      diasRestantes,
      createdAt: tenant.createdAt,
      stats: {
        users: tenant._count.users,
        models: tenant._count.productModels,
        clients: tenant._count.clients,
        orders: tenant._count.orders,
        suppliers: tenant._count.suppliers,
        saleNotes: tenant._count.saleNotes,
      },
      users: tenant.users,
      businessConfig,
      subscriptionPayments: tenant.subscriptionPayments.map((p) => ({
        id: p.id,
        monto: Number(p.monto),
        periodoMeses: p.periodoMeses,
        metodoPago: p.metodoPago,
        plan: p.plan,
        fechaPago: p.fechaPago,
        fechaInicio: p.fechaInicio,
        fechaFin: p.fechaFin,
        numeroFacturaSri: p.numeroFacturaSri,
        facturaAutorizada: p.facturaAutorizada,
        notas: p.notas,
        createdAt: p.createdAt,
      })),
    };
  }

  /**
   * Actualizar nombre, configuración de negocio y plan de un tenant.
   */
  async updateTenant(
    tenantId: string,
    data: {
      name?: string;
      plan?: PlanTipo;
      estadoSuscripcion?: EstadoSuscripcion;
      fechaVencimientoPlan?: string | Date;
      diasPruebaGratis?: number;
      maxSucursales?: number;
      maxUsuarios?: number;
      precioMensualPlan?: number;
      businessConfig?: {
        nombre?: string;
        ruc?: string;
        direccion?: string;
        telefono?: string;
      };
    },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${tenantId}" no encontrado.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const tenantUpdates: any = {};
      if (data.name && data.name.trim()) tenantUpdates.name = data.name.trim();
      if (data.plan) {
        tenantUpdates.plan = data.plan;
        const defaults = PLAN_DEFAULTS[data.plan];
        if (data.maxSucursales === undefined) tenantUpdates.maxSucursales = defaults.maxSucursales;
        if (data.maxUsuarios === undefined) tenantUpdates.maxUsuarios = defaults.maxUsuarios;
        if (data.precioMensualPlan === undefined) tenantUpdates.precioMensualPlan = defaults.precioMensual;
      }
      if (data.estadoSuscripcion) tenantUpdates.estadoSuscripcion = data.estadoSuscripcion;
      if (data.fechaVencimientoPlan) tenantUpdates.fechaVencimientoPlan = new Date(data.fechaVencimientoPlan);
      if (data.diasPruebaGratis !== undefined) tenantUpdates.diasPruebaGratis = data.diasPruebaGratis;
      if (data.maxSucursales !== undefined) tenantUpdates.maxSucursales = data.maxSucursales;
      if (data.maxUsuarios !== undefined) tenantUpdates.maxUsuarios = data.maxUsuarios;
      if (data.precioMensualPlan !== undefined) tenantUpdates.precioMensualPlan = data.precioMensualPlan;

      if (Object.keys(tenantUpdates).length > 0) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: tenantUpdates,
        });
      }

      if (data.businessConfig) {
        const encryptedRuc = data.businessConfig.ruc ? this.encryption.encrypt(data.businessConfig.ruc) : undefined;
        const existingConfig = await tx.businessConfig.findFirst({ where: { tenantId } });
        if (existingConfig) {
          await tx.businessConfig.update({
            where: { id: existingConfig.id },
            data: {
              nombre: data.businessConfig.nombre || data.name || tenant.name,
              ruc: encryptedRuc ?? existingConfig.ruc,
              direccion: data.businessConfig.direccion ?? existingConfig.direccion,
              telefono: data.businessConfig.telefono ?? existingConfig.telefono,
            },
          });
        } else {
          await tx.businessConfig.create({
            data: {
              tenantId,
              nombre: data.businessConfig.nombre || data.name || tenant.name,
              ruc: encryptedRuc || this.encryption.encrypt('0000000000001'),
              direccion: data.businessConfig.direccion || 'Ecuador',
              telefono: data.businessConfig.telefono,
            },
          });
        }
      }
    });

    this.logger.log(`Tenant "${tenantId}" actualizado.`);
    return this.getTenantDetail(tenantId);
  }

  /**
   * Obtiene el estado de suscripción en tiempo real, etapa de gracia y opacidad visual.
   */
  async getSubscriptionStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        businessConfig: {
          select: { nombre: true, ruc: true },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${tenantId}" no encontrado.`);
    }

    const now = new Date();
    let fechaVencimiento = tenant.fechaVencimientoPlan;

    if (!fechaVencimiento) {
      // Fallback: calcular basado en createdAt + diasPruebaGratis
      fechaVencimiento = new Date(tenant.createdAt);
      fechaVencimiento.setDate(fechaVencimiento.getDate() + (tenant.diasPruebaGratis || 15));
    }

    const diffMs = new Date(fechaVencimiento).getTime() - now.getTime();
    const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const diasVencido = diasRestantes < 0 ? Math.abs(diasRestantes) : 0;

    let stage: 'OK' | 'RENOVACION_PROXIMA' | 'GRACIA_1' | 'GRACIA_2' | 'BLOQUEADO' = 'OK';
    let opacidad = 1.0;
    let bloqueado = false;
    let mensaje = 'Suscripción activa y al día.';

    if (tenant.estadoSuscripcion === EstadoSuscripcion.SUSPENDIDA || !tenant.active) {
      stage = 'BLOQUEADO';
      opacidad = 0.0;
      bloqueado = true;
      mensaje = 'El acceso a tu espacio ha sido suspendido por administración.';
    } else if (diasRestantes > 3) {
      stage = 'OK';
      opacidad = 1.0;
      bloqueado = false;
      mensaje = `Suscripción activa (${diasRestantes} días restantes).`;
    } else if (diasRestantes >= 0 && diasRestantes <= 3) {
      stage = 'RENOVACION_PROXIMA';
      opacidad = 1.0;
      bloqueado = false;
      mensaje = `Tu plan vence ${diasRestantes === 0 ? 'hoy' : `en ${diasRestantes} día(s)`}. Renuévalo para mantener el servicio continuo.`;
    } else {
      // Días vencidos (Período de gracia y decaimiento visual progresivo)
      if (diasVencido <= 2) {
        stage = 'GRACIA_1';
        opacidad = 0.95;
        bloqueado = false;
        mensaje = `Período de Gracia (Día ${diasVencido}/5). Por favor reporta tu comprobante de pago para mantener activo el sistema.`;
      } else if (diasVencido >= 3 && diasVencido <= 4) {
        stage = 'GRACIA_2';
        opacidad = 0.60;
        bloqueado = false;
        mensaje = `Aviso Crítico: Plan vencido hace ${diasVencido} días. El bloqueo total del sistema ocurrirá en ${5 - diasVencido} día(s).`;
      } else {
        // Día 5 o superior
        stage = 'BLOQUEADO';
        opacidad = 0.0;
        bloqueado = true;
        mensaje = 'Acceso bloqueado por mensualidad pendiente. Registra tu transferencia para reanudar el servicio inmediatamente.';
      }
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      plan: tenant.plan,
      estadoSuscripcion: tenant.estadoSuscripcion,
      fechaVencimientoPlan: fechaVencimiento,
      diasRestantes,
      diasVencido,
      stage,
      opacidad,
      bloqueado,
      mensaje,
      maxSucursales: tenant.maxSucursales,
      maxUsuarios: tenant.maxUsuarios,
      precioMensualPlan: Number(tenant.precioMensualPlan),
      superAdminWhatsapp: '593994781205',
      bancoInfo: {
        banco: 'Banco Pichincha',
        tipoCuenta: 'Cuenta de Ahorros / Corriente',
        numeroCuenta: '2208459102',
        titular: 'NEXORA Software - Christopher Paucar',
        ruc: '1805123456001',
        email: 'pagos@nexora.ec',
      },
    };
  }

  /**
   * Registrar un pago de suscripción para un tenant y extender su vigencia.
   */
  async registerSubscriptionPayment(
    tenantId: string,
    data: {
      monto: number;
      periodoMeses: number;
      metodoPago?: string;
      plan?: PlanTipo;
      numeroFacturaSri?: string;
      facturaAutorizada?: boolean;
      comprobanteUrl?: string;
      notas?: string;
    },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${tenantId}" no encontrado.`);
    }

    const meses = Number(data.periodoMeses) || 1;
    const monto = (data.monto !== undefined && data.monto !== null && !isNaN(Number(data.monto))) ? Number(data.monto) : (Number(tenant.precioMensualPlan) * meses);
    const plan = data.plan || tenant.plan;

    // Calcular fechas del período contratado
    const now = new Date();
    let fechaInicio = now;

    // Si la fecha de vencimiento actual aún está en el futuro, extender desde esa fecha
    if (tenant.fechaVencimientoPlan && new Date(tenant.fechaVencimientoPlan) > now) {
      fechaInicio = new Date(tenant.fechaVencimientoPlan);
    }

    const fechaFin = new Date(fechaInicio);
    fechaFin.setMonth(fechaFin.getMonth() + meses);

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.create({
        data: {
          tenantId,
          monto,
          periodoMeses: meses,
          metodoPago: data.metodoPago || 'TRANSFERENCIA',
          plan,
          fechaPago: now,
          fechaInicio,
          fechaFin,
          numeroFacturaSri: data.numeroFacturaSri,
          facturaAutorizada: data.facturaAutorizada ?? false,
          comprobanteUrl: data.comprobanteUrl,
          notas: data.notas,
        },
      });

      const updatedTenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          plan,
          estadoSuscripcion: EstadoSuscripcion.ACTIVA,
          fechaVencimientoPlan: fechaFin,
          active: true,
        },
      });

      return { payment, updatedTenant };
    });

    this.logger.log(
      `Pago de suscripción registrado para Tenant "${tenant.name}": $${monto} por ${meses} mes(es). Nueva vigencia hasta ${fechaFin.toISOString().split('T')[0]}`,
    );

    return {
      payment: {
        id: result.payment.id,
        monto: Number(result.payment.monto),
        periodoMeses: result.payment.periodoMeses,
        metodoPago: result.payment.metodoPago,
        plan: result.payment.plan,
        fechaInicio: result.payment.fechaInicio,
        fechaFin: result.payment.fechaFin,
        numeroFacturaSri: result.payment.numeroFacturaSri,
        facturaAutorizada: result.payment.facturaAutorizada,
      },
      tenant: {
        id: result.updatedTenant.id,
        name: result.updatedTenant.name,
        plan: result.updatedTenant.plan,
        estadoSuscripcion: result.updatedTenant.estadoSuscripcion,
        fechaVencimientoPlan: result.updatedTenant.fechaVencimientoPlan,
      },
    };
  }

  /**
   * Listar historial de pagos de suscripción de un tenant.
   */
  async listSubscriptionPayments(tenantId: string) {
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => ({
      id: p.id,
      tenantId: p.tenantId,
      monto: Number(p.monto),
      periodoMeses: p.periodoMeses,
      metodoPago: p.metodoPago,
      plan: p.plan,
      fechaPago: p.fechaPago,
      fechaInicio: p.fechaInicio,
      fechaFin: p.fechaFin,
      numeroFacturaSri: p.numeroFacturaSri,
      facturaAutorizada: p.facturaAutorizada,
      comprobanteUrl: p.comprobanteUrl,
      notas: p.notas,
      createdAt: p.createdAt,
    }));
  }

  /**
   * Eliminar un tenant y todos sus datos en cascada.
   */
  async deleteTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${tenantId}" no encontrado.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { tenantId } });
      await tx.businessConfig.deleteMany({ where: { tenantId } });
      await tx.productModel.deleteMany({ where: { tenantId } });
      await tx.client.deleteMany({ where: { tenantId } });
      await tx.order.deleteMany({ where: { tenantId } });
      await tx.supplier.deleteMany({ where: { tenantId } });
      await tx.season.deleteMany({ where: { tenantId } });
      await tx.saleNote.deleteMany({ where: { tenantId } });
      await tx.cobro.deleteMany({ where: { tenantId } });
      await tx.deudaProveedor.deleteMany({ where: { tenantId } });
      await tx.clienteDevolucion.deleteMany({ where: { tenantId } });
      await tx.proveedorDevolucion.deleteMany({ where: { tenantId } });
      await tx.facturaElectronica.deleteMany({ where: { tenantId } });
      await tx.cierreCaja.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.subscriptionPayment.deleteMany({ where: { tenantId } });
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    this.logger.warn(`Tenant "${tenant.name}" (${tenantId}) eliminado por Super Admin.`);
    return { message: `Tenant "${tenant.name}" eliminado correctamente.` };
  }

  /**
   * Crear un nuevo usuario en un tenant específico.
   */
  async createUserForTenant(
    tenantId: string,
    data: {
      email: string;
      nombre: string;
      password: string;
      rol?: Rol;
    },
  ) {
    // Validar formato del correo
    const cleanEmail = (data.email || '').trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail) || (cleanEmail.match(/@/g) || []).length !== 1) {
      throw new BadRequestException('El correo debe ser un email válido y contener exactamente un arroba (@).');
    }
    data.email = cleanEmail;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado.');

    const emailExists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (emailExists) throw new ConflictException(`El correo "${data.email}" ya está registrado.`);

    const passwordHash = await bcrypt.hash(data.password, this.BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        nombre: data.nombre,
        rol: data.rol || Rol.ROL_ADMIN,
        passwordHash,
        tenantId,
        activo: true,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
        createdAt: true,
      },
    });

    this.logger.log(`Usuario "${user.email}" creado para Tenant "${tenant.name}".`);
    return user;
  }

  /**
   * Editar usuario existente.
   */
  async updateUserForTenant(
    userId: string,
    data: {
      nombre?: string;
      email?: string;
      rol?: Rol;
      activo?: boolean;
      password?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');

    if (data.email && data.email !== user.email) {
      const emailExists = await this.prisma.user.findUnique({ where: { email: data.email } });
      if (emailExists) throw new ConflictException(`El correo "${data.email}" ya está registrado.`);
    }

    const updateData: any = {};
    if (data.nombre !== undefined) updateData.nombre = data.nombre;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.rol !== undefined) updateData.rol = data.rol;
    if (data.activo !== undefined) updateData.activo = data.activo;
    if (data.password && data.password.trim()) {
      updateData.passwordHash = await bcrypt.hash(data.password.trim(), this.BCRYPT_ROUNDS);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
        createdAt: true,
      },
    });

    this.logger.log(`Usuario "${userId}" actualizado por Super Admin.`);
    return updated;
  }

  /**
   * Eliminar un usuario.
   */
  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');

    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.warn(`Usuario "${user.email}" (${userId}) eliminado por Super Admin.`);
    return { message: `Usuario "${user.nombre}" eliminado correctamente.` };
  }

  /**
   * Listar todos los usuarios con rol Super Admin.
   */
  async listSuperAdmins() {
    return this.prisma.user.findMany({
      where: { rol: Rol.ROL_SUPER_ADMIN },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true,
        intentosFallidos: true,
        bloqueadoHasta: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Crear un nuevo Super Admin.
   */
  async createSuperAdmin(data: { nombre: string; email: string; password: string }) {
    const cleanEmail = (data.email || '').trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      throw new BadRequestException('El correo debe ser un email válido.');
    }
    if (!data.password || data.password.trim().length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
    }
    if (!data.nombre || !data.nombre.trim()) {
      throw new BadRequestException('El nombre del Super Administrador es obligatorio.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      throw new ConflictException(`El correo "${cleanEmail}" ya está registrado.`);
    }

    const passwordHash = await bcrypt.hash(data.password.trim(), this.BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: cleanEmail,
        nombre: data.nombre.trim(),
        rol: Rol.ROL_SUPER_ADMIN,
        passwordHash,
        activo: true,
        tenantId: null,
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true,
      },
    });

    this.logger.log(`Nuevo Super Admin creado: "${user.email}" (${user.id})`);
    return user;
  }

  /**
   * Actualizar un Super Admin existente.
   */
  async updateSuperAdmin(id: string, data: { nombre?: string; email?: string; password?: string; activo?: boolean }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.rol !== Rol.ROL_SUPER_ADMIN) {
      throw new NotFoundException('Super Administrador no encontrado.');
    }

    if (data.email && data.email.trim().toLowerCase() !== user.email) {
      const cleanEmail = data.email.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({ where: { email: cleanEmail } });
      if (existing) {
        throw new ConflictException(`El correo "${cleanEmail}" ya está registrado.`);
      }
    }

    const updateData: any = {};
    if (data.nombre !== undefined) updateData.nombre = data.nombre.trim();
    if (data.email !== undefined) updateData.email = data.email.trim().toLowerCase();
    if (data.activo !== undefined) updateData.activo = data.activo;
    if (data.password && data.password.trim()) {
      if (data.password.trim().length < 6) {
        throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
      }
      updateData.passwordHash = await bcrypt.hash(data.password.trim(), this.BCRYPT_ROUNDS);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true,
      },
    });

    this.logger.log(`Super Admin "${user.id}" actualizado.`);
    return updated;
  }

  /**
   * Eliminar un Super Admin con protecciones de seguridad.
   */
  async deleteSuperAdmin(id: string, requesterUserId: string) {
    if (id === requesterUserId) {
      throw new BadRequestException('No puedes eliminar tu propia cuenta de Super Administrador en sesión activa.');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.rol !== Rol.ROL_SUPER_ADMIN) {
      throw new NotFoundException('Super Administrador no encontrado.');
    }

    const totalSuperAdmins = await this.prisma.user.count({
      where: { rol: Rol.ROL_SUPER_ADMIN },
    });
    if (totalSuperAdmins <= 1) {
      throw new BadRequestException('No se puede eliminar el único Super Administrador del sistema.');
    }

    await this.prisma.user.delete({ where: { id } });
    this.logger.warn(`Super Admin "${user.email}" (${id}) eliminado por "${requesterUserId}".`);
    return { message: `Super Administrador "${user.nombre}" eliminado correctamente.` };
  }

  /**
   * Obtener reporte global de ingresos, pagos y métricas de suscripciones para Super Admin.
   */
  async getGlobalSubscriptionReport() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [payments, tenants] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              plan: true,
              estadoSuscripcion: true,
              active: true,
              fechaVencimientoPlan: true,
            },
          },
        },
        orderBy: { fechaPago: 'desc' },
      }),
      this.prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          active: true,
          plan: true,
          estadoSuscripcion: true,
          fechaVencimientoPlan: true,
          precioMensualPlan: true,
          diasPruebaGratis: true,
          createdAt: true,
          _count: {
            select: {
              users: true,
              orders: true,
              clients: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    let totalRecaudado = 0;
    let ingresosMesActual = 0;
    const recaudacionPorPlan: Record<string, number> = {
      PLAN_BASICO: 0,
      PLAN_COMERCIAL: 0,
      PLAN_MAYORISTA: 0,
    };
    const recaudacionPorMetodo: Record<string, number> = {};

    const formattedPayments = payments.map((p) => {
      const montoNum = Number(p.monto) || 0;
      totalRecaudado += montoNum;

      if (p.fechaPago && new Date(p.fechaPago) >= startOfMonth) {
        ingresosMesActual += montoNum;
      }

      if (p.plan) {
        recaudacionPorPlan[p.plan] = (recaudacionPorPlan[p.plan] || 0) + montoNum;
      }

      const metodo = p.metodoPago || 'TRANSFERENCIA';
      recaudacionPorMetodo[metodo] = (recaudacionPorMetodo[metodo] || 0) + montoNum;

      return {
        id: p.id,
        tenantId: p.tenantId,
        tenantName: p.tenant?.name || 'Local',
        tenantPlan: p.tenant?.plan || p.plan,
        monto: montoNum,
        periodoMeses: p.periodoMeses,
        metodoPago: p.metodoPago,
        plan: p.plan,
        fechaPago: p.fechaPago,
        fechaInicio: p.fechaInicio,
        fechaFin: p.fechaFin,
        numeroFacturaSri: p.numeroFacturaSri,
        facturaAutorizada: p.facturaAutorizada,
        notas: p.notas,
      };
    });

    let mrrProyectado = 0;
    let localesAlDia = 0;
    let localesPorVencer = 0;
    let localesVencidos = 0;
    let localesEnPrueba = 0;

    const localesStatus = tenants.map((t) => {
      let diasRestantes = 0;
      if (t.fechaVencimientoPlan) {
        const diffMs = new Date(t.fechaVencimientoPlan).getTime() - now.getTime();
        diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      }

      const precioPlan = Number(t.precioMensualPlan) || 0;
      if (t.active) {
        mrrProyectado += precioPlan;
      }

      let estadoCalculado = 'AL_DIA';
      if (t.estadoSuscripcion === EstadoSuscripcion.EN_PRUEBA) {
        localesEnPrueba++;
        estadoCalculado = 'EN_PRUEBA';
      } else if (diasRestantes < 0) {
        localesVencidos++;
        estadoCalculado = 'VENCIDO';
      } else if (diasRestantes <= 7) {
        localesPorVencer++;
        estadoCalculado = 'POR_VENCER';
      } else {
        localesAlDia++;
        estadoCalculado = 'AL_DIA';
      }

      return {
        id: t.id,
        name: t.name,
        active: t.active,
        plan: t.plan,
        precioMensualPlan: precioPlan,
        estadoSuscripcion: t.estadoSuscripcion,
        estadoCalculado,
        fechaVencimientoPlan: t.fechaVencimientoPlan,
        diasRestantes,
        totalUsuarios: t._count.users,
        totalPedidos: t._count.orders,
        totalClientes: t._count.clients,
      };
    });

    return {
      kpis: {
        totalRecaudado,
        ingresosMesActual,
        mrrProyectado,
        totalLocales: tenants.length,
        localesAlDia,
        localesPorVencer,
        localesVencidos,
        localesEnPrueba,
      },
      recaudacionPorPlan,
      recaudacionPorMetodo,
      pagos: formattedPayments,
      locales: localesStatus,
    };
  }
}
