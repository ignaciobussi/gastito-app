PRAGMA foreign_keys = ON;

CREATE TRIGGER expenses_require_user_id_insert
BEFORE INSERT ON expenses
FOR EACH ROW WHEN NEW.user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'expenses.user_id is required');
END;

CREATE TRIGGER expenses_require_user_id_update
BEFORE UPDATE OF user_id ON expenses
FOR EACH ROW WHEN NEW.user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'expenses.user_id is required');
END;

CREATE TRIGGER recurrence_skips_require_user_id_insert
BEFORE INSERT ON recurrence_skips
FOR EACH ROW WHEN NEW.user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'recurrence_skips.user_id is required');
END;

CREATE TRIGGER recurrence_skips_require_user_id_update
BEFORE UPDATE OF user_id ON recurrence_skips
FOR EACH ROW WHEN NEW.user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'recurrence_skips.user_id is required');
END;

CREATE TABLE budgets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL CHECK(limit_amount >= 100),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  UNIQUE(user_id, category, year, month)
);

INSERT INTO budgets_new (id, user_id, category, limit_amount, year, month)
SELECT id, user_id, category, limit_amount, year, month
FROM budgets;

DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;

CREATE INDEX idx_budgets_user_id ON budgets(user_id);

