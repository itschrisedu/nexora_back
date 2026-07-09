import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum } from 'class-validator';
import { Rol } from '@prisma/client';

export class LoginDto {
  @IsEmail({}, { message: 'El email debe ser válido' })
  @IsNotEmpty({ message: 'El email es obligatorio' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password!: string;
}

export class RecuperarContrasenaDto {
  @IsEmail({}, { message: 'El email debe ser válido' })
  @IsNotEmpty({ message: 'El email es obligatorio' })
  email!: string;
}

export class ResetContrasenaDto {
  @IsString()
  @IsNotEmpty({ message: 'El token es obligatorio' })
  token!: string;

  @IsString()
  @IsNotEmpty({ message: 'La nueva contraseña es obligatoria' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  newPassword!: string;
}

export class CrearUsuarioDto {
  @IsEmail({}, { message: 'El email debe ser válido' })
  @IsNotEmpty({ message: 'El email es obligatorio' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  nombre!: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password!: string;

  @IsEnum(Rol, { message: 'El rol debe ser un rol válido (ROL_ADMIN, ROL_VENDEDOR, ROL_BODEGUERO)' })
  @IsNotEmpty({ message: 'El rol es obligatorio' })
  rol!: Rol;
}

