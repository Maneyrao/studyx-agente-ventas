import { NextResponse } from 'next/server';
import {
  readToolFailureV1,
  searchCatalogToolV1,
} from '@/features/conversation/application/agent-tools-read';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { loadBusinessWorkspaceConfig } from '@/lib/config';

function unavailable() {
  return readToolFailureV1('search_catalog', 'CATALOG_UNAVAILABLE');
}

/** Versioned ToolResultV1 boundary; the legacy /tools/catalog shape stays intact. */
export async function GET() {
  try {
    const { workspaceSlug } = loadBusinessWorkspaceConfig();
    return NextResponse.json(await searchCatalogToolV1({
      store: businessContextStore,
      workspaceSlug,
    }));
  } catch {
    return NextResponse.json(unavailable());
  }
}
