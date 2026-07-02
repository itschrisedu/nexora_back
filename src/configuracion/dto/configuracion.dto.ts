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

// ── TallaConfig ──

export class CreateTallaDto {
  @IsInt()
  @Min(1)
  numero!: number;

  @IsString()
  @IsNotEmpty()
  serieId!: string;
}
