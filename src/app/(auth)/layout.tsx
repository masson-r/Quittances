import Link from 'next/link'

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="text-xl font-semibold">
        Loyo-reg
      </Link>
      <div className="bg-card text-card-foreground grid gap-5 rounded-xl border p-6 shadow-sm">{children}</div>
    </main>
  )
}
