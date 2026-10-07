import * as dns from 'dns';
import {
  Injectable,
  UnauthorizedException,
  Logger,
  NotFoundException,
  BadRequestException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { PrismaService } from '../shared/infrastructure/prisma/prisma.service';
import { JwtPayload } from './jwt.strategy';
import { ActiveSessionStore } from './active-session.store';
import { Rol, AccionAuditoria } from '@prisma/client';

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;
  private readonly MAX_LOGIN_ATTEMPTS = 3;
  private readonly LOCKOUT_HOURS = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Inicialización del ciclo de vida del backend.
   * No recrea ni sobrescribe empresas ni usuarios para respetar las modificaciones de la base de datos.
   */
  async onApplicationBootstrap() {
    this.logger.log('✅ Servicio de autenticación inicializado sin sobreescritura de datos.');
  }

  /**
   * Enmascara un correo electrónico para proteger la privacidad en la UI (ej. ch••••r@gmail.com).
   */
  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const domain = parts[1];
    const maskedName =
      name.length > 2
        ? `${name[0]}${'•'.repeat(Math.min(name.length - 2, 4))}${name[name.length - 1]}`
        : `${name[0]}•`;
    return `${maskedName}@${domain}`;
  }

  /**
   * Envía un correo electrónico mediante Nodemailer SMTP (Gmail, Outlook, Yahoo o Servidor SMTP),
   * con fallback a Resend API o simulador de consola.
   */
  private async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    const smtpUser = this.configService.get<string>('SMTP_USER') || this.configService.get<string>('MAIL_USER');
    let smtpPass = this.configService.get<string>('SMTP_PASS') || this.configService.get<string>('MAIL_PASS');
    const smtpService = this.configService.get<string>('SMTP_SERVICE')?.toLowerCase();
    let smtpHost = this.configService.get<string>('SMTP_HOST') || this.configService.get<string>('MAIL_HOST');
    let smtpPort = Number(this.configService.get<number | string>('SMTP_PORT') || this.configService.get<number | string>('MAIL_PORT')) || 465;
    let smtpSecure = this.configService.get<string>('SMTP_SECURE') === 'true' || smtpPort === 465;

    // Limpiar espacios en la contraseña de aplicación de Gmail (ej: "abcd efgh ijkl mnop" -> "abcdefghijklmnop")
    if (smtpPass) {
      smtpPass = smtpPass.replace(/\s+/g, '');
    }

    const fromEmail = smtpUser || this.configService.get<string>(
      'NOTIFICATIONS_FROM_EMAIL',
      'seguridad@nexoracalzado.com',
    );
    const fromName = this.configService.get<string>('NOTIFICATIONS_FROM_NAME', 'NEXORA Seguridad');

    // 1. Intentar envío con SMTP Nodemailer
    if (smtpUser && smtpPass) {
      try {
        let transporter: Transporter;
        const originalHost = smtpHost || 'smtp.gmail.com';
        let resolvedHost = originalHost;

        // Forzar resolución IPv4 explícita para evitar errores ENETUNREACH de IPv6 en Railway/Linux
        try {
          const dnsLookup = await dns.promises.lookup(originalHost, { family: 4 });
          if (dnsLookup?.address) {
            resolvedHost = dnsLookup.address;
          }
        } catch (_) {
          resolvedHost = originalHost;
        }

        const timeoutOptions: any = {
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 20000,
        };

        if (smtpService) {
          transporter = nodemailer.createTransport({
            service: smtpService,
            auth: { user: smtpUser, pass: smtpPass },
            ...timeoutOptions,
          });
        } else if (smtpUser.toLowerCase().endsWith('@gmail.com')) {
          // Gmail con IPv4 directa y SNI TLS
          transporter = nodemailer.createTransport({
            host: resolvedHost,
            port: smtpPort || 465,
            secure: smtpSecure !== undefined ? smtpSecure : true,
            auth: { user: smtpUser, pass: smtpPass },
            tls: {
              rejectUnauthorized: false,
              servername: originalHost,
            },
            ...timeoutOptions,
          });
        } else {
          if (!smtpHost) {
            if (smtpUser.endsWith('@hotmail.com') || smtpUser.endsWith('@outlook.com') || smtpUser.endsWith('@live.com')) {
              smtpHost = 'smtp-mail.outlook.com';
              smtpPort = 587;
              smtpSecure = false;
            } else if (smtpUser.endsWith('@yahoo.com') || smtpUser.endsWith('@yahoo.es')) {
              smtpHost = 'smtp.mail.yahoo.com';
              smtpPort = 465;
              smtpSecure = true;
            }
          }

          transporter = nodemailer.createTransport({
            host: resolvedHost,
            port: smtpPort,
            secure: smtpSecure,
            auth: { user: smtpUser, pass: smtpPass },
            tls: {
              rejectUnauthorized: false,
              servername: originalHost,
            },
            ...timeoutOptions,
          });
        }

        const info = await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to,
          subject,
          html,
        });

        this.logger.log(`📧 [SMTP] Correo enviado exitosamente a ${to} (MessageId: ${info.messageId})`);
        return true;
      } catch (smtpErr: any) {
        this.logger.error(`❌ Error al enviar correo mediante SMTP a ${to}: ${smtpErr.message}`);
      }
    }

    const systemEmail =
      this.configService.get<string>('SYSTEM_EMAIL') ||
      this.configService.get<string>('SMTP_USER') ||
      this.configService.get<string>('MAIL_USER') ||
      'nexora.appv01@gmail.com';

    // 2. Fallback con Resend si está configurado
    const apiKey = this.configService.get<string>('RESEND_API_KEY', '');
    if (apiKey && apiKey.trim() !== '') {
      try {
        const resend = new Resend(apiKey);
        const resendFrom = this.configService.get<string>('RESEND_FROM_EMAIL') || 'NEXORA Notificaciones <onboarding@resend.dev>';
        
        let res = await resend.emails.send({
          from: resendFrom,
          to,
          subject,
          html,
          ...(smtpUser ? { replyTo: smtpUser } : { replyTo: systemEmail }),
        });

        // Si Resend falla porque está en modo sandbox (cuenta gratuita sin dominio verificado)
        if (
          res.error &&
          (res.error.message.includes('only send testing emails') ||
            res.error.message.includes('testing emails'))
        ) {
          this.logger.warn(
            `⚠️ [Resend Sandbox] Cuenta gratuita de Resend en modo prueba. Entregando a buzón principal del sistema (${systemEmail}) para la cuenta (${to}).`,
          );

          const devHtml = `
            <div style="background: #1e293b; color: #38bdf8; padding: 12px 16px; border-radius: 12px; margin-bottom: 20px; font-size: 13px; font-family: sans-serif; border: 1px solid rgba(56, 189, 248, 0.3);">
              <strong>ℹ️ Modo de Prueba / Notificación del Sistema:</strong><br />
              Este código de verificación fue generado para: <strong style="color: #fff;">${to}</strong>.<br />
              Buzón central del sistema: <a href="mailto:${systemEmail}" style="color: #38bdf8;">${systemEmail}</a>.
            </div>
            ${html}
          `;

          res = await resend.emails.send({
            from: resendFrom,
            to: systemEmail,
            subject: `[Para: ${to}] ${subject}`,
            html: devHtml,
            replyTo: systemEmail,
          });
        }

        if (res.error) {
          this.logger.warn(`Resend Error: ${res.error.message}. Simulando en consola.`);
        } else {
          this.logger.log(`📧 [Resend] Correo enviado exitosamente (ID: ${res.data?.id})`);
          return true;
        }
      } catch (e: any) {
        this.logger.warn(`Error al enviar email con Resend: ${e.message}`);
      }
    }

    // 3. Fallback en consola (simulador)
    this.logger.log(
      `\n======================================================\n[SIMULADOR EMAIL] Para: ${to}\nAsunto: ${subject}\n======================================================`,
    );
    return true;
  }

  /**
   * Genera la plantilla HTML estándar corporativa para códigos OTP de NEXORA.
   */
  private getOtpHtmlTemplate(titulo: string, descripcion: string, otp: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #07080a; color: #eef2f7; border-radius: 24px; padding: 36px 28px; border: 1px solid rgba(255,255,255,0.08); text-align: center;">
        <div style="margin-bottom: 24px;">
          <span style="display: inline-block; padding: 6px 14px; background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.25); border-radius: 99px; font-size: 11px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase;">
            Seguridad NEXORA
          </span>
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 16px 0 6px; letter-spacing: -0.02em;">
            ${titulo}
          </h1>
          <p style="color: rgba(238,242,247,0.65); font-size: 13px; line-height: 1.5; margin: 0;">
            ${descripcion}
          </p>
        </div>

        <div style="background: linear-gradient(170deg, #14161a, #0f1114); border-radius: 20px; padding: 24px 20px; border: 1px solid rgba(255,255,255,0.06); margin: 24px 0; box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);">
          <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8; margin-bottom: 12px;">
            Código de Verificación (4 Dígitos)
          </div>
          <div style="background: #061c14; border: 2px solid #10b981; border-radius: 16px; padding: 14px 24px; display: inline-block; box-shadow: 0 0 24px rgba(16,185,129,0.2);">
            <span style="font-size: 36px; font-weight: 900; letter-spacing: 12px; color: #34d399; font-family: monospace; margin-left: 12px;">
              ${otp}
            </span>
          </div>
          <p style="font-size: 12px; color: #64748b; margin: 16px 0 0;">
            ⏱️ Este código expira en <strong>5 minutos</strong>.
          </p>
        </div>

        <p style="font-size: 11px; color: rgba(238,242,247,0.4); margin: 20px 0 0; line-height: 1.4;">
          Si no realizaste esta solicitud, ignora este mensaje. Nadie del equipo de NEXORA te pedirá este código.
        </p>
      </div>
    `;
  }

  /**
   * Registra el latido de actividad periódica del cliente autenticado.
   */
  async registerHeartbeat(userId: string, sessionId?: string) {
    if (!userId) return { ok: false };
    ActiveSessionStore.touch(userId, sessionId);
    return { ok: true, timestamp: Date.now() };
  }

  /**
   * Login — Autentica al usuario y retorna access + refresh tokens.
   * Si ya existe una sesión activa y está ONLINE concurrentemente en otro dispositivo, solicita código OTP.
   * Si el dispositivo anterior se apagó o cerró (sin latido en >90s), permite login directo.
   */
  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.activo) {
      throw new UnauthorizedException('Cuenta desactivada. Contacte al administrador');
    }

    // ── Verificar si la cuenta está bloqueada por intentos fallidos ──
    if (user.bloqueadoHasta && user.bloqueadoHasta > new Date()) {
      const horasRestantes = Math.ceil(
        (user.bloqueadoHasta.getTime() - Date.now()) / (1000 * 60 * 60),
      );
      this.logger.warn(
        `Intento de login en cuenta bloqueada: ${email} (bloqueada por ${horasRestantes}h más)`,
      );
      throw new UnauthorizedException(
        `Cuenta bloqueada por seguridad. Demasiados intentos fallidos. Intente nuevamente en ${horasRestantes} hora(s) o use la opción de desbloquear por correo.`,
      );
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      const nuevosIntentos = (user.intentosFallidos || 0) + 1;
      const updateData: any = { intentosFallidos: nuevosIntentos };

      if (nuevosIntentos >= this.MAX_LOGIN_ATTEMPTS) {
        updateData.bloqueadoHasta = new Date(Date.now() + this.LOCKOUT_HOURS * 60 * 60 * 1000);
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
        updateData.sessionOtp = otp;
        updateData.sessionOtpExpiresAt = expiresAt;
        updateData.sessionOtpAttempts = 0;

        const html = this.getOtpHtmlTemplate(
          'Desbloqueo de Seguridad de Cuenta',
          'Detectamos 3 intentos fallidos de inicio de sesión. Por tu seguridad hemos bloqueado temporalmente el acceso directo. Ingresa este código de 4 dígitos en la ventana de desbloqueo para restablecer tu acceso inmediatamente:',
          otp,
        );

        this.sendEmail(user.email, 'Código de Desbloqueo de Cuenta — NEXORA', html).catch((err) => {
          this.logger.warn(`Error enviando email de bloqueo a ${user.email}: ${err.message}`);
        });

        this.logger.warn(
          `Cuenta BLOQUEADA por ${this.LOCKOUT_HOURS}h: ${email} (${nuevosIntentos} intentos fallidos). Código OTP enviado al correo.`,
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });

      const intentosRestantes = this.MAX_LOGIN_ATTEMPTS - nuevosIntentos;
      if (intentosRestantes > 0) {
        throw new UnauthorizedException(
          `Credenciales inválidas. Le quedan ${intentosRestantes} intento(s) antes del bloqueo de cuenta.`,
        );
      } else {
        throw new UnauthorizedException(
          `Cuenta bloqueada por seguridad tras 3 intentos fallidos. Se ha enviado un código de 4 dígitos a su correo para desbloquearla de inmediato.`,
        );
      }
    }

    // ── Verificar si ya existe una sesión activa concurrente ONLINE ──
    // Un usuario solo tiene conflicto si su sesión anterior ha enviado un latido en los últimos 90 segundos
    const isOnlineNow = ActiveSessionStore.isSessionOnline(user.id, 90_000);
    const hasExistingSession = Boolean(ActiveSessionStore.get(user.id) || user.activeSessionId);

    if (hasExistingSession && isOnlineNow) {
      // Hay una sesión realmente activa y conectada en este instante en otro dispositivo → pedir OTP obligatorio
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          sessionOtp: otp,
          sessionOtpExpiresAt: expiresAt,
          sessionOtpAttempts: 0,
        },
      });

      const html = this.getOtpHtmlTemplate(
        'Autorización de Transferencia de Sesión',
        'Detectamos un intento de inicio de sesión desde un nuevo dispositivo o navegador mientras tienes una sesión abierta en otro lugar. Ingresa este código de 4 dígitos para autorizar el cambio de dispositivo:',
        otp,
      );

      this.sendEmail(user.email, 'Código de Confirmación de Sesión — NEXORA', html).catch((err) => {
        this.logger.warn(`Error enviando email de transferencia de sesión a ${user.email}: ${err.message}`);
      });

      this.logger.warn(`Conflicto de sesión única detectado para: ${email}. Código OTP enviado al correo.`);
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`🔐 [DEV] OTP de transferencia de sesión para ${email}: ${otp}`);
      }
      return {
        sessionConflict: true,
        requiresOtp: true,
        email: user.email,
        maskedEmail: this.maskEmail(user.email),
        message:
          'Ya existe una sesión abierta para este usuario en otro dispositivo. Por tu seguridad, hemos enviado un código de 4 dígitos a tu correo para autorizar el traslado de sesión a este dispositivo.',
        debugCode: process.env.NODE_ENV !== 'production' ? otp : undefined,
      };
    }

    // Si la sesión anterior ya no está online (dispositivo apagado, pestaña cerrada o inactiva por >90s):
    if (hasExistingSession && !isOnlineNow) {
      this.logger.log(`Sesión previa de ${email} inactiva o fuera de línea. Permitiendo login directo y cerrando sesión previa.`);
    }

    return this.createSessionResponse(user, ipAddress, userAgent);
  }

  /**
   * Genera los tokens JWT y registra la nueva sesión activa, invalidando la anterior.
   */
  private async createSessionResponse(user: any, ipAddress?: string, userAgent?: string) {
    // Resetear contador de fallos
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        intentosFallidos: 0,
        bloqueadoHasta: null,
        sessionOtp: null,
        sessionOtpExpiresAt: null,
        sessionOtpAttempts: 0,
      },
    });

    // Invalida todos los refresh tokens previos del usuario para que el otro dispositivo quede completamente desconectado
    try {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revoked: false },
        data: { revoked: true },
      });
    } catch (tokenErr: any) {
      this.logger.warn(`Error al revocar refresh tokens previos: ${tokenErr.message}`);
    }

    const sessionId = randomBytes(16).toString('hex');
    ActiveSessionStore.set(user.id, sessionId);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { activeSessionId: sessionId },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      rol: user.rol,
      tenantId: user.tenantId,
      sessionId,
    };

    const sessionHours = await this.getTenantSessionHours(user.tenantId);
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: sessionHours as any,
    });

    const refreshToken = randomBytes(64).toString('hex');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = this.calculateExpirationDate(refreshExpiresIn);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      },
    });

    // ── Registrar evento LOGIN en Bitácora de Auditoría ──
    if (user.tenantId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            userEmail: user.email,
            userRol: user.rol,
            accion: AccionAuditoria.LOGIN,
            entidad: 'AUTH',
            entidadId: user.id,
            detalles: {
              resumenHumano: `Inicio de sesión seguro (${user.nombre || user.email})`,
              email: user.email,
              nombre: user.nombre || user.email,
              rol: user.rol,
              loginAt: new Date().toISOString(),
            },
            ipAddress: ipAddress || '127.0.0.1',
            userAgent: userAgent || 'Navegador Web',
          },
        });
      } catch (auditErr: any) {
        this.logger.warn(`No se pudo registrar log de LOGIN para ${user.email}: ${auditErr.message}`);
      }
    }

    this.logger.log(`Sesión iniciada exitosamente para: ${user.email} (${user.rol})`);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
        tenantId: user.tenantId,
        tenantName: user.tenant?.name || null,
        permiteCambiarPrecio: user.permiteCambiarPrecio,
        esAdminGeneral: user.esAdminGeneral || (!user.parentId && user.rol === Rol.ROL_ADMIN),
        termsAcceptedAt: user.termsAcceptedAt,
        termsVersion: user.termsVersion,
        gpsConsentAt: user.gpsConsentAt,
      },
    };
  }

  /**
   * Solicita un código OTP de 4 dígitos para autorizar la transferencia de sesión.
   */
  async requestSessionTransferOtp(email: string, password?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.bloqueadoHasta && user.bloqueadoHasta > new Date()) {
      throw new UnauthorizedException('La cuenta se encuentra bloqueada por seguridad.');
    }

    if (password) {
      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        throw new UnauthorizedException('Contraseña incorrecta');
      }
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        sessionOtp: otp,
        sessionOtpExpiresAt: expiresAt,
        sessionOtpAttempts: 0,
      },
    });

    const html = this.getOtpHtmlTemplate(
      'Autorización de Transferencia de Sesión',
      'Detectamos un intento de inicio de sesión desde un nuevo dispositivo o navegador.',
      otp,
    );

    await this.sendEmail(user.email, 'Código de Confirmación de Sesión — NEXORA', html);

    this.logger.log(`🔑 OTP de sesión generado para ${email}: [${otp}]`);

    return {
      ok: true,
      maskedEmail: this.maskEmail(user.email),
      expiresInSeconds: 300,
      debugCode: process.env.NODE_ENV !== 'production' ? otp : undefined,
    };
  }

  /**
   * Valida el código OTP de transferencia de sesión de 4 dígitos.
   * Tras 3 intentos erróneos, bloquea la cuenta por 24 horas.
   */
  async verifySessionOtp(email: string, otp: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.bloqueadoHasta && user.bloqueadoHasta > new Date()) {
      throw new UnauthorizedException('Cuenta bloqueada por seguridad. Contacte al administrador.');
    }

    if (!user.sessionOtp || !user.sessionOtpExpiresAt || user.sessionOtpExpiresAt < new Date()) {
      throw new BadRequestException('El código ha expirado o no ha sido solicitado. Solicite uno nuevo.');
    }

    if (user.sessionOtp !== otp.trim()) {
      const newAttempts = (user.sessionOtpAttempts || 0) + 1;
      const totalFailures = (user.intentosFallidos || 0) + 1;

      if (newAttempts >= this.MAX_LOGIN_ATTEMPTS || totalFailures >= this.MAX_LOGIN_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            intentosFallidos: this.MAX_LOGIN_ATTEMPTS,
            bloqueadoHasta: new Date(Date.now() + this.LOCKOUT_HOURS * 60 * 60 * 1000),
            sessionOtp: null,
            sessionOtpExpiresAt: null,
          },
        });
        throw new UnauthorizedException(
          'Cuenta bloqueada por 24 horas tras 3 intentos fallidos consecutivos.',
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          sessionOtpAttempts: newAttempts,
          intentosFallidos: totalFailures,
        },
      });

      const remaining = this.MAX_LOGIN_ATTEMPTS - newAttempts;
      throw new UnauthorizedException(
        `Código incorrecto. Le quedan ${remaining} intento(s) antes del bloqueo.`,
      );
    }

    // OTP Correcto: Iniciar sesión y cerrar la anterior
    this.logger.log(`✅ OTP de transferencia verificado con éxito para: ${email}`);
    return this.createSessionResponse(user, ipAddress, userAgent);
  }

  /**
   * Solicita un código OTP de 4 dígitos para auto-desbloqueo o recuperación de cuenta
   * disponible para Super Admin, Admin y Colaboradores.
   */
  async requestUnlockOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('No existe ninguna cuenta asociada a este correo electrónico.');
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        sessionOtp: otp,
        sessionOtpExpiresAt: expiresAt,
        sessionOtpAttempts: 0,
      },
    });

    const html = this.getOtpHtmlTemplate(
      'Desbloqueo y Recuperación de Cuenta',
      'Has solicitado desbloquear tu cuenta o recuperar el acceso a tu panel de NEXORA.',
      otp,
    );

    await this.sendEmail(user.email, 'Código de Desbloqueo de Cuenta — NEXORA', html);
    this.logger.log(`🔓 OTP de desbloqueo generado para ${email}: [${otp}]`);

    return {
      ok: true,
      maskedEmail: this.maskEmail(user.email),
      expiresInSeconds: 300,
      debugCode: process.env.NODE_ENV !== 'production' ? otp : undefined,
    };
  }

  /**
   * Valida el código OTP de desbloqueo y restablece la cuenta de inmediato.
   */
  async verifyUnlockOtp(email: string, otp: string, newPassword?: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (!user.sessionOtp || !user.sessionOtpExpiresAt || user.sessionOtpExpiresAt < new Date()) {
      throw new BadRequestException('El código ha expirado o es inválido. Solicite un nuevo código.');
    }

    if (user.sessionOtp !== otp.trim()) {
      const newAttempts = (user.sessionOtpAttempts || 0) + 1;
      if (newAttempts >= this.MAX_LOGIN_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            bloqueadoHasta: new Date(Date.now() + this.LOCKOUT_HOURS * 60 * 60 * 1000),
            sessionOtp: null,
            sessionOtpExpiresAt: null,
          },
        });
        throw new UnauthorizedException('Excedió el número de intentos permitidos.');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: { sessionOtpAttempts: newAttempts },
      });

      throw new UnauthorizedException(
        `Código incorrecto. Le quedan ${this.MAX_LOGIN_ATTEMPTS - newAttempts} intento(s).`,
      );
    }

    const updateData: any = {
      intentosFallidos: 0,
      bloqueadoHasta: null,
      sessionOtp: null,
      sessionOtpExpiresAt: null,
      sessionOtpAttempts: 0,
    };

    if (newPassword && newPassword.length >= 6) {
      updateData.passwordHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: updateData,
      include: { tenant: true },
    });

    this.logger.log(`🎉 Cuenta desbloqueada exitosamente para ${email} (${user.rol})`);
    return this.createSessionResponse(updatedUser, ipAddress, userAgent);
  }

  /**
   * Obtiene la duración de sesión configurada para la empresa en horas.
   */
  private async getTenantSessionHours(tenantId: string | null): Promise<string> {
    if (tenantId) {
      try {
        const config = await this.prisma.businessConfig.findUnique({
          where: { tenantId },
        });
        if (config?.duracionSesionHoras) {
          return `${config.duracionSesionHoras}h`;
        }
      } catch (err) {
        // Fallback silencioso si falla la consulta
      }
    }
    return this.configService.get<string>('JWT_ACCESS_EXPIRATION', '24h');
  }

  /**
   * Refresh Token — Genera un nuevo access token a partir de un refresh token válido.
   */
  async refreshToken(token: string) {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (storedToken.revoked) {
      this.logger.warn(`Intento de uso de refresh token revocado: userId=${storedToken.userId}`);
      throw new UnauthorizedException('Refresh token revocado');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const currentSessionId = ActiveSessionStore.get(storedToken.user.id);
    const payload: JwtPayload = {
      sub: storedToken.user.id,
      email: storedToken.user.email,
      rol: storedToken.user.rol,
      tenantId: storedToken.user.tenantId,
      sessionId: currentSessionId,
    };

    const sessionHours = await this.getTenantSessionHours(storedToken.user.tenantId);

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: sessionHours as any,
    });

    return { accessToken };
  }

  /**
   * Logout — Revoca el refresh token y libera la sesión activa del usuario.
   */
  async logout(token?: string, userId?: string, ipAddress?: string, userAgent?: string) {
    let resolvedUserId = userId;

    if (token) {
      try {
        const stored = await this.prisma.refreshToken.findUnique({ where: { token } });
        if (stored) {
          await this.prisma.refreshToken.update({
            where: { token },
            data: { revoked: true },
          });
          resolvedUserId = resolvedUserId || stored.userId;
        }
      } catch (err: any) {
        this.logger.warn(`Error al revocar refreshToken en logout: ${err.message}`);
      }
    }

    if (resolvedUserId) {
      ActiveSessionStore.invalidate(resolvedUserId);
      const user = await this.prisma.user
        .update({
          where: { id: resolvedUserId },
          data: { activeSessionId: null },
        })
        .catch((e) => {
          this.logger.warn(`Error limpiando activeSessionId: ${e.message}`);
          return null;
        });

      if (user && user.tenantId) {
        try {
          await this.prisma.auditLog.create({
            data: {
              tenantId: user.tenantId,
              userId: user.id,
              userEmail: user.email,
              userRol: user.rol,
              accion: AccionAuditoria.LOGOUT,
              entidad: 'AUTH',
              entidadId: user.id,
              detalles: {
                resumenHumano: `Cierre de sesión de usuario (${user.nombre || user.email})`,
                email: user.email,
                nombre: user.nombre || user.email,
                rol: user.rol,
                logoutAt: new Date().toISOString(),
              },
              ipAddress: ipAddress || '127.0.0.1',
              userAgent: userAgent || 'Navegador Web',
            },
          });
        } catch (auditErr: any) {
          this.logger.warn(`No se pudo registrar log de LOGOUT: ${auditErr.message}`);
        }
      }

      this.logger.log(`Sesión cerrada y liberada en BD para userId: ${resolvedUserId}`);
    }
  }

  /**
   * Solicitar recuperación de contraseña.
   */
  async solicitarRecuperacion(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Por seguridad no revelamos si existe o no el usuario
      return { message: 'Si el correo existe en nuestro sistema, recibirás instrucciones para restablecer tu contraseña.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora de validez

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    this.logger.log(`Solicitud de recuperación de contraseña para: ${email}. Token: ${token}`);
    
    // Aquí se enviaría el email si estuviera configurado
    return { message: 'Si el correo existe en nuestro sistema, recibirás instrucciones para restablecer tu contraseña.', debugToken: token };
  }

  /**
   * Restablecer contraseña con token.
   */
  async resetPassword(token: string, newPassword: string) {
    const resetRecord = await this.prisma.passwordReset.findUnique({
      where: { token },
    });

    if (!resetRecord) {
      throw new NotFoundException('Token de recuperación inválido');
    }

    if (resetRecord.usedAt) {
      throw new UnauthorizedException('Este token ya fue utilizado');
    }

    if (resetRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de recuperación expirado');
    }

    const passwordHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      // Revocar todos los refresh tokens del usuario (forzar re-login)
      this.prisma.refreshToken.updateMany({
        where: { userId: resetRecord.userId, revoked: false },
        data: { revoked: true },
      }),
    ]);

    this.logger.log(`Contraseña reseteada para userId: ${resetRecord.userId}`);

    return { message: 'Contraseña actualizada exitosamente. Inicia sesión con tu nueva contraseña.' };
  }

  // ── Gestión de Personal (Admin CRUD) ──────────

  async listUsers(requestUser: { id: string; rol: string; tenantId: string | null }) {
    const where: any = {};

    if (requestUser.rol === 'ROL_SUPER_ADMIN') {
      // Super Admin ve todos los usuarios
    } else if (requestUser.rol === 'ROL_ADMIN') {
      const mainTenant = requestUser.tenantId
        ? await this.prisma.tenant.findUnique({
            where: { id: requestUser.tenantId },
            include: { businessConfig: true },
          })
        : null;
      const ruc = mainTenant?.businessConfig?.ruc;

      const tenantIds: (string | null)[] = [requestUser.tenantId];
      if (ruc) {
        const relatedTenants = await this.prisma.tenant.findMany({
          where: { businessConfig: { ruc }, active: true },
          select: { id: true },
        });
        relatedTenants.forEach((t) => {
          if (!tenantIds.includes(t.id)) tenantIds.push(t.id);
        });
      }

      where.tenantId = { in: tenantIds.filter(Boolean) };
      where.rol = { in: [Rol.ROL_VENDEDOR, Rol.ROL_BODEGUERO, Rol.ROL_ADMIN] };
    } else {
      // Vendedores y bodegueros no deberían listar usuarios
      return [];
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        esAdminGeneral: true,
        activo: true,
        permiteCambiarPrecio: true,
        intentosFallidos: true,
        bloqueadoHasta: true,
        termsAcceptedAt: true,
        termsVersion: true,
        gpsConsentAt: true,
        tenantId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createUser(
    email: string,
    nombre: string,
    rol: Rol,
    password: string,
    requestUser: { id: string; rol: string; tenantId: string | null; esAdminGeneral?: boolean; parentId?: string | null },
    explicitTenantId?: string,
    permiteCambiarPrecio?: boolean,
    esAdminGeneral?: boolean,
  ) {
    // Permisos: Super Admin o Admin General (Dueño) pueden crear administradores
    const isCallerAdminGeneral =
      requestUser.rol === 'ROL_SUPER_ADMIN' ||
      (requestUser.rol === 'ROL_ADMIN' && (requestUser.esAdminGeneral === true || !requestUser.parentId));

    if (rol === Rol.ROL_ADMIN && !isCallerAdminGeneral) {
      throw new UnauthorizedException('Solo un Administrador General o Super Admin puede crear administradores.');
    }
    if (rol === Rol.ROL_SUPER_ADMIN && requestUser.rol !== 'ROL_SUPER_ADMIN') {
      throw new UnauthorizedException('Solo un Super Administrador puede crear otro Super Administrador.');
    }

    // Validar formato del correo
    const cleanEmail = (email || '').trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail) || (cleanEmail.match(/@/g) || []).length !== 1) {
      throw new BadRequestException('El correo debe ser un email válido y contener exactamente un arroba (@).');
    }
    email = cleanEmail;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new UnauthorizedException('El correo ya está registrado.');
    }

    // Determinar el tenantId del nuevo usuario
    let tenantId: string | null = null;
    if (explicitTenantId) {
      tenantId = explicitTenantId;
    } else {
      tenantId = requestUser.tenantId;
    }

    const isGlobal = rol === Rol.ROL_ADMIN ? (esAdminGeneral ?? false) : false;

    const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email,
        nombre,
        rol,
        esAdminGeneral: isGlobal,
        passwordHash,
        activo: true,
        permiteCambiarPrecio: permiteCambiarPrecio ?? false,
        tenantId,
        parentId: requestUser.id,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        esAdminGeneral: true,
        activo: true,
        permiteCambiarPrecio: true,
        tenantId: true,
      },
    });

    // Enviar correo con credenciales de acceso y enlace al sistema en segundo plano
    this.sendWelcomeCredentialsEmail({
      email,
      nombre,
      rol,
      password,
    }).catch((err) => {
      this.logger.warn(`Error enviando correo de bienvenida a ${email}: ${err.message}`);
    });

    return user;
  }

  async toggleUserActive(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    return this.prisma.user.update({
      where: { id },
      data: { activo: !user.activo },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
        permiteCambiarPrecio: true,
      },
    });
  }

  async toggleUserPermisoPrecio(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    return this.prisma.user.update({
      where: { id },
      data: { permiteCambiarPrecio: !user.permiteCambiarPrecio },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
        permiteCambiarPrecio: true,
      },
    });
  }

  /**
   * Desbloquea una cuenta bloqueada por intentos fallidos.
   * Resetea el contador de intentos y elimina la fecha de bloqueo.
   */
  async unlockUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { intentosFallidos: 0, bloqueadoHasta: null },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        activo: true,
        intentosFallidos: true,
        bloqueadoHasta: true,
      },
    });
    this.logger.log(`Cuenta desbloqueada manualmente: ${updated.email}`);
    return updated;
  }

  // ══════════════════════════════════════════
  // FASE E8: TÉRMINOS LEGALES Y CONSENTIMIENTO GPS
  // ══════════════════════════════════════════

  async acceptTerms(userId: string, version: string = '1.0') {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        termsAcceptedAt: new Date(),
        termsVersion: version,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        termsAcceptedAt: true,
        termsVersion: true,
        gpsConsentAt: true,
      },
    });
    this.logger.log(`Términos y condiciones aceptados por usuario: ${user.email} (v${version})`);
    return { ok: true, user, message: 'Términos y condiciones aceptados correctamente.' };
  }

  async acceptGpsConsent(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        gpsConsentAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        termsAcceptedAt: true,
        termsVersion: true,
        gpsConsentAt: true,
      },
    });
    this.logger.log(`Consentimiento GPS registrado para usuario: ${user.email}`);
    return { ok: true, user, message: 'Consentimiento GPS registrado correctamente.' };
  }

  async getTermsStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nombre: true,
        rol: true,
        termsAcceptedAt: true,
        termsVersion: true,
        gpsConsentAt: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return user;
  }

  async changePassword(userId: string, passwordActual: string, passwordNuevo: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    const isCurrentValid = await bcrypt.compare(passwordActual, user.passwordHash);
    if (!isCurrentValid) {
      throw new BadRequestException('La contraseña actual ingresada es incorrecta.');
    }

    if (!passwordNuevo || passwordNuevo.length < 8) {
      throw new BadRequestException('La nueva contraseña debe tener al menos 8 caracteres.');
    }

    const newHash = await bcrypt.hash(passwordNuevo, this.BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });

    this.logger.log(`Contraseña actualizada exitosamente para el usuario: ${user.email}`);
    return { ok: true, message: 'Contraseña actualizada correctamente.' };
  }

  // ── Envío de Correo de Bienvenida con Credenciales ──────────────────────────────

  /**
   * Envía un correo de bienvenida al nuevo usuario con sus credenciales de acceso
   * y el enlace directo al sistema para iniciar sesión.
   * Se invoca de forma asíncrona (fire-and-forget) para no bloquear la creación del usuario.
   */
  async sendWelcomeCredentialsEmail(data: {
    email: string;
    nombre: string;
    rol: string;
    password: string;
  }): Promise<boolean> {
    const { email, nombre, rol, password } = data;
    const loginUrl = 'https://nexora-web-dusky-six.vercel.app/';

    const rolLabels: Record<string, string> = {
      ROL_SUPER_ADMIN: 'Super Administrador',
      ROL_ADMIN: 'Administrador',
      ROL_VENDEDOR: 'Vendedor',
      ROL_BODEGUERO: 'Bodeguero',
    };
    const rolLabel = rolLabels[rol] || rol;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #07080a; color: #eef2f7; border-radius: 24px; padding: 40px 32px; border: 1px solid rgba(255,255,255,0.08);">
        <div style="text-align: center; margin-bottom: 28px;">
          <span style="display: inline-block; padding: 6px 16px; background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.25); border-radius: 99px; font-size: 11px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase;">
            Bienvenido a NEXORA
          </span>
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 18px 0 8px; letter-spacing: -0.02em;">
            Tu cuenta ha sido creada
          </h1>
          <p style="color: rgba(238,242,247,0.6); font-size: 14px; line-height: 1.6; margin: 0;">
            Hola <strong style="color: #ffffff;">${nombre}</strong>, se ha creado tu cuenta con el rol de <strong style="color: #10b981;">${rolLabel}</strong> en el sistema NEXORA.
          </p>
        </div>

        <div style="background: linear-gradient(170deg, #14161a, #0f1114); border-radius: 20px; padding: 24px; border: 1px solid rgba(255,255,255,0.06); margin: 24px 0; box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);">
          <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8; margin-bottom: 16px; text-align: center;">
            Credenciales de Acceso
          </div>

          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <span style="font-size: 12px; color: #94a3b8; display: block; margin-bottom: 4px;">Usuario (Correo)</span>
                <span style="font-size: 15px; color: #ffffff; font-weight: 600;">${email}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 0;">
                <span style="font-size: 12px; color: #94a3b8; display: block; margin-bottom: 4px;">Contrase\u00f1a</span>
                <span style="font-size: 15px; color: #34d399; font-weight: 700; font-family: monospace; letter-spacing: 1px; background: #061c14; padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(16,185,129,0.3); display: inline-block;">${password}</span>
              </td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${loginUrl}" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; text-decoration: none; border-radius: 14px; font-size: 15px; font-weight: 700; letter-spacing: 0.02em; box-shadow: 0 4px 16px rgba(16,185,129,0.3);">
            Ingresar al Sistema
          </a>
          <p style="margin: 12px 0 0; font-size: 12px; color: rgba(238,242,247,0.4);">
            ${loginUrl}
          </p>
        </div>

        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 14px 18px; margin-top: 24px;">
          <p style="margin: 0; font-size: 12px; color: #fbbf24; line-height: 1.5;">
            <strong>Recomendaci\u00f3n de Seguridad:</strong> Por tu seguridad, cambia tu contrase\u00f1a despu\u00e9s de tu primer inicio de sesi\u00f3n desde la secci\u00f3n de perfil.
          </p>
        </div>

        <div style="text-align: center; margin-top: 28px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06);">
          <p style="margin: 0; font-size: 11px; color: rgba(238,242,247,0.3);">
            Este correo fue generado autom\u00e1ticamente por el sistema NEXORA.<br />
            Si no solicitaste esta cuenta, comunica al administrador de tu organizaci\u00f3n.
          </p>
        </div>
      </div>
    `;

    this.logger.log(`📧 Enviando correo de bienvenida con credenciales a ${email} (rol: ${rolLabel})...`);
    return this.sendEmail(email, 'Bienvenido a NEXORA — Tus Credenciales de Acceso', html);
  }

  // ── Utilidades ──────────────────────────────

  private calculateExpirationDate(duration: string): Date {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default 7 días
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * multipliers[unit]);
  }
}
