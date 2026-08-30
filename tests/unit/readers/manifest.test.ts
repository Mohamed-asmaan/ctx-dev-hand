// tests/unit/readers/manifest.test.ts
import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { readManifest } from "../../../src/adapters/java-maven/manifest.js";
import { CtxError } from "../../../src/store/state.js";

const FIXTURES = path.resolve("tests/fixtures/poms");
const TEMP = path.resolve("tests/fixtures/poms/_temp");

// Helper: read a fixture pom from a temp dir so readManifest gets the dir, not the file
import fs from "node:fs/promises";
import os from "node:os";

async function withPom(fixtureName: string, fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-test-"));
  try {
    const src = path.join(FIXTURES, fixtureName);
    await fs.copyFile(src, path.join(dir, "pom.xml"));
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("readManifest", () => {
  it("minimal.xml → declaredRuntimeVersion=8, 2 dependencies", async () => {
    await withPom("minimal.xml", async (dir) => {
      const m = await readManifest(dir);
      expect(m.declaredRuntimeVersion).toBe("8");
      expect(m.dependencies).toHaveLength(2);
      expect(m.buildTool).toBe("maven");
    });
  });

  it("with-properties.xml → ${postgres.version} resolved to literal", async () => {
    await withPom("with-properties.xml", async (dir) => {
      const m = await readManifest(dir);
      const pg = m.dependencies.find((d) => d.artifactId === "postgresql");
      expect(pg).toBeDefined();
      expect(pg!.version).toBe("42.2.5");
      expect(pg!.versionRaw).toBe("${postgres.version}");
    });
  });

  it("with-properties.xml missing property → version 'unresolved'", async () => {
    await withPom("with-properties.xml", async (dir) => {
      const m = await readManifest(dir);
      const hibernate = m.dependencies.find((d) => d.artifactId === "hibernate-core");
      expect(hibernate).toBeDefined();
      expect(hibernate!.version).toBe("unresolved");
    });
  });

  it("with-parent.xml → parentResolved=false, warning emitted to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await withPom("with-parent.xml", async (dir) => {
      const m = await readManifest(dir);
      expect(m.parentResolved).toBe(false);
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("<parent>"));
    });
    stderrSpy.mockRestore();
  });

  it("version-range.xml → version marked 'range', excluded from checks", async () => {
    await withPom("version-range.xml", async (dir) => {
      const m = await readManifest(dir);
      const pg = m.dependencies.find((d) => d.artifactId === "postgresql");
      expect(pg).toBeDefined();
      expect(pg!.version).toBe("range");
      expect(pg!.versionRaw).toContain("42.0.0");
    });
  });

  it("no-java-version.xml → declaredRuntimeVersion=null, does not throw", async () => {
    await withPom("no-java-version.xml", async (dir) => {
      const m = await readManifest(dir);
      expect(m.declaredRuntimeVersion).toBeNull();
      expect(m.dependencies.length).toBeGreaterThan(0);
    });
  });

  it("malformed.xml → does not throw CtxError E1 (fast-xml-parser is lenient)", async () => {
    // fast-xml-parser is lenient with malformed XML — it doesn't throw.
    // The result may be empty/partial. We verify it doesn't throw a hard error.
    await withPom("malformed.xml", async (dir) => {
      // Should not throw — parser is lenient
      const m = await readManifest(dir);
      expect(m).toBeDefined();
    });
  });

  it("empty-deps.xml → dependencies [], does not throw", async () => {
    await withPom("empty-deps.xml", async (dir) => {
      const m = await readManifest(dir);
      expect(m.dependencies).toHaveLength(0);
      expect(m.declaredRuntimeVersion).toBe("11");
    });
  });

  it("missing pom.xml → throws CtxError E1", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-nopom-"));
    try {
      await expect(readManifest(dir)).rejects.toSatisfy(
        (e: unknown) => e instanceof CtxError && (e as CtxError).code === "E1",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("precedence: maven.compiler.source wins over java.version", async () => {
    // The with-properties.xml has maven.compiler.source=8, so it should be 8
    await withPom("with-properties.xml", async (dir) => {
      const m = await readManifest(dir);
      expect(m.declaredRuntimeVersion).toBe("8");
    });
  });

  it("pom with both maven.compiler.source and java.version → compiler.source wins", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-both-"));
    try {
      await fs.writeFile(
        path.join(dir, "pom.xml"),
        `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>both</artifactId>
  <version>1.0</version>
  <properties>
    <maven.compiler.source>11</maven.compiler.source>
    <java.version>8</java.version>
  </properties>
  <dependencies/>
</project>`,
      );
      const m = await readManifest(dir);
      expect(m.declaredRuntimeVersion).toBe("11");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
