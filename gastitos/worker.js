const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const encoder = new TextEncoder();

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});
const error = (message, status = 400) => json({ message }, status);
const dateOk = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const monthRange = (year, month) => ({ start: `${year}-${String(month).padStart(2, '0')}-01`, end: new Date(year, month, 0).toISOString().slice(0, 10) });
const row = item => ({ ...item, recurring: Boolean(item.recurring), recurrenceDay: item.recurrence_day, sourceExpenseId: item.source_expense_id });

const toBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
const bytesToBase64Url = bytes => toBase64Url(new Uint8Array(bytes));

async function digest(value) {
  return bytesToBase64Url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(bits)}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, iterations, saltText, expected] = String(stored).split('$');
  if (algorithm !== 'pbkdf2-sha256' || !iterations || !saltText || !expected) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromBase64Url(saltText), iterations: Number(iterations), hash: 'SHA-256' }, key, 256);
  return (await digest(bytesToBase64Url(bits))) === (await digest(expected));
}

function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  return cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

async function getUser(request, db) {
  const token = cookieValue(request, 'gastitos_session');
  if (!token) return null;
  const session = await db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP').bind(await digest(token)).first();
  if (!session) return null;
  return db.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(session.user_id).first();
}

async function createSession(db, userId) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  await db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)').bind(userId, await digest(token), expires).run();
  return token;
}

const sessionCookie = token => `gastitos_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
const clearSessionCookie = 'gastitos_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
const LOCAL_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const originOk = request => {
  const origin = request.headers.get('Origin');
  return !origin || LOCAL_ORIGINS.has(origin) || origin === new URL(request.url).origin;
};

async function scheduleRecurring(db, userId, year, month) {
  const templates = (await db.prepare('SELECT * FROM expenses WHERE user_id = ? AND recurring = 1').bind(userId).all()).results;
  for (const source of templates) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    if (source.date.slice(0, 7) === prefix) continue;
    const day = Math.min(source.recurrence_day || 1, new Date(year, month, 0).getDate());
    const date = `${prefix}-${String(day).padStart(2, '0')}`;
    const skip = await db.prepare('SELECT id FROM recurrence_skips WHERE user_id = ? AND source_expense_id = ? AND date = ?').bind(userId, source.id, date).first();
    const exists = await db.prepare('SELECT id FROM expenses WHERE user_id = ? AND source_expense_id = ? AND date = ?').bind(userId, source.id, date).first();
    if (!skip && !exists) await db.prepare('INSERT INTO expenses (user_id, amount, category, description, date, type, recurring, source_expense_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').bind(userId, source.amount, source.category, source.description, date, source.type, source.id).run();
  }
}

async function authApi(request, env, path) {
  const db = env.DB;
  if (request.method !== 'GET' && !originOk(request)) return error('Origen no permitido.', 403);
  if (path === '/api/auth/register' && request.method === 'POST') {
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase(), name = String(body.name || '').trim(), password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2 || name.length > 80 || password.length < 8 || password.length > 128) return error('Completá datos válidos. La contraseña debe tener entre 8 y 128 caracteres.');
    try {
      const result = await db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').bind(email, await hashPassword(password), name).run();
      const token = await createSession(db, result.meta.last_row_id);
      return json({ user: { id: result.meta.last_row_id, email, name } }, 201, { 'Set-Cookie': sessionCookie(token) });
    } catch (cause) {
      if (String(cause).toLowerCase().includes('unique')) return error('No se pudo crear la cuenta.', 409);
      throw cause;
    }
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    const body = await request.json(), email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
    const user = await db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').bind(email).first();
    if (!user || !(await verifyPassword(password, user.password_hash))) return error('Correo o contraseña incorrectos.', 401);
    const token = await createSession(db, user.id);
    return json({ user: { id: user.id, email: user.email, name: user.name } }, 200, { 'Set-Cookie': sessionCookie(token) });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = cookieValue(request, 'gastitos_session');
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie });
  }
  if (path === '/api/auth/me' && request.method === 'GET') return json({ user: await getUser(request, db) });
  return error('Ruta no encontrada.', 404);
}

async function api(request, env, path) {
  const db = env.DB, url = new URL(request.url);
  if (path.startsWith('/api/auth/')) return authApi(request, env, path);
  if (request.method !== 'GET' && !originOk(request)) return error('Origen no permitido.', 403);
  const user = await getUser(request, db);
  if (!user) return error('Autenticación requerida.', 401);
  const userId = user.id;

  if (path === '/api/expenses' && request.method === 'GET') {
    const year = Number(url.searchParams.get('year')), month = Number(url.searchParams.get('month'));
    let sql = 'SELECT * FROM expenses WHERE user_id = ?', values = [userId];
    if (year && month) { await scheduleRecurring(db, userId, year, month); const range = monthRange(year, month); sql += ' AND date BETWEEN ? AND ?'; values.push(range.start, range.end); }
    else if (year) { sql += ' AND date BETWEEN ? AND ?'; values.push(`${year}-01-01`, `${year}-12-31`); }
    sql += ' ORDER BY date DESC, id DESC';
    return json((await db.prepare(sql).bind(...values).all()).results.map(row));
  }
  if (path === '/api/expenses' && request.method === 'POST') {
    const body = await request.json(), amount = Number(body.amount);
    if (amount < 100 || !body.category?.trim() || !dateOk(body.date)) return error('El monto mínimo es $100. Completá categoría y fecha.');
    const recurring = Boolean(body.recurring), day = recurring ? Number(body.recurrenceDay) || Number(body.date.slice(8, 10)) : null;
    const result = await db.prepare('INSERT INTO expenses (user_id, amount, category, description, date, type, recurring, recurrence_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(userId, amount, body.category.trim(), body.description?.trim() || 'Sin descripción', body.date, body.type === 'fixed' ? 'fixed' : 'variable', recurring ? 1 : 0, day).run();
    return json({ id: result.meta.last_row_id }, 201);
  }
  if (path.startsWith('/api/expenses/') && request.method === 'DELETE') {
    const id = Number(path.split('/').pop()), expense = await db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!expense) return error('Gasto no encontrado.', 404);
    if (expense.recurring) { await db.prepare('DELETE FROM expenses WHERE user_id = ? AND source_expense_id = ?').bind(userId, id).run(); await db.prepare('DELETE FROM recurrence_skips WHERE user_id = ? AND source_expense_id = ?').bind(userId, id).run(); }
    else if (expense.source_expense_id) {
      const source = await db.prepare('SELECT id FROM expenses WHERE id = ? AND user_id = ?').bind(expense.source_expense_id, userId).first();
      if (source) await db.prepare('INSERT OR IGNORE INTO recurrence_skips (user_id, source_expense_id, date) VALUES (?, ?, ?)').bind(userId, source.id, expense.date).run();
    }
    await db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').bind(id, userId).run(); return new Response(null, { status: 204 });
  }
  if (path.startsWith('/api/recurrences/') && request.method === 'DELETE') {
    const id = Number(path.split('/').pop()), current = await db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!current) return error('Gasto no encontrado.', 404);
    const sourceId = current.recurring ? current.id : current.source_expense_id;
    if (!sourceId) return error('Este gasto no pertenece a una recurrencia.');
    const source = await db.prepare('SELECT id FROM expenses WHERE id = ? AND user_id = ?').bind(sourceId, userId).first();
    if (!source) return error('Recurrencia no encontrada.', 404);
    await db.prepare('DELETE FROM expenses WHERE user_id = ? AND (source_expense_id = ? OR id = ?)').bind(userId, sourceId, sourceId).run();
    await db.prepare('DELETE FROM recurrence_skips WHERE user_id = ? AND source_expense_id = ?').bind(userId, sourceId).run(); return new Response(null, { status: 204 });
  }
  if (path === '/api/budgets' && request.method === 'GET') {
    const year = Number(url.searchParams.get('year')), month = Number(url.searchParams.get('month'));
    return json((await db.prepare('SELECT id, category, limit_amount AS "limit", year, month FROM budgets WHERE user_id = ? AND year = ? AND month = ? ORDER BY category').bind(userId, year, month).all()).results);
  }
  if (path === '/api/budgets' && request.method === 'POST') {
    const body = await request.json(); if (!body.category?.trim() || Number(body.limit) < 100) return error('El límite mínimo es $100.');
    await db.prepare('INSERT INTO budgets (user_id, category, limit_amount, year, month) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, category, year, month) DO UPDATE SET limit_amount = excluded.limit_amount').bind(userId, body.category.trim(), Number(body.limit), Number(body.year), Number(body.month)).run(); return json({ ok: true }, 201);
  }
  if (path.startsWith('/api/budgets/') && request.method === 'DELETE') { await db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').bind(Number(path.split('/').pop()), userId).run(); return new Response(null, { status: 204 }); }
  if (path === '/api/summary' && request.method === 'GET') {
    const year = Number(url.searchParams.get('year')) || new Date().getFullYear(), rows = (await db.prepare('SELECT amount, category, date FROM expenses WHERE user_id = ? AND date BETWEEN ? AND ?').bind(userId, `${year}-01-01`, `${year}-12-31`).all()).results;
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 })), categories = {}; let total = 0;
    rows.forEach(item => { const value = Number(item.amount); total += value; months[Number(item.date.slice(5, 7)) - 1].total += value; categories[item.category] = (categories[item.category] || 0) + value; });
    return json({ year, total, months, categories });
  }
  if (path === '/api/import' && request.method === 'POST') {
    const body = await request.json(), list = Array.isArray(body.expenses) ? body.expenses : null;
    if (!list) return error('El archivo no tiene gastos válidos.'); let imported = 0;
    for (const item of list) if (Number(item.amount) >= 100 && item.category && dateOk(item.date)) { await db.prepare('INSERT INTO expenses (user_id, amount, category, description, date, type, recurring, recurrence_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(userId, Number(item.amount), item.category, item.description || 'Sin descripción', item.date, item.type === 'fixed' ? 'fixed' : 'variable', item.recurring ? 1 : 0, item.recurrenceDay || null).run(); imported++; }
    return json({ imported }, 201);
  }
  return error('Ruta no encontrada.', 404);
}

export default { async fetch(request, env) { const path = new URL(request.url).pathname; try { return path.startsWith('/api/') ? await api(request, env, path) : env.ASSETS.fetch(request); } catch (cause) { console.error(cause); return error('Ocurrió un error en el servidor.', 500); } } };
