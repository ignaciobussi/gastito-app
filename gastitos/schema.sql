CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL CHECK(limit_amount >= 100),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  UNIQUE(user_id, category, year, month)
);
CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON budgets(user_id);

CREATE TABLE IF NOT EXISTS recurrence_skips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_expense_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(source_expense_id, date)
);
CREATE INDEX IF NOT EXISTS idx_recurrence_skips_user_id ON recurrence_skips(user_id);
