import { app } from "./app";

// Last-resort safety net. Route errors are already funnelled to the error
// middleware (see lib/asyncRoutes), so reaching here means something escaped
// the request cycle — log it and keep serving rather than exiting, which would
// take the whole API down for every user.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`✅ API listening on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
});
