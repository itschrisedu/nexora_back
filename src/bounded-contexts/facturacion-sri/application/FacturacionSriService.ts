import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { EncryptionService } from '../../../shared/infrastructure/encryption/encryption.service';
import { firstValueFrom } from 'rxjs';

/**
 * FacturacionSriService — Conector HTTP entre Nexora y el microservicio
 * local api-facturacion-electronica-sri.
 *
 * Responsabilidades:
 * 1. Obtener la configuración SRI del tenant (firma .p12, ambiente, establecimiento)
 * 2. Armar el DTO de factura con datos del emisor + comprador + detalles
 * 3. Enviar al microservicio SRI local vía HTTP POST
 * 4. Registrar el resultado (claveAcceso, estado, XML, RIDE PDF) en FacturaElectronica
 */
@Injectable()
export class FacturacionSriService {
  private readonly logger = new Logger(FacturacionSriService.name);
  private readonly sriBaseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly configService: ConfigService,
  ) {
    // URL base del microservicio SRI local (ej: http://localhost:4000)
    this.sriBaseUrl = this.configService.get<string>(
      'SRI_MICROSERVICE_URL',
      'http://localhost:4000',
    );
  }

  // ══════════════════════════════════════════
  // EMITIR FACTURA ELECTRÓNICA
  // ══════════════════════════════════════════

  async emitirFactura(tenantId: string, datosVenta: EmitirFacturaInput) {
    // 1. Obtener configuración del negocio (firma, RUC, ambiente)
    const config = await this.obtenerConfigSri(tenantId);

    let identificacionLimpia = datosVenta.comprador.identificacion;
    if (identificacionLimpia && (identificacionLimpia.includes(':') || identificacionLimpia.length > 20)) {
      try {
        identificacionLimpia = this.encryption.decrypt(identificacionLimpia);
      } catch {}
    }

    // 2. Armar el DTO para el microservicio SRI
    const facturaDto = {
      ambiente: config.sriAmbiente === '2' ? '2' : '1', // 1=Pruebas, 2=Producción
      fechaEmision: this.formatearFecha(datosVenta.fecha),
      emisor: {
        ruc: config.rucDescifrado,
        razonSocial: config.nombre,
        nombreComercial: config.nombre,
        dirMatriz: config.direccion,
        dirEstablecimiento: config.direccion,
        establecimiento: config.sriEstablecimiento,
        puntoEmision: config.sriPuntoEmision,
        obligadoContabilidad: config.sriObligadoContabilidad ? 'SI' : 'NO',
      },
      comprador: {
        tipoIdentificacion: datosVenta.comprador.tipoIdentificacion,
        identificacion: identificacionLimpia,
        razonSocial: datosVenta.comprador.razonSocial,
        direccion: datosVenta.comprador.direccion || '',
        email: datosVenta.comprador.email || '',
      },
      detalles: datosVenta.detalles.map((d) => ({
        codigoPrincipal: d.codigoProducto,
        descripcion: d.descripcion,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario,
        descuento: d.descuento || 0,
        impuestos: [
          {
            codigo: '2', // IVA
            codigoPorcentaje: d.codigoIva || '0', // 0=0%, 2=12%, 4=15%
            tarifa: d.tarifaIva || 0,
            baseImponible: d.cantidad * d.precioUnitario - (d.descuento || 0),
            valor:
              ((d.cantidad * d.precioUnitario - (d.descuento || 0)) *
                (d.tarifaIva || 0)) /
              100,
          },
        ],
      })),
      pagos: [
        {
          formaPago: datosVenta.formaPago || '01', // 01=Efectivo
          total: datosVenta.totalConImpuestos,
        },
      ],
      infoAdicional: [
        { nombre: 'Email', valor: datosVenta.comprador.email || 'N/A' },
        { nombre: 'Teléfono', valor: datosVenta.comprador.telefono || 'N/A' },
      ],
    };

    // 3. Generar número de comprobante secuencial
    const secuencial = await this.obtenerSiguienteSecuencial(tenantId, config);
    const numeroComprobante = `${config.sriEstablecimiento}-${config.sriPuntoEmision}-${secuencial}`;

    // 4. Registrar factura en estado PENDIENTE
    const factura = await this.prisma.facturaElectronica.create({
      data: {
        tenantId,
        saleNoteId: datosVenta.saleNoteId || null,
        numeroComprobante,
        estadoSri: 'PENDIENTE',
      },
    });

    // 5. Enviar al microservicio SRI
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.sriBaseUrl}/sri/emitir/factura`, facturaDto),
      );

      const resultado = response.data;

      // 6. Actualizar factura con resultado del SRI
      const updated = await this.prisma.facturaElectronica.update({
        where: { id: factura.id },
        data: {
          claveAcceso: resultado.claveAcceso || null,
          estadoSri: resultado.success ? 'AUTORIZADO' : 'RECHAZADO',
          xmlUrl: resultado.xmlAutorizado || null,
          errorMensaje: resultado.success
            ? null
            : JSON.stringify(resultado.mensajes || []),
        },
      });

      this.logger.log(
        `Factura ${numeroComprobante} — Estado: ${updated.estadoSri} — Clave: ${updated.claveAcceso || 'N/A'}`,
      );

      return updated;
    } catch (error: any) {
      // Registrar el error en la factura
      await this.prisma.facturaElectronica.update({
        where: { id: factura.id },
        data: {
          estadoSri: 'RECHAZADO',
          errorMensaje: error.response?.data?.message || error.message,
        },
      });

      this.logger.error(
        `Error al emitir factura ${numeroComprobante}: ${error.message}`,
      );

      throw new InternalServerErrorException(
        `Error al comunicarse con el servicio SRI: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  // ══════════════════════════════════════════
  // CONSULTAR ESTADO DE FACTURA
  // ══════════════════════════════════════════

  async consultarEstado(tenantId: string, facturaId: string) {
    const factura = await this.prisma.facturaElectronica.findFirst({
      where: { id: facturaId, tenantId },
    });

    if (!factura) {
      throw new BadRequestException('Factura electrónica no encontrada');
    }

    // Si ya está autorizada, devolver directamente
    if (factura.estadoSri === 'AUTORIZADO') {
      return factura;
    }

    // Si tiene clave de acceso, consultar al SRI
    if (factura.claveAcceso) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(
            `${this.sriBaseUrl}/sri/comprobante/${factura.claveAcceso}`,
          ),
        );

        if (response.data?.estado === 'AUTORIZADO') {
          return this.prisma.facturaElectronica.update({
            where: { id: factura.id },
            data: { estadoSri: 'AUTORIZADO' },
          });
        }
      } catch {
        this.logger.warn(
          `No se pudo consultar estado SRI para clave ${factura.claveAcceso}`,
        );
      }
    }

    return factura;
  }

  // ══════════════════════════════════════════
  // LISTAR FACTURAS ELECTRÓNICAS DEL TENANT
  // ══════════════════════════════════════════

  async listarFacturas(tenantId: string) {
    return this.prisma.facturaElectronica.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ══════════════════════════════════════════
  // MÉTODOS PRIVADOS
  // ══════════════════════════════════════════

  /**
   * Obtiene y valida la configuración SRI del tenant
   */
  private async obtenerConfigSri(tenantId: string) {
    const config = await this.prisma.businessConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      throw new BadRequestException(
        'Configuración del negocio no encontrada. Configure el RUC y datos del emisor primero.',
      );
    }

    if (!config.firmaP12Path) {
      throw new BadRequestException(
        'Certificado de firma electrónica (.p12) no configurado. Suba su archivo .p12 en Configuración > Facturación SRI.',
      );
    }

    return {
      ...config,
      rucDescifrado: this.encryption.decrypt(config.ruc),
    };
  }

  /**
   * Genera el siguiente secuencial (000000001 - 999999999)
   */
  private async obtenerSiguienteSecuencial(
    tenantId: string,
    config: { sriEstablecimiento: string; sriPuntoEmision: string },
  ): Promise<string> {
    const prefijo = `${config.sriEstablecimiento}-${config.sriPuntoEmision}-`;

    const ultima = await this.prisma.facturaElectronica.findFirst({
      where: {
        tenantId,
        numeroComprobante: { startsWith: prefijo },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!ultima) return '000000001';

    const partes = ultima.numeroComprobante.split('-');
    const ultimoNum = parseInt(partes[2], 10) || 0;
    return String(ultimoNum + 1).padStart(9, '0');
  }

  /**
   * Formatea Date a dd/mm/yyyy (formato requerido por SRI)
   */
  private formatearFecha(fecha: Date | string): string {
    const d = new Date(fecha);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const anio = d.getFullYear();
    return `${dia}/${mes}/${anio}`;
  }
}

// ══════════════════════════════════════════
// INTERFACES DE ENTRADA
// ══════════════════════════════════════════

export interface EmitirFacturaInput {
  saleNoteId?: string;
  fecha: Date | string;
  comprador: {
    tipoIdentificacion: string; // '04'=RUC, '05'=Cédula, '06'=Pasaporte, '07'=Consumidor Final
    identificacion: string;
    razonSocial: string;
    direccion?: string;
    email?: string;
    telefono?: string;
  };
  detalles: {
    codigoProducto: string;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuento?: number;
    codigoIva?: string;
    tarifaIva?: number;
  }[];
  formaPago?: string; // '01'=Efectivo, '16'=Tarjeta Débito, '19'=Tarjeta Crédito, '20'=Transferencia
  totalConImpuestos: number;
}
