import './globals.css';

export const metadata = {
  title: '설교 쇼츠 자동 생성기',
  description: '설교 한 편에서 쇼츠 후보를 찾아주는 AI 설교 미디어 도구'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
