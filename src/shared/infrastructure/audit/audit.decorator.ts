import { SetMetadata } from '@nestjs/common';
import { AccionAuditoria } from '@prisma/client';

export const AUDIT_KEY = 'audit_metadata';

export interface AuditOptions {
  accion: AccionAuditoria;
  entidad: string;
}

/**
 * Decorador para marcar explícitamente métodos de controladores que deben ser auditados.
 */
export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);
