const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
    connectionString:
        process.env.DATABASE_URL ||
        "postgresql://USERNAME:PASSWORD@HOSTNAME/DATABASE?sslmode=require",
    ssl: {
        rejectUnauthorized: false
    }
});

// Database Init
async function initDB() {
    try {
        const createTableQuery = `
        CREATE TABLE IF NOT EXISTS appointments (
            id SERIAL PRIMARY KEY,
            patient_name VARCHAR(255) NOT NULL,
            contact VARCHAR(50) NOT NULL,
            appointment_date DATE NOT NULL,
            appointment_time TIME NOT NULL,
            symptoms TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        `;

        await pool.query(createTableQuery);
        console.log('✅ PostgreSQL Connected & Table Ready!');
    } catch (error) {
        console.log('❌ DB Error:', error.message);
    }
}

initDB();

// Nodemailer Config
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// POST Appointment API
app.post('/api/appointments', async (req, res) => {
    try {
        console.log("📥 Request Body:", req.body);

        // Data Receive
        const patientName = req.body.patientName || req.body.patient_name || "Unknown Patient";
        const contact = req.body.contact || req.body.phone || "No Contact";
        const appointment_date = req.body.date || req.body.appointment_date || new Date().toISOString().split('T')[0];
        const appointment_time = req.body.time || req.body.appointment_time || "12:00:00";
        const symptoms = req.body.symptoms || "None";

        // 📧 পেশেন্টের ইমেইল এড্রেস ট্র্যাক করা (ফ্রন্টএন্ড থেকে পাঠানো ইমেইল)
        const patientEmail = req.body.email || req.body.patientEmail || req.body.patient_email;

        // Insert Query
        const insertQuery = `
        INSERT INTO appointments
        (
            patient_name,
            contact,
            appointment_date,
            appointment_time,
            symptoms
        )
        VALUES
        (
            $1::text,
            $2::text,
            $3::date,
            $4::time,
            $5::text
        )
        RETURNING id;
        `;

        const values = [
            patientName,
            contact,
            appointment_date,
            appointment_time,
            symptoms
        ];

        console.log("📦 Insert Values:", values);

        const result = await pool.query(insertQuery, values);
        console.log("✅ DB Insert Success");

        // 📧 ইমেইল সার্ভিস (অ্যাডমিন এবং পেশেন্ট উভয়ের জন্য)
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {

            // ১. অ্যাডমিনের জন্য নোটিফিকেশন মেইল
            const adminMailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
                subject: `New Appointment Request from ${patientName}`,
                html: `
                    <h2>New Appointment Notification</h2>
                    <p><strong>Patient Name:</strong> ${patientName}</p>
                    <p><strong>Contact:</strong> ${contact}</p>
                    <p><strong>Date:</strong> ${appointment_date}</p>
                    <p><strong>Time:</strong> ${appointment_time}</p>
                    <p><strong>Symptoms:</strong> ${symptoms}</p>
                `
            };

            transporter.sendMail(adminMailOptions, (error, info) => {
                if (error) console.log("📧 Admin Email Error:", error.message);
                else console.log("📧 Admin Email Sent:", info.response);
            });

            // ২. পেশেন্টের জন্য কনফার্মেশন মেইল (যদি ইমেইল পাওয়া যায়)
            if (patientEmail) {
                const patientMailOptions = {
                    from: process.env.EMAIL_USER,
                    to: patientEmail,
                    subject: `Appointment Requested Successfully - CareZone`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                            <h2 style="color: #2c3e50; text-align: center;">CareZone</h2>
                            <p>Dear <strong>${patientName}</strong>,</p>
                            <p>Thank you for reaching out to us! We have received your appointment request, and our team is currently processing it.</p>
                            
                            <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #3498db; margin: 20px 0;">
                                <h3 style="margin-top: 0; color: #2c3e50;">Appointment Details:</h3>
                                <p style="margin: 5px 0;"><strong>Date:</strong> ${appointment_date}</p>
                                <p style="margin: 5px 0;"><strong>Time:</strong> ${appointment_time}</p>
                                <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background-color: #ffeaa7; color: #d63031; padding: 2px 6px; border-radius: 4px; font-size: 13px; font-weight: bold;">Pending Confirmation</span></p>
                            </div>
                            
                            <p>We will get back to you shortly via SMS or Call to confirm your slot. If you have any urgent queries, feel free to reply to this email.</p>
                            <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;" />
                            <p style="font-size: 12px; color: #7f8c8d; text-align: center;">This is an automated request confirmation from CareZone.</p>
                        </div>
                    `
                };

                transporter.sendMail(patientMailOptions, (error, info) => {
                    if (error) console.log("📧 Patient Email Error:", error.message);
                    else console.log(`📧 Confirmation Email Sent to Patient (${patientEmail}):`, info.response);
                });
            } else {
                console.log("💡 Note: No patient email provided from frontend, skipping confirmation mail.");
            }
        }

        // SMS Send
        const smsToken = process.env.GREENWEB_TOKEN;

        if (smsToken) {
            const smsMessage = `Hello ${patientName}, Your appointment request is received for ${appointment_date} at ${appointment_time}. CareZone`;
            const smsUrl = `https://api.greenweb.com.bd/api.php?token=${smsToken}&to=${contact}&message=${encodeURIComponent(smsMessage)}`;

            axios.get(smsUrl)
                .then(() => {
                    console.log("📱 SMS Sent");
                })
                .catch((error) => {
                    console.log("📱 SMS Error:", error.message);
                });
        }

        return res.status(201).send({
            success: true,
            insertedId: result.rows[0].id
        });

    } catch (err) {
        console.log("❌ API Error:", err);

        return res.status(500).send({
            success: false,
            message: err.message
        });
    }
});

// Test Route
app.get('/', (req, res) => {
    res.send('🚀 CareZone Backend Running');
});

// Server Start
app.listen(port, () => {
    console.log(`🚀 Server is running on port ${port}`);
});