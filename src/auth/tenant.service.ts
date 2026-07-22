import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { Rol } from '@prisma/client';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Listar todos los tenants con estadísticas básicas.
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

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
      createdAt: t.createdAt,
      stats: {
        users: t._count.users,
        models: t._count.productModels,
        clients: t._count.clients,
        orders: t._count.orders,
      },
      admins: t.users,
    }));
  }

  /**
   * Crear un nuevo tenant con un admin inicial.
   */
  async createTenant(data: {
    name: string;
    adminEmail: string;
    adminNombre: string;
    adminPassword: string;
  }) {
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

    const passwordHash = await bcrypt.hash(data.adminPassword, this.BCRYPT_ROUNDS);

    // Crear tenant + admin + businessConfig en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          active: true,
        },
      });

      const admin = await tx.user.create({
        data: {
          email: data.adminEmail,
          nombre: data.adminNombre,
          rol: Rol.ROL_ADMIN,
          passwordHash,
          activo: true,
          tenantId: tenant.id,
        },
        select: {
          id: true,
          email: true,
          nombre: true,
          rol: true,
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

    this.logger.log(`Tenant "${data.name}" creado con admin ${data.adminEmail}`);

    return {
      id: result.tenant.id,
      name: result.tenant.name,
      active: result.tenant.active,
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
   * Obtener detalles de un tenant específico con todos sus usuarios.
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
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${tenantId}" no encontrado.`);
    }

    return {
      id: tenant.id,
      name: tenant.name,
      active: tenant.active,
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
      businessConfig: tenant.businessConfig,
    };
  }
}
