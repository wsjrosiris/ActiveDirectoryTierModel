# 🏛️ Tier Model

Declarative PowerShell framework to deploy and audit an Active Directory Tier Model (OUs, Groups, Users, ACL Delegations, GPOs, ADMX, MSA/gMSA/dMSA Permissions, Windows LAPS Permissions) from a single version-controlled JSON configuration file. Supports idempotent re-runs, drift detection, and reproducible builds via pinned dependency versions.

> 🏗️ **Built with the Specify Framework** - Test-driven development ensuring quality and reliability

> 🌐 **NEW in v1.3.0:** Multi-language support (German, French, Spanish, ...) and a web-based management console for visual Tier Model administration.

## 🎯 Goals
- 🔒 Safe, repeatable deployments (WhatIf planning + convergent apply)
- 📊 Drift auditing & reporting (hash provenance + structured findings)
- 🧩 Modular, test-first architecture (Pester enforced)
- 📦 Version governance for dependencies & configuration schema
- 🌍 Multi-language support for host OS and Active Directory
- 🖥️ Web-based management console for visual administration

## 📚 Documentation

> 📖 **Full documentation**: [GitHub Pages - Active Directory Tier Model](https://microsoft.github.io/ActiveDirectoryTierModel)

To get started with TierModel, please refer to our comprehensive documentation:

### 🚀 Getting Started
- **[Quick Deployment Guide](https://microsoft.github.io/ActiveDirectoryTierModel/quick-deployment-guide/)** - Fast-track deployment for experienced administrators
- **[Detailed Deployment Guide](https://microsoft.github.io/ActiveDirectoryTierModel/detailed-deployment-guide/)** - Step-by-step deployment with explanations
- **[FAQ](https://microsoft.github.io/ActiveDirectoryTierModel/faq/)** - Frequently asked questions covering upgrades, migration from previous versions, troubleshooting, and Sentinel integration

### 📖 Core Documentation
- **[Deployment Methodology](https://microsoft.github.io/ActiveDirectoryTierModel/deployment-methodology/)** - Understanding the deployment approach
- **[Drift Detection Details](https://microsoft.github.io/ActiveDirectoryTierModel/drift-detection-details/)** - Comprehensive drift auditing and remediation
- **[Tier Model Logging](https://microsoft.github.io/ActiveDirectoryTierModel/tiermodel-logging/)** - Structured logging and diagnostics
- **[GPO Management Strategy](https://microsoft.github.io/ActiveDirectoryTierModel/gpo-management-strategy/)** - Group Policy Object management
- **[ADMX Management](https://microsoft.github.io/ActiveDirectoryTierModel/admx-management/)** - Administrative template handling
- **[Conditional Principals](https://microsoft.github.io/ActiveDirectoryTierModel/conditional-principals/)** - Domain-specific principal resolution
- **[CI/CD Integration](https://microsoft.github.io/ActiveDirectoryTierModel/ci-cd/)** - Pipeline integration and automation
- **[Test Tag Matrix](https://microsoft.github.io/ActiveDirectoryTierModel/test-tag-matrix/)** - Pester test organization
- **[Test Coverage](https://microsoft.github.io/ActiveDirectoryTierModel/test-coverage/)** - Comprehensive test coverage analysis and roadmap
- **[Language Support](docs/language-support.md)** - Multi-language support for 19 languages (English, German, French, Spanish, ...)

### 🔧 Technical Specifications
- **[Feature Specification](specs/001-tier-model-module/spec.md)** - Complete requirements and user stories
- **[Implementation Plan](specs/001-tier-model-module/plan.md)** - Technical architecture and design decisions

## 🧪 Testing & Quality Assurance

**Current Test Status: ✅ ALL TESTS PASSING** *(Last run: July 31, 2026)*

| Test Suite | Test Files | Test Cases | Status | Coverage |
|------------|-----------|------------|--------|----------|
| **Unit Tests** | 17 files | 1,147 tests | ✅ 100% Pass | **88.72%** |
| **Integration Tests** | 7 files | 288 tests | ✅ 100% Pass | **100%** |
| **Manual Integration Tests** | 1 file | 331 tests | ✅ 100% Pass | **100%** |
| **Total** | **25 files** | **1,766 tests** | ✅ **All Passing** | **88.72%** |

### Test Coverage Highlights
- ✅ **63/63** production files have comprehensive test coverage (5 new Windows LAPS cmdlets added in v1.2.0)
- ✅ **100%** of all automated 1,435 test cases passing
- ✅ **100%** of all manual 331 test cases passing
- ✅ **88.72%** overall docs-scope line coverage — `modules/TierModel/*` module scope ~91% (all above 80% CI gate); `Audit-TierModel.ps1` at 73.1% (new fail-fast/alignment paths need live-AD or PS<7 to exercise), `Deploy-TierModel.ps1` at 81.4%
- ✅ `Get-TierModelConditionalGroupNames` — new function with full test coverage (6 unit tests)
- ✅ **New in v1.2.0:** Unit and integration test files for Windows LAPS (Unit.WinLapsAclOperations.Tests.ps1, Integration.WinLapsDeployment.Tests.ps1)
- ✅ **New in v1.2.1:** UI & reliability bug fixes (BUG-001..011) — see CHANGELOG.
- ✅ **New in v1.2.2:** English-language enforcement (#23) — fail-fast host-OS and Active Directory (en-US only) prerequisite checks (10 new unit tests); see [Language Support](https://microsoft.github.io/ActiveDirectoryTierModel/language-support/).
- ✅ Mock-based testing (no Active Directory connectivity required)
- ✅ WhatIf support validation across all deployment operations

### Running Tests
```powershell
# Run all tests
.\tests\Invoke-AllTests.ps1

# Run unit tests only
.\tests\Invoke-AllTests.ps1 -TestType Unit

# Run integration tests only
.\tests\Invoke-AllTests.ps1 -TestType Integration

# Show only failures (useful for large test runs)
.\tests\Invoke-AllTests.ps1 -FailedOnly

# Run with detailed output
.\tests\Invoke-AllTests.ps1 -Detailed
```

### Deployment Scripts
| Script | Purpose | Optional Features |
|--------|---------|-------------------|
| `Deploy-TierModel.ps1` | 🚀 Deploy with scoped execution | `-IncludeMsa`, `-IncludeGmsa`, `-IncludeDmsa` (Managed Service Account ACL delegation), `-IncludeWinLaps` (Windows LAPS ACL delegation + GPO decryptor) |
| `Audit-TierModel.ps1` | 📊 Audit and compliance checking | `-IncludeMsa`, `-IncludeGmsa`, `-IncludeDmsa` (Managed Service Account ACL audit), `-IncludeWinLaps` (Windows LAPS ACL + decryptor audit) |
| `Start-TierModelManager.ps1` | 🖥️ Web management console | Starts local web server on port 8080 |

## 🖥️ Web Management Console (NEW v1.3.0)

A local web-based management console for visual Tier Model administration.

```powershell
.\Start-TierModelManager.ps1
# Opens http://localhost:8080 in browser
```

### Features
| Feature | Description |
|---------|-------------|
| **Dashboard** | Statistics (OUs, Groups, Users, ACLs) + interactive OU tree with Tier badges (T0/T1/T2) |
| **Organizational Units** | View, search, add, remove OUs |
| **Groups** | Manage security groups (name, scope, category) |
| **Users** | Manage service accounts (enable/disable) |
| **ACL Delegations** | View OU permission delegations |
| **Configuration** | Direct JSON editor for all config files |
| **Deploy** | Run `Deploy-TierModel.ps1` with options (WhatIf, MSA, gMSA, dMSA, WinLAPS) |
| **Audit** | Run `Audit-TierModel.ps1` and view drift detection results |

### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /` | GET | HTML management interface |
| `GET /api/config/{file}` | GET | Read JSON configuration file |
| `POST /api/config/{file}` | POST | Save JSON configuration file |
| `POST /api/deploy` | POST | Execute `Deploy-TierModel.ps1` |
| `POST /api/audit` | POST | Execute `Audit-TierModel.ps1` |

## 🌍 Multi-Language Support (NEW v1.3.0)

The Tier Model now supports **19 languages** for both the host operating system and Active Directory.

### Supported Languages
| Language | LCID | AD Group Names |
|----------|------|----------------|
| English (en-US) | `0x09` | Domain Admins, Server Operators, Account Operators |
| **German (de-DE)** | `0x07` | Domänen-Admins, Server-Operatoren, Konten-Operatoren |
| French (fr-FR) | `0x0c` | Administrateurs du domaine, Opérateurs de serveur, Opérateurs de comptes |
| Spanish (es-ES) | `0x0a` | Administradores del dominio, Operadores de servidor, Operadores de cuentas |
| Italian (it-IT) | `0x10` | Amministratori del dominio, Operatori server, Operatori account |
| Dutch (nl-NL) | `0x13` | Domeinbeheerders, Serveroperators, Accountoperators |
| Portuguese (pt-BR) | `0x16` | Administradores do domínio, Operadores de Servidor, Operadores de Conta |
| Turkish (tr-TR) | `0x14` | Etki Alanı Yöneticileri, Sunucu İşletmenleri, Hesap İşletmenleri |
| Japanese (ja-JP) | `0x11` | ドメイン管理者, Server Operators, Account Operators |
| Korean (ko-KR) | `0x12` | 도메인 관리자, 서버 운영자, 계정 운영자 |
| Chinese (zh-CN) | `0x04` | 域管理员, 服务器操作员, 账户操作员 |
| Polish (pl-PL) | `0x15` | Administratorzy domeny, Operatorzy serwera, Operatorzy kont |
| Russian (ru-RU) | `0x19` | Администраторы домена, Операторы сервера, Операторы счетов |
| Swedish (sv-SE) | `0x1d` | Domänadministratörer, Serveroperatörer, Kontooperaörer |
| Danish (da-DK) | `0x06` | Domæneadministratorer, Serveroperatører, Kontooperaörer |
| Finnish (fi-FI) | `0x0b` | Verkkotunnusylläpitäjät, Palvelimen operaattorit, Tilin operaattorit |
| Greek (el-GR) | `0x08` | Διαχειριστές τομέα, Χειριστές διακομιστή, Χειριστές λογαριασμών |
| Czech (cs-CZ) | `0x05` | Správci domény, Operátoři serveru, Operátoři účtů |
| Hungarian (hu-HU) | `0x0e` | Tartományrendszergazdák, Szerverüzemeltetők, Fióküzemeltetők |

### How It Works
1. **Host OS Detection**: Reads `InstallLanguage` from registry (`HKLM:\SYSTEM\CurrentControlSet\Control\Nls\Language`)
2. **AD Language Detection**: Resolves well-known groups by SID and detects language from actual group names
3. **No Fail-Fast**: Non-English systems are no longer blocked — the Tier Model adapts to the detected language

## 🤝 Contributing

Contributions are welcome — but this is a **security-sensitive** project, so we follow an
**issue-first** process. Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** before opening a
pull request.

**The process, in short:**

1. 🗣️ **Open an issue first** describing the problem or proposal — for *any* change (feature, fix, refactor, config, or docs).
2. 🧭 **Discuss and get maintainer agreement** on scope and approach **before writing code**.
3. 🔀 **Then open a focused PR** that links the agreed issue and implements only what was agreed.

> ⚠️ **Pull requests without a linked, pre-agreed issue will be closed.** Unsolicited new
> parameters, alternate deployment topologies, relaxed security validation, or
> bundled / reformat-heavy changes are rejected on sight — not to be unwelcoming, but
> because unreviewed changes to a tiering-security tool can silently weaken tier
> boundaries. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full rationale.

When your PR is ready, it must also satisfy:

1. ✅ **All Pester tests pass** — the CI pipeline will reject any PR with failing tests
2. 🧪 **New or updated tests are included** — any new code or bug fix must include corresponding test cases to maintain or improve code coverage
3. 📊 **Code coverage stays at or above 80%** — the CI enforces a minimum coverage threshold; if your changes reduce coverage below 80%, add tests until coverage is restored
4. 📝 Documentation is updated for any new or changed functionality
5. 🎯 Code follows project conventions and keeps the diff focused (no unrelated reformatting)

> **Note:** The packaging step will not produce a release artifact unless all tests pass and coverage meets the minimum threshold.

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

### Development Setup
```powershell
# Clone repository
git clone https://github.com/microsoft/ActiveDirectoryTierModel.git
cd ActiveDirectoryTierModel

# Run tests locally before submitting a PR
.\tests\Invoke-AllTests.ps1
```

## 📋 Prerequisites

- **PowerShell**: 7.0+
- **Elevation**: Administrator privileges required
- **Domain Admin**: Membership in Domain Admins group
- **Modules**: ActiveDirectory, GroupPolicy (see `config/dependencies.json`)
- **Language**: Multi-language support — 19 languages supported for host OS and Active Directory (see [Multi-Language Support](#-multi-language-support-new-v130))

*For detailed prerequisite validation, run `Test-TierModelPrerequisites`*

## 🔗 Additional Resources

- ❓ [Frequently Asked Questions (FAQ)](https://microsoft.github.io/ActiveDirectoryTierModel/faq/)
- 📦 [Dependencies Configuration](config/dependencies.json)
- 🗂️ [Configuration Schema](config/tiermodel.schema.json)
- 📜 [Changelog](CHANGELOG.md)

---

**Version**: 1.3.0 | **License**: MIT | **Status**: ✅ Production Ready

## 🚀 Releasing

This project uses **semantic versioning** (`MAJOR.MINOR.PATCH`) and tag-based releases.

| Bump | When | Example |
|------|------|---------|
| `PATCH` (1.0.**1**) | Bug fix, typo, doc correction | Fix broken ACL rule |
| `MINOR` (1.**1**.0) | New feature, backward-compatible | Add WinLAPS parameter |
| `MAJOR` (**2**.0.0) | Breaking change | Restructure config schema |

### Creating a release

1. Ensure all changes are merged to `main` and CI is green
2. Tag the release:
   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```
3. The CI pipeline will automatically:
   - Run all tests and enforce code coverage (80% minimum)
   - Create a `TierModel-1.1.0.zip` release asset
   - Publish a GitHub Release with auto-generated release notes

You can also create a release from the GitHub UI: **Releases → Create a new release → enter the tag name** (e.g. `v1.1.0`).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.