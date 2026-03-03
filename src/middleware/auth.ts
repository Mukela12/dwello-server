import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../lib/jwt';
import { isTokenBlacklisted } from '../services/redis';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      res.status(401).json({ error: 'Token has been invalidated' });
      return;
    }

    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
