import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { goModAdapter } from "../../../src/adapters/go-mod/index.js";
import { rustCargoAdapter } from "../../../src/adapters/rust-cargo/index.js";
import { phpComposerAdapter } from "../../../src/adapters/php-composer/index.js";
import { rubyBundlerAdapter } from "../../../src/adapters/ruby-bundler/index.js";
import { selectAdapter } from "../../../src/adapters/index.js";

async function withDir(files: Record<string, string>, fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-adapter-"));
  try {
    for (const [rel, contents] of Object.entries(files)) {
      const dest = path.join(dir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, contents, "utf8");
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("new language adapters", () => {
  it("go.mod → go 1.16 and two modules", async () => {
    await withDir(
      {
        "go.mod": `module example.com/app\ngo 1.16\n\nrequire (\n\tgithub.com/lib/pq v1.9.0\n\tgithub.com/gin-gonic/gin v1.7.7\n)\n`,
      },
      async (dir) => {
        expect(goModAdapter.detect(dir)).toBe(true);
        const m = await goModAdapter.readManifest(dir);
        expect(m.language).toBe("go");
        expect(m.declaredRuntimeVersion).toBe("1.16");
        expect(m.dependencies).toHaveLength(2);
        expect(m.dependencies.find((d) => d.groupId === "github.com/lib/pq")?.version).toBe("1.9.0");
      },
    );
  });

  it("Cargo.toml → rust-version and diesel", async () => {
    await withDir(
      {
        "Cargo.toml": `[package]\nname = "app"\nrust-version = "1.60"\n\n[dependencies]\ndiesel = "1.4.8"\n`,
      },
      async (dir) => {
        const m = await rustCargoAdapter.readManifest(dir);
        expect(m.language).toBe("rust");
        expect(m.declaredRuntimeVersion).toBe("1.60");
        expect(m.dependencies[0]?.artifactId).toBe("diesel");
        expect(m.dependencies[0]?.version).toBe("1.4.8");
      },
    );
  });

  it("composer.json → php and laravel", async () => {
    await withDir(
      {
        "composer.json": JSON.stringify({
          require: { php: "^7.4", "laravel/framework": "8.83.0" },
        }),
      },
      async (dir) => {
        const m = await phpComposerAdapter.readManifest(dir);
        expect(m.language).toBe("php");
        expect(m.declaredRuntimeVersion).toBe("7.4");
        expect(m.dependencies).toHaveLength(1);
        expect(m.dependencies[0]?.groupId).toBe("laravel/framework");
      },
    );
  });

  it("Gemfile → ruby and rails", async () => {
    await withDir(
      {
        Gemfile: `ruby '2.7.0'\ngem 'rails', '6.1.0'\n`,
      },
      async (dir) => {
        const m = await rubyBundlerAdapter.readManifest(dir);
        expect(m.language).toBe("ruby");
        expect(m.declaredRuntimeVersion).toBe("2.7.0");
        expect(m.dependencies[0]?.artifactId).toBe("rails");
        expect(m.dependencies[0]?.version).toBe("6.1.0");
      },
    );
  });

  it("selectAdapter prefers go.mod over package.json", async () => {
    await withDir(
      { "go.mod": "module x\ngo 1.20\n", "package.json": "{}" },
      async (dir) => {
        const adapter = await selectAdapter(dir);
        expect(adapter?.id).toBe("go-mod");
      },
    );
  });
});
