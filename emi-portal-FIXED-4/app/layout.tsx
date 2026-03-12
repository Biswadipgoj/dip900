import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'TelePoint EMI Portal',
  description: 'EMI Management by TelePoint',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: { borderRadius: '12px', background: '#1e293b', color: '#fff', fontSize: '14px' },
            success: { style: { background: '#16a34a', color: 'white' }, iconTheme: { primary: 'white', secondary: '#16a34a' } },
            error: { style: { background: '#dc2626', color: 'white' }, iconTheme: { primary: 'white', secondary: '#dc2626' } },
          }}
        />
        <footer className="text-center py-4 text-xs text-ink-muted/50 no-print">Created by DIP</footer>
      </body>
    </html>
  );
}
