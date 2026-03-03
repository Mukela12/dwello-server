import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export default redis;

export async function blacklistToken(token: string, expiresIn: number = 604800): Promise<void> {
  await redis.set(`bl:${token}`, '1', 'EX', expiresIn);
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const result = await redis.get(`bl:${token}`);
  return result === '1';
}
