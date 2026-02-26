// sms_routes.js - Stub router (SMS functionality pending)
import { Router } from 'express';

const router = Router();

router.post('/send', (req, res) => {
    res.status(501).json({ error: 'SMS service not configured' });
});

export default router;
