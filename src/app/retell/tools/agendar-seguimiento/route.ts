import { handleRetellToolRoute } from '../route-handler';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleRetellToolRoute(request, 'agendar_seguimiento');
}
