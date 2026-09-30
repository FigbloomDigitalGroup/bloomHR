// server.js
import express from "express";
import cors from "cors";
import mpesaRouter from "./mpesa.js";
import emailRouter from "./email_routes.js";
import smsRouter from "./sms_routes.js";
import adminRouter from "./admin_routes.js";


const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Attach routes
app.use("/api/mpesa", mpesaRouter);
app.use("/api/email", emailRouter);
app.use("/api/sms", smsRouter);
app.use("/api/admin", adminRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
