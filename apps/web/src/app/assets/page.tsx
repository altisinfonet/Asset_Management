import Link from 'next/link';

export default function AssetsPage() {
  return (
    <main>
      <h1>Assets</h1>
      <ul>
        <li>
          <Link href="/assets/view?id=0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8c9d">
            Open asset AT-00124
          </Link>
        </li>
      </ul>
    </main>
  );
}
