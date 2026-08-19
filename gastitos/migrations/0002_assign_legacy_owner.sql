-- Replace INITIAL_USER_ID with the id returned by the initial registration.
PRAGMA foreign_keys = ON;

UPDATE expenses
SET user_id = 1
WHERE user_id IS NULL;

UPDATE budgets
SET user_id = 1
WHERE user_id IS NULL;

UPDATE recurrence_skips
SET user_id = (
  SELECT e.user_id
  FROM expenses e
  WHERE e.id = recurrence_skips.source_expense_id
)
WHERE recurrence_skips.user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM expenses e
    WHERE e.id = recurrence_skips.source_expense_id
  );

SELECT 'expenses_without_owner' AS check_name, COUNT(*) AS result
FROM expenses WHERE user_id IS NULL;

SELECT 'budgets_without_owner' AS check_name, COUNT(*) AS result
FROM budgets WHERE user_id IS NULL;

SELECT 'recurrence_skips_without_owner' AS check_name, COUNT(*) AS result
FROM recurrence_skips WHERE user_id IS NULL;

SELECT 'invalid_recurrence_sources' AS check_name, COUNT(*) AS result
FROM recurrence_skips rs
LEFT JOIN expenses e ON e.id = rs.source_expense_id
WHERE e.id IS NULL;

SELECT 'cross_user_recurrence_sources' AS check_name, COUNT(*) AS result
FROM recurrence_skips rs
JOIN expenses e ON e.id = rs.source_expense_id
WHERE rs.user_id <> e.user_id;

