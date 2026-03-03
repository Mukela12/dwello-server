import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/landlord', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const properties = await prisma.property.findMany({
      where: { landlordId: userId },
      include: { units: { include: { tenancies: { where: { status: 'ACTIVE' } } } } },
    });

    const totalUnits = properties.reduce((sum, p) => sum + p.units.length, 0);
    const occupiedUnits = properties.reduce(
      (sum, p) => sum + p.units.filter((u) => u.status === 'OCCUPIED').length,
      0
    );
    const vacantUnits = totalUnits - occupiedUnits;
    const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

    const monthlyPayments = await prisma.payment.findMany({
      where: {
        unit: { property: { landlordId: userId } },
        periodMonth: currentMonth,
        periodYear: currentYear,
        status: 'COMPLETED',
      },
    });
    const monthlyRevenue = monthlyPayments.reduce((sum, p) => sum + p.amount, 0);

    const activeTenancies = properties.flatMap((p) => p.units.flatMap((u) => u.tenancies));
    const expectedRevenue = activeTenancies.reduce((sum, t) => sum + t.rentAmount, 0);

    const paidTenantIds = new Set(monthlyPayments.map((p) => p.tenantId));
    const overdueCount = activeTenancies.filter((t) => !paidTenantIds.has(t.tenantId)).length;

    const openMaintenance = await prisma.maintenanceRequest.count({
      where: { unit: { property: { landlordId: userId } }, status: { not: 'RESOLVED' } },
    });

    const recentPayments = await prisma.payment.findMany({
      where: { unit: { property: { landlordId: userId } } },
      include: {
        tenant: { select: { name: true, avatar: true } },
        unit: { include: { property: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const revenueHistory = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(currentYear, currentMonth - 1 - i, 1);
      const month = m.getMonth() + 1;
      const year = m.getFullYear();

      const payments = await prisma.payment.aggregate({
        where: {
          unit: { property: { landlordId: userId } },
          periodMonth: month,
          periodYear: year,
          status: 'COMPLETED',
        },
        _sum: { amount: true },
      });

      revenueHistory.push({
        month: monthNames[month - 1],
        year,
        revenue: payments._sum.amount || 0,
      });
    }

    res.json({
      totalProperties: properties.length,
      totalUnits,
      occupiedUnits,
      vacantUnits,
      occupancyRate,
      monthlyRevenue,
      expectedRevenue,
      overdueCount,
      openMaintenance,
      recentPayments,
      revenueHistory,
    });
  } catch (error) {
    console.error('Landlord dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

router.get('/tenant', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const tenancy = await prisma.tenancy.findFirst({
      where: { tenantId: userId, status: 'ACTIVE' },
      include: {
        unit: {
          include: { property: { select: { id: true, name: true, address: true, city: true } } },
        },
      },
    });

    if (!tenancy) {
      res.json({ tenancy: null, message: 'No active tenancy' });
      return;
    }

    const currentMonthPayment = await prisma.payment.findFirst({
      where: {
        tenantId: userId,
        unitId: tenancy.unitId,
        periodMonth: currentMonth,
        periodYear: currentYear,
        status: 'COMPLETED',
      },
    });

    const recentPayments = await prisma.payment.findMany({
      where: { tenantId: userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const openRequests = await prisma.maintenanceRequest.count({
      where: { tenantId: userId, status: { not: 'RESOLVED' } },
    });

    const unreadNotifications = await prisma.notification.count({
      where: { userId, read: false },
    });

    res.json({
      tenancy: {
        ...tenancy,
        currentMonthPaid: !!currentMonthPayment,
        nextPaymentDue: `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(tenancy.paymentDay).padStart(2, '0')}`,
      },
      recentPayments,
      openRequests,
      unreadNotifications,
    });
  } catch (error) {
    console.error('Tenant dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

router.get('/notifications', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    await prisma.notification.updateMany({
      where: { userId: req.user!.userId, read: false },
      data: { read: true },
    });

    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

export default router;
