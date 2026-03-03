import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth';
import propertyRoutes from './routes/properties';
import unitRoutes from './routes/units';
import tenantRoutes from './routes/tenants';
import paymentRoutes from './routes/payments';
import maintenanceRoutes from './routes/maintenance';
import dashboardRoutes from './routes/dashboard';
import uploadRoutes from './routes/upload';
import { errorHandler } from './middleware/error-handler';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'MwiniPay API', version: '1.0.0' });
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api', unitRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/upload', uploadRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`MwiniPay API running on port ${PORT}`);
});

export default app;
