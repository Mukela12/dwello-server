import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { sendTenantInvite } from '../services/email';

const router = Router();

const getParamId = (req: Request): string => req.params.id as string;

router.get('/', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const tenancies = await prisma.tenancy.findMany({
      where: {
        unit: { property: { landlordId: req.user!.userId } },
        status: 'ACTIVE',
      },
      include: {
        tenant: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
        unit: { include: { property: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const tenants = tenancies.map((t) => ({
      ...t.tenant,
      tenancy: {
        id: t.id,
        unitId: t.unitId,
        unitName: t.unit.name,
        propertyId: t.unit.property.id,
        propertyName: t.unit.property.name,
        rentAmount: t.rentAmount,
        leaseStart: t.leaseStart,
        leaseEnd: t.leaseEnd,
        paymentDay: t.paymentDay,
        status: t.status,
      },
    }));

    res.json(tenants);
  } catch (error) {
    console.error('List tenants error:', error);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

router.post('/invite', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      email: z.string().email(),
      unitId: z.string(),
      rentAmount: z.number().positive(),
      leaseStart: z.string(),
      leaseEnd: z.string().optional(),
      paymentDay: z.number().int().min(1).max(31).optional(),
      deposit: z.number().min(0).optional(),
    }).parse(req.body);

    const unit = await prisma.unit.findFirst({
      where: { id: data.unitId, property: { landlordId: req.user!.userId } },
      include: { property: true },
    });
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');

    const invite = await prisma.tenantInvite.create({
      data: {
        email: data.email,
        unitId: data.unitId,
        landlordId: req.user!.userId,
        token,
      },
    });

    const landlord = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    await sendTenantInvite(data.email, landlord!.name, unit.property.name, unit.name, token);

    res.status(201).json({ message: 'Invitation sent', invite });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Invite tenant error:', error);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

router.post('/accept-invite', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      token: z.string(),
      name: z.string().min(2),
      password: z.string().min(6),
      phone: z.string().optional(),
    }).parse(req.body);

    const invite = await prisma.tenantInvite.findFirst({
      where: { token: data.token, status: 'PENDING' },
    });

    if (!invite) {
      res.status(400).json({ error: 'Invalid or expired invitation' });
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (invite.createdAt < sevenDaysAgo) {
      await prisma.tenantInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
      res.status(400).json({ error: 'Invitation has expired' });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    let user = await prisma.user.findUnique({ where: { email: invite.email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: invite.email,
          password: hashedPassword,
          name: data.name,
          phone: data.phone,
          role: 'TENANT',
        },
      });
    }

    const unit = await prisma.unit.findUnique({ where: { id: invite.unitId } });

    await prisma.tenancy.create({
      data: {
        tenantId: user.id,
        unitId: invite.unitId,
        leaseStart: new Date(),
        rentAmount: unit!.rentAmount,
        paymentDay: 1,
      },
    });

    await prisma.unit.update({
      where: { id: invite.unitId },
      data: { status: 'OCCUPIED' },
    });

    await prisma.tenantInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED' },
    });

    const authToken = signToken({ userId: user.id, email: user.email, role: user.role });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token: authToken,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Accept invite error:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

router.get('/:id', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const tenancy = await prisma.tenancy.findFirst({
      where: {
        tenantId: getParamId(req),
        unit: { property: { landlordId: req.user!.userId } },
      },
      include: {
        tenant: { select: { id: true, name: true, email: true, phone: true, avatar: true, createdAt: true } },
        unit: { include: { property: { select: { id: true, name: true } } } },
      },
    });

    if (!tenancy) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const payments = await prisma.payment.findMany({
      where: { tenantId: getParamId(req) },
      orderBy: { createdAt: 'desc' },
    });

    const maintenanceRequests = await prisma.maintenanceRequest.findMany({
      where: { tenantId: getParamId(req) },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ ...tenancy.tenant, tenancy, payments, maintenanceRequests });
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({ error: 'Failed to fetch tenant' });
  }
});

router.delete('/:id', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const tenancy = await prisma.tenancy.findFirst({
      where: {
        tenantId: getParamId(req),
        status: 'ACTIVE',
        unit: { property: { landlordId: req.user!.userId } },
      },
    });

    if (!tenancy) {
      res.status(404).json({ error: 'Active tenancy not found' });
      return;
    }

    await prisma.tenancy.update({
      where: { id: tenancy.id },
      data: { status: 'TERMINATED', leaseEnd: new Date() },
    });

    await prisma.unit.update({
      where: { id: tenancy.unitId },
      data: { status: 'VACANT' },
    });

    res.json({ message: 'Tenancy terminated' });
  } catch (error) {
    console.error('Remove tenant error:', error);
    res.status(500).json({ error: 'Failed to remove tenant' });
  }
});

export default router;
