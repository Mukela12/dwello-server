import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Error:', err.message);

  if (err.name === 'ZodError') {
    res.status(400).json({ error: 'Validation error', details: JSON.parse(err.message) });
    return;
  }

  if (err.name === 'PrismaClientKnownRequestError') {
    res.status(400).json({ error: 'Database error', message: err.message });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
}
