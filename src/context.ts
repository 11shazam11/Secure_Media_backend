import jwt, { JwtPayload } from 'jsonwebtoken';

export interface Context {
  userId: string | null;
}

export async function createContext({ request }: { request: Request }): Promise<Context> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) return { userId: null };

  try {
    const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as JwtPayload;
    // Supabase user id is in `sub`
    return { userId: typeof decoded.sub === 'string' ? decoded.sub : null };
  } catch {
    return { userId: null };
  }
}
