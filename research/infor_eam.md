# Infor EAM (now HxGN EAM by Hexagon)

- **Vendor / License:** Hexagon AB (commercial). Hexagon acquired the product from Infor in late 2021 and rebranded it HxGN EAM (per search summary of third-party listings; exact date unverified).
- **Category:** Enterprise Asset Management (EAM) / maintenance management
- **Target customers:** Asset-intensive organizations: manufacturing, healthcare, distribution, government, energy, and service organizations (per third-party listings; unverified against Hexagon's own materials).
- **Deployment:** Both. Hexagon markets it as SaaS; on-premise customers also exist (on-prem customers receive one functional update per year, per a search snippet of Hexagon's listing, unverified).
- **Pricing model:** not public (Hexagon directs buyers to contact sales).
- **Sources:**
  - Fetched and read: https://trginternational.com/solutions/hxgen-eam (partner page; no EAM feature content, used only to confirm it is an Infor-based partner page)
  - Fetched, no product content returned: https://nexus.hexagon.com/home/product/hxgn-eam
  - Fetch failed (404): https://docs.hexagonppm.com/r/en-US/EAM-System-Overview/1271406 ; https://docs.hexagonppm.com/r/en-US/EAM-System-Overview/12.2/1271406 ; https://www.infor.com/products/eam
  - Fetch failed (403): https://www.capterra.com/p/249582/HxGN-EAM/reviews/ ; https://hexagon.com/products/hxgn-eam ; https://hexagon.com/products/enterprise-asset-management ; https://hexagon.com/products/hxgn-alix ; https://www.g2.com/products/octave-attune-eam-hxgn-eam/features
  - Search snippets only (page not opened), first pass: https://docs.hexagonppm.com/r/en-US/HxGN-EAM-Mobile-User/12.0/1262482 ; https://it.stonybrook.edu/services/eam ; https://www.softwareadvice.com.au/software/348397/hxgn-eam ; https://softwarefinder.com/cmms/hxgn-eam/reviews ; https://www.capterra.com/reviews/1028040/hxgn-eam (regional mirrors) ; https://www.saasworthy.com/product/infor-cloudsuite-eam/reviews ; https://sourceforge.net/software/product/HxGN-EAM ; https://www.getapp.com.au/software/2055879/hxgn-eam
  - Search snippets only, second pass: https://docs.hexagonppm.com/r/en-US/HxGN-EAM-ION-API-Swagger/1278189 ; https://docs.infor.com/mg/10.x/en-us/mongooseolh/mgiiea/lol1573178506544.html (Infor "Integration with ION API"; applicability to EAM unverified) ; https://docs.infor.com/ion/2022.x/en-us/ioncedg_cloud_osm/dmy1605540098433.html (ION API overview) ; https://docs.hexagonppm.com/r/en-US/EAM-System-Overview/12.2/1271406 (Base modules and features, HxGN EAM 12.2) ; https://docs.hexagonppm.com/r/en-US/EAM-System-Overview/1261937 ; https://www.geoconnexion.com/news/hexagon-launches-hxgn-alix-its-ai-powered-assistant-to-help-industrial-enterprises-digitally-transform-heavy-asset-operations ; https://www.arcweb.com/blog/reimagining-asset-future-hxgn-eam-connect-sets-new-benchmark-india ; https://wm-synergy.com/resource/explore-predictive-maintenance-with-hexagon-eams-ai-tools ; https://www.trustradius.com/compare-products/cerexio-predictive-maintenance-vs-hxgn-eam ; https://aliresources.hexagon.com/articles-blogs/hxgn-eam-identified-as-leader-in-enterprise-asset-management ; https://tn-eam.aspect-systems.ru:8090/web/help/ru/eam/administrator/syssecurity/activating_multi_organization_security.html (third-party mirror of Infor EAM admin help; version unknown) ; https://infor.georgetown.org/web/help/EN/eam/default.html (EAM help mirror) ; https://www.g2.com/products/hxgn-apm/discuss ; https://platform.softwareone.com/product/hxgn-eam/PCP-0553-5288 ; https://www.capterra.com/p/249582/HxGN-EAM/reviews/Capterra___1807612/

## Features
Note: the official Hexagon and Infor product pages were not readable in this session (all direct fetches returned 403 or 404). Feature items come from search snippets of Hexagon and Infor documentation mirrors and third-party listings. Treat them as unverified until checked against Hexagon's current docs for your release.

### 1. Asset Registry & Data Model
- Asset Hierarchy Management: hierarchy linking equipment, systems, and locations (Stony Brook deployment description, snippet)
- "Unlimited complexity in asset structure" (Hexagon claim; marketing wording)
- Depreciation tracking for assets, systems, and positions (snippet)
- Custom fields, asset categories, models/manufacturers: Not found

### 2. Lifecycle & Assignment / Procurement, Stores & Inventory
- Procurement module (Hexagon docs, snippet): automates and controls purchasing workflow; implements procedural and approval processes for purchasing expenditures; can generate requisitions automatically when stock falls below minimum levels (unverified detail)
- Stores and inventory (materials management, Hexagon docs, snippet): stock and parts movement; multiple stores so responsibility can be delegated and parts kept near point of use; three replenishment methods: min/max, reorder level, and on-demand (unverified)
- Budget management (Stony Brook description, snippet)
- Check-in/check-out, assignment to user/location, audits, disposal/retirement, reservations: Not found

### 3. Discovery & Inventory Automation
- Agent/agentless scanning, network discovery, cloud/MDM integrations: Not found
- Data import: an import/upload process exists (referenced in a Capterra review; the review calls it slow to learn)
- Physical inventory counts via barcode readers (see section 4)

### 4. Tagging & Mobile
- HxGN EAM Mobile on Android, iOS, and Windows devices (Hexagon mobile user guide, snippet)
- Works with or without network connectivity (offline mode) (snippet)
- Work order actions in mobile: start/stop activities, book labor hours, issue parts, close orders (snippet)
- Barcode asset label design and printing (snippet)
- Barcode reader integration for physical inventory collection (snippet)
- GIS / BIM capabilities (Hexagon product description, snippet; unverified detail)
- RFID, GPS: Not found

### 5. Software & License Management (SAM)
- Not offered / not found. Not part of the EAM product as described in any source reviewed.

### 6. Maintenance & Work Orders (EAM)
- Work management module: work orders and preventive maintenance (PM) work orders generated on a schedule (calendar frequency) or from meter readings (snippet)
- PM work orders can apply to a single asset or a system of assets (snippet)
- PM orders with the same frequency can be bundled under one parent work order (snippet)
- Inspection management: inspection points defined on assets, supporting condition-based maintenance (snippet)
- Positioned for "prescriptive maintenance" and asset performance management (Hexagon description, marketing wording)
- Spare-parts / inventory issue from work orders: covered (parts issue on mobile, snippet; see section 2)
- IoT / sensor integration: no native IoT module found (unverified; may be handled through integrations)

### 7. Contracts, Vendors & Finance
- Contracts (Hexagon docs, snippet): clause library, discounts, multi-tiered contracts (unverified)
- Warranty (Hexagon docs, snippet): materials module flags parts still under warranty when they fail and helps start a warranty claim (unverified). A G2 grouping lists managing warranties, related maintenance operations, and costs (third-party, unverified)
- Purchasing expenditures under approval processes (see section 2); purchase orders implied by procurement module (unverified)
- Depreciation tracking (see section 1); budget management (see section 2)
- Vendor management as a dedicated module: Not found
- Cost tracking: partially covered via procurement and work-order costs (unverified)

### 8. CMDB / Relationships / ITSM
- Configuration items, CMDB relationships, incident/change linkage, service desk: Not found in sources reviewed

### 9. Reporting, Dashboards & Alerts
- Report generation: praised by reviewers for breadth of reporting options (Capterra and Software Advice reviews, snippet)
- Dashboards: one reviewer calls dashboard options limited (Capterra, snippet)
- Scheduled reports, alerts, notifications: Not found

### 10. Workflow & Automation
- Approval workflows for purchasing expenditures (Hexagon docs, snippet; see section 2)
- Status authorization: EAM admin help topics include "defining status authorizations for user groups" and "granting status change authorization permissions" (EAM help table of contents, snippet). This appears to be the mechanism for approval-style controls on record status; exact behavior on work orders unverified
- Custom workflow designer, rules engine, triggers: Not found

### 11. Integrations & API
- Infor ION API gateway: EAM is exposed to ION through a gateway. The EAM web service is published with Swagger documentation and used with the ION API Connector in ION Desk and in ION API flows (Hexagon "HxGN EAM ION API Swagger" docs, snippet; unverified for current release)
- Proxy URL pattern for Infor-provisioned EAM ends in EWSConnector (snippet; unverified)
- Non-Infor suites: EAM server endpoint at /axis/services, registered as ION API target endpoint (snippet; unverified)
- Auth: Infor docs snippet says REST APIs use OAuth 1.0a zero-legged through ION. A third-party API index says OAuth 2.0 through ION API Gateway. Conflict unresolved; check the ION docs for your version
- Event-based integration: BOD-based integration through ION with inbound and outbound BOD mapping documents (snippet; unverified)
- XML-based integration with external applications (system overview, snippet)
- Native REST/GraphQL public API documented by Hexagon, webhooks, SCIM: Not found
- SSO/LDAP: Not found

### 12. Security, Multi-tenancy & Compliance
- Multi-organization security (MOS) (EAM admin help mirror, snippet; version unknown):
  - Record-level security for system forms based on the organization of the record
  - Activation is per entity and cannot be reversed once activated
  - Record-level security for equipment requires the MULTIORG installation parameter set to YES
  - Users can be assigned to more than one EAM user group; users can be added to organizations
- User groups and status authorizations (see section 10)
- SOC 2 / ISO certifications, audit logs, data residency: Not found in sources reviewed
- Multi-tenancy in the SaaS sense (separate tenants per customer): Not found beyond the "TenantId" in the ION proxy URL pattern (unverified)

### 13. AI / Advanced
- HxGN Alix: AI assistant for heavy-asset operations, launched November 2024; available in the latest HxGN EAM release; covers predictive maintenance, real-time condition monitoring, and document management for engineering schematics and technical documentation (GeoConnexion news, snippet; unverified detail)
- Predictive maintenance: machine-learning models anticipate equipment failures and can auto-generate maintenance work orders from predictive models (snippet of Hexagon EAM marketing; unverified)
- Prescriptive-maintenance roadmap toward asset performance management (Hexagon description, marketing wording)
- HxGN APM (from Hexagon's acquisition of Itus Digital): risk-based, condition-based, and predictive maintenance; a separate product from EAM, linked for EAM/APM work (snippet; unverified)
- Data normalization / AI-driven data cleanup: Not found

## Standout Differentiators
- Breadth of maintenance functionality: PM scheduling by calendar or meter, system-level PM, inspection points for condition-based maintenance (snippets; reviewers call it strong on functionality, Capterra features score 3.9/5)
- Full mobile work-order execution with offline capability plus barcode label and count workflows (snippets)
- Procurement-to-stores-to-work-order chain in one product: requisitions, multi-store inventory, three replenishment methods, warranty flagging on failed parts (Hexagon docs, snippet; unverified)
- Record-level multi-organization security for multi-site operators (EAM admin help, snippet)
- Long-running on-premise product lineage from Infor, now sold by Hexagon in both SaaS and on-prem forms, with an AI assistant (HxGN Alix) and predictive maintenance added recently (per listings; unverified)

## Common Complaints / Weaknesses
- Steep learning curve and setup effort: the most common complaint across Capterra, Software Advice, and SoftwareFinder reviews
- Weak value-for-money and support scores: value 2.8/5, ease of use 3.2/5, customer support 3.2/5 (Software Advice / Capterra, snippet); one reviewer calls it "very expensive" and says customization responsiveness is slow
- Dated interface: one Capterra reviewer calls the interface dull with limited dashboard options and themes
- Dependence on scarce skilled technicians for report setup (one SoftwareFinder reviewer)
- Import process slow to learn (one Capterra reviewer)
- API auth documentation is inconsistent across sources (OAuth 1.0a vs 2.0 for ION); integration setup depends on ION and tenant configuration
- Small review sample: about 24 Capterra reviews, overall 3.5/5 (snippet). Some reviews concern the older Infor CloudSuite EAM version and may not reflect the current product.
