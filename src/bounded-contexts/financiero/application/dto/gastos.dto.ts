import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GastoCategoria, MetodoPagoGasto } from '@prisma/client';

export class CreateGastoDto {
  @IsEnum(GastoCategoria)
  @IsNotEmpty()
  categoria!: GastoCategoria;

  @IsString()
  @IsNotEmpty()
  concepto!: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  monto!: number;

  @IsEnum(MetodoPagoGasto)
  @IsOptional()
  metodoPago?: MetodoPagoGasto;

  @IsOptional()
  fecha?: Date | string;

  @IsString()
  @IsOptional()
  numeroComprobante?: string;

  @IsString()
  @IsOptional()
  proveedorServicio?: string;

  @IsString()
  @IsOptional()
  comprobanteUrl?: string;

  @IsString()
  @IsOptional()
  observaciones?: string;

  @IsString()
  @IsOptional()
  orderId?: string;

  @IsString()
  @IsOptional()
  sucursalId?: string; // Para gastos específicos de una sucursal
}

export class UpdateGastoDto {
  @IsEnum(GastoCategoria)
  @IsOptional()
  categoria?: GastoCategoria;

  @IsString()
  @IsOptional()
  concepto?: string;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  @Type(() => Number)
  monto?: number;

  @IsEnum(MetodoPagoGasto)
  @IsOptional()
  metodoPago?: MetodoPagoGasto;

  @IsOptional()
  fecha?: Date | string;

  @IsString()
  @IsOptional()
  numeroComprobante?: string;

  @IsString()
  @IsOptional()
  proveedorServicio?: string;

  @IsString()
  @IsOptional()
  comprobanteUrl?: string;

  @IsString()
  @IsOptional()
  observaciones?: string;
}

export class GastoFiltrosDto {
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsEnum(GastoCategoria)
  categoria?: GastoCategoria;

  @IsOptional()
  @IsEnum(MetodoPagoGasto)
  metodoPago?: MetodoPagoGasto;

  @IsOptional()
  fechaDesde?: string;

  @IsOptional()
  fechaHasta?: string;

  @IsOptional()
  mes?: string | number;

  @IsOptional()
  anio?: string | number;
}
