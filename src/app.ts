import express from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";
import { env } from "./config/env";
import { errorHandler } from "./middlewares/errorHandler";
import apiRoutes from "./routes";

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request timeout middleware (important for Vercel serverless)
app.use((req, res, next) => {
  req.setTimeout(25000);
  res.setTimeout(25000);
  next();
});

// Swagger docs
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api/docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// Routes
app.use("/api", apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
    error: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server (for local development)
if (!process.env.VERCEL && env.NODE_ENV !== "production") {
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${env.PORT}`);
    console.log(`Network access: http://10.7.13.124:${env.PORT}`);
  });
}


export default app;
