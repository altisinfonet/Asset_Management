import { Suspense } from 'react';
import { AssetView } from './asset-view';

export default function AssetViewPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <AssetView />
    </Suspense>
  );
}
