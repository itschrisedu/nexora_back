-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ROL_ADMIN', 'ROL_VENDEDOR', 'ROL_BODEGUERO');

-- CreateEnum
CREATE TYPE "SeasonTipo" AS ENUM ('INICIO_CLASES', 'NAVIDAD', 'FIESTAS_LOCALES', 'OTRA');

-- CreateEnum
CREATE TYPE "MovimientoTipo" AS ENUM ('ENTRADA_MERCANCIA', 'VENTA', 'DEVOLUCION_CLIENTE', 'DEVOLUCION_PROVEEDOR', 'BAJA', 'AJUSTE', 'RESERVA', 'LIBERACION_RESERVA');

-- CreateEnum
CREATE TYPE "NivelCredito" AS ENUM ('SIN_CREDITO', 'NIVEL_1', 'NIVEL_2', 'NIVEL_3', 'NIVEL_4');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('EN_ESPERA_STOCK', 'PENDIENTE', 'EN_PREPARACION', 'EN_TRANSITO', 'MODIFICADO', 'CANCELADO', 'ENTREGADO');

-- CreateEnum
CREATE TYPE "CanalEntrada" AS ENUM ('MANUAL', 'WHATSAPP', 'CATALOGO');

-- CreateEnum
CREATE TYPE "TipoPago" AS ENUM ('CONTADO', 'CREDITO');

-- CreateEnum
CREATE TYPE "TipoVenta" AS ENUM ('SERIE_COMPLETA', 'TALLA_ESPECIFICA');

-- CreateEnum
CREATE TYPE "DispatchEstado" AS ENUM ('PENDIENTE_SEPARACION', 'SEPARADO', 'EN_TRANSITO');

-- CreateEnum
CREATE TYPE "TipoCobro" AS ENUM ('CONTADO', 'CREDITO');

-- CreateEnum
CREATE TYPE "CobroEstado" AS ENUM ('PENDIENTE', 'PARCIALMENTE_PAGADO', 'SALDADO');

-- CreateEnum
CREATE TYPE "DeudaEstado" AS ENUM ('PENDIENTE', 'PARCIALMENTE_PAGADO', 'SALDADO');

-- CreateEnum
CREATE TYPE "SupplierOrderStatus" AS ENUM ('PENDIENTE', 'RECIBIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_config" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ruc" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "SeasonTipo" NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_config" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "series_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "talla_config" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "serieId" TEXT NOT NULL,

    CONSTRAINT "talla_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_models" (
    "id" TEXT NOT NULL,
    "baseCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "material" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "imageUrl" TEXT,
    "costPrice" DECIMAL(10,2) NOT NULL,
    "salePrice" DECIMAL(10,2) NOT NULL,
    "serieId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_by_talla" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_by_talla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "canceled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "type" "MovimientoTipo" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "previousCostPrice" DECIMAL(10,2) NOT NULL,
    "previousSalePrice" DECIMAL(10,2) NOT NULL,
    "newCostPrice" DECIMAL(10,2) NOT NULL,
    "newSalePrice" DECIMAL(10,2) NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "ruc" TEXT,
    "cedula" TEXT,
    "direccion" TEXT,
    "notas" TEXT,
    "nivelCredito" "NivelCredito" NOT NULL DEFAULT 'SIN_CREDITO',
    "totalCompras" INTEGER NOT NULL DEFAULT 0,
    "comprasSinAtraso" INTEGER NOT NULL DEFAULT 0,
    "atrasoConsecutivo" INTEGER NOT NULL DEFAULT 0,
    "limiteCredito" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "creditoUtilizado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_score_history" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "nivelAnterior" "NivelCredito" NOT NULL,
    "nivelNuevo" "NivelCredito" NOT NULL,
    "motivo" TEXT NOT NULL,
    "ajustadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_level_config" (
    "id" TEXT NOT NULL,
    "nivel" "NivelCredito" NOT NULL,
    "comprasRequeridas" INTEGER NOT NULL,
    "limiteDolares" DECIMAL(10,2) NOT NULL,
    "plazoDias" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_level_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'PENDIENTE',
    "canal" "CanalEntrada" NOT NULL,
    "tipoPago" "TipoPago" NOT NULL,
    "montoTotal" DECIMAL(10,2) NOT NULL,
    "notas" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "serieId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "tipoVenta" "TipoVenta" NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_queues" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "prioridadFifo" TIMESTAMP(3) NOT NULL,
    "nivelCredito" "NivelCredito" NOT NULL,
    "totalHistorico" DECIMAL(10,2) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "activadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_orders" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "estado" "DispatchEstado" NOT NULL DEFAULT 'PENDIENTE_SEPARACION',
    "confirmadoPorId" TEXT,
    "confirmadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_order_lines" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "serieId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "aceptada" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dispatch_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_modifications" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tipoModificacion" TEXT NOT NULL,
    "montoOriginal" DECIMAL(10,2) NOT NULL,
    "montoNuevo" DECIMAL(10,2) NOT NULL,
    "lineasRechazadas" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_modifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_notes" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "pdfUrl" TEXT,
    "enviada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_note_lines" (
    "id" TEXT NOT NULL,
    "saleNoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "talla" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "sale_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobros" (
    "id" TEXT NOT NULL,
    "saleNoteId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tipo" "TipoCobro" NOT NULL,
    "montoTotal" DECIMAL(10,2) NOT NULL,
    "saldoPendiente" DECIMAL(10,2) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "estado" "CobroEstado" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobro_abonos" (
    "id" TEXT NOT NULL,
    "cobroId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "metodo" TEXT NOT NULL,
    "notas" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cobro_abonos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deudas_proveedor" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "entradaId" TEXT NOT NULL,
    "montoTotal" DECIMAL(10,2) NOT NULL,
    "saldoPendiente" DECIMAL(10,2) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "estado" "DeudaEstado" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deudas_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deuda_pagos" (
    "id" TEXT NOT NULL,
    "deudaId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "metodo" TEXT NOT NULL,
    "notas" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deuda_pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "ruc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "contacto" TEXT,
    "direccion" TEXT,
    "email" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_orders" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "supplierId" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "estado" "SupplierOrderStatus" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_lines" (
    "id" TEXT NOT NULL,
    "supplierOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "cantidadPedida" INTEGER NOT NULL,
    "precioCosto" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "supplier_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandise_entries" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "supplierOrderId" TEXT,
    "supplierId" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "fechaIngreso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchandise_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchandise_entry_lines" (
    "id" TEXT NOT NULL,
    "merchandiseEntryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "cantidadIngresada" INTEGER NOT NULL,
    "precioCosto" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "merchandise_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "eventoOrigen" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ENVIADO',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_key" ON "password_resets"("token");

-- CreateIndex
CREATE UNIQUE INDEX "series_config_nombre_key" ON "series_config"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "product_models_baseCode_key" ON "product_models"("baseCode");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_by_talla_productId_tallaId_key" ON "stock_by_talla"("productId", "tallaId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_level_config_nivel_key" ON "credit_level_config"("nivel");

-- CreateIndex
CREATE UNIQUE INDEX "order_queues_orderId_key" ON "order_queues"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_orders_orderId_key" ON "dispatch_orders"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_notes_numero_key" ON "sale_notes"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_saleNoteId_key" ON "cobros"("saleNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "deudas_proveedor_entradaId_key" ON "deudas_proveedor"("entradaId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_ruc_key" ON "suppliers"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_numero_key" ON "supplier_orders"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "merchandise_entries_numero_key" ON "merchandise_entries"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "merchandise_entries_supplierOrderId_key" ON "merchandise_entries"("supplierOrderId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talla_config" ADD CONSTRAINT "talla_config_serieId_fkey" FOREIGN KEY ("serieId") REFERENCES "series_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "product_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_serieId_fkey" FOREIGN KEY ("serieId") REFERENCES "series_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_by_talla" ADD CONSTRAINT "stock_by_talla_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_by_talla" ADD CONSTRAINT "stock_by_talla_tallaId_fkey" FOREIGN KEY ("tallaId") REFERENCES "talla_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_score_history" ADD CONSTRAINT "credit_score_history_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_queues" ADD CONSTRAINT "order_queues_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_orders" ADD CONSTRAINT "dispatch_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_order_lines" ADD CONSTRAINT "dispatch_order_lines_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "dispatch_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_note_lines" ADD CONSTRAINT "sale_note_lines_saleNoteId_fkey" FOREIGN KEY ("saleNoteId") REFERENCES "sale_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_saleNoteId_fkey" FOREIGN KEY ("saleNoteId") REFERENCES "sale_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobro_abonos" ADD CONSTRAINT "cobro_abonos_cobroId_fkey" FOREIGN KEY ("cobroId") REFERENCES "cobros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deuda_pagos" ADD CONSTRAINT "deuda_pagos_deudaId_fkey" FOREIGN KEY ("deudaId") REFERENCES "deudas_proveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "supplier_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_entries" ADD CONSTRAINT "merchandise_entries_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "supplier_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_entries" ADD CONSTRAINT "merchandise_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_entry_lines" ADD CONSTRAINT "merchandise_entry_lines_merchandiseEntryId_fkey" FOREIGN KEY ("merchandiseEntryId") REFERENCES "merchandise_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
