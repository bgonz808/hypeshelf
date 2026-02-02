# ADR-005: Container Image Scanning

## Status

Accepted

## Context

The NLLB Docker image (`docker/Dockerfile.nllb`) includes OS packages from `python:3.14-slim`, Python dependencies (ctranslate2, torch, fastapi, etc.), and optionally CUDA libraries. While `pip-audit` runs at build time to catch known Python CVEs, it does not cover:

- OS-level vulnerabilities in the Debian base image
- Vulnerabilities in system libraries installed via `apt-get`
- Dockerfile misconfigurations (running as root, exposed secrets, etc.)
- CUDA library CVEs in the GPU stage

We need automated scanning that covers the full container image, not just the Python layer.

## Decision

Use **Trivy** (v0.69+, via `aquasecurity/trivy-action@0.31.0`) as the primary container image scanner, running:

- **Weekly** (Sundays 5am UTC) on a schedule
- **On push/PR** when `docker/**` files change
- **On demand** via `workflow_dispatch`

Scan both the `runtime` and `runtime-gpu` build stages as separate matrix entries. Additionally, run Trivy in `config` mode to detect Dockerfile misconfigurations.

## Rationale

### Scanner Comparison

| Aspect            | Trivy                                  | Grype                            |
| ----------------- | -------------------------------------- | -------------------------------- |
| **Version**       | 0.62+ (Jun 2025)                       | 0.87+ (Jun 2025)                 |
| **Vuln DBs**      | NVD, GHSA, Alpine, Debian, Ubuntu…     | NVD, GHSA, OS distro feeds       |
| **Scope**         | Vulns + IaC misconfig + SBOM + secrets | Vulns only                       |
| **SARIF output**  | Native                                 | Via grype -o sarif               |
| **GitHub Action** | Official (`aquasecurity/trivy-action`) | Official (`anchore/scan-action`) |
| **GitHub Stars**  | ~25k                                   | ~9k                              |
| **License**       | Apache 2.0                             | Apache 2.0                       |

Both are viable. Trivy was chosen because:

1. **Broader scope** — also detects Dockerfile misconfigurations and can generate SBOMs, reducing tool sprawl
2. **Larger community** — more active development, faster CVE DB updates
3. **Single tool** — image scan + config scan in one action, vs needing a separate Dockerfile linter

Grype remains a viable fallback if Trivy ever becomes problematic.

## Alternatives Considered

### Grype (Anchore)

Narrower scope (vulnerabilities only, no misconfig detection). Would need a separate tool for Dockerfile linting. Viable fallback.

### Snyk Container

Free tier is limited to a small number of scans per month. Commercial product with potential vendor lock-in.

### Docker Scout

Newer tool, tightly coupled to Docker Hub. Less mature ecosystem and CI integration compared to Trivy.

### Running Both Trivy and Grype

Considered for defense-in-depth, but overkill for a single Docker image. The overlap in vulnerability databases means diminishing returns. Can revisit if the project grows to multiple images.

## Consequences

### Positive

- OS-level CVE coverage for `python:3.14-slim` base image and all system packages
- SARIF integration with GitHub Security tab for unified vulnerability dashboard
- Dockerfile misconfiguration detection (e.g., missing `USER`, exposed secrets, bad practices)
- Complements existing `pip-audit` (Python layer) and Semgrep (source code)

### Negative

- Docker build adds ~3-5 minutes to CI on `docker/**` changes
- Trivy DB download adds ~30s per run (cached in GitHub Actions)

### Neutral

- Does not replace `pip-audit` — both serve different purposes (build-time pinning vs runtime image state)
- Scheduled runs are report-only; PR runs are blocking (HIGH/CRITICAL)

## References

- [Trivy GitHub](https://github.com/aquasecurity/trivy)
- [Grype GitHub](https://github.com/anchore/grype)
- [Montana State Scanner Benchmark (2024)](https://scholarworks.montana.edu/items/nb09bf50j) — comparative analysis of container scanners
- [GitLab Issue #457615](https://gitlab.com/gitlab-org/gitlab/-/issues/457615) — Trivy vs Grype discussion
- ADR-003: Security Scanning Strategy (layer model)
