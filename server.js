import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());

app.get('/get-token', (req, res) => {
  const payload = {
    app_key: process.env.ZOOM_SDK_KEY,
    tpc: req.query.topic || "TestSession",
    role_type: 1,
    version: 1,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };

  const token = jwt.sign(payload, process.env.ZOOM_SDK_SECRET, { algorithm: 'HS256' });
  res.json({ token });
});

app.listen(4000, () => console.log('Backend running on port 4000'));
