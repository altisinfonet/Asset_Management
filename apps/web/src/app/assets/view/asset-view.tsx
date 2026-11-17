'use client';

import { useSearchParams } from 'next/navigation';

export function AssetView() {
  const params = useSearchParams();
  const id = params.get('id');
  const code = params.get('code');
  return (
    <main>
      <h1>Asset detail</h1>
      {id ? <p data-testid="asset-id">{id}</p> : null}
      {code ? <p data-testid="asset-code">{code}</p> : null}
      {!id && !code ? <p data-testid="no-asset">No asset selected</p> : null}
    </main>
  );
}
