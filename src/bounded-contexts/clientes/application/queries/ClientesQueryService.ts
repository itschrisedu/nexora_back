import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../../shared/infrastructure/encryption/encryption.service';
import { NivelCredito as PrismaNivelCredito } from '@prisma/client';

@Injectable()
export class ClientesQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async obtenerCliente(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new NotFoundException(`Cliente con ID "${id}" no encontrado`);
    }

    return this.formatCliente(client);
  }

  async buscarClientes(
    filtros: { q?: string; nivelCredito?: PrismaNivelCredito; activo?: boolean },
    tenantId?: string | null,
  ) {
    const where: any = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (filtros.q) {
      where.OR = [
        { nombre: { contains: filtros.q, mode: 'insensitive' } },
        { apellido: { contains: filtros.q, mode: 'insensitive' } },
        { telefono: { contains: filtros.q, mode: 'insensitive' } },
      ];
    }

    if (filtros.nivelCredito) {
      where.nivelCredito = filtros.nivelCredito;
    }

    if (filtros.activo !== undefined) {
      where.activo = filtros.activo;
    }

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });

    return clients.map((c) => this.formatCliente(c));
  }

  async obtenerHistorialCambiosNivel(clienteId: string) {
    const history = await this.prisma.creditScoreHistory.findMany({
      where: { clientId: clienteId },
      orderBy: { createdAt: 'desc' },
    });

    return history;
  }

  async validarCapacidadCrediticia(clienteId: string, montoSolicitado: number) {
    const client = await this.prisma.client.findUnique({
      where: { id: clienteId },
    });

    if (!client) {
      throw new NotFoundException(`Cliente con ID "${clienteId}" no encontrado`);
    }

    const limiteTotal = Number(client.limiteCredito);
    const creditoUtilizado = Number(client.creditoUtilizado);
    const limiteDisponible = Math.max(0, limiteTotal - creditoUtilizado);

    // Obtener configuración del nivel del cliente
    const configNivel = await this.prisma.creditLevelConfig.findUnique({
      where: { nivel: client.nivelCredito },
    });

    const plazoDias = configNivel ? configNivel.plazoDias : 0;

    // Lógica de rechazos
    if (client.nivelCredito === PrismaNivelCredito.SIN_CREDITO || limiteTotal <= 0) {
      return {
        aprobado: false,
        nivelActual: client.nivelCredito,
        limiteTotal,
        creditoUtilizado,
        limiteDisponible,
        plazoDias,
        razon: 'El cliente está en Nivel 1 (Sin Crédito). Requiere compras de contado o asignación de nivel por el Administrador.',
      };
    }

    if (montoSolicitado > limiteDisponible) {
      return {
        aprobado: false,
        nivelActual: client.nivelCredito,
        limiteTotal,
        creditoUtilizado,
        limiteDisponible,
        plazoDias,
        razon: `Monto supera límite disponible ($${limiteDisponible.toFixed(2)})`,
      };
    }

    return {
      aprobado: true,
      nivelActual: client.nivelCredito,
      limiteTotal,
      creditoUtilizado,
      limiteDisponible,
      plazoDias,
    };
  }

  // ── Mapeador interno para descifrado ─────────

  private formatCliente(record: any) {
    let rucDescifrado: string | null = null;
    let cedulaDescifrada: string | null = null;

    try {
      if (record.ruc) {
        rucDescifrado = this.encryptionService.decrypt(record.ruc);
      }
    } catch (e) {
      rucDescifrado = '[ERROR_DESCIFRADO_RUC]';
    }

    try {
      if (record.cedula) {
        cedulaDescifrada = this.encryptionService.decrypt(record.cedula);
      }
    } catch (e) {
      cedulaDescifrada = '[ERROR_DESCIFRADO_CEDULA]';
    }

    return {
      id: record.id,
      nombre: record.nombre,
      apellido: record.apellido,
      telefono: record.telefono,
      email: record.email,
      ruc: rucDescifrado,
      cedula: cedulaDescifrada,
      direccion: record.direccion,
      notas: record.notas,
      nivelCredito: record.nivelCredito,
      totalCompras: record.totalCompras,
      comprasSinAtraso: record.comprasSinAtraso,
      atrasoConsecutivo: record.atrasoConsecutivo,
      limiteCredito: Number(record.limiteCredito),
      creditoUtilizado: Number(record.creditoUtilizado),
      creditoDisponible: Math.max(0, Number(record.limiteCredito) - Number(record.creditoUtilizado)),
      activo: record.activo,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
