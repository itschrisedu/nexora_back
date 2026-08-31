/**
 * ActiveSessionStore
 * Almacena en memoria el identificador de la sesión activa más reciente por cada usuario.
 * Garantiza que cada cuenta solo pueda estar activa en un único dispositivo/terminal a la vez.
 */
export class ActiveSessionStore {
  private static readonly sessions = new Map<string, string>();

  static set(userId: string, sessionId: string): void {
    this.sessions.set(userId, sessionId);
  }

  static get(userId: string): string | undefined {
    return this.sessions.get(userId);
  }

  static invalidate(userId: string): void {
    this.sessions.delete(userId);
  }
}
