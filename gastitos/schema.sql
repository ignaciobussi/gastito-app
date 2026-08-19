CREATE TABLE IF NOT EXISTS expenses (
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
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_source ON expenses(source_expense_id);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL CHECK(limit_amount >= 100),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  UNIQUE(category, year, month)
);

CREATE TABLE IF NOT EXISTS recurrence_skips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_expense_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(source_expense_id, date)
);
