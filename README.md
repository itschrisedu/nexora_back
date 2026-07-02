# NEXORA — Enterprise Commerce Lifecycle & Credit Scoring System (Backend API)

NEXORA is a high-performance backend API built using **NestJS**, **TypeScript**, **Prisma ORM**, and **PostgreSQL (Neon)**. Designed using **Domain-Driven Design (DDD)** and Clean Architecture principles, it handles transactional operations, operational traceability, and dynamic credit scoring for footwear retailers.

---

## 🚀 Tech Stack

- **Core Framework:** NestJS (TypeScript)
- **Database ORM:** Prisma 7.x (with `@prisma/adapter-pg` driver adapter)
- **Database Engine:** PostgreSQL (Neon Cloud)
- **Security & Crypto:** AES-256-GCM for sensitive PII encryption, Passport JWT for authentication, Bcrypt (12 rounds) for password hashing
- **Testing:** Jest & Supertest

---

## 🧱 Architecture & Design Patterns

The project enforces strict separation of concerns through:
- **Domain-Driven Design (DDD):** Encapsulation of domain logic within `ValueObjects`, `Entities`, and `AggregateRoots`. Business invariants are protected by the domain model.
- **Clean Architecture:** Strict dependency direction from outer infrastructure layers inwards to application use cases and the core domain kernel.
- **Modular Bounded Contexts:** Independent domain boundary contexts (such as `Inventory`, `Customers`, and `Commercial`) prepared for modular scalability.

---

## 📂 Project Structure

```
nexora_back/
├── prisma/
│   ├── schema.prisma          # Database schema definitions (Phase 1)
│   └── seed.ts                # Database seeder (Admin account, Shoe series & sizes)
├── src/
│   ├── shared/
│   │   ├── domain/            # DDD Core Kernel (AggregateRoot, Entity, ValueObject, Money)
│   │   ├── infrastructure/    # Cross-cutting tech utilities (PrismaService, EncryptionService)
│   │   ├── guards/            # JwtAuthGuard, RolesGuard & @Roles() decorator
│   │   └── filters/           # Global Exception Filters for JSON API standardization
│   ├── auth/                  # JWT Authentication Context (Login, Logout, Rotated Refresh Tokens)
│   ├── configuracion/         # General System Config Bounded Context (Business Data, Seasons, Series/Sizes)
│   ├── bounded-contexts/      # Empty templates for future contexts (Inventory, Customers, etc.)
│   ├── app.module.ts          # Main application entry wiring
│   └── main.ts                # Application bootstraper (ValidationPipes, ExceptionFilters, CORS, API Prefix)
├── prisma.config.ts           # Prisma 7 configurations mapping adapter & migrations
├── .env                       # Local environment configurations (ignored by git)
└── README.md                  # This file
```

---

## 🛠️ Prerequisites

- **Node.js:** `^20.x` or higher
- **npm:** `^10.x` or higher
- **PostgreSQL Database:** A hosted instance (e.g., Neon Cloud) or local installation

---

## ⚙️ Getting Started & Installation

### 1. Environment Configurations
Clone the template environment file and fill in your connection details:
```bash
cp .env.example .env
```
Open `.env` and configure:
- `DATABASE_URL`: Your secure PostgreSQL connection string.
- `AES_MASTER_KEY`: A 64-character hex string (32 bytes) used for encrypting RUC/IDs.

### 2. Install Dependencies
```bash
npm install
```

### 3. Generate Prisma Client Types
```bash
npx prisma generate
```

### 4. Run Database Migrations
Apply the initial schema to your PostgreSQL database:
```bash
npx prisma migrate dev --name init
```

### 5. Seed the Database
Initialize the database with the default system configurations, shoe size configurations, and the default system administrator:
```bash
npx prisma db seed
```
> **Default Admin Credentials:**
> - **Email:** `admin@nexora.app`
> - **Password:** `Admin123!`

---

## 🏃 Running the Application

### Development Mode
Runs the application with hot-reloading active:
```bash
npm run start:dev
```
The server will run on: `http://localhost:3001/api`

### Production Mode
Compiles the TypeScript code into production JavaScript and launches the build:
```bash
npm run build
npm run start:prod
```

---

## 🧪 Testing

The codebase includes comprehensive unit tests verifying the domain invariants (`Money`) and the core security capabilities (`EncryptionService` AES-256-GCM).

To execute the test suite:
```bash
npm run test
```

---

## 🛡️ Security Features

1. **At-Rest Sensitive Data Encryption:** Client identification details (RUC and Personal IDs) are encrypted via AES-256-GCM. A unique random Initialization Vector (IV) is generated for each entry to prevent cipher pattern detection.
2. **Access Security Guards:** JWT verification tokens are validated globally. Specific endpoints are guarded by a custom Role-Based Access Control (RBAC) guard using `@Roles(...)` (supports `ROL_ADMIN`, `ROL_VENDEDOR`, and `ROL_BODEGUERO`).
3. **Password Security:** Password hashes are computed with Bcrypt using a safe strength multiplier of 12 rounds.
