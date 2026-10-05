import { IsNotEmpty, IsString, IsOptional, IsEmail, IsArray, ValidateNested, IsNumber, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class RegistrarSupplierDto {
  @IsOptional()
  @IsString()
  ruc?: string;

  @IsOptional()
  @IsString()
  razonSocial?: string;

  @IsOptional()
  @IsString()
  nombreComercial?: string;

  @IsNotEmpty({ message: 'El nombre del proveedor es obligatorio.' })
  @IsString()
  nombres: string;

  @IsNotEmpty({ message: 'El apellido del proveedor es obligatorio.' })
  @IsString()
  apellidos: string;

  @IsNotEmpty({ message: 'El número de teléfono del proveedor es obligatorio.' })
  @IsString()
  contacto: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El formato del email no es válido.' })
  email?: string;
}

export class ActualizarSupplierDto {
  @IsOptional()
  @IsString()
  razonSocial?: string;

  @IsOptional()
  @IsString()
  contacto?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsString()
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

  @IsOptional()
  @IsString()
  observacionLinea?: string;
}

export class CrearSupplierOrderDto {
  @IsNotEmpty()
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  @IsIn(['BORRADOR', 'PENDIENTE'])
  estado?: 'BORRADOR' | 'PENDIENTE';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrearSupplierOrderLineDto)
  lines: CrearSupplierOrderLineDto[];
}

export class ActualizarSupplierOrderDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  @IsIn(['BORRADOR', 'PENDIENTE', 'CANCELADA'])
  estado?: 'BORRADOR' | 'PENDIENTE' | 'CANCELADA';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrearSupplierOrderLineDto)
  lines?: CrearSupplierOrderLineDto[];
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

  @IsOptional()
  @IsNumber()
  cantidadEsperada?: number;

  @IsOptional()
  @IsNumber()
  diferencia?: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01, { message: 'El precio de costo debe ser mayor a 0.' })
  precioCosto: number;

  @IsOptional()
  @IsString()
  observacionLinea?: string;
}

export class RegistrarMerchandiseEntryDto {
  @IsNotEmpty()
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  supplierOrderId?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  estado?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegistrarMerchandiseEntryLineDto)
  lines: RegistrarMerchandiseEntryLineDto[];
}

export class RegistrarSupplierPaymentDto {
  @IsNotEmpty({ message: 'El monto es obligatorio.' })
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0.' })
  monto: number;

  @IsNotEmpty({ message: 'El método de pago es obligatorio.' })
  @IsString()
  metodo: string; // EFECTIVO | TRANSFERENCIA | CHEQUE

  @IsOptional()
  @IsString()
  comprobante?: string;

  @IsOptional()
  @IsString()
  banco?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsString()
  supplierOrderId?: string;
}
