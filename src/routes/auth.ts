import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { blacklistToken } from '../services/redis';
import { sendPasswordReset } from '../services/email';
import { authenticate } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  phone: z.string().optional(),
  role: z.enum(['LANDLORD', 'TENANT']),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = registerSchema.parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: { ...data, password: hashedPassword },
      select: { id: true, email: true, name: true, role: true, phone: true, avatar: true, createdAt: true },
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({ user, token });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(data.password, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone, avatar: user.avatar },
      token,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await blacklistToken(token);
    }
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, name: true, role: true, phone: true, avatar: true, createdAt: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.json({ message: 'If an account exists, a reset link has been sent' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    await sendPasswordReset(user.email, user.name, resetToken);
    res.json({ message: 'If an account exists, a reset link has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

router.put('/profile', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      name: z.string().min(2).optional(),
      phone: z.string().optional(),
    }).parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data,
      select: { id: true, email: true, name: true, role: true, phone: true, avatar: true, createdAt: true },
    });

    res.json(user);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/password', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const data = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(6),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(data.currentPassword, user.password);
    if (!valid) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.newPassword, 12);
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { password: hashedPassword },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = z.object({
      token: z.string(),
      password: z.string().min(6),
    }).parse(req.body);

    const user = await prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
    });

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExpiry: null },
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;
