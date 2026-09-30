import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root folder
dotenv.config({ path: path.join(process.cwd(), ".env") });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

// Validate env vars
const requiredEnvVars = ["ZOOM_SDK_KEY", "ZOOM_SDK_SECRET"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.warn("⚠️ Missing Zoom environment variables:", missingEnvVars.join(", "));
  console.warn("Zoom signature generation will not work, but other services remain active.");
}

interface GenerateSignatureRequest {
  sessionName: string;
  userIdentity: string;
  role?: number;
}

app.post("/api/zoom/signature", (req, res) => {
  try {
    const { sessionName, userIdentity, role = 0 }: GenerateSignatureRequest = req.body;

    if (!sessionName || !userIdentity) {
      return res.status(400).json({ error: "sessionName and userIdentity are required" });
    }

    const sdkKey = process.env.ZOOM_SDK_KEY!;
    const sdkSecret = process.env.ZOOM_SDK_SECRET!;
    const expirationHours = parseInt(process.env.JWT_EXPIRATION_HOURS || "24", 10);

    // ✅ Zoom Video SDK JWT payload
    const payload = {
      app_key: sdkKey,
      topic: sessionName, // topic/session name
      version: 1,
      user_identity: userIdentity,
      role_type: role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * expirationHours,
    };

    const signature = jwt.sign(payload, sdkSecret, { algorithm: "HS256" });

    res.json({
      signature,
      sdkKey,
      sessionName,
      userIdentity,
      role,
      expiresIn: expirationHours * 60 * 60,
    });

    console.log(`✅ Generated signature for ${sessionName} (${userIdentity})`);
  } catch (err) {
    console.error("❌ Error generating signature:", err);
    res.status(500).json({ error: "Failed to generate JWT signature" });
  }
});

// Nodemailer Transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

// Email sending endpoint
app.post("/api/email/send", async (req, res) => {
  try {
    const { to, subject, html } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({ error: "to, subject, and html are required" });
    }

    // Use Resend if available
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      const { Resend } = await import("resend");
      const resend = new Resend(resendApiKey);
      const { data, error } = await resend.emails.send({
        from: process.env.SMTP_FROM || "onboarding@resend.dev",
        to,
        subject,
        html,
      });

      if (error) {
        console.error("❌ Resend error:", error);
        throw error;
      }

      console.log("✅ Message sent via Resend: %s", data?.id);
      return res.json({ message: "Email sent successfully", id: data?.id });
    }

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Zira HR" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });

    console.log("✅ Message sent via SMTP: %s", info.messageId);
    res.json({ message: "Email sent successfully", id: info.messageId });
  } catch (error: any) {
    console.error("❌ Error sending email:", error);
    res.status(500).json({ error: error.message || "Failed to send email" });
  }
});

// Email logs endpoint
app.get("/api/email/logs", async (req, res) => {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return res.status(500).json({ error: "Resend API key not configured on server" });
    }

    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey);
    const limit = parseInt(req.query.limit as string) || 20;

    const { data, error } = await resend.emails.list({
      limit: limit
    });

    if (error) {
      console.error("❌ Resend list error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error: any) {
    console.error("❌ Error fetching email logs:", error);
    res.status(500).json({ error: error.message || "Failed to fetch email logs" });
  }
});

// Email details endpoint
app.get("/api/email/logs/:id", async (req, res) => {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return res.status(500).json({ error: "Resend API key not configured on server" });
    }

    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey);
    const { id } = req.params;

    const { data, error } = await resend.emails.get(id);

    if (error) {
      console.error("❌ Resend get error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error: any) {
    console.error("❌ Error fetching email details:", error);
    res.status(500).json({ error: error.message || "Failed to fetch email details" });
  }
});

// SMS sending endpoint (proxies Celcom Africa to avoid no-cors issues)
app.post("/api/sms/send", async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: "phone and message are required" });
    }

    const apiKey = process.env.CELCOM_API_KEY;
    const partnerID = process.env.CELCOM_PARTNER_ID;
    const shortcode = process.env.CELCOM_SHORTCODE;

    if (!apiKey || !partnerID || !shortcode) {
      return res.status(500).json({ error: "SMS gateway is not configured (CELCOM_API_KEY, CELCOM_PARTNER_ID, CELCOM_SHORTCODE)" });
    }

    const encodedMessage = encodeURIComponent(message);
    const url = `https://isms.celcomafrica.com/api/services/sendsms/?apikey=${apiKey}&partnerID=${partnerID}&message=${encodedMessage}&shortcode=${shortcode}&mobile=${phone}`;

    console.log(`📡 Sending SMS to ${phone} via Celcom Africa...`);

    const response = await fetch(url, { method: "GET" });
    const responseText = await response.text();

    console.log(`📩 Celcom Africa response (${response.status}): ${responseText}`);

    // Celcom Africa returns JSON with a "responses" array
    let parsed: any = null;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Not JSON — treat as raw text
    }

    // Check for known error patterns in the response
    const responseStr = responseText.toLowerCase();
    if (
      !response.ok ||
      responseStr.includes("error") ||
      responseStr.includes("invalid") ||
      responseStr.includes("failed") ||
      responseStr.includes("unauthorized")
    ) {
      console.error("❌ SMS delivery failed:", responseText);
      return res.status(502).json({
        error: "SMS provider rejected the request",
        details: parsed || responseText,
      });
    }

    console.log(`✅ SMS sent successfully to ${phone}`);
    res.json({ message: "SMS sent successfully", details: parsed || responseText });
  } catch (error: any) {
    console.error("❌ Error sending SMS:", error);
    res.status(500).json({ error: error.message || "Failed to send SMS" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      port: PORT,
      hasZoomConfig: !!(process.env.ZOOM_SDK_KEY && process.env.ZOOM_SDK_SECRET),
    },
  });
});

// 404 handler
app.all("*", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
