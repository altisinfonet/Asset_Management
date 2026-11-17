# Freshservice (Freshworks) — Asset Management within ITSM

- **Vendor / License:** Commercial (Freshworks, SaaS subscription)
- **Category:** ITSM suite with an integrated IT asset management (ITAM) module and CMDB; ITAM can also be bought standalone (per Freshworks ITAM page)
- **Target customers:** Mid-market and SMB IT teams (unverified; inferred from per-agent tier pricing and reviewer comments on small-team pricing)
- **Deployment:** SaaS. Self-hosted option: not found.
- **Pricing model:** Per agent per month, billed annually: Starter $19, Growth $49, Pro $99; Enterprise custom. ITAM is metered by "Asset Units" (CMDB assets, sold in packs of 500). The pricing page did not clearly show which plans include ITAM, discovery, or software license management (unverified).
- **Sources:**
  - Fetched and read:
    - https://www.freshworks.com/freshservice/features/it-asset-management/software-asset-management/
    - https://www.freshworks.com/freshservice/itam/hardware-asset-management/
    - https://www.freshworks.com/freshservice/pricing/
    - https://support.freshservice.com/support/solutions/articles/50000011973-about-software-license-management
    - https://www.gb-advisors.com/blog/streamlining-software-license-management-best-practices-with-freshservice (third-party partner blog)
    - https://virima.com/blog/freshservice-it-asset-management-benefits-limitations-and-alternative (competitor blog; claims treated as unverified)
  - Search results read (snippets only):
    - https://www.g2.com/products/freshservice/reviews (fetch returned 403; G2 figures from search snippet)
    - https://www.capterra.com/p/132997/Freshservice/reviews/ (fetch returned 403; Capterra figures from search snippet)
    - https://support.freshservice.com/support/solutions/articles/50000011974-implement-a-software-license-management-slm-workflow
    - https://support.freshservice.com/support/solutions/articles/50000011976-manage-software-components
    - https://itbrief.com.au/story/freshworks-boosts-freshservice-with-live-asset-mapping
    - https://www.barchart.com/story/news/1112348/freshworks-expands-it-asset-management-capabilities-by-adding-continuous-infrastructure-discovery-and-dependency-mapping-to-freshservice
    - https://www.desk365.io/blog/freshservice-reviews/ (third-party)
    - https://www.saasworthy.com/product/freshservice/reviews

## Features
For each category, bullet the concrete features. Write "Not offered / not found" if none. Mark anything uncertain with (unverified).

### 1. Asset Registry & Data Model
- Asset types: hardware and software asset records; software models, OS models, and their lifecycle dates (EOL/EOS) (SLM support article)
- Software and OS license models as subsections (SLM support article)
- Custom asset types, custom fields, parent/child hierarchies, locations: Not found in sources read
- Depreciation: Not mentioned on the Freshservice hardware asset page (not found)

### 2. Lifecycle & Assignment
- "Manage hardware from purchase to disposal" (HAM page headline); lifecycle management capability tag (HAM page)
- Purchase Order Management and Contract Management listed as ITAM capabilities (SAM/ITAM pages)
- Check-in/check-out, user/location assignment detail, audits, reservations: Not found in sources read

### 3. Discovery & Inventory Automation
- Asset discovery capability tag (HAM page)
- Software discovery through an autodiscovery job with the "Discover Software" option; scanning is limited to Windows and Linux machine instances (SLM support article)
- Discovery agent on endpoints and API integrations with directory services, SCCM, Intune, and cloud management platforms (search snippet, unverified)
- Continuous infrastructure discovery and live asset mapping announced as new capabilities (news snippets; details unverified)
- Limitation: software discovery requires the SLM feature, which was available only to new signups after the 31 March 2026 release (SLM support article)
- Network discovery, CSV import detail: Not verified in sources read

### 4. Tagging & Mobile
- Barcode scanning to spot idle assets and simplify physical audits (HAM page body text)
- QR codes, label printing, RFID, mobile app, offline mode, GPS: Not found in sources read

### 5. Software & License Management (SAM)
- Software license models with per-installation counts; License Type field (Perpetual or Subscription) is documentation-only and does not change counting (search snippet, unverified)
- License inventories by core, CPU, and client access license (CAL) (SAM page)
- Compliance alerts for expired, unlicensed, and over-licensed software; renewal alerts (SAM page)
- Identification of unused or underutilized licenses (SAM page)
- Prohibited software detection; end-of-life tracking; license usage and threshold alerts (SLM support article, per search snippet and summary)
- SaaS management: SaaS discovery, usage and license tracking, shadow IT discovery, spend control (SaaS Management capability)
- Usage metering beyond SaaS usage tracking: Not verified

### 6. Maintenance & Work Orders (EAM)
- Preventive/condition-based maintenance, spare parts, IoT/sensors: Not found in sources read
- Work orders: ITSM ticketing exists, but its linkage to asset maintenance was not verified

### 7. Contracts, Vendors & Finance
- Contract management with automated renewal tracking and expiration monitoring (SAM/ITAM page)
- Purchase order management (ITAM capability list)
- Spend control for SaaS (SAM page)
- Warranties, depreciation, cost tracking by asset: Not found in sources read

### 8. CMDB / Relationships / ITSM
- Configuration Management Database (CMDB) and dependency mapping listed as ITAM capabilities (SAM/ITAM pages)
- Change management and risk management capability tags on the ITAM page (HAM page)
- Dependency mapping was announced as an expansion (news snippet, unverified). A competitor claims Freshservice's dependency mapping is "Not included" (Virima blog, unverified)
- Incident/change linkage detail: Not verified in sources read

### 9. Reporting, Dashboards & Alerts
- Expiring license, overuse, and unused-license alerts (SLM support article; summary)
- Slack or Teams notifications for license alerts (third-party blog, unverified)
- Scheduled reports, custom report builder: Not verified in sources read

### 10. Workflow & Automation
- Software license management (SLM) workflow article exists (support article title; contents not read)
- Automation of onboarding, provisioning, and lifecycle workflows (SAM page)
- Approval workflows and rule engine: Not verified in sources read

### 11. Integrations & API
- Directory services, SCCM, Intune, and cloud management platform integrations (search snippet, unverified)
- Named integrations, REST API, webhooks, SCIM: Not verified in sources read
- SSO: a Capterra summary lists SSO limitations (unverified; see Complaints)

### 12. Security, Multi-tenancy & Compliance
- Capterra summary (24 reviews) cites limited permission granularity, unclear role assignment, missing audit logs, and data residency or SSO limitations (search snippet; small sample, unverified)
- RBAC detail, multi-company, SOC 2/ISO, data residency: Not verified in sources read

### 13. AI / Advanced
- Not found in sources read. AI capabilities were not checked.

## Standout Differentiators
- ITAM bundled with ITSM, CMDB, and a self-service portal and knowledge base in one per-agent platform (reviewer commentary via search snippet; Freshworks ITAM page)
- Asset units and tiered per-agent pricing; ITAM can be used integrated with Freshservice ITSM or standalone (Freshworks pricing and ITAM pages)
- Ease of use and intuitive UI praised across G2 reviews (search snippet)
- Software license tracking with core/CPU/CAL inventories and renewal and compliance alerts within the same ITSM console (Freshworks SAM page)

## Common Complaints / Weaknesses
- Limited features and customization for reporting, project management, and complex workflows (G2 review excerpts, via search snippet; G2 page returned 403)
- Add-on costs add up, even on top tier (Capterra review excerpt, via search snippet); pricing complaints for small teams (Desk365 third-party blog, unverified)
- Cloud asset management needs improvement (single G2 reviewer, via search snippet; anecdotal)
- Limited permission granularity, unclear role assignment, missing audit logs, data residency and SSO limitations (Capterra summary of 24 reviews; small sample, unverified)
- Hybrid IT and physical asset setups need significant upfront design to fit the platform (single G2 reviewer, anecdotal)
- Competitor claims, treated as unverified: manual asset entry, limited discovery of cloud/IoT/network devices, limited data refresh, "may not scale well," constrained third-party integrations (Virima blog)
- Ratings in search snippets: about 4.6/5 from 1,300+ reviews on G2 and about 4.5/5 from about 680 reviews on Capterra. Not verified on the live pages.

## Not filled / gaps
- Current per-plan inclusion for ITAM, discovery, and license management: the pricing page did not confirm it.
- G2 and Capterra review pages returned 403. Complaints come from search snippets and a 24-review Capterra summary, so counts are indicative only.
- Most discovery detail comes from search snippets or a competitor blog and needs verification against live Freshservice docs.
- Several sections (custom fields, depreciation, check-in/out, reservations, mobile/QR, RBAC, REST API, AI) have no supporting source in what was read, which does not prove absence.
