import { IsNotEmpty, IsString, IsOptional, IsEmail, IsArray, ValidateNested, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RegistrarSupplierDto {
  @IsNotEmpty({ message: 'El RUC es obligatorio.' })
  @IsString()
  ruc: string;

  @IsNotEmpty({ message: 'La razón social es obligatoria.' })
  @IsString()
  razonSocial: string;

  @IsOptional()
  @IsString()
  contacto?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El formato del email no es válido.' })
  email?: string;
}

export class CrearSupplierOrderLineDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1, { message: 'La cantidad pedida debe ser al menos 1.' })
  cantidadPedida: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01, { message: 'El precio de costo debe ser mayor a 0.' })
  precioCosto: number;
}

export class CrearSupplierOrderDto {
  @IsNotEmpty()
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrearSupplierOrderLineDto)
  lines: CrearSupplierOrderLineDto[];
}

export class RegistrarMerchandiseEntryLineDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsNotEmpty()
  @IsString()
  tallaId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1, { message: 'La cantidad ingresada debe ser al menos 1.' })
  cantidadIngresada: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01, { message: 'El precio de costo debe ser mayor a 0.' })
  precioCosto: number;
}

export class RegistrarMerchandiseEntryDto {
  @IsNotEmpty()
  @IsString()
  supplierId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegistrarMerchandiseEntryLineDto)
  lines: RegistrarMerchandiseEntryLineDto[];

  @IsOptional()
  @IsString()
  supplierOrderId?: string;
}
