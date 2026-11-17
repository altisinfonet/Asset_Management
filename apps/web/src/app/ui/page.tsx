import type { Metadata } from 'next';
import { Gallery } from './gallery';

/**
 * Component gallery for design review: every base component in light and dark, side by side.
 * Hidden (not linked from the navigation, `noindex`). Not part of the product UI.
 */
export const metadata: Metadata = {
  title: 'UI gallery',
  robots: { index: false, follow: false },
};

export default function UiGalleryPage() {
  return <Gallery />;
}
