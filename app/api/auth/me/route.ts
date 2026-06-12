import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Auth is disabled — always return the solo user. The owner email comes from
// the OWNER_EMAIL env var so it is not committed in source or shipped in the
// client bundle (SEC-C1). Empty string when unset.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ userId: 'solo', email: process.env.OWNER_EMAIL ?? '' });
}
