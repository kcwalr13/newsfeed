import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Auth is disabled — always return the solo user.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ userId: 'solo', email: 'kcwalr13@gmail.com' });
}
