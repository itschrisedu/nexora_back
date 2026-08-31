import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Color/Variante para la creación ──

class ColorVariantDto {
  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;
}

// ── Crear modelo con variantes ──

export class CrearModeloDto {
  @IsString()
  @IsNotEmpty()
  baseCode!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsOptional()
  material?: string;

  @IsNumber()
  @Min(0.01)
  costPrice!: number;

  @IsNumber()
  @Min(0.01)
  salePrice!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColorVariantDto)
  colors!: ColorVariantDto[];

  @IsArray()
  @IsString({ each: true })
  serieIds!: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  stockInicial?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  stockMinimo?: number;

  @IsOptional()
  seriesPrices?: Record<string, { costPrice: number; salePrice: number }>;

  // Tallas personalizadas por serie: { serieId: tallaId[] }
  // Si un tallaId se repite, se agrega stock extra a esa talla
  @IsOptional()
  customTallas?: Record<string, string[]>;

  @IsString()
  @IsOptional()
  supplierId?: string;
}

// ── Agregar nuevo color a un modelo existente ──

export class AgregarColorDto {
  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsArray()
  @IsString({ each: true })
  serieIds!: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  stockInicial?: number;

  @IsOptional()
  seriesPrices?: Record<string, { costPrice: number; salePrice: number }>;

  @IsOptional()
  customTallas?: Record<string, string[]>;
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

// ── Actualizar modelo ──
export class ActualizarModeloDto {
  @IsString()
  @IsOptional()
  baseCode?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  material?: string;
}

// ── Actualizar producto / variante (foto, precios, color, serie, tallas) ──
export class ActualizarProductoDto {
  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  serieId?: string;

  @IsNumber()
  @IsOptional()
  @Min(0.01)
  costPrice?: number;

  @IsNumber()
  @IsOptional()
  @Min(0.01)
  salePrice?: number;

  @IsArray()
  @IsOptional()
  tallas?: { tallaId?: string; numero?: number; cantidad: number }[];
}
