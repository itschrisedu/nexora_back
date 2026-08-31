import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SeasonTipo } from '@prisma/client';

// ── BusinessConfig ──

export class UpdateBusinessConfigDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsString()
  @IsNotEmpty()
  ruc!: string;

  @IsString()
  @IsNotEmpty()
  direccion!: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  primaryColor?: string;

  // ── Horarios Operativos de Sesión ──
  @IsString()
  @IsOptional()
  horaInicioOperativa?: string;

  @IsString()
  @IsOptional()
  horaFinOperativa?: string;

  @IsInt()
  @IsOptional()
  duracionSesionHoras?: number;

  // ── Facturación Electrónica SRI (Fase 12) ──

  @IsString()
  @IsOptional()
  sriAmbiente?: string; // "1" = Pruebas, "2" = Producción

  @IsString()
  @IsOptional()
  sriEstablecimiento?: string; // "001"

  @IsString()
  @IsOptional()
  sriPuntoEmision?: string; // "001"

  @IsBoolean()
  @IsOptional()
  sriObligadoContabilidad?: boolean;

  // ── Parámetros de Scoring Crediticio ──
  @IsOptional()
  creditMontoMaximoInicial?: number;

  @IsOptional()
  creditPlazoMaximoDias?: number;

  @IsOptional()
  creditScoreMinimo?: number;

  @IsOptional()
  creditTasaMoraPct?: number;
}

export class RegistrarUbicacionDto {
  @IsNotEmpty()
  lat!: number;

  @IsNotEmpty()
  lng!: number;

  @IsString()
  @IsOptional()
  direccion?: string;
}

// ── Season ──

export class CreateSeasonDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsEnum(SeasonTipo, { message: 'Tipo de temporada inválido' })
  tipo!: SeasonTipo;

  @IsDateString()
  fechaInicio!: string;

  @IsDateString()
  fechaFin!: string;
}

export class UpdateSeasonDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsEnum(SeasonTipo)
  @IsOptional()
  tipo?: SeasonTipo;

  @IsDateString()
  @IsOptional()
  fechaInicio?: string;

  @IsDateString()
  @IsOptional()
  fechaFin?: string;

  @IsBoolean()
  @IsOptional()
  activa?: boolean;
}

// ── SeriesConfig ──

export class CreateSeriesDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;
}

/**
 * Crear serie completa con rango de tallas automático.
 * Genera tallas desde tallasDesde hasta tallasHasta.
 */
export class CreateSeriesWithTallasDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsInt()
  @Min(1)
  tallasDesde!: number;

  @IsInt()
  @Min(1)
  tallasHasta!: number;
}

/**
 * Actualizar una serie existente: cambiar nombre y/o reconfiguar rango de tallas.
 */
export class UpdateSeriesDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  tallasDesde?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  tallasHasta?: number;
}

// ── TallaConfig ──

export class CreateTallaDto {
  @IsInt()
  @Min(1)
  numero!: number;

  @IsString()
  @IsNotEmpty()
  serieId!: string;
}
