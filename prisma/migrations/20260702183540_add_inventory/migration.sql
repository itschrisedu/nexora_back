-- CreateEnum
CREATE TYPE "MovimientoTipo" AS ENUM ('ENTRADA_MERCANCIA', 'VENTA', 'DEVOLUCION_CLIENTE', 'DEVOLUCION_PROVEEDOR', 'BAJA', 'AJUSTE', 'RESERVA', 'LIBERACION_RESERVA');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "material" TEXT,
    "fotoUrl" TEXT,
    "precioCosto" DECIMAL(10,2) NOT NULL,
    "precioVenta" DECIMAL(10,2) NOT NULL,
    "serieId" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_by_talla" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "cantidadReservada" INTEGER NOT NULL DEFAULT 0,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_by_talla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tallaId" TEXT NOT NULL,
    "tipo" "MovimientoTipo" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "referenceId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "precioCostoAnterior" DECIMAL(10,2) NOT NULL,
    "precioVentaAnterior" DECIMAL(10,2) NOT NULL,
    "precioCostoNuevo" DECIMAL(10,2) NOT NULL,
    "precioVentaNuevo" DECIMAL(10,2) NOT NULL,
    "cambiadoPorId" TEXT NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_codigo_key" ON "products"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "stock_by_talla_productId_tallaId_key" ON "stock_by_talla"("productId", "tallaId");

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
