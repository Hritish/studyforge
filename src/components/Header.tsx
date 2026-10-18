import { cookies } from "next/headers";
import Link from "next/link";
import { getModel } from "@/lib/ai/claude";
import { getAuthConfig, SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { engineMode } from "@/lib/engine";
import { Logo } from "./Logo";

export async function Header() {
  const mode = engineMode();
  const auth = getAuthConfig();
  const signedIn = auth ? verifySession((await cookies()).get(SESSION_COOKIE)?.value, auth.key) : false;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
          <Logo />
          <span>StudyForge</span>
        </Link>
        <span
          title={mode === "demo" ? "No ANTHROPIC_API_KEY set: cards come from an offline pattern-matching generator." : `Using ${getModel()}`}
          className={`hidden rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-block ${
            mode === "demo" ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200" : "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200"
          }`}
          data-testid="mode-badge"
        >
          {mode === "demo" ? "Demo mode" : "Claude"}
        </span>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/#library" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
            Library
          </Link>
          <Link href="/new" className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white shadow-sm hover:bg-indigo-500">
            + New set
          </Link>
          {signedIn ? (
            <form method="post" action="/api/logout">
              <button type="submit" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900" data-testid="logout">
                Log out
              </button>
            </form>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
