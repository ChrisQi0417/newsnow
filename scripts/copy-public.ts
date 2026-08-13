import { cp, readdir } from "node:fs/promises"
import { join } from "node:path"
import { projectDir } from "../shared/dir"

const distDir = join(projectDir, "dist")
const publicDir = join(distDir, "output", "public")
const entries = await readdir(distDir, { withFileTypes: true })

await Promise.all(entries
  .filter(entry => entry.name !== "output")
  .map(entry => cp(
    join(distDir, entry.name),
    join(publicDir, entry.name),
    { force: true, recursive: entry.isDirectory() },
  )))

console.info("[info] Copied static frontend to Cloudflare Pages output")
