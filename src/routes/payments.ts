import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { initiatePayment, checkPaymentStatus } from '../services/techpay';
import { sendPaymentReceipt } from '../services/email';

const router = Router();

const getParamId = (req: Request): string => req.params.id as string;

router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { propertyId, status, month, year } = req.query;

    const where: any = {};

    if (req.user!.role === 'LANDLORD') {
      where.unit = { property: { landlordId: req.user!.userId } };
    } else {
      where.tenantId = req.user!.userId;
    }

    if (propertyId) where.unit = { ...where.unit, propertyId: propertyId as string };
    if (status) where.status = status as string;
    if (month) where.periodMonth = parseInt(month as string);
    if (year) where.periodYear = parseInt(year as string);

    const payments = await prisma.payment.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        unit: { include: { property: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(payments);
  } catch (error) {
    console.error('List payments error:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

router.post('/initiate', authenticate, authorize('TENANT'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      unitId: z.string().optional(),
      phoneNumber: z.string(),
      amount: z.number().positive(),
      periodMonth: z.number().int().min(1).max(12),
      periodYear: z.number().int(),
    }).parse(req.body);

    const tenancy = await prisma.tenancy.findFirst({
      where: {
        tenantId: req.user!.userId,
        status: 'ACTIVE',
        ...(data.unitId ? { unitId: data.unitId } : {}),
      },
      include: { unit: { include: { property: true } } },
    });
    if (!tenancy) {
      res.status(400).json({ error: 'No active tenancy found' });
      return;
    }

    const unitId = data.unitId || tenancy.unitId;

    const existing = await prisma.payment.findFirst({
      where: {
        tenantId: req.user!.userId,
        unitId,
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
        status: 'COMPLETED',
      },
    });
    if (existing) {
      res.status(400).json({ error: 'Payment already made for this period' });
      return;
    }

    const reference = `MWINI-${Date.now()}`;
    const callbackUrl = `${process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace('3000', '4000') : 'http://localhost:4000'}/api/payments/webhook`;

    const techpayResult = await initiatePayment({
      amount: data.amount,
      phoneNumber: data.phoneNumber,
      reference,
      description: `Rent payment for ${tenancy.unit.property.name} - ${tenancy.unit.name}`,
      callbackUrl,
    });

    const payment = await prisma.payment.create({
      data: {
        unitId,
        tenantId: req.user!.userId,
        amount: data.amount,
        method: 'MOBILE_MONEY',
        status: techpayResult.success ? 'PENDING' : 'FAILED',
        techpayToken: techpayResult.token,
        techpayRef: reference,
        phoneNumber: data.phoneNumber,
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
      },
    });

    res.status(201).json({ payment, techpay: techpayResult });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Initiate payment error:', error);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

router.get('/:id/status', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: getParamId(req) } });
    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    if (payment.techpayToken && payment.status === 'PENDING') {
      const techpayStatus = await checkPaymentStatus(payment.techpayToken);

      if (techpayStatus.data?.status === 'completed' || techpayStatus.data?.status === 'successful') {
        const updated = await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'COMPLETED', paidAt: new Date() },
        });
        res.json(updated);
        return;
      }

      if (techpayStatus.data?.status === 'failed') {
        const updated = await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED' },
        });
        res.json(updated);
        return;
      }
    }

    res.json(payment);
  } catch (error) {
    console.error('Check payment status error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, status, reference } = req.body;

    const payment = await prisma.payment.findFirst({
      where: { OR: [{ techpayToken: token }, { techpayRef: reference }] },
      include: { tenant: true, unit: { include: { property: true } } },
    });

    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const newStatus =
      status === 'completed' || status === 'successful'
        ? 'COMPLETED'
        : status === 'failed'
          ? 'FAILED'
          : 'PENDING';

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: newStatus as any,
        paidAt: newStatus === 'COMPLETED' ? new Date() : undefined,
      },
    });

    if (newStatus === 'COMPLETED') {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      await sendPaymentReceipt(
        payment.tenant.email,
        payment.tenant.name,
        payment.amount,
        payment.unit.property.name,
        payment.unit.name,
        `${monthNames[payment.periodMonth - 1]} ${payment.periodYear}`
      );

      await prisma.notification.create({
        data: {
          userId: payment.unit.property.landlordId,
          title: 'Payment Received',
          message: `${payment.tenant.name} paid ZMW ${payment.amount} for ${payment.unit.property.name} - ${payment.unit.name}`,
          type: 'PAYMENT',
        },
      });
    }

    res.json({ message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.post('/record', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      unitId: z.string(),
      tenantId: z.string(),
      amount: z.number().positive(),
      method: z.enum(['CASH', 'BANK_TRANSFER']),
      periodMonth: z.number().int().min(1).max(12),
      periodYear: z.number().int(),
    }).parse(req.body);

    const unit = await prisma.unit.findFirst({
      where: { id: data.unitId, property: { landlordId: req.user!.userId } },
    });
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const payment = await prisma.payment.create({
      data: { ...data, status: 'COMPLETED', paidAt: new Date() },
    });

    res.status(201).json(payment);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Record payment error:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

router.get('/link/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenancy = await prisma.tenancy.findUnique({
      where: { id: getParamId(req) },
      include: {
        tenant: { select: { name: true } },
        unit: {
          include: {
            property: {
              include: { landlord: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!tenancy || tenancy.status !== 'ACTIVE') {
      res.status(404).json({ error: 'Payment link not found or expired' });
      return;
    }

    res.json({
      tenantName: tenancy.tenant.name,
      propertyName: tenancy.unit.property.name,
      unitName: tenancy.unit.name,
      rentAmount: tenancy.unit.rentAmount,
      landlordName: tenancy.unit.property.landlord.name,
    });
  } catch (error) {
    console.error('Get payment link error:', error);
    res.status(500).json({ error: 'Failed to fetch payment link' });
  }
});

router.post('/link/:id/pay', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      phoneNumber: z.string(),
      provider: z.enum(['AIRTEL', 'MTN', 'ZAMTEL']),
      periodMonth: z.number().int().min(1).max(12),
      periodYear: z.number().int(),
    }).parse(req.body);

    const tenancy = await prisma.tenancy.findUnique({
      where: { id: getParamId(req) },
      include: { unit: { include: { property: true } }, tenant: true },
    });

    if (!tenancy || tenancy.status !== 'ACTIVE') {
      res.status(404).json({ error: 'Payment link not found or expired' });
      return;
    }

    const existing = await prisma.payment.findFirst({
      where: {
        tenantId: tenancy.tenantId,
        unitId: tenancy.unitId,
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
        status: 'COMPLETED',
      },
    });
    if (existing) {
      res.status(400).json({ error: 'Payment already made for this period' });
      return;
    }

    const reference = `MWINI-${Date.now()}`;
    const callbackUrl = `${process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace('3000', '4000') : 'http://localhost:4000'}/api/payments/webhook`;

    const techpayResult = await initiatePayment({
      amount: tenancy.unit.rentAmount,
      phoneNumber: data.phoneNumber,
      reference,
      description: `Rent payment for ${tenancy.unit.property.name} - ${tenancy.unit.name}`,
      callbackUrl,
    });

    const payment = await prisma.payment.create({
      data: {
        unitId: tenancy.unitId,
        tenantId: tenancy.tenantId,
        amount: tenancy.unit.rentAmount,
        method: 'MOBILE_MONEY',
        status: techpayResult.success ? 'PENDING' : 'FAILED',
        techpayToken: techpayResult.token,
        techpayRef: reference,
        phoneNumber: data.phoneNumber,
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
      },
    });

    res.status(201).json({ paymentId: payment.id, techpay: techpayResult });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Payment link pay error:', error);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

export default router;
