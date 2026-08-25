import express from "express";

/**
 * Express 4 does not forward rejected promises from `async` route handlers to
 * the error middleware: the rejection goes unhandled and, on Node >= 15, the
 * whole process exits. A single bad request (e.g. a value Postgres refuses)
 * could therefore take the API down for everyone.
 *
 * This patches the Router so every handler registered anywhere is wrapped:
 * async failures reach the normal error handler and the client gets a clean
 * 500 instead of a dead server.
 *
 * Must be imported before any module that creates a Router.
 */
const METHODS = [
  "use",
  "all",
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;

const WRAPPED = Symbol("asyncWrapped");

function wrapHandler(fn: any): any {
  if (typeof fn !== "function" || fn[WRAPPED]) return fn;

  // Error-handling middleware is identified by its arity — keep it at 4
  if (fn.length === 4) {
    const wrapped = (err: any, req: any, res: any, next: any) => {
      try {
        return Promise.resolve(fn(err, req, res, next)).catch(next);
      } catch (error) {
        return next(error);
      }
    };
    (wrapped as any)[WRAPPED] = true;
    return wrapped;
  }

  const wrapped = (req: any, res: any, next: any) => {
    try {
      return Promise.resolve(fn(req, res, next)).catch(next);
    } catch (error) {
      return next(error);
    }
  };
  (wrapped as any)[WRAPPED] = true;
  return wrapped;
}

export function installAsyncRouteSafety() {
  const proto: any = express.Router;
  if (proto[WRAPPED]) return;

  for (const method of METHODS) {
    const original = proto[method];
    if (typeof original !== "function") continue;
    proto[method] = function patched(this: any, ...args: any[]) {
      return original.apply(
        this,
        args.map((arg) =>
          typeof arg === "function"
            ? wrapHandler(arg)
            : Array.isArray(arg)
              ? arg.map(wrapHandler)
              : arg
        )
      );
    };
  }
  proto[WRAPPED] = true;
}

installAsyncRouteSafety();
