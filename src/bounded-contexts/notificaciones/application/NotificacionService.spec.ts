import { NotificacionService } from './NotificacionService';
import { INotificationSender } from '../domain/INotificationSender';
import { NotificationPayload } from '../domain/NotificationPayload';

describe('NotificacionService', () => {
  let service: NotificacionService;
  let mockEmailSender: jest.Mocked<INotificationSender>;
  let mockWhatsAppSender: jest.Mocked<INotificationSender>;
  let mockPrisma: any;

  beforeEach(() => {
    mockEmailSender = { send: jest.fn() };
    mockWhatsAppSender = { send: jest.fn() };
    mockPrisma = {
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
      client: { findUnique: jest.fn() },
    };

    service = new NotificacionService(
      mockPrisma,
      mockEmailSender,
      mockWhatsAppSender,
    );
  });

  it('debe despachar al emailSender cuando canal es EMAIL', async () => {
    mockEmailSender.send.mockResolvedValue({ success: true });

    const payload: NotificationPayload = {
      canal: 'EMAIL',
      destinatario: 'test@example.com',
      asunto: 'Test',
      cuerpoHtml: '<p>Hola</p>',
      eventoOrigen: 'PedidoConfirmado',
    };

    await service.enviar(payload);

    expect(mockEmailSender.send).toHaveBeenCalledWith(payload);
    expect(mockWhatsAppSender.send).not.toHaveBeenCalled();
    expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canal: 'EMAIL',
        estado: 'ENVIADO',
        destinatario: 'test@example.com',
      }),
    });
  });

  it('debe despachar al whatsAppSender cuando canal es WHATSAPP', async () => {
    mockWhatsAppSender.send.mockResolvedValue({ success: true });

    const payload: NotificationPayload = {
      canal: 'WHATSAPP',
      destinatario: '+593991234567',
      asunto: 'Test WA',
      cuerpoHtml: 'Hola',
      eventoOrigen: 'PedidoEntregado',
    };

    await service.enviar(payload);

    expect(mockWhatsAppSender.send).toHaveBeenCalledWith(payload);
    expect(mockEmailSender.send).not.toHaveBeenCalled();
  });

  it('debe registrar FALLIDO cuando el sender devuelve error', async () => {
    mockEmailSender.send.mockResolvedValue({ success: false, error: 'Invalid email' });

    await service.enviar({
      canal: 'EMAIL',
      destinatario: 'bad@email',
      asunto: 'Fail',
      cuerpoHtml: '',
      eventoOrigen: 'Test',
    });

    expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        estado: 'FALLIDO',
        error: 'Invalid email',
      }),
    });
  });

  it('debe registrar FALLIDO cuando el sender lanza excepción', async () => {
    mockEmailSender.send.mockRejectedValue(new Error('Network error'));

    await service.enviar({
      canal: 'EMAIL',
      destinatario: 'test@test.com',
      asunto: 'Crash',
      cuerpoHtml: '',
      eventoOrigen: 'Test',
    });

    // Debe registrar el fallo en el catch
    expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        estado: 'FALLIDO',
        error: 'Network error',
      }),
    });
  });

  it('obtenerEmailCliente devuelve null si no existe el cliente', async () => {
    mockPrisma.client.findUnique.mockResolvedValue(null);
    const email = await service.obtenerEmailCliente('no-existe');
    expect(email).toBeNull();
  });

  it('obtenerEmailCliente devuelve el email si existe', async () => {
    mockPrisma.client.findUnique.mockResolvedValue({ email: 'found@test.com' });
    const email = await service.obtenerEmailCliente('client-1');
    expect(email).toBe('found@test.com');
  });
});
