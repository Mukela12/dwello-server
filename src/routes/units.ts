import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

const paramId = (req: Request): string => req.params.id as string;

const unitSchema = z.object({
  name: z.string().min(1),
  rentAmount: z.number().positive(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
});

router.post('/properties/:id/units', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = unitSchema.parse(req.body);

    const property = await prisma.property.findFirst({
      where: { id: paramId(req), landlordId: req.user!.userId },
    });
    if (!property) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    const unit = await prisma.unit.create({
      data: { ...data, propertyId: paramId(req) },
    });

    res.status(201).json(unit);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Create unit error:', error);
    res.status(500).json({ error: 'Failed to create unit' });
  }
});

router.put('/units/:id', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = unitSchema.partial().parse(req.body);

    const unit = await prisma.unit.findFirst({
      where: { id: paramId(req), property: { landlordId: req.user!.userId } },
    });
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const updated = await prisma.unit.update({
      where: { id: paramId(req) },
      data,
    });

    res.json(updated);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Update unit error:', error);
    res.status(500).json({ error: 'Failed to update unit' });
  }
});

router.delete('/units/:id', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const unit = await prisma.unit.findFirst({
      where: { id: paramId(req), property: { landlordId: req.user!.userId } },
    });
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    await prisma.unit.delete({ where: { id: paramId(req) } });
    res.json({ message: 'Unit deleted' });
  } catch (error) {
    console.error('Delete unit error:', error);
    res.status(500).json({ error: 'Failed to delete unit' });
  }
});

router.get('/units/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: paramId(req) },
      include: {
        property: true,
        tenancies: {
          where: { status: 'ACTIVE' },
          include: {
            tenant: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
          },
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 10 },
        maintenance: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    res.json(unit);
  } catch (error) {
    console.error('Get unit error:', error);
    res.status(500).json({ error: 'Failed to fetch unit' });
  }
});

router.put('/tenancies/:id/terminate', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const tenancy = await prisma.tenancy.findFirst({
      where: {
        id: req.params.id as string,
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
    console.error('Terminate tenancy error:', error);
    res.status(500).json({ error: 'Failed to terminate tenancy' });
  }
});

export default router;
