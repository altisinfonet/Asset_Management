# ManageEngine AssetExplorer

- **Vendor / License:** ManageEngine (Zoho Corporation), commercial, proprietary
- **Category:** IT and non-IT asset management (ITAM), with software license management, purchase/contract management and CMDB
- **Target customers:** IT asset and service teams in SMB to enterprise; vendor material does not name verticals (unverified)
- **Deployment:** Both (on-premises and cloud/SaaS, per the vendor's on-prem vs cloud page)
- **Pricing model:** Editions are Free (cloud: 25 nodes, no expiry), Trial (cloud: 250 nodes, 30 days) and Professional (license-based). Cloud subscriptions are monthly or yearly; on-prem is yearly or perpetual (vendor page). Third-party marketplace listing shows a starting price of about $795 per feature as one-time (unverified; not confirmed on vendor pricing page).
- **Sources:** See the Sources section at the bottom of this file.

## Features
For each category, bullet the concrete features. Write "Not offered / not found" if none. Mark anything uncertain with (unverified).

**Source note:** The vendor's on-prem vs cloud feature page, product readme, cloud page and help overview were read successfully. The vendor's help portal only exposes an Overview section in the fetched content, so most module-level detail comes from the feature tables. The vendor help pages at `/products/asset-explorer/help/` and reviews sites (G2, Capterra, SoftwareAdvice) were partly blocked or only seen as snippets.

### 1. Asset Registry & Data Model
- IT and non-IT asset management in one view (vendor readme)
- Flexible asset categorization (reviewer mention; G2 snippet)
- Asset ownership tracking (third-party listing; unverified)
- Custom modules (Professional edition, per cloud page)
- Asset depreciation (listed under asset tracking on the on-prem vs cloud table)
- CMDB with interactive relationship maps and custom business views (cloud page)
- Custom fields, models/manufacturers, hierarchies, locations: not found in sources reviewed

### 2. Lifecycle & Assignment
- Asset life cycle management (cloud page; on-prem table)
- Configurable lifecycles, graphical lifecycle canvas (drag-and-drop), role-restricted state transitions, distinct lifecycles per product type, contextual notifications, automated actions at asset states (on-prem table and cloud page)
- Asset acknowledgement, auto-assignment, loaned assets, consumables, asset audits (on-prem table)
- Network audit history of workstation, hardware and software changes (readme)
- Check-in/check-out, reservations, explicit disposal/retirement workflow: not found

### 3. Discovery & Inventory Automation
- Agentless Windows scan (in the feature comparison table)
- Agent-based Windows scan, marked "In Beta" (feature table)
- Discovery for Macs, Linux, printers and other network devices (on-prem table)
- Discovery via network credentials (SSH, SNMP, etc.), probe scanning (distributed asset scan), domain scan (on-prem table)
- Agentless probes deployed per site for cloud edition (cloud page)
- Detailed workstation inventory of processors, memory, installed software (readme)
- Complete IT asset discovery of workstations, printers, switches, routers and access points (readme)
- Cloud discovery connectors (Microsoft Azure, Intune, Microsoft 365, SCCM listed as integrations; see section 11)
- CSV/XLS import (CMDB section of on-prem table)

### 4. Tagging & Mobile
- Barcode and QR code scanning and RFID scanners to import assets (cloud page; on-prem table lists barcode and QR)
- Label printing, offline mode, GPS: not found
- Mobile app: not stated on the cloud page. One third-party listing says mobile access is Android-only (unverified)

### 5. Software & License Management (SAM)
- Software Asset Management: tracks purchased licenses against installed software to check compliance (readme)
- Software license metering: tracks how often software is used (readme)
- Software license management, license agreement management, software license compliance management (on-prem table)
- Suite licensing, upgrade and downgrade of licenses (cloud feature table, via search snippet; unverified)
- Consolidate all software licenses from one screen (vendor snippet; unverified)
- SaaS management: not found

### 6. Maintenance & Work Orders (EAM)
- Not offered / not found (no preventive or condition-based maintenance, work orders, spare parts or IoT in sources reviewed)

### 7. Contracts, Vendors & Finance
- Contract management: track contracts, multiple assets per contract, child contracts, contract cost, expiry notifications and renewal notifications before expiry (on-prem table, readme)
- Purchase order system with multi-level approvals, multiple currencies, extra costs, invoice and payment info, general ledger codes, purchase of assets and services (on-prem table)
- Asset integration with purchasing (on-prem table)
- Cost tracking and depreciation: depreciation listed; detailed cost tracking beyond contract cost not found
- Vendor records and warranties: not found

### 8. CMDB / Relationships / ITSM
- Configuration management database: CI definitions, new CI types, relationship maps, business views, CSV/XLS import, CSV/PNG export (on-prem table)
- Automatic syncing of newly discovered asset and user data into CMDB (cloud page)
- ITSM link to ServiceDesk Plus: third-party listing says it integrates with ServiceDesk Plus, Desktop Central and Endpoint Central (unverified)
- Incident and change linkage: not confirmed in sources reviewed

### 9. Reporting, Dashboards & Alerts
- 180+ standard reports, custom and query reports, KPI reports, role-based dashboards, folders, chart types (on-prem table)
- Export to CSV, XLS, HTML, PDF; scheduled reports (on-prem table)
- Contextual notifications and renewal/expiry notifications (on-prem table, readme)
- Analytics Plus integration for advanced reporting (on-prem table)

### 10. Workflow & Automation
- Custom workflows and "automations" (on-prem table, cloud page)
- Approval workflow in purchase orders (multi-level approvals) (on-prem table)
- Custom workflows based on asset parameters (third-party listing; unverified)
- Developer space (on-prem table; contents not verified)

### 11. Integrations & API
- Named integrations: Analytics Plus, Endpoint Central, Microsoft 365, Microsoft Azure, Microsoft Intune, Microsoft Office 365 Calendar, Microsoft SCCM, SolarWinds, Zapier (on-prem table)
- Self-service portal (on-prem table)
- REST API, webhooks, SSO/LDAP/SCIM: not confirmed in sources reviewed

### 12. Security, Multi-tenancy & Compliance
- Role-restricted state transitions and role-based dashboards (on-prem table)
- Audit history of changes (readme)
- Multi-tenancy/multi-company, SOC 2/ISO certifications, data residency, RBAC detail: not found in sources reviewed

### 13. AI / Advanced
- Not found in sources reviewed (no AI or predictive maintenance features identified)

## Standout Differentiators
- Single product covering IT and non-IT asset management, with a built-in CMDB, purchase order and contract management in one tool (vendor readme and feature tables)
- Priced and packaged with free and trial cloud tiers (25-node free tier, 250-node 30-day trial), which lowers evaluation cost (cloud page)
- Tight coupling with the ManageEngine/Zoho stack (Endpoint Central, ServiceDesk Plus, Analytics Plus, Zoho-branded integrations) (feature table; third-party)
- Software license metering plus compliance in one place (readme)

## Common Complaints / Weaknesses
- **Thin public review base:** G2 4.2/5 from about 13 reviews (another page shows 4.3 from 12); Capterra 4.6/5 from about 13. Small sample, so conclusions are weak.
- **Bugs in purchase order module:** one G2 reviewer reports occasional report and PO-module bugs.
- **Fit questions:** a G2 comparison summary says some users find it hard to match the product to specific needs (text truncated, unverified).
- **Non-substantive "dislikes":** many G2 "dislikes" fields are empty or non-specific, so there is little negative signal.
- **Discovery limits:** agent-based scanning is still marked Beta, and Windows is the only platform clearly covered by the agentless scan in the feature table (unverified against the full matrix).
- **Mobile:** mobile app support is unclear; one listing says Android only (unverified).
- **Not verified:** the vendor help portal fetch showed only an Overview section, so module depth (workflows, API docs, integrations) could not be checked directly.
- Competitor and review sites (SoftwareAdvice, GetApp) returned 403 or were not read, so their complaint data is missing.

## Sources
Fetched successfully (text read):
- https://www.manageengine.com/products/asset-explorer/on-premises-vs-cloud.html (feature comparison table; checkmarks not preserved, so edition-by-edition support is not confirmed)
- https://www.manageengine.com/products/asset-explorer/readme.html (product overview)
- https://www.manageengine.com/za/products/asset-explorer/cloud.html (cloud edition page)
- https://help.assetexplorer.com/portal/en/kb/assetexplorer/overview/ (help portal overview; redirected from https://www.manageengine.com/products/asset-explorer/help/)

Search results consulted (titles and snippets only; pages not read in full or blocked):
- https://www.manageengine.com/in/products/asset-explorer/on-premises-vs-cloud.html (snippet)
- https://www.manageengine.com/au/products/asset-explorer/on-premises-vs-cloud.html (snippet)
- https://www.manageengine.com/blog/general/unveiling-cloud-based-manageengine-assetexplorer-our-enterprise-it-asset-management-platform.html (snippet)
- https://www.manageengine.cn/products/asset-explorer/help/assets/assets.html (snippet)
- https://www.manageengine.com/products/asset-explorer/help/ (redirected; see above)
- https://www.g2.com/products/manageengine-asset-explorer/ (search snippet, reviews summary)
- https://www.capterra.com/p/162097/ManageEngine-AssetExplorer/ (search snippet, ratings)
- https://www.softwareadvice.com/scm/manageengine-assetexplorer-profile/reviews/ (search snippet; 403 on fetch)
- https://www.softwareadvice.com.au/software/435544/manageengine-assetexplorer (snippet)
- https://www.getapp.com/it-management-software/a/assetexplorer (snippet; 403 on reviews page)
- https://www.saasworthy.com/product/manageengine-asset-explorer/reviews (snippet)
- https://invgate.com/itdb/manageengine-assetexplorer (snippet)
- https://us.fitgap.com/products/manageengine-asset-explorer (snippet)
- https://platform.softwareone.com/product/assetexplorer/PCP-5528-9187 (snippet; marketplace price listing)
- https://www.g2.com/compare/incident-iq-vs-manageengine-asset-explorer-vs-lansweeper (snippet)
