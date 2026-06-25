import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const key = request.headers.get('x-orchestrator-key');
  const expected = process.env.ORCHESTRATOR_API_KEY;

  if (!expected) {
    return NextResponse.json({ error: 'MISCONFIGURED' }, { status: 500 });
  }

  if (!key || key !== expected) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
