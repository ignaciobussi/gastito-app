PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL CHECK(amount >= 100),
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT 'Sin descripción',
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'variable' CHECK(type IN ('variable', 'fixed')),
  recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_day INTEGER,
  source_expense_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL CHECK(limit_amount >= 100),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  UNIQUE(category, year, month)
);
CREATE TABLE recurrence_skips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_expense_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(source_expense_id, date)
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('expenses',1);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_source ON expenses(source_expense_id);
