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
import * as fs from 'fs';
import * as path from 'path';

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
    // URL base del microservicio SRI (limpia barras finales y asegura protocolo)
    const rawUrl = this.configService.get<string>(
      'SRI_MICROSERVICE_URL',
      'http://localhost:4000',
    );
    let url = (rawUrl || 'http://localhost:4000').trim().replace(/\/+$/, '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    this.sriBaseUrl = url;
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
        razonSocial: (config as any).sriRazonSocial?.trim() || config.nombre,
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

    // Obtener firma P12 en Base64 para enviarla al microservicio
    let firmaData: { archivoBase64: string; password?: string } | undefined;
    if (config.firmaP12Path) {
      let p12Buffer: Buffer | null = null;
      if (
        config.firmaP12Path.startsWith('data:') ||
        config.firmaP12Path.startsWith('base64:') ||
        config.firmaP12Path.length > 500
      ) {
        // Viene persistido en Base64 directamente en la base de datos
        const base64Str = config.firmaP12Path.includes(',')
          ? config.firmaP12Path.split(',')[1]
          : config.firmaP12Path.replace(/^base64:/, '');
        try {
          p12Buffer = Buffer.from(base64Str, 'base64');
        } catch (err: any) {
          this.logger.error(`Error parseando buffer de firma Base64: ${err.message}`);
        }
      } else {
        // Viene como ruta en disco
        let resolvedPath = config.firmaP12Path;
        if (!path.isAbsolute(resolvedPath)) {
          resolvedPath = path.resolve(process.cwd(), resolvedPath);
        }
        if (fs.existsSync(resolvedPath)) {
          p12Buffer = fs.readFileSync(resolvedPath);
        } else {
          this.logger.warn(`Archivo de firma P12 no encontrado en ruta de disco: ${resolvedPath}`);
        }
      }

      if (p12Buffer) {
        let passwordDescifrada = '';
        if (config.firmaPasswordEnc) {
          try {
            passwordDescifrada = this.encryption.decrypt(config.firmaPasswordEnc);
          } catch {}
        }
        firmaData = {
          archivoBase64: p12Buffer.toString('base64'),
          password: passwordDescifrada,
        };
      }
    }

    if (!firmaData) {
      throw new BadRequestException(
        'El archivo de firma electrónica (.p12) no está disponible en el servidor. Por favor, suba nuevamente su archivo .p12 y contraseña en el menú Configuración -> Facturación SRI.',
      );
    }

    (facturaDto as any).secuencial = secuencial;
    (facturaDto as any).firma = firmaData;

    // 4. Registrar o actualizar factura en estado PENDIENTE (soporte de reintentos)
    let factura = datosVenta.saleNoteId
      ? await this.prisma.facturaElectronica.findUnique({
          where: { saleNoteId: datosVenta.saleNoteId },
        })
      : null;

    if (factura) {
      if (factura.estadoSri === 'AUTORIZADO') {
        throw new BadRequestException(
          `Esta nota de venta ya cuenta con la factura autorizada ${factura.numeroComprobante}`,
        );
      }
      factura = await this.prisma.facturaElectronica.update({
        where: { id: factura.id },
        data: {
          numeroComprobante,
          estadoSri: 'PENDIENTE',
          errorMensaje: null,
        },
      });
    } else {
      factura = await this.prisma.facturaElectronica.create({
        data: {
          tenantId,
          saleNoteId: datosVenta.saleNoteId || null,
          numeroComprobante,
          estadoSri: 'PENDIENTE',
        },
      });
    }

    // 5. Enviar al microservicio SRI
    try {
      this.logger.log(
        `Enviando factura ${numeroComprobante} a ${this.sriBaseUrl}/sri/emitir/factura (firma adjunta: ${!!firmaData})`,
      );
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
      const detalleError =
        error.response?.data?.error ||
        error.response?.data?.message ||
        (typeof error.response?.data === 'string' ? error.response.data : null) ||
        error.message;

      // Registrar el error en la factura
      await this.prisma.facturaElectronica.update({
        where: { id: factura.id },
        data: {
          estadoSri: 'RECHAZADO',
          errorMensaje: detalleError,
        },
      });

      this.logger.error(
        `Error al emitir factura ${numeroComprobante}: ${detalleError}`,
      );

      throw new InternalServerErrorException(
        `Error al comunicarse con el servicio SRI: ${detalleError}`,
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
   * Formatea Date a dd/mm/yyyy en zona horaria Ecuador (UTC-5), formato requerido por SRI
   */
  private formatearFecha(fecha: Date | string): string {
    const d = new Date(fecha);
    // Forzar zona horaria Ecuador (America/Guayaquil = UTC-5)
    const ecuadorStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' }); // yyyy-mm-dd
    const [anio, mes, dia] = ecuadorStr.split('-');
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
