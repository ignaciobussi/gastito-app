const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const error = (message, status = 400) => json({ message }, status);
const dateOk = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const monthRange = (year, month) => ({ start: `${year}-${String(month).padStart(2, '0')}-01`, end: new Date(year, month, 0).toISOString().slice(0, 10) });
const row = item => ({ ...item, recurring: Boolean(item.recurring), recurrenceDay: item.recurrence_day, sourceExpenseId: item.source_expense_id });

async function scheduleRecurring(db, year, month) {
  const templates = (await db.prepare('SELECT * FROM expenses WHERE recurring = 1').all()).results;
  for (const source of templates) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    if (source.date.slice(0, 7) === prefix) continue;
    const day = Math.min(source.recurrence_day || 1, new Date(year, month, 0).getDate());
    const date = `${prefix}-${String(day).padStart(2, '0')}`;
    const skip = await db.prepare('SELECT id FROM recurrence_skips WHERE source_expense_id = ? AND date = ?').bind(source.id, date).first();
    const exists = await db.prepare('SELECT id FROM expenses WHERE source_expense_id = ? AND date = ?').bind(source.id, date).first();
    if (!skip && !exists) await db.prepare('INSERT INTO expenses (amount, category, description, date, type, recurring, source_expense_id) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(source.amount, source.category, source.description, date, source.type, source.id).run();
  }
}

async function api(request, env, path) {
  const db = env.DB, url = new URL(request.url);
  if (path === '/api/expenses' && request.method === 'GET') {
    const year = Number(url.searchParams.get('year')), month = Number(url.searchParams.get('month'));
    let sql = 'SELECT * FROM expenses', values = [];
    if (year && month) { await scheduleRecurring(db, year, month); const { start, end } = monthRange(year, month); sql += ' WHERE date BETWEEN ? AND ?'; values = [start, end]; }
    else if (year) { sql += ' WHERE date BETWEEN ? AND ?'; values = [`${year}-01-01`, `${year}-12-31`]; }
    sql += ' ORDER BY date DESC, id DESC';
    return json((await db.prepare(sql).bind(...values).all()).results.map(row));
  }
  if (path === '/api/expenses' && request.method === 'POST') {
    const body = await request.json(); const amount = Number(body.amount);
    if (amount < 100 || !body.category?.trim() || !dateOk(body.date)) return error('El monto mínimo es $100. Completá categoría y fecha.');
    const recurring = Boolean(body.recurring), day = recurring ? Number(body.recurrenceDay) || Number(body.date.slice(8, 10)) : null;
    const result = await db.prepare('INSERT INTO expenses (amount, category, description, date, type, recurring, recurrence_day) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(amount, body.category.trim(), body.description?.trim() || 'Sin descripción', body.date, body.type === 'fixed' ? 'fixed' : 'variable', recurring ? 1 : 0, day).run();
    return json({ id: result.meta.last_row_id }, 201);
  }
  if (path.startsWith('/api/expenses/') && request.method === 'DELETE') {
    const id = Number(path.split('/').pop()), expense = await db.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
    if (!expense) return error('Gasto no encontrado.', 404);
    if (expense.recurring) { await db.prepare('DELETE FROM expenses WHERE source_expense_id = ?').bind(id).run(); await db.prepare('DELETE FROM recurrence_skips WHERE source_expense_id = ?').bind(id).run(); }
    else if (expense.source_expense_id) await db.prepare('INSERT OR IGNORE INTO recurrence_skips (source_expense_id, date) VALUES (?, ?)').bind(expense.source_expense_id, expense.date).run();
    await db.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run(); return new Response(null, { status: 204 });
  }
  if (path.startsWith('/api/recurrences/') && request.method === 'DELETE') {
    const id = Number(path.split('/').pop()), current = await db.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
    if (!current) return error('Gasto no encontrado.', 404);
    const sourceId = current.recurring ? current.id : current.source_expense_id;
    if (!sourceId) return error('Este gasto no pertenece a una recurrencia.');
    await db.prepare('DELETE FROM expenses WHERE source_expense_id = ? OR id = ?').bind(sourceId, sourceId).run();
    await db.prepare('DELETE FROM recurrence_skips WHERE source_expense_id = ?').bind(sourceId).run(); return new Response(null, { status: 204 });
  }
  if (path === '/api/budgets' && request.method === 'GET') {
    const year = Number(url.searchParams.get('year')), month = Number(url.searchParams.get('month'));
    return json((await db.prepare('SELECT id, category, limit_amount AS "limit", year, month FROM budgets WHERE year = ? AND month = ? ORDER BY category').bind(year, month).all()).results);
  }
  if (path === '/api/budgets' && request.method === 'POST') {
    const body = await request.json(); if (!body.category?.trim() || Number(body.limit) < 100) return error('El límite mínimo es $100.');
    await db.prepare('INSERT INTO budgets (category, limit_amount, year, month) VALUES (?, ?, ?, ?) ON CONFLICT(category, year, month) DO UPDATE SET limit_amount = excluded.limit_amount').bind(body.category.trim(), Number(body.limit), Number(body.year), Number(body.month)).run(); return json({ ok: true }, 201);
  }
  if (path.startsWith('/api/budgets/') && request.method === 'DELETE') { await db.prepare('DELETE FROM budgets WHERE id = ?').bind(Number(path.split('/').pop())).run(); return new Response(null, { status: 204 }); }
  if (path === '/api/summary' && request.method === 'GET') {
    const year = Number(url.searchParams.get('year')) || new Date().getFullYear(), rows = (await db.prepare('SELECT amount, category, date FROM expenses WHERE date BETWEEN ? AND ?').bind(`${year}-01-01`, `${year}-12-31`).all()).results;
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 })), categories = {}; let total = 0;
    rows.forEach(item => { const value = Number(item.amount); total += value; months[Number(item.date.slice(5, 7)) - 1].total += value; categories[item.category] = (categories[item.category] || 0) + value; });
    return json({ year, total, months, categories });
  }
  if (path === '/api/import' && request.method === 'POST') {
    const body = await request.json(), list = Array.isArray(body.expenses) ? body.expenses : null;
    if (!list) return error('El archivo no tiene gastos válidos.'); let imported = 0;
    for (const item of list) if (Number(item.amount) >= 100 && item.category && dateOk(item.date)) { await db.prepare('INSERT INTO expenses (amount, category, description, date, type, recurring, recurrence_day) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(Number(item.amount), item.category, item.description || 'Sin descripción', item.date, item.type === 'fixed' ? 'fixed' : 'variable', item.recurring ? 1 : 0, item.recurrenceDay || null).run(); imported++; }
    return json({ imported }, 201);
  }
  return error('Ruta no encontrada.', 404);
}

export default { async fetch(request, env) { const path = new URL(request.url).pathname; try { return path.startsWith('/api/') ? await api(request, env, path) : env.ASSETS.fetch(request); } catch (cause) { console.error(cause); return error('Ocurrió un error en el servidor.', 500); } } };
