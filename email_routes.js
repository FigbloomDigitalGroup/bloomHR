import express from "express";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const router = express.Router();

// Initialize Resend if API key is present
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Fallback Nodemailer Transporter configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

// Get email logs from Resend using REST API
router.get("/logs", async (req, res) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            return res.status(500).json({ error: "Resend API key not configured" });
        }

        // Get pagination parameters from query string
        const limit = req.query.limit || 20;
        const cursor = req.query.cursor || '';

        // Build URL with pagination params
        let url = `https://api.resend.com/emails?limit=${limit}`;
        if (cursor) {
            url += `&cursor=${cursor}`;
        }

        // Call Resend REST API directly since SDK doesn't expose list method
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Resend API error:", errorText);
            return res.status(response.status).json({
                error: "Failed to fetch emails from Resend",
                details: errorText
            });
        }

        const data = await response.json();
        console.log("✅ Fetched emails from Resend:", data.data?.length || 0, "emails");
        res.json(data);
    } catch (error) {
        console.error("❌ Error fetching email logs:", error);
        res.status(500).json({ error: "Failed to fetch email logs" });
    }
});

// Get single email details from Resend
router.get("/logs/:id", async (req, res) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            return res.status(500).json({ error: "Resend API key not configured" });
        }

        const { id } = req.params;

        const response = await fetch(`https://api.resend.com/emails/${id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Resend API error:", errorText);
            return res.status(response.status).json({
                error: "Failed to fetch email details",
                details: errorText
            });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("❌ Error fetching email details:", error);
        res.status(500).json({ error: "Failed to fetch email details" });
    }
});

// Email sending endpoint
router.post("/send", async (req, res) => {
    try {
        const { to, subject, html, attachments } = req.body;

        if (!to || !subject || !html) {
            return res.status(400).json({ error: "to, subject, and html are required" });
        }

        const provider = req.body.provider || 'resend';

        // 1. Send via Resend
        if (provider === 'resend') {
            if (resend) {
                const { data, error } = await resend.emails.send({
                    from: process.env.SMTP_FROM || "onboarding@resend.dev",
                    to,
                    subject,
                    html,
                    attachments,
                });

                if (error) {
                    console.error("❌ Resend error:", error);
                    throw error;
                }

                console.log("✅ Email sent via Resend: %s", data.id);
                return res.json({ message: "Email sent successfully", id: data.id });
            } else {
                // Fallback if Resend selected but not configured? 
                // Or maybe just error out? For now, let's fallthrough to SMTP ? 
                // No, existing logic was: if resend configured, use it. If not, fallback.
                console.log("⚠️ Resend selected but not configured, falling back to default SMTP");
            }
        }

        // 2. Send via cPanel (SMTP)
        let mailOptions = {
            from: process.env.SMTP_FROM || `"Zira HR" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
            attachments: attachments ? attachments.map(att => ({
                filename: att.filename,
                content: att.content,
                encoding: 'base64'
            })) : []
        };

        if (provider === 'cpanel') {
            const cpanelUser = req.body.cpanelUser || "support@mularcredit.com";
            const cpanelPass = "5q{%i1B&C+=CgVfG";

            console.log(`🔌 Attempting cPanel SMTP with user: '${cpanelUser}' and host: mail.mularcredit.com`);

            const cpanelTransporter = nodemailer.createTransport({
                host: "mail.mularcredit.com",
                port: 465,
                secure: true,
                auth: {
                    user: cpanelUser,
                    pass: cpanelPass,
                },
            });

            const info = await cpanelTransporter.sendMail(mailOptions);
            console.log("✅ Email sent via cPanel SMTP: %s", info.messageId);
            return res.json({ message: "Email sent successfully via cPanel", id: info.messageId });
        }

        // 3. Default/Fallback SMTP (Gmail or whatever is in .env)
        const info = await transporter.sendMail(mailOptions);

        console.log("✅ Email sent via SMTP: %s", info.messageId);
        res.json({ message: "Email sent successfully", id: info.messageId });
    } catch (error) {
        console.error("❌ Error sending email:", error);
        res.status(500).json({
            error: "Failed to send email",
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

export default router;
