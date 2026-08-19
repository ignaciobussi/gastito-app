var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } }), "json");
var error = /* @__PURE__ */ __name((message, status = 400) => json({ message }, status), "error");
var dateOk = /* @__PURE__ */ __name((value) => /^\d{4}-\d{2}-\d{2}$/.test(value || ""), "dateOk");
var monthRange = /* @__PURE__ */ __name((year, month) => ({ start: `${year}-${String(month).padStart(2, "0")}-01`, end: new Date(year, month, 0).toISOString().slice(0, 10) }), "monthRange");
var row = /* @__PURE__ */ __name((item) => ({ ...item, recurring: Boolean(item.recurring), recurrenceDay: item.recurrence_day, sourceExpenseId: item.source_expense_id }), "row");
async function scheduleRecurring(db, year, month) {
  const templates = (await db.prepare("SELECT * FROM expenses WHERE recurring = 1").all()).results;
  for (const source of templates) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    if (source.date.slice(0, 7) === prefix) continue;
    const day = Math.min(source.recurrence_day || 1, new Date(year, month, 0).getDate());
    const date = `${prefix}-${String(day).padStart(2, "0")}`;
    const skip = await db.prepare("SELECT id FROM recurrence_skips WHERE source_expense_id = ? AND date = ?").bind(source.id, date).first();
    const exists = await db.prepare("SELECT id FROM expenses WHERE source_expense_id = ? AND date = ?").bind(source.id, date).first();
    if (!skip && !exists) await db.prepare("INSERT INTO expenses (amount, category, description, date, type, recurring, source_expense_id) VALUES (?, ?, ?, ?, ?, 0, ?)").bind(source.amount, source.category, source.description, date, source.type, source.id).run();
  }
}
__name(scheduleRecurring, "scheduleRecurring");
async function api(request, env, path) {
  const db = env.DB, url = new URL(request.url);
  if (path === "/api/expenses" && request.method === "GET") {
    const year = Number(url.searchParams.get("year")), month = Number(url.searchParams.get("month"));
    let sql = "SELECT * FROM expenses", values = [];
    if (year && month) {
      await scheduleRecurring(db, year, month);
      const { start, end } = monthRange(year, month);
      sql += " WHERE date BETWEEN ? AND ?";
      values = [start, end];
    } else if (year) {
      sql += " WHERE date BETWEEN ? AND ?";
      values = [`${year}-01-01`, `${year}-12-31`];
    }
    sql += " ORDER BY date DESC, id DESC";
    return json((await db.prepare(sql).bind(...values).all()).results.map(row));
  }
  if (path === "/api/expenses" && request.method === "POST") {
    const body = await request.json();
    const amount = Number(body.amount);
    if (amount < 100 || !body.category?.trim() || !dateOk(body.date)) return error("El monto m\xEDnimo es $100. Complet\xE1 categor\xEDa y fecha.");
    const recurring = Boolean(body.recurring), day = recurring ? Number(body.recurrenceDay) || Number(body.date.slice(8, 10)) : null;
    const result = await db.prepare("INSERT INTO expenses (amount, category, description, date, type, recurring, recurrence_day) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(amount, body.category.trim(), body.description?.trim() || "Sin descripci\xF3n", body.date, body.type === "fixed" ? "fixed" : "variable", recurring ? 1 : 0, day).run();
    return json({ id: result.meta.last_row_id }, 201);
  }
  if (path.startsWith("/api/expenses/") && request.method === "DELETE") {
    const id = Number(path.split("/").pop()), expense = await db.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first();
    if (!expense) return error("Gasto no encontrado.", 404);
    if (expense.recurring) {
      await db.prepare("DELETE FROM expenses WHERE source_expense_id = ?").bind(id).run();
      await db.prepare("DELETE FROM recurrence_skips WHERE source_expense_id = ?").bind(id).run();
    } else if (expense.source_expense_id) await db.prepare("INSERT OR IGNORE INTO recurrence_skips (source_expense_id, date) VALUES (?, ?)").bind(expense.source_expense_id, expense.date).run();
    await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
    return new Response(null, { status: 204 });
  }
  if (path.startsWith("/api/recurrences/") && request.method === "DELETE") {
    const id = Number(path.split("/").pop()), current = await db.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first();
    if (!current) return error("Gasto no encontrado.", 404);
    const sourceId = current.recurring ? current.id : current.source_expense_id;
    if (!sourceId) return error("Este gasto no pertenece a una recurrencia.");
    await db.prepare("DELETE FROM expenses WHERE source_expense_id = ? OR id = ?").bind(sourceId, sourceId).run();
    await db.prepare("DELETE FROM recurrence_skips WHERE source_expense_id = ?").bind(sourceId).run();
    return new Response(null, { status: 204 });
  }
  if (path === "/api/budgets" && request.method === "GET") {
    const year = Number(url.searchParams.get("year")), month = Number(url.searchParams.get("month"));
    return json((await db.prepare('SELECT id, category, limit_amount AS "limit", year, month FROM budgets WHERE year = ? AND month = ? ORDER BY category').bind(year, month).all()).results);
  }
  if (path === "/api/budgets" && request.method === "POST") {
    const body = await request.json();
    if (!body.category?.trim() || Number(body.limit) < 100) return error("El l\xEDmite m\xEDnimo es $100.");
    await db.prepare("INSERT INTO budgets (category, limit_amount, year, month) VALUES (?, ?, ?, ?) ON CONFLICT(category, year, month) DO UPDATE SET limit_amount = excluded.limit_amount").bind(body.category.trim(), Number(body.limit), Number(body.year), Number(body.month)).run();
    return json({ ok: true }, 201);
  }
  if (path.startsWith("/api/budgets/") && request.method === "DELETE") {
    await db.prepare("DELETE FROM budgets WHERE id = ?").bind(Number(path.split("/").pop())).run();
    return new Response(null, { status: 204 });
  }
  if (path === "/api/summary" && request.method === "GET") {
    const year = Number(url.searchParams.get("year")) || (/* @__PURE__ */ new Date()).getFullYear(), rows = (await db.prepare("SELECT amount, category, date FROM expenses WHERE date BETWEEN ? AND ?").bind(`${year}-01-01`, `${year}-12-31`).all()).results;
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0 })), categories = {};
    let total = 0;
    rows.forEach((item) => {
      const value = Number(item.amount);
      total += value;
      months[Number(item.date.slice(5, 7)) - 1].total += value;
      categories[item.category] = (categories[item.category] || 0) + value;
    });
    return json({ year, total, months, categories });
  }
  if (path === "/api/import" && request.method === "POST") {
    const body = await request.json(), list = Array.isArray(body.expenses) ? body.expenses : null;
    if (!list) return error("El archivo no tiene gastos v\xE1lidos.");
    let imported = 0;
    for (const item of list) if (Number(item.amount) >= 100 && item.category && dateOk(item.date)) {
      await db.prepare("INSERT INTO expenses (amount, category, description, date, type, recurring, recurrence_day) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(Number(item.amount), item.category, item.description || "Sin descripci\xF3n", item.date, item.type === "fixed" ? "fixed" : "variable", item.recurring ? 1 : 0, item.recurrenceDay || null).run();
      imported++;
    }
    return json({ imported }, 201);
  }
  return error("Ruta no encontrada.", 404);
}
__name(api, "api");
var worker_default = { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  try {
    return path.startsWith("/api/") ? await api(request, env, path) : env.ASSETS.fetch(request);
  } catch (cause) {
    console.error(cause);
    return error("Ocurri\xF3 un error en el servidor.", 500);
  }
} };

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error2 = reduceError(e);
    const body = JSON.stringify(error2);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-AxHGAt/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-AxHGAt/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
