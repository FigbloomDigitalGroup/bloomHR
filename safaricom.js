// server.js
import express from "express";
import cors from "cors";
import mpesaRouter from "./mpesa.js";
import emailRouter from "./email_routes.js";


const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Attach routes
app.use("/api/mpesa", mpesaRouter);
app.use("/api/email", emailRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
