import { Shell } from './shell';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ path: [] as string[] }];
}

export default function SpikePage() {
  return <Shell />;
}
