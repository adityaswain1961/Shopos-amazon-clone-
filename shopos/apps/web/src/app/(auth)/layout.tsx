import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 font-bold text-2xl">
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">
          ShopOS
        </span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
