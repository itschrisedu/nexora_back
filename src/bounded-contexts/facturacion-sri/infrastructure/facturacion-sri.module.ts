import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FacturacionSriService } from '../application/FacturacionSriService';
import { FacturacionSriController } from './facturacion-sri.controller';

/**
 * FacturacionSriModule — Bounded Context de Facturación Electrónica SRI.
 *
 * Este módulo actúa como puente entre Nexora y el microservicio local
 * api-facturacion-electronica-sri que se encarga de:
 *   - Firmar XML con XAdES-BES (.p12)
 *   - Enviar al SRI vía SOAP (cel.sri.gob.ec)
 *   - Generar PDF RIDE del comprobante
 *
 * HttpModule se configura con timeout de 30s ya que la comunicación
 * con el SRI puede tardar por la validación SOAP.
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 30000, // 30 segundos (SRI SOAP puede tardar)
      maxRedirects: 3,
    }),
  ],
  controllers: [FacturacionSriController],
  providers: [FacturacionSriService],
  exports: [FacturacionSriService],
})
export class FacturacionSriModule {}
