import { redirect } from "next/navigation";
import { btn, Card, input } from "@/components/ui";
import { getAuthConfig, safeNextPath } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in · StudyForge" };

const ERRORS: Record<string, string> = {
  invalid: "Wrong password. Try again.",
  rate: "Too many attempts. Wait 15 minutes and try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (!getAuthConfig()) redirect(safeNextPath(next));
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <Card>
        <h1 className="text-xl font-semibold text-slate-900">Log in to StudyForge</h1>
        <p className="mt-1 text-sm text-slate-500">This StudyForge is private. Enter the password to continue.</p>
        {error && ERRORS[error] ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200" role="alert" data-testid="login-error">
            {ERRORS[error]}
          </p>
        ) : null}
        <form method="post" action="/api/login" className="mt-5 space-y-4">
          <input type="hidden" name="next" value={safeNextPath(next)} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</span>
            <input className={input} type="password" name="password" autoComplete="current-password" required autoFocus />
          </label>
          <button type="submit" className={`${btn.primary} w-full`}>
            Log in
          </button>
        </form>
      </Card>
    </div>
  );
}
