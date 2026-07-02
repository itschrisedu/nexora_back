import { Pedido } from './Pedido';
import { LineaPedido } from './LineaPedido';
import { CanalEntrada, PrismaCanalEntrada } from './value-objects/CanalEntrada';
import { TipoPago, PrismaTipoPago } from './value-objects/TipoPago';
import { TipoVenta, PrismaTipoVenta } from './value-objects/TipoVenta';
import { Money } from '../../../shared/domain/Money';
import { PrismaEstadoPedido, TransicionEstadoInvalidaException } from './value-objects/EstadoPedido';

// ── Helpers de Pruebas ─────────────────────────

function crearLineaDePrueba(overrides?: {
  productId?: string;
  cantidad?: number;
  precioUnitario?: number;
}): LineaPedido {
  return LineaPedido.crear(
    crypto.randomUUID(),
    overrides?.productId ?? 'prod-001',
    'serie-001',
    'talla-38',
    overrides?.cantidad ?? 2,
    Money.create(overrides?.precioUnitario ?? 25.0),
    TipoVenta.create(PrismaTipoVenta.SERIE_COMPLETA),
  );
}

function crearPedidoPendiente(lineas?: LineaPedido[]): Pedido {
  const lines = lineas ?? [crearLineaDePrueba()];
  return Pedido.crear(
    crypto.randomUUID(),
    'client-001',
    CanalEntrada.create(PrismaCanalEntrada.WHATSAPP),
    TipoPago.create(PrismaTipoPago.CONTADO),
    lines,
    PrismaEstadoPedido.PENDIENTE,
    'user-admin-001',
  );
}

function crearPedidoEnEsperaStock(): Pedido {
  return Pedido.crear(
    crypto.randomUUID(),
    'client-001',
    CanalEntrada.create(PrismaCanalEntrada.MANUAL),
    TipoPago.create(PrismaTipoPago.CREDITO),
    [crearLineaDePrueba()],
    PrismaEstadoPedido.EN_ESPERA_STOCK,
    'user-admin-001',
  );
}

// ══════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════

describe('Pedido — Aggregate Root', () => {
  // ── Creación ─────────────────────────────────

  describe('Creación', () => {
    it('debe crear un pedido PENDIENTE con líneas válidas', () => {
      const pedido = crearPedidoPendiente();

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.PENDIENTE);
      expect(pedido.lineas.length).toBe(1);
      expect(pedido.montoTotal.amount).toBe(50); // 2 * $25
      expect(pedido.canal.value).toBe('WHATSAPP');
      expect(pedido.tipoPago.value).toBe('CONTADO');
    });

    it('debe crear un pedido EN_ESPERA_STOCK', () => {
      const pedido = crearPedidoEnEsperaStock();

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_ESPERA_STOCK);
    });

    it('debe calcular correctamente el monto total con múltiples líneas', () => {
      const lineas = [
        crearLineaDePrueba({ cantidad: 3, precioUnitario: 20 }),  // $60
        crearLineaDePrueba({ cantidad: 5, precioUnitario: 30 }),  // $150
      ];
      const pedido = crearPedidoPendiente(lineas);

      expect(pedido.montoTotal.amount).toBe(210);
    });

    it('debe lanzar error si no tiene líneas', () => {
      expect(() =>
        Pedido.crear(
          crypto.randomUUID(),
          'client-001',
          CanalEntrada.create('WHATSAPP'),
          TipoPago.create('CONTADO'),
          [],
          PrismaEstadoPedido.PENDIENTE,
          'user-admin-001',
        ),
      ).toThrow('El pedido debe tener al menos una línea');
    });
  });

  // ── Eventos de Dominio ──────────────────────

  describe('Eventos de dominio en creación', () => {
    it('debe emitir PedidoCreado al crear con estado PENDIENTE', () => {
      const pedido = crearPedidoPendiente();
      const events = pedido.domainEvents;

      expect(events.length).toBe(1);
      expect(events[0].eventName).toBe('PedidoCreado');
    });

    it('debe emitir PedidoEnEsperaStock al crear con stock insuficiente', () => {
      const pedido = crearPedidoEnEsperaStock();
      const events = pedido.domainEvents;

      expect(events.length).toBe(1);
      expect(events[0].eventName).toBe('PedidoEnEsperaStock');
    });
  });

  // ── Máquina de Estados ─────────────────────

  describe('Transiciones de estado', () => {
    it('PENDIENTE → EN_PREPARACION', () => {
      const pedido = crearPedidoPendiente();
      pedido.iniciarPreparacion();

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_PREPARACION);
      // Último evento emitido
      const events = pedido.domainEvents;
      expect(events[events.length - 1].eventName).toBe('PedidoEnPreparacion');
    });

    it('EN_PREPARACION → EN_TRANSITO', () => {
      const pedido = crearPedidoPendiente();
      pedido.iniciarPreparacion();
      pedido.marcarEnTransito();

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_TRANSITO);
    });

    it('EN_TRANSITO → ENTREGADO', () => {
      const pedido = crearPedidoPendiente();
      pedido.iniciarPreparacion();
      pedido.marcarEnTransito();
      pedido.entregar();

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.ENTREGADO);
    });

    it('EN_ESPERA_STOCK → PENDIENTE (confirmar)', () => {
      const pedido = crearPedidoEnEsperaStock();
      pedido.confirmar();

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.PENDIENTE);
      const events = pedido.domainEvents;
      expect(events[events.length - 1].eventName).toBe('PedidoConfirmado');
    });

    it('PENDIENTE → CANCELADO', () => {
      const pedido = crearPedidoPendiente();
      pedido.cancelar('Cliente solicitó cancelación');

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.CANCELADO);
      const events = pedido.domainEvents;
      expect(events[events.length - 1].eventName).toBe('PedidoCancelado');
    });

    it('EN_ESPERA_STOCK → CANCELADO', () => {
      const pedido = crearPedidoEnEsperaStock();
      pedido.cancelar('Stock nunca llegó');

      expect(pedido.estado.value).toBe(PrismaEstadoPedido.CANCELADO);
    });

    it('EN_TRANSITO → MODIFICADO', () => {
      const pedido = crearPedidoPendiente();
      pedido.iniciarPreparacion();
      pedido.marcarEnTransito();
      // EN_TRANSITO permite ir a MODIFICADO
      const estado = pedido.estado;
      const nuevoEstado = estado.transicionarA(PrismaEstadoPedido.MODIFICADO);

      expect(nuevoEstado.value).toBe(PrismaEstadoPedido.MODIFICADO);
    });
  });

  // ── Transiciones Inválidas ─────────────────

  describe('Transiciones inválidas', () => {
    it('PENDIENTE → ENTREGADO debe lanzar error', () => {
      const pedido = crearPedidoPendiente();

      expect(() => pedido.entregar()).toThrow(TransicionEstadoInvalidaException);
    });

    it('CANCELADO → PENDIENTE debe lanzar error', () => {
      const pedido = crearPedidoPendiente();
      pedido.cancelar('motivo');

      expect(() => pedido.confirmar()).toThrow(TransicionEstadoInvalidaException);
    });

    it('ENTREGADO → CANCELADO debe lanzar error', () => {
      const pedido = crearPedidoPendiente();
      pedido.iniciarPreparacion();
      pedido.marcarEnTransito();
      pedido.entregar();

      expect(() => pedido.cancelar('intento tardío')).toThrow(TransicionEstadoInvalidaException);
    });

    it('EN_ESPERA_STOCK → EN_PREPARACION debe lanzar error (no puede saltarse PENDIENTE)', () => {
      const pedido = crearPedidoEnEsperaStock();

      expect(() => pedido.iniciarPreparacion()).toThrow(TransicionEstadoInvalidaException);
    });
  });

  // ── LineaPedido ─────────────────────────────

  describe('LineaPedido', () => {
    it('debe calcular subtotal correctamente', () => {
      const linea = crearLineaDePrueba({ cantidad: 4, precioUnitario: 15 });

      expect(linea.subtotal.amount).toBe(60);
    });

    it('debe rechazar cantidad cero', () => {
      expect(() => crearLineaDePrueba({ cantidad: 0 })).toThrow(
        'La cantidad de la línea de pedido debe ser mayor que cero',
      );
    });

    it('debe rechazar cantidad negativa', () => {
      expect(() => crearLineaDePrueba({ cantidad: -1 })).toThrow(
        'La cantidad de la línea de pedido debe ser mayor que cero',
      );
    });
  });

  // ── Reconstrucción ──────────────────────────

  describe('Reconstrucción (desde BD)', () => {
    it('debe reconstruir un pedido sin emitir eventos', () => {
      const linea = LineaPedido.reconstruir('line-1', {
        productId: 'prod-001',
        serieId: 'serie-001',
        tallaId: 'talla-38',
        cantidad: 2,
        precioUnitario: Money.create(25),
        tipoVenta: TipoVenta.create(PrismaTipoVenta.SERIE_COMPLETA),
      });

      const pedido = Pedido.reconstruir(
        'pedido-reconst-1',
        'client-001',
        require('./value-objects/EstadoPedido').EstadoPedido.create(PrismaEstadoPedido.EN_PREPARACION),
        CanalEntrada.create(PrismaCanalEntrada.MANUAL),
        TipoPago.create(PrismaTipoPago.CREDITO),
        [linea],
        Money.create(50),
        'user-admin-001',
        new Date('2026-01-15'),
      );

      expect(pedido.id).toBe('pedido-reconst-1');
      expect(pedido.estado.value).toBe(PrismaEstadoPedido.EN_PREPARACION);
      expect(pedido.domainEvents.length).toBe(0); // Reconstrucción NO genera eventos
    });
  });

  // ── clearDomainEvents ──────────────────────

  describe('clearDomainEvents', () => {
    it('debe limpiar los eventos y devolverlos', () => {
      const pedido = crearPedidoPendiente();

      expect(pedido.domainEvents.length).toBe(1);

      const cleared = pedido.clearDomainEvents();

      expect(cleared.length).toBe(1);
      expect(pedido.domainEvents.length).toBe(0);
    });
  });
});
