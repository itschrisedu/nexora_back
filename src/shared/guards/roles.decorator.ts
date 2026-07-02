import { SetMetadata } from '@nestjs/common';
import { Rol } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Decorator @Roles — Define qué roles pueden acceder a un endpoint.
 * Uso: @Roles(Rol.ROL_ADMIN, Rol.ROL_VENDEDOR)
 */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES_KEY, roles);
