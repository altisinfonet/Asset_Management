# Asset Panda

- **Vendor / License:** Asset Panda (commercial, proprietary SaaS)
- **Category:** Asset tracking / fixed asset management / equipment and inventory tracking (cloud SaaS, with vertical editions)
- **Target customers:** Government and public sector (local government, public works, fire, police), K-12 school districts, higher education, facilities and equipment teams, IT asset teams. Vendor also markets "Asset Panda for Local Government / Public Works / Fire / Police / K-12 / Higher Education" editions.
- **Deployment:** SaaS only. Vendor testimonial on assetpanda.com describes the platform as "100% cloud based" (on-prem not mentioned in anything consulted).
- **Pricing model:** Vendor page lists no prices ("Get a Quote", free trial, free demo, Enterprise tier). Third-party listings (search snippets, unverified) report a Starter tier at about $50/month for 5 users and 1,000 assets, and a Business+ tier at about $60/user/month for 10 users and 5,000 assets, with Enterprise quote-based. Treat these as unverified.
- **Sources:**
  - Fetched successfully:
    - https://www.assetpanda.com/
  - Search results used (page itself not fetchable, content taken from search-result snippets, so treat as unverified):
    - https://www.capterra.com/p/142562/Asset-Panda/ (403 on fetch)
    - https://www.capterra.com/p/142562/Asset-Panda/reviews/ (403 on fetch)
    - https://www.g2.com/products/asset-panda/features (403 on fetch)
    - https://www.g2.com/products/asset-panda/reviews (403 on fetch)
    - https://www.softwareadvice.com/asset-management/asset-panda-profile/ (403 on fetch)
    - https://www.assetpanda.com/?p=10302 (404 on fetch)
    - https://tech.co/asset-tracking/asset-panda-review
    - https://softwareconnect.com/asset-tracking/asset-panda/
    - https://coastapp.com/blog/asset-panda-review/
    - https://www.getapp.com/operations-management-software/a/asset-panda/
    - https://www.selecthub.com/cmms-software/asset-panda/
    - https://www.trustradius.com/products/asset-panda/reviews/all

## Features
(Vendor-page items are from assetpanda.com. Items marked "(search snippet)" come from third-party listings and are unverified.)

### 1. Asset Registry & Data Model
- Asset records with photos, serial numbers, locations, assignments, costs, warranties, and attached documents (vendor page)
- Customizable fields and workflows, marketed as "Flexible by design" (vendor page)
- Asset types for asset, equipment, inventory, facilities, and employees (search snippet)
- Parent-child asset relationships: exists but reviewers say it is limited (see Complaints)
- Hierarchies / CMDB-style relationships beyond parent-child: Not found
- Custom manufacturer/model catalog: Not found (unverified)
- Depreciation: calculated, but reviewer reports only straight-line is supported (see Complaints)

### 2. Lifecycle & Assignment
- Assignment, checkout, transfer, and return tracking with chain-of-custody history (vendor page)
- Check-in / check-out with barcode/QR scanning (vendor page + search snippet)
- Full lifecycle history (search snippet)
- Lifecycle tracking covering maintenance, repairs, depreciation, and disposal (vendor page)
- Reservation Management (listed as a solution module on vendor page)
- Leased Equipment Tracking, Lifecycle Management (solution modules on vendor page)
- Asset audits / fixed asset audits (search snippet)
- Procurement / purchase orders: Not found
- Kitting (search snippet)

### 3. Discovery & Inventory Automation
- Agent-based or network discovery: Not found on vendor pages. A reviewer mentioned a "device agent" that did not work as expected (search snippet, Capterra), so some agent component may exist (unverified).
- MDM / cloud integrations: Google Workspace and Microsoft Intune are named in search snippets (unverified). A customer story on vendor site mentions a JAMF integration.
- CSV / bulk import: Not confirmed. Reviewers describe getting assets into the system as difficult (see Complaints).
- Cloud/network discovery: Not found

### 4. Tagging & Mobile
- Barcode and QR scanning, barcode generation, labels and tags (vendor page "Asset Tags & Labels", "Barcode Tracking"; search snippet "barcode generation")
- Asset Panda Pro mobile app: scan codes, update records, transfer assets, complete inspections, view records in the field (vendor page)
- Works "even when connectivity is limited" / offline mode (vendor claim, unverified in depth)
- iOS and Android apps, free barcode scanning (search snippet)
- GPS / coordinates: records coordinates for assets during mobile audit (search snippet, "Mobile Asset Auditing")
- RFID: Not found
- Inspections capturing condition photos and signatures (vendor page)

### 5. Software & License Management (SAM)
- Software license / seat tracking: Not found. Asset Panda is positioned around physical and fixed assets.
- SaaS management: Not found
- Usage metering: Not found

### 6. Maintenance & Work Orders (EAM)
- Maintenance Management and Preventive Maintenance modules (vendor page)
- Work orders can be generated and managed (search snippet)
- Repair Tracking, Asset Inspections, Calibration Management (vendor page)
- Help Desk Ticketing module; unresolved requests routed into help desk follow-up (vendor page, UrsaAI)
- IoT / sensors / condition-based maintenance: Not found

### 7. Contracts, Vendors & Finance
- Warranties, costs, documents stored on asset records (vendor page)
- Depreciation reports and fixed asset management module (vendor page)
- Depreciation method: reviewer says only straight-line is computed (search snippet, unverified)
- Contract management: Not found
- Vendor management: Not found
- Purchase orders: Not found

### 8. CMDB / Relationships / ITSM
- Parent-child asset relationships, limited per reviewers (search snippet)
- Help Desk Ticketing module (vendor page)
- Incident / change linkage: Not found
- Service desk beyond the help desk ticketing module: Not found

### 9. Reporting, Dashboards & Alerts
- Reports for inventory, compliance, maintenance, depreciation, and audits (vendor page)
- Auditing reports described by one reviewer as limited (search snippet)
- Custom reports: "Customizable ... reports" (search snippet, unverified in depth)
- Dashboards: Not confirmed
- Scheduled reports / alerts: Not confirmed

### 10. Workflow & Automation
- Customizable workflows (vendor page)
- AI skills that "run custom AI skills and surface items needing attention" (UrsaAI, vendor page)
- Approval workflows: Not found
- Rules / triggers: Not found

### 11. Integrations & API
- Generic "Integrations" product for connecting with existing tools (vendor page, no named list)
- Named integrations: Google Workspace, Microsoft Intune (search snippet); JAMF (customer story on vendor site)
- Public REST API: Not mentioned on vendor page; not verified
- Webhooks: Not found
- SSO / LDAP / SCIM: Not found on vendor pages. Reviewers mention integration difficulty (see Complaints).

### 12. Security, Multi-tenancy & Compliance
- Granular user permissions (search snippet)
- Compliance badges: SOC 2, HIPAA, GovRAMP (vendor page)
- Linked policies: GDPR Policy, Privacy Policy, Public Security Information (vendor page)
- Multi-company / multi-tenancy: Not found (unverified)
- Audit logs: "full history" / chain-of-custody history cited; dedicated audit-log feature: Not confirmed
- Data residency: Not found
- SSO: Not found

### 13. AI / Advanced
- UrsaAI: answers questions using company knowledge and asset records; runs custom AI skills; surfaces items needing attention; monitors scans, transfers, and check-outs; can read inspection photos to assist with condition grading (vendor page)
- Predictive maintenance: Not found
- Vendor product tiers: "Asset Panda Pro with Ursa AI" and "Asset Panda Classic" login options (vendor page)

## Standout Differentiators
- Vertical editions for public sector and education (Local Government, Public Works, Fire, Police, K-12, Higher Education), plus government purchasing contracts (vendor page)
- Inspections with condition photos and signatures, plus chain-of-custody checkout history
- UrsaAI layer that answers questions over asset records and grades condition from inspection photos (vendor claim)
- Broad module set (fixed assets, maintenance, calibration, reservations, leased equipment, facilities, tools, fleet) in one platform
- Compliance badges claimed: SOC 2, HIPAA, GovRAMP

## Common Complaints / Weaknesses
(Sourced from search-result snippets of Capterra, G2, GetApp, Software Advice and similar listings. The review pages themselves returned 403, so these are unverified in full and represent a sample, not a census.)
- **Cost at scale:** Most common complaint in snippets. Reviewers say it is expensive for small companies and for larger teams, and mention unexpected extra costs. Free plan has an asset cap that forces a paid upgrade (unverified).
- **Hard setup and data migration:** Several reviewers say initial programming and getting assets into the system is difficult, though they credit implementation teams. Others say it is great once past the learning curve. Capterra snippet cites "complicated account management."
- **Modeling and reporting limits:** Parent-child asset relationships are restricted; only straight-line depreciation is reported as supported for one reviewer; audit reporting is limited.
- **Integrations and mobile:** Reviewers report difficulty integrating with databases and major platforms; device agent did not work as expected; one reviewer says mobile access is incomplete and the vendor acknowledged mobile should match desktop. GetApp snippet lists slow response, lag, and recurring glitches.
- **Interface design:** G2 snippet mentions interface design criticism and tedious data entry; limited label-format options.
- **Ratings (snippets, unverified):** G2 about 4.2/5 across 42 reviews; Capterra about 4.6/5 across about 1,370 reviews, with customer service about 4.7. Positive themes: customizability and customer support.
- **Reddit:** No Reddit threads were found or retrieved for Asset Panda. Reddit-specific complaints are not verified.
