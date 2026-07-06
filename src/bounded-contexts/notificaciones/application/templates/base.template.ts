/**
 * Estilos compartidos para todas las plantillas de email de NEXORA.
 */
export const baseStyles = `
  <style>
    body { margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f9; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #ffffff; padding: 24px 32px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.5px; }
    .header .subtitle { color: #a0aec0; font-size: 13px; margin-top: 4px; }
    .body { padding: 28px 32px; color: #2d3748; line-height: 1.6; }
    .body h2 { color: #1a1a2e; font-size: 18px; margin-top: 0; }
    .highlight { background: #edf2f7; border-left: 4px solid #3182ce; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
    .highlight strong { color: #2b6cb0; }
    table.detail { width: 100%; border-collapse: collapse; margin: 16px 0; }
    table.detail th { background: #edf2f7; text-align: left; padding: 8px 12px; font-size: 13px; color: #4a5568; }
    table.detail td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #1a1a2e; }
    .footer { background: #f7fafc; padding: 16px 32px; text-align: center; font-size: 12px; color: #a0aec0; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-info { background: #ebf8ff; color: #2b6cb0; }
    .badge-success { background: #f0fff4; color: #276749; }
    .badge-warning { background: #fffff0; color: #975a16; }
    .badge-danger { background: #fff5f5; color: #c53030; }
  </style>
`;

export function wrapTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">${baseStyles}</head>
<body>
  <div class="container">
    <div class="header">
      <h1>NEXORA</h1>
      <div class="subtitle">Sistema de Trazabilidad Operativa</div>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      Este es un correo automático de NEXORA. No responda a este mensaje.
    </div>
  </div>
</body>
</html>`;
}
