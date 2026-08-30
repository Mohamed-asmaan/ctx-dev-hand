# ctx Safety Report
**Generated:** 2026-08-29T19:49:54.789Z  
**Project:** pom.xml  
**Target Java:** 11  
**Scanned at:** 2026-08-29T19:34:58.097Z  

## Verdict

**BLOCKED** — 3 blocking finding(s), 2 warning(s)

## Findings

### F1 — C1_language_forces_dependency
- **Severity:** blocking
- **Dependency:** `org.postgresql:postgresql`
- **Installed:** 42.2.5
- **Minimum required:** 42.3.0
- **Reason:** The installed version (42.2.5) predates Java 11 support. Moving the language to 11 forces the dependency forward to at least 42.3.0.
- **Evidence:** Support for PostgreSQL 9.6 and earlier was removed in 42.3.0
- **Source:** curated
- **Fetched at:** 2026-08-29T19:49:54.709Z
- **Source URL:** (see data/compatibility.json for verification link)

### F2 — C1_language_forces_dependency
- **Severity:** blocking
- **Dependency:** `javax.xml.bind:jaxb-api`
- **Installed:** 2.3.0
- **Reason:** This package was bundled in the JDK through Java 10. In Java 11 it must be declared as an explicit dependency or the build will fail.
- **Evidence:** Java EE and CORBA modules removed from the JDK in Java 11 (JEP 320)
- **Source:** curated
- **Fetched at:** 2026-08-29T19:49:54.709Z
- **Source URL:** (see data/compatibility.json for verification link)

### F3 — C2_dependency_drops_database
- **Severity:** blocking
- **Dependency:** `org.postgresql:postgresql@42.3.0`
- **Installed:** 9.6
- **Minimum required:** 10
- **Caused by:** F1
- **Reason:** Upgrading the driver to 42.3.0 (required to satisfy F1) drops support for postgres 9.6. The database must be upgraded to 10 or later before the driver is upgraded.
- **Evidence:** Support for PostgreSQL 9.6 and earlier was removed in 42.3.0
- **Source:** curated
- **Fetched at:** 2026-08-29T19:49:54.710Z
- **Source URL:** (see data/compatibility.json for verification link)

### F4 — C3_eol_advisory
- **Severity:** warning
- **Dependency:** `org.postgresql:postgresql`
- **Installed:** 42.2.5
- **Minimum required:** 42.7.7
- **Reason:** A newer version of org.postgresql:postgresql is available (42.7.7). Review the changelog before upgrading.
- **Evidence:** Latest available version is 42.7.7
- **Source:** registry
- **Fetched at:** 2026-08-29T19:49:54.710Z

### F5 — C3_eol_advisory
- **Severity:** warning
- **Dependency:** `javax.xml.bind:jaxb-api`
- **Installed:** 2.3.0
- **Minimum required:** 2.3.1
- **Reason:** A newer version of javax.xml.bind:jaxb-api is available (2.3.1). Review the changelog before upgrading.
- **Evidence:** Latest available version is 2.3.1
- **Source:** registry
- **Fetched at:** 2026-08-29T19:49:54.710Z

## Upgrade Order

**Step 1:** Add javax.xml.bind:jaxb-api as an explicit dependency (removed from JDK)
- Resolves: F2

**Step 2:** Upgrade database postgresql from 9.6 to 10 or later
- Resolves: F3

**Step 3:** Upgrade org.postgresql:postgresql from 42.2.5 to 42.3.0
- Resolves: F1
- After: step 2

**Step 4:** Set maven.compiler.source/target to 42.3.0 (or update java.version property)
- After: step 1, step 2, step 3

## Blast Radius

### `org.postgresql` (2 file(s))
- `src/db/Connection.java:13`
- `src/db/Pool.java:8`

### `javax.xml.bind` (3 file(s))
- `src/api/XmlMapper.java:5`
- `src/api/XmlMapper.java:6`
- `src/api/XmlMapper.java:7`

## Not Checked

_All dependencies were checked._

## Known Limitations

1. **Compatibility knowledge is partial.** Exact for curated dependencies, inferred for the long tail, absent for the rest. The output says which.
2. **Direct dependencies only.** A constraint reaching the project through a transitive dependency is not detected.
3. **Declared, not actual.** ctx reads what the project declares. If production runs a different database version than docker-compose.yml says, ctx cannot know.
4. **Detection, not certainty.** This improves the odds; it does not remove the need for a human to sign off.
5. **No runtime or performance analysis.** Functional compatibility only.
6. **Single manifest, single repo.** No monorepo or multi-module support.
