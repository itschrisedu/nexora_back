import {
  IsArray,
  IsDecimal,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Stock por talla para la creación ──

class TallaStockDto {
  @IsString()
  @IsNotEmpty()
  tallaId!: string;

  @IsInt()
  @Min(0)
  stockInicial!: number;

  @IsInt()
  @Min(0)
  stockMinimo!: number;
}

// ── Crear producto ──

export class CrearProductoDto {
  @IsString()
  @IsNotEmpty()
  codigo!: string;

  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsString()
  @IsNotEmpty()
  marca!: string;

  @IsString()
  @IsNotEmpty()
  modelo!: string;

  @IsString()
  @IsOptional()
  material?: string;

  @IsString()
  @IsOptional()
  fotoUrl?: string;

  @IsNumber()
  @Min(0.01)
  precioCosto!: number;

  @IsNumber()
  @Min(0.01)
  precioVenta!: number;

  @IsString()
  @IsNotEmpty()
  serieId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TallaStockDto)
  tallas!: TallaStockDto[];
}

// ── Cambiar precio ──

export class CambiarPrecioDto {
  @IsNumber()
  @Min(0.01)
  nuevoPrecioCosto!: number;

  @IsNumber()
  @Min(0.01)
  nuevoPrecioVenta!: number;

  @IsString()
  @IsOptional()
  motivo?: string;
}

// ── Reservar stock ──

export class ReservarStockDto {
  @IsString()
  @IsNotEmpty()
  tallaId!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsString()
  @IsNotEmpty()
  motivo!: string;

  @IsString()
  @IsOptional()
  referenceId?: string;

  @IsInt()
  @Min(1)
  ttlMinutos!: number;
}

// ── Movimiento de stock ──

export class MovimientoStockDto {
  @IsString()
  @IsNotEmpty()
  tallaId!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsString()
  @IsNotEmpty()
  motivo!: string;

  @IsString()
  @IsOptional()
  referenceId?: string;
}

// ── Buscar productos ──

export class BuscarProductosDto {
  @IsString()
  @IsOptional()
  q?: string;

  @IsString()
  @IsOptional()
  serie?: string;

  @IsString()
  @IsOptional()
  marca?: string;
}
