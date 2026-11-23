import { readFileSync } from "node:fs";
import { backup, DatabaseSync } from "node:sqlite";

const migrations = [
  "20261123000100_baseline",
  "20261123000200_integrity_and_jobs",
];

function readMigration(migration) {
  return readFileSync(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8");
}

export function applyTestMigrations(databaseUrl) {
  const database = new DatabaseSync(databaseUrl.slice("file:".length));
  try {
    for (const migration of migrations) {
      database.exec(readMigration(migration));
    }
  } finally {
    database.close();
  }
}

export async function verifyMigrationAndBackup(legacyPath, backupPath) {
  const original = new DatabaseSync(legacyPath);
  try {
    original.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
    original.exec(readMigration(migrations[0]));
    original.exec(`
      INSERT INTO User (id,email,balanceKopeks,updatedAt)
      VALUES ('legacy-user','legacy@example.test',1201,1);
      INSERT INTO Payment (id,userId,status,method,amountKopeks,description,creditedAt,updatedAt)
      VALUES ('legacy-pay','legacy-user','SUCCEEDED','bank_card',1201,'Legacy payment',1,1);
      INSERT INTO BalanceTransaction (id,userId,type,amountKopeks,description)
      VALUES ('legacy-ledger','legacy-user','TOPUP',1201,'Legacy ledger');
    `);
    await backup(original, backupPath);
    const restored = new DatabaseSync(backupPath);
    try {
      restored.exec(readMigration(migrations[1]));
      return {
        integrity: restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
        foreignKeys: restored.prepare("PRAGMA foreign_key_check").all().length,
        balance: restored.prepare("SELECT balanceKopeks FROM User WHERE id='legacy-user' AND vpnSyncAt IS NOT NULL").get()?.balanceKopeks,
        payment: restored.prepare("SELECT count(*) AS total FROM Payment WHERE id='legacy-pay' AND creditedAt=1").get()?.total,
        ledger: restored.prepare("SELECT sum(amountKopeks) AS total FROM BalanceTransaction").get()?.total,
        originalColumns: original.prepare("SELECT count(*) AS total FROM pragma_table_info('User') WHERE name='vpnSyncAt'").get()?.total,
      };
    } finally {
      restored.close();
    }
  } finally {
    original.close();
  }
}
