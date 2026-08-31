import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CanalEntrada, TipoPago, TipoVenta, EstadoPedido } from '@prisma/client';

class LineaPedidoDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  tallaId!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsEnum(TipoVenta)
  @IsNotEmpty()
  tipoVenta!: TipoVenta;
}

export class CrearPedidoDto {
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @IsEnum(CanalEntrada)
  @IsNotEmpty()
  canal!: CanalEntrada;

  @IsEnum(TipoPago)
  @IsNotEmpty()
  tipoPago!: TipoPago;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaPedidoDto)
  lineas!: LineaPedidoDto[];

  @IsString()
  @IsOptional()
  notas?: string;
}

export class CancelarPedidoDto {
  @IsString()
  @IsNotEmpty()
  motivo!: string;
}

class LineaRechazadaDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  tallaId!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;
}

export class ModificarEnTransitoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaRechazadaDto)
  lineasRechazadas!: LineaRechazadaDto[];
}

export class ActualizarEstadoPedidoDto {
  @IsEnum(EstadoPedido)
  @IsNotEmpty()
  estado!: EstadoPedido;

  @IsString()
  @IsOptional()
  motivo?: string;
}

