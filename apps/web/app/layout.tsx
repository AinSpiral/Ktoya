import type { Metadata } from 'next';
import { Cormorant_Garamond, Manrope } from 'next/font/google';
import './globals.css';
import './friends-beta.css';

const serif = Cormorant_Garamond({
  variable: '--font-serif',
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600'],
});

const sans = Manrope({
  variable: '--font-sans',
  subsets: ['cyrillic', 'latin'],
});

export const metadata: Metadata = {
  title: 'КтоЯ — Книга жизни',
  description: 'Бережно сохрани настоящие истории своей жизни голосом или текстом.',
  openGraph: {
    title: 'КтоЯ — Книга жизни',
    description: 'Твоя жизнь заслуживает книги.',
    type: 'website',
    locale: 'ru_RU',
    images: [{ url: '/ktoya-og-social-card.webp', width: 1200, height: 630, alt: 'КтоЯ — Книга жизни' }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={[serif.variable, sans.variable].join(' ')}>{children}</body>
    </html>
  );
}
