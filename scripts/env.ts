/**
 * Env loading for the remote DB scripts (db:deploy, db:seed:remote).
 * `--env-file=<path>` loads that file first (e.g. one made with
 * `vercel env pull .env.vercel`); then `.env` fills anything still unset.
 * Values already in the environment always win.
 */
import { config } from "dotenv";

export function loadScriptEnv(argv = process.argv): void {
  const arg = argv.find((a) => a.startsWith("--env-file="));
  if (arg) {
    const file = arg.slice("--env-file=".length);
    const r = config({ path: file, quiet: true });
    if (r.error) throw new Error(`Could not read ${file}: ${r.error.message}`);
  }
  config({ quiet: true });
}
