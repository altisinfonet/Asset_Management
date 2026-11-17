# IBM Maximo Application Suite (Manage, Health, Predict, Monitor, Mobile)

- **Vendor / License:** IBM, commercial (proprietary)
- **Category:** Enterprise asset management (EAM / CMMS) with an asset performance management (APM) add-on set, delivered as the Maximo Application Suite (MAS)
- **Target customers:** Asset-intensive enterprises and public-sector operators. Official industry add-ons named: Spatial Asset Management, Civil Infrastructure, Oil & Gas, Transportation, Utilities. Clinical-engineering use is mentioned only by a third-party directory (unverified).
- **Deployment:** Both (unverified). MAS is an application suite on IBM's platform; the platform components named are Db2, Oracle, and Microsoft SQL Server, with WebSphere Application Server (J2EE). The exact cloud/managed offering and any SaaS tier were not confirmed in the sources read.
- **Pricing model:** Not public. IBM offers a free trial and a live demo, with no list prices on the pages read.
- **Sources:**
  - https://www.ibm.com/docs/SSLPL8_cd/com.ibm.mam.doc/overview/c_product_overview.html (fetched)
  - https://www.ibm.com/docs/en/maximo-manage/continuous-delivery (fetched; table of contents only, truncated)
  - https://www.ibm.com/products/maximo/asset-management (fetched)
  - https://www.ibm.com/products/maximo/mobile (fetched; no feature list on the page)
  - https://ibm.com/downloads/cas/B9QXZYLJ (Maximo Manage datasheet, search snippet only)
  - https://www.ibm.com/docs/SSLPL8_cd/com.ibm.mam.doc/overview/c_wn_manage_91.html (search snippet only)
  - https://www.ibm.com/docs/SSLPL8_cd/com.ibm.mam.doc/overview/c_is_add_ons.html (search snippet only)
  - https://www.ibm.com/docs/SS7PRM_cd/com.ibm.ah.doc/overview/whats_new_91.html (search snippet only)
  - https://www.ibm.com/docs/SS7PRM_cd/com.ibm.ah.doc/overview/whats_new_89.html (search snippet only)
  - https://www.ibm.com/products/ibm-maximo-asset-performance-management/asset-health (search snippet only)
  - https://www.ibm.com/products/ibm-maximo-asset-performance-management/predictive-maintenance-insights (search snippet only)
  - https://www.ibm.com/downloads/documents/us-en/10a99803cf2fdddf (search snippet only)
  - https://softwareconnect.com/reviews/ibm-maximo/ (search snippet only)
  - https://www.selecthub.com/p/eam-software/maximo/ (search snippet only)
  - https://www.g2.com/products/ibm-maximo-application-suite/reviews_and_filters (search snippet only)
  - https://facilio.com/blog/ibm-maximo-cmms-review/ (search snippet only)
  - https://infraspeak.com/en/compare/ibm-maximo-review (search snippet only)
  - https://www.bpdzenith.com/products/maximo-application-suite (search snippet only; partner page on 7.6.x end of support)

## Features

### 1. Asset Registry & Data Model
- Asset lifecycle coverage: IBM datasheet says the product covers the asset lifecycle from acquisition to disposal (search snippet only).
- Asset history linked to work orders, failure codes, and job plans (IBM asset-management page).
- Sites, locations, and multisite capability with sites, organizations, and data sharing (IBM docs table of contents).
- Linear asset management (add-on) and linear asset reliability (datasheet snippet).
- Spatial asset visualization and advanced mapping of work and assets (add-on / datasheet).
- Classifications, charts of accounts, currency codes (IBM docs table of contents).
- Asset hierarchy / parent-child: not named on the pages read (unverified).
- Custom fields / custom asset types: not found.
- Models / manufacturers: not found.
- Depreciation: not found.

### 2. Lifecycle & Assignment
- Work management: organizing planned and unplanned work for assets and locations by priority, urgency, and resources (IBM product overview).
- Inventory across multiple storerooms, reorder points, warehouse locations, supplier integration, multi-location support (IBM asset-management page).
- Labor, qualifications, crafts, crew types, person groups under Resources (IBM docs table of contents).
- Calibration assets and standards (IBM docs table of contents).
- Procurement / purchase orders: not confirmed on the pages read (unverified).
- Check-in / check-out, reservations: not found.
- Audits: not found.
- Disposal / retirement: covered by the lifecycle claim above; no specific workflow found (unverified).

### 3. Discovery & Inventory Automation
- Agent / agentless scanning, network discovery: not found.
- Cloud / MDM integrations: not found.
- Import / CSV: not checked (unverified).
- IoT sensor ingestion is a Monitor/Health capability, not discovery (see section 13).

### 4. Tagging & Mobile
- Maximo Mobile: offline and online modes, image and voice capture, barcode and RFID scanning (IBM asset-management page).
- Voice-to-text and photo capture for mobile data entry (IBM product overview).
- Mobile device requirements, data refresh, and map features are documented (IBM docs index).
- Mobile access to asset data and work orders for field service management (IBM FSM use case).
- AR / remote-expert assistance: listed as planned (not available) in an IBM Japanese datasheet (search snippet, unverified roadmap).
- QR code labels / label printing: not found.
- GPS: not confirmed (unverified).

### 5. Software & License Management (SAM)
- Not offered / not found in the sources read.

### 6. Maintenance & Work Orders (EAM)
- Work orders with predefined workflows, automated scheduling and approvals (IBM asset-management page).
- Maintenance scheduling in a single graphical view (IBM product overview).
- Failure codes and job plans linked to work orders (IBM asset-management page).
- Advanced scheduling and optimization (add-on).
- Preventive maintenance (PM) as a named module: not confirmed on the pages read (unverified).
- Condition-based maintenance: via Health and Predict (section 13).
- Spare parts: via Inventory (section 2).
- Work order intelligence: detection of missing information, duplicate work orders, and recurring failures (IBM asset-management page; see section 13).

### 7. Contracts, Vendors & Finance
- Cost management and cost insights; integration with IBM Apptio (Manage 9.1 release notes, search snippet only).
- Integration with external financial applications (IBM product overview).
- Supplier integration (IBM asset-management page).
- Contracts and warranties as named modules: not confirmed (unverified).
- Depreciation: not found.

### 8. CMDB / Relationships / ITSM
- Not offered / not found in the sources read. Relationships between assets are implied by hierarchy and locations but not confirmed (unverified).

### 9. Reporting, Dashboards & Alerts
- Customizable dashboards; KPI dashboards for sites, locations, assets, and work types (Manage 9.1 release notes, search snippet only).
- Scheduled reports; BIRT reporting and ad hoc reporting (IBM product overview).
- Automated maintenance, cost, and compliance reports; data export (IBM asset-management page).
- Start Center portlets and Assets & Locations / Operational dashboards (IBM docs table of contents).
- Notifications: escalations, email interaction, communication templates (IBM docs table of contents).

### 10. Workflow & Automation
- Workflow automation for business and management processes (IBM product overview).
- Automated approvals (IBM asset-management page).
- Workflows administration, cron tasks, escalations (IBM docs table of contents).
- Application Designer for customization (IBM product overview).
- Rule-engine / trigger details: not checked (unverified).

### 11. Integrations & API
- Enterprise and framework application integration; business flows with external systems (IBM product overview).
- ERP and system connectors (add-on, IBM asset-management page).
- Attached-document storage on S3 and Azure (IBM docs table of contents).
- Migration Manager (IBM product overview).
- REST / GraphQL API, webhooks, SSO / LDAP / SCIM: not confirmed in the sources read (unverified).

### 12. Security, Multi-tenancy & Compliance
- Access control: managing users and their access to sites, applications, and menu options (IBM product overview).
- Users and security groups, domains (IBM docs table of contents).
- Multisite / organizations with data sharing (IBM docs table of contents).
- Compliance tracking and regulatory compliance reporting (IBM asset-management page).
- RBAC detail, audit logs, SOC 2 / ISO certifications, data residency: not confirmed (unverified).
- Users are created in the MAS console (per G2 review; see complaints).

### 13. AI / Advanced
- **Maximo Health:** condition-monitoring app combining IoT sensor readings, asset records, and work history; manages health, criticality, risk, and custom scores (IBM Health docs and asset-health page, search snippets; IBM Predict/Health pages).
- **Maximo Predict:** machine learning to estimate likelihood of future failures; moves from time-based to condition-based action (search snippet). Anomaly detection can be trained from a JSON file (Predict 8.9 release notes, search snippet). Operating-context-specific anomaly scores added in 8.4 (search snippet).
- **Maximo Monitor:** data foundation for real-time sensor / IoT data collection and analysis (search snippets; no dedicated Monitor page was fetched, so detail is thin).
- **AI Assistant:** natural-language queries of Maximo data, on-demand tables and views, accessible anywhere in MAS (IBM asset-management page).
- **watsonx generative AI:** conversational and summarization capabilities (IBM asset-management page).
- **Generative AI for work order data quality** (Manage datasheet, search snippet only).
- **Asset investment optimizer / matrix** utilities models now in Health and Predict (search snippet).
- Predictive maintenance and IoT ingestion are sold as separate Monitor/Health/Predict components, not as Manage features.

## Standout Differentiators
- Breadth of EAM plus APM in one suite: Manage (work, inventory, assets) paired with Health, Predict, and Monitor for IoT-driven condition-based maintenance (IBM product pages).
- Deep industry specialization through add-ons: linear assets, spatial asset management, utilities, oil and gas, transportation, civil infrastructure (IBM add-ons page).
- Mobile offline/online field execution with barcode and RFID scanning (IBM asset-management page).
- Generative AI assistant and work-order intelligence built on watsonx (IBM asset-management page).
- G2 reviewers most often praise flexibility and scalability, and asset tracking across the lifecycle ("from purchase order to the scrap heap") (G2 summary via search snippet).

## Common Complaints / Weaknesses
- Steep learning curve and "wall of modules"; dated, rigid UI (G2 reviewer; Facilio and Infraspeak blogs, search snippets).
- Customization and configuration are difficult for individual business needs (G2 reviewer; search snippet).
- Long rollouts: G2 summary lists average implementation time of about 7 months (search snippet; G2 summary is a snapshot).
- Requires solid infrastructure and skilled operations staff (G2 reviewer).
- Cost is high; G2 lists perceived cost in the top "$$$$$" tier (search snippet).
- Mobile app needs more clicks than modern alternatives (Infraspeak, search snippet).
- Version churn: Maximo 7.6.x reached end of support in September 2025 (partner page, search snippet), so customers must migrate to MAS.

**Caveat:** The G2 and third-party review figures are from search snippets and blog summaries, not full review pages. Review counts varied between snapshots (about 580 to 630). The IBM product pages are marketing-level; the IBM docs table of contents was truncated, so Assets, Work management, PM, Inventory, Contracts, and Reporting modules were not confirmed in full.
