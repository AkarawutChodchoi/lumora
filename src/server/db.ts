import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  // Query errors are thrown and handled (or logged) by the caller, so Prisma itself only logs warnings.
  new PrismaClient({
    log: ["warn"],
    // Interactive transactions default to a 5s budget, which is too tight when the
    // database is far away (e.g. local dev against a cloud region). Production sits
    // next to the database, so this only matters as a ceiling.
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
