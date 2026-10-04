interface ActiveSessionEntry {
  sessionId: string;
  lastActiveAt: number; // Marca de tiempo en milisegundos
}

/**
 * ActiveSessionStore
 * Almacena en memoria el identificador de la sesión activa más reciente y su marca de tiempo de actividad por usuario.
 * Garantiza que cada cuenta solo pueda estar activa en un único dispositivo/terminal a la vez y
 * permite saber si la sesión previa está realmente online o si el dispositivo fue apagado/cerrado.
 */
export class ActiveSessionStore {
  private static readonly sessions = new Map<string, ActiveSessionEntry>();

  static set(userId: string, sessionId: string): void {
    this.sessions.set(userId, {
      sessionId,
      lastActiveAt: Date.now(),
    });
  }

  static touch(userId: string, sessionId?: string): void {
    const current = this.sessions.get(userId);
    if (current) {
      if (!sessionId || current.sessionId === sessionId) {
        current.lastActiveAt = Date.now();
      }
    } else if (sessionId) {
      this.sessions.set(userId, {
        sessionId,
        lastActiveAt: Date.now(),
      });
    }
  }

  static get(userId: string): string | undefined {
    return this.sessions.get(userId)?.sessionId;
  }

  static getLastActive(userId: string): number | undefined {
    return this.sessions.get(userId)?.lastActiveAt;
  }

  /**
   * Verifica si la sesión de un usuario está actualmente online (activa en los últimos X ms, por defecto 90s).
   */
  static isSessionOnline(userId: string, timeoutMs: number = 90_000): boolean {
    const entry = this.sessions.get(userId);
    if (!entry) return false;
    return Date.now() - entry.lastActiveAt < timeoutMs;
  }

  static invalidate(userId: string): void {
    this.sessions.delete(userId);
  }
}
