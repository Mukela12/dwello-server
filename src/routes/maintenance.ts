import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

const getParamId = (req: Request): string => req.params.id as string;

router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const where: any = {};

    if (req.user!.role === 'LANDLORD') {
      where.unit = { property: { landlordId: req.user!.userId } };
    } else {
      where.tenantId = req.user!.userId;
    }

    const { status, priority } = req.query;
    if (status) where.status = status as string;
    if (priority) where.priority = priority as string;

    const requests = await prisma.maintenanceRequest.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true, email: true, avatar: true } },
        unit: { include: { property: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(requests);
  } catch (error) {
    console.error('List maintenance error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.post('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      unitId: z.string(),
      title: z.string().min(1),
      description: z.string().min(1),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      images: z.array(z.string()).optional(),
    }).parse(req.body);

    const tenancy = await prisma.tenancy.findFirst({
      where: { tenantId: req.user!.userId, unitId: data.unitId, status: 'ACTIVE' },
      include: { unit: { include: { property: true } } },
    });
    if (!tenancy) {
      res.status(400).json({ error: 'No active tenancy for this unit' });
      return;
    }

    const request = await prisma.maintenanceRequest.create({
      data: { ...data, images: data.images || [], tenantId: req.user!.userId },
      include: { unit: { include: { property: true } }, tenant: { select: { name: true } } },
    });

    await prisma.notification.create({
      data: {
        userId: tenancy.unit.property.landlordId,
        title: 'New Maintenance Request',
        message: `${request.tenant.name} submitted: ${data.title}`,
        type: 'MAINTENANCE',
      },
    });

    res.status(201).json(request);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Create maintenance error:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

router.put('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
      notes: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    }).parse(req.body);

    const request = await prisma.maintenanceRequest.findUnique({
      where: { id: getParamId(req) },
    });

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const updateData: any = { ...data };
    if (data.status === 'RESOLVED') {
      updateData.resolvedAt = new Date();
    }

    const updated = await prisma.maintenanceRequest.update({
      where: { id: getParamId(req) },
      data: updateData,
      include: { unit: { include: { property: true } }, tenant: { select: { id: true, name: true } } },
    });

    if (data.status) {
      await prisma.notification.create({
        data: {
          userId: updated.tenant.id,
          title: 'Maintenance Update',
          message: `Your request "${updated.title}" status changed to ${data.status.replace('_', ' ')}`,
          type: 'MAINTENANCE',
        },
      });
    }

    res.json(updated);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Update maintenance error:', error);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const request = await prisma.maintenanceRequest.findUnique({
      where: { id: getParamId(req) },
      include: {
        tenant: { select: { id: true, name: true, email: true, avatar: true } },
        unit: { include: { property: { select: { id: true, name: true } } } },
      },
    });

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    res.json(request);
  } catch (error) {
    console.error('Get maintenance error:', error);
    res.status(500).json({ error: 'Failed to fetch request' });
  }
});

router.delete('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const request = await prisma.maintenanceRequest.findUnique({ where: { id: getParamId(req) } });

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    await prisma.maintenanceRequest.delete({ where: { id: getParamId(req) } });
    res.json({ message: 'Request deleted' });
  } catch (error) {
    console.error('Delete maintenance error:', error);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

export default router;
