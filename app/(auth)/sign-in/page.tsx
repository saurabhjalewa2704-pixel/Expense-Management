import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-5 pb-10 pt-[var(--safe-top)]">
      <SignInForm next={safeNext(next)} initialError={error === "not-allowed" ? "That address can't sign in to this app." : undefined} />
    </main>
  );
}

/** Only ever redirect back into the app itself. */
function safeNext(next?: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
