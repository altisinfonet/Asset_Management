# ServiceNow IT Asset Management (ITAM: SAM Pro, HAM Pro, CMDB)

- **Vendor / License:** Commercial (ServiceNow, proprietary subscription on the Now Platform)
- **Category:** Enterprise IT asset management suite (software asset management, hardware asset management, CMDB as data foundation)
- **Target customers:** Large enterprises (unverified; inferred from implementation-complexity and governance complaints; official target-segment statement not found)
- **Deployment:** SaaS (ServiceNow cloud). Self-hosted option: not found.
- **Pricing model:** Not public. SAM Pro and HAM Pro are described as separate subscriptions beyond base ITSM/ITAM; Now Assist in SAM Pro limited to higher-tier SAM Pro licenses and add-ons (Plus, Enterprise) per a Noventiq blog. Exact prices not found.
- **Sources:**
  - Fetched and read:
    - https://www.servicenow.com/docs/r/yokohama/it-asset-management/it-asset-management.html
    - https://www.servicenow.com/docs/r/pyt4lF0aAin_R6wVyV414Q/xrmHwFzPo4DtICb0jYrjdQ
    - https://blog.noventiq.nl/servicenow-itam-developments (redirected from blog.noventiq.co.uk)
  - Search results read (snippets only; full page not fetched or fetch returned 403):
    - https://www.g2.com/products/servicenow-it-asset-management/reviews (fetch returned 403)
    - https://www.capterra.com/p/254088/ServiceNow/reviews/?page=2 (fetch of /reviews/ returned 403)
    - https://www.servicenow.com/community/ham-forum/i-am-looking-for-asset-management-features-that-comes-with-itsm/m-p/2948069
    - https://www.servicenow.com/community/sam-blog/what-s-new-in-paris-release-for-it-asset-management/ba-p/2285254 (2020-era)
    - https://itassetmanagement.net/2020/07/07/servicenow-paris-ham-and-engineering-announcements/ (2020-era)
    - https://www.servicenow.com/community/ham-articles/the-path-to-value-for-hardware-asset-management/ta-p/3044907
  - Not accessible: https://www.servicenow.com/products/it-asset-management.html and https://www.servicenow.com/products/software-asset-management.html (both returned 403)

## Features
For each category, bullet the concrete features. Write "Not offered / not found" if none. Mark anything uncertain with (unverified).

### 1. Asset Registry & Data Model
- Normalize hardware assets; normalize software assets (ITAM docs)
- Discovery, normalization, and inventory coverage (ITAM docs)
- Hardware normalization standardizes manufacturer name, model name, and model number (search snippet, unverified)
- Common apps: Base Asset Management, Contract Management, Procurement, Product Catalog (ITAM docs)
- Product hierarchy and asset lifecycle concept docs exist (names only)
- Custom fields, parent/child hierarchies, locations, depreciation: Not found in sources read

### 2. Lifecycle & Assignment
- Automate your asset life cycle; end-to-end lifecycle management (ITAM docs)
- Automated asset tasks: deploy, swap, retire (search snippet, unverified)
- Refresh aging hardware assets; audit your asset inventory; audit trail cataloging (ITAM docs)
- Software request via service catalog (ITAM docs)
- Maintenance plans (ITAM docs)
- Check-in/check-out, user/location assignment detail, reservations: Not found in sources read

### 3. Discovery & Inventory Automation
- Discovery is named as a feature (ITAM docs) but no discovery method detail was read
- ServiceNow Agent Client Collector (ACC) presented as a source of asset data for SAM Pro and HAM, replacing SCCM-based data (Noventiq blog)
- Cloud Cost Management and SaaS license management listed as product areas (ITAM docs)
- Network discovery, MDM integration, CSV import: Not verified in sources read

### 4. Tagging & Mobile
- Barcode and QR scanning via mobile app (ITAM docs)
- Label printing, RFID, offline mode, GPS: Not found in sources read

### 5. Software & License Management (SAM)
- Manage software rights; leverage Publisher Packs; view and act on license position (ITAM docs)
- Track software spend; track SaaS subscription usage (ITAM docs)
- License reclamation; license compliance and reconciliation; real-time entitlement tracking (ITAM docs)
- Microsoft licensing modeling in SAM Pro: Microsoft 365 subscriptions and add-ons (including "From SA" rights), E3/E5/Teams/security add-on overlap detection, SQL Server per-core and high-availability models (Noventiq blog)
- Now Assist in SAM Pro: publisher summaries, license calculation explanations, reclamation candidates from usage data; described as initial and limited (Noventiq blog)
- Usage metering detail: Not verified

### 6. Maintenance & Work Orders (EAM)
- Enterprise Asset Management (EAM) is a separate product area; Otto for EAM listed (ITAM docs)
- Maintenance plans (ITAM docs)
- Preventive/condition-based triggers, spare parts, IoT/sensors: Not found in sources read

### 7. Contracts, Vendors & Finance
- Manage expiring maintenance and lease contracts; Contract Management (ITAM docs)
- Procurement and Product Catalog as common apps (ITAM docs)
- Total cost of ownership; showback and chargeback; rightsizing (ITAM docs)
- Depreciation: Not found in sources read

### 8. CMDB / Relationships / ITSM
- Configuration Management Database (CMDB) is the foundation for ITAM data (ITAM docs; search snippet notes CMDB health checks, duplicate cleanup)
- ITAM shares a single data model with ITSM, CMDB, and Security Operations (search snippet, unverified)
- Incident/change linkage: Not verified in sources read

### 9. Reporting, Dashboards & Alerts
- Software asset analytics dashboards (ITAM docs)
- Asset governance workspace; SAM Workspace as the interface for Now Assist features (ITAM docs / Noventiq)
- HAM dashboard in HAM Pro (search snippet, unverified)
- Scheduled reports, custom report builder: Not verified in sources read

### 10. Workflow & Automation
- Lifecycle flows in HAM Pro (community snippet, unverified)
- Automated asset tasks (deploy, swap, retire) and contract renewal workflow (search snippet, unverified)
- Approval workflows and custom rule builder: Not verified in sources read

### 11. Integrations & API
- SCCM-based data source referenced for SAM/HAM; ACC as replacement (Noventiq blog)
- Named integrations to ITSM and Security Operations via shared data model (search snippet, unverified)
- REST API, webhooks, SCIM: Not verified in sources read
- SSO/LDAP: Single reviewer complaint about SSO problems (G2 snippet, see Complaints)

### 12. Security, Multi-tenancy & Compliance
- Security and compliance tracking (ITAM docs)
- Audit trail cataloging (ITAM docs)
- RBAC, multi-company/tenancy, SOC 2/ISO, data residency: Not verified in sources read

### 13. AI / Advanced
- Now Assist in SAM Pro (limited, higher-tier licenses) (Noventiq blog)
- Otto for Software Asset Management, Otto for Hardware Asset Management, Otto for Enterprise Asset Management listed as AI products (ITAM docs; capabilities not described)
- Predictive maintenance, anomaly detection: Not found in sources read

## Standout Differentiators
- Deep software licensing depth: publisher packs, license position, entitlement tracking, and Microsoft licensing modeling (ITAM docs, Noventiq blog)
- Single data model across ITAM, CMDB, ITSM, and Security Operations on the Now Platform (search snippet, unverified)
- Breadth: SAM, HAM, EAM, cloud cost, and procurement/contract apps in one suite (ITAM docs)
- Generative AI layer (Otto, Now Assist) on top of asset data, though limited in scope per sources (ITAM docs, Noventiq blog)

## Common Complaints / Weaknesses
- Large rollouts struggle with stakeholder alignment, governance, and process ownership (G2 summary, via search snippet; G2 page itself returned 403)
- Reconciling asset data across CMDB and ITAM tables is hard; license rules and models require deep entitlement knowledge (G2 review excerpt, via search snippet)
- Implementation cost and complexity; high licensing cost for advanced features, though the cited complaint is about ITSM platform-wide rather than ITAM specifically (search snippet)
- Single-review complaints (anecdotal): SSO and mobile access problems, integration difficulty requiring skilled admins, unintuitive navigation
- Ratings reported in search snippets: about 4.3/5 across 503 reviews (G2 ITAM page) and 4.4 from 169 reviews on another G2 listing. The counts differ, so the snapshots may differ. Not verified on the live page.

## Not filled / gaps
- Pricing figures: not public in sources read.
- Official ServiceNow product pages (ITAM, SAM) returned 403; features were taken from ServiceNow docs and third-party sources.
- Several sections (custom fields, depreciation, check-in/out, reservations, RBAC, REST API, GPS/offline mobile) have no supporting source and are marked "Not found in sources read," which does not prove absence.
