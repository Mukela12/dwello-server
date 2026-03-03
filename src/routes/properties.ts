import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

const getParamId = (req: Request): string => req.params.id as string;

const propertySchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  type: z.enum(['APARTMENT', 'HOUSE', 'COMMERCIAL', 'ROOM']),
  description: z.string().optional(),
  images: z.array(z.string()).optional(),
});

router.get('/', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const properties = await prisma.property.findMany({
      where: { landlordId: req.user!.userId },
      include: {
        units: {
          include: {
            tenancies: {
              where: { status: 'ACTIVE' },
              include: { tenant: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = properties.map((p) => ({
      ...p,
      totalUnits: p.units.length,
      occupiedUnits: p.units.filter((u) => u.status === 'OCCUPIED').length,
      vacantUnits: p.units.filter((u) => u.status === 'VACANT').length,
      monthlyRevenue: p.units
        .filter((u) => u.status === 'OCCUPIED')
        .reduce((sum, u) => sum + u.rentAmount, 0),
    }));

    res.json(enriched);
  } catch (error) {
    console.error('List properties error:', error);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

router.post('/', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = propertySchema.parse(req.body);
    const property = await prisma.property.create({
      data: { ...data, images: data.images || [], landlordId: req.user!.userId },
      include: { units: true },
    });
    res.status(201).json(property);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Create property error:', error);
    res.status(500).json({ error: 'Failed to create property' });
  }
});

router.get('/:id', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const property = await prisma.property.findFirst({
      where: { id: getParamId(req), landlordId: req.user!.userId },
      include: {
        units: {
          include: {
            tenancies: {
              where: { status: 'ACTIVE' },
              include: {
                tenant: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
              },
            },
            payments: { orderBy: { createdAt: 'desc' }, take: 5 },
            maintenance: { where: { status: { not: 'RESOLVED' } } },
          },
        },
      },
    });

    if (!property) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    res.json(property);
  } catch (error) {
    console.error('Get property error:', error);
    res.status(500).json({ error: 'Failed to fetch property' });
  }
});

router.put('/:id', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = propertySchema.partial().parse(req.body);

    const existing = await prisma.property.findFirst({
      where: { id: getParamId(req), landlordId: req.user!.userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    const property = await prisma.property.update({
      where: { id: getParamId(req) },
      data,
      include: { units: true },
    });

    res.json(property);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Update property error:', error);
    res.status(500).json({ error: 'Failed to update property' });
  }
});

router.delete('/:id', authenticate, authorize('LANDLORD'), async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await prisma.property.findFirst({
      where: { id: getParamId(req), landlordId: req.user!.userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    await prisma.property.delete({ where: { id: getParamId(req) } });
    res.json({ message: 'Property deleted' });
  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({ error: 'Failed to delete property' });
  }
});

export default router;
