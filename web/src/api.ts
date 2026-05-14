import type { Brand, RunDetail, RunSummary } from './types';

async function jsonFetch<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      // ignore
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listRuns: () => jsonFetch<RunSummary[]>('/api/runs'),
  getRun: (id: string) => jsonFetch<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),

  startRun: (body: { brandId: string; archetypeId?: string; seed?: string }) =>
    jsonFetch<{ runId: string; runDir: string }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resumeRun: (id: string) =>
    jsonFetch<{ runId: string; runDir: string }>(
      `/api/runs/${encodeURIComponent(id)}/resume`,
      { method: 'POST' }
    ),

  suggestSeed: (brandId: string, archetypeId?: string) =>
    jsonFetch<{ seed: string }>(
      `/api/brands/${encodeURIComponent(brandId)}/suggest-seed`,
      {
        method: 'POST',
        body: JSON.stringify({ archetypeId }),
      }
    ),

  listBrands: () => jsonFetch<Brand[]>('/api/brands'),
  getBrand: (id: string) => jsonFetch<Brand>(`/api/brands/${encodeURIComponent(id)}`),
  createBrand: (b: Brand) =>
    jsonFetch<Brand>('/api/brands', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  updateBrand: (b: Brand) =>
    jsonFetch<Brand>(`/api/brands/${encodeURIComponent(b.id)}`, {
      method: 'PUT',
      body: JSON.stringify(b),
    }),
  deleteBrand: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/brands/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

export function fileUrl(runId: string, subpath: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/files/${subpath}`;
}
