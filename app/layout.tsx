import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'LaunchPad', template: '%s · LaunchPad' },
  description: 'Deploy applications from GitHub to your own server.',
};

export const viewport: Viewport = { themeColor: '#0a0c0f' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
