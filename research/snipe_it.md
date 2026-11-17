# Snipe-IT

- **Vendor / License:** Grokability (open-source). License listed as AGPL-3.0 on the GitHub repository page. Note: a search snippet described it as GPLv3; the repository page is the primary source, so AGPL-3.0 is used here.
- **Category:** IT asset management / asset and license tracking (open-source web app, Laravel/PHP per repo file listing; also a commercial hosted offering)
- **Target customers:** IT departments, sysadmins, small and mid-size businesses, schools and nonprofits (inferred from review and blog sources, unverified as a stated target). Hosted offering aimed at teams that do not want to self-host.
- **Deployment:** Both. Self-hosted on Linux, Windows, or macOS (Docker image available), and a hosted account offered by the vendor. The hosted offering is listed on snipeitapp.com.
- **Pricing model:** Software is free and open source (self-hosted). Hosted (snipeitapp.com/pricing, USD): Basic Hosting $39.99/month or $399.99/year (120 API calls/min, community support only); Small Business Hosting $99.99/month or $999.99/year (240 API calls/min, email support, priority feature requests, automated upgrades and server maintenance); Dedicated Hosting (small) $249.99/month or $2,499.99/year (unlimited API calls subject to hardware, increased LDAP syncs, site IP restrictions). Medium and Large Dedicated Hosting listed at about $5k/year and $7.5k/year (limits not shown). Max users and assets listed as unlimited on all three small plans. Enterprise Support Plan includes phone support, API integration help, and a private Slack channel (not priced on the page).
- **Sources:**
  - Fetched successfully:
    - https://github.com/grokability/snipe-it
    - https://snipeitapp.com/product
    - https://snipeitapp.com/pricing
    - https://snipe-it.readme.io/ (documentation index)
  - Search results consulted (snippets only, not fetched):
    - https://tech.co/asset-tracking/snipe-it-review
    - https://www.g2.com/products/snipe-it (403 on fetch)
    - https://www.g2.com/products/snipe-it/reviews (403 on fetch)
    - https://www.capterra.com/p/150016/Snipe-IT/reviews/ (403 on fetch)
    - https://www.capterra.com/p/150016/Snipe-IT/ (search snippet only)
    - https://snipe-it.readme.io/docs/installation-issues
    - https://snipe-it.readme.io/docs/upgrading
    - https://snipe-it.readme.io/blog/whats-new-in-snipe-it-v4
    - https://www.goworkwize.com/blog/snipe-it-review
    - https://caeo.virima.com/blog/snipe-asset-management-features-limitations-and-alternative
    - https://redlib.hbubli.cc/r/sysadmin/comments/1isewng/need_a_good_asset_management_software
    - https://www.g2.com/compare/scalepad-lifecycle-manager-vs-snipe-it (search snippet)

## Features
(Sources for each item: GitHub repo page (GH), snipeitapp.com/product (SP), documentation index (Docs), pricing page (Pricing), search snippet (snippet).)

### 1. Asset Registry & Data Model
- Asset models (GH/SP "asset models"); models API endpoints `/models`, `/models/:id`, model files (Docs)
- Categories (Docs API `/categories`)
- Custom fields (SP, Docs user's manual)
- Locations with API (`/locations`) (Docs)
- Components (API `/components`) (Docs)
- Bulk imports, CSV import/export (SP, GH)
- Asset cloning (Docs user's manual)
- Depreciation types (Docs user's manual) and purchase-date based depreciation (GH)
- Parent-child hierarchies beyond components: Not found
- Multi-company / multi-tenancy in one installation (GH, Docs "Multi-tenancy")

### 2. Lifecycle & Assignment
- Checkout / check-in with one-click check-in (SP)
- Assignment to users and locations; item transfers between users (SP)
- End-user acceptance on checkout and optional digital signatures on acceptance (GH, SP)
- Requestable assets (SP)
- Expiration alerts (SP)
- Pre-defined kits for faster checkouts (GH)
- Full asset history (SP)
- Audits: audit feature and "upcoming audit reports" (SP, Docs)
- Asset maintenance records: API `/maintenances/:id` only (Docs); no maintenance workflow UI confirmed
- Reservations: Not found
- Procurement / purchase orders: Not found

### 3. Discovery & Inventory Automation
- No agent-based or network discovery found
- Sync adapters: GH lists 25 MDM/RMM sync adapters (Jamf, Microsoft Intune, NinjaOne, Kandji/Iru); SP lists 17 native adapters, claiming 20 total, plus a Custom HTTP adapter for any system with a JSON REST API. Counts conflict between sources; both listed.
- Named adapters/integrations: Jamf Pro, Microsoft Intune, Google Workspace, Kandji, NinjaOne, Meraki (SP)
- Import: CSV import (GH, SP), item importer (Docs CLI utilities)
- Cloud discovery (AWS/Azure scanning): Not found

### 4. Tagging & Mobile
- Barcode and QR support, asset labels (SP, Docs "barcodes and asset labels")
- Mobile-friendly web interface for updates on the go (GH, SP)
- Official mobile app: in beta (SP). Third-party mobile apps are listed. One Android app is noted as incompatible with hosted accounts (SP).
- Offline mode: Not found
- GPS / geolocation: Not found
- RFID: Not found
- Per-user light/dark mode and per-user language (GH)

### 5. Software & License Management (SAM)
- License records with quick access to history and checkouts (SP)
- License seats, seat-level API `/licenses/:id/seats/:seat_id` (Docs)
- Expiration email alerts for licenses (SP)
- Multi-pack license support (snippet, G2 summary)
- SaaS management / usage metering: Not found
- Compliance reporting for licenses beyond expiration: Not found

### 6. Maintenance & Work Orders (EAM)
- Asset maintenances tracked (Docs "Asset Maintenances" API endpoint; cost and maintenance tracking listed in a SourceForge snippet, unverified)
- Work orders: Not found
- Preventive / condition-based maintenance: Not found
- Spare parts / inventory of consumables and components: Accessories, consumables, and components exist as API resources (Docs)
- IoT / sensors: Not found

### 7. Contracts, Vendors & Finance
- Depreciation types (Docs), purchase dates for depreciation (GH)
- Cost tracking (snippet, SourceForge listing; unverified)
- Supplier management (snippet, SourceForge listing; unverified)
- Warranty / contract records: Not confirmed
- Purchase orders: Not found

### 8. CMDB / Relationships / ITSM
- Components and accessories linked to assets (Docs API)
- Configuration item relationships: Not found
- Incident / change management: Not found
- Service desk: Not found
- Jira integration: "Snipe-IT for Jira" by codefortynine, free up to 10 users (SP, third-party)
- Freshservice and Halo ITSM are listed as community/low-code integrations (SP)

### 9. Reporting, Dashboards & Alerts
- Recent-activity dashboard view (SP)
- Calendar view (SP, marked "new")
- Activity report API `/reports/activity` (Docs)
- Built-in emails to users and admins: expected checkin, expiring license, low inventory, upcoming audit reports (SP)
- One-click or cron backups (GH, SP)
- Custom report builder: Not found; a G2 reviewer notes limited report customization (snippet)

### 10. Workflow & Automation
- Notifications: Slack and Teams check-in/check-out alerts (GH, SP)
- Webhooks (Docs user's manual)
- Approval workflows: Not found (end-user acceptance flow is the closest feature)
- Rules / triggers: Not found beyond notifications and webhooks
- Low-code connectors: Pipedream, Rapid7, blinkops, Trelica, ZohoFlow, Axonius, ConductorOne, Mindflow (SP, third-party)

### 11. Integrations & API
- Robust JSON REST API (GH, SP); endpoint list in Docs for assets, locations, accessories, consumables, components, users, models, licenses, categories, maintenances, reports
- API rate limits by plan on hosted offering: 120 calls/min (Basic), 240 calls/min (Small Business), unlimited subject to hardware (Dedicated) (Pricing)
- PowerShell API documentation (Docs)
- SSO: SAML (GH, SP, Docs)
- Directory: Active Directory/LDAP login and sync, Google Secure LDAP sync (GH, SP), hosted LDAP providers (Docs)
- SCIM user provisioning (GH, SP, Docs)
- OIDC auth plugin (community, SP)
- MCP server (community, SP)
- Go client library (community, SP)

### 12. Security, Multi-tenancy & Compliance
- Role-based groups with granular permissions (GH, SP)
- Multi-company support in one installation (GH); Docs also list "Multi-tenancy"
- SAML, LDAP, SCIM (see section 11)
- Site IP restrictions on Small/Dedicated hosted plans (Pricing)
- Audit log: Activity/history tracking and an activity report API (SP, Docs); dedicated audit-log compliance feature: Not confirmed
- SOC 2 / ISO 27001 / data residency: Not found
- Self-hosting gives data control (inferred from open-source self-host model, unverified as a compliance claim)

### 13. AI / Advanced
- AI features built in: Not found
- Community MCP server connects AI agents to the API (SP, third-party)
- Predictive maintenance: Not found
- Data normalization utility exists as a CLI command (Docs)
- Translations: 55+ languages (GH, SP)

## Standout Differentiators
- Free, open-source (AGPL-3.0) self-hostable asset and license tracker with a broad REST API (GH)
- Strong identity integrations for an open-source tool: SAML, LDAP/AD, Google Secure LDAP, SCIM (GH, SP)
- Native MDM/RMM sync adapters (Jamf, Intune, NinjaOne, Kandji, Meraki) plus a Custom HTTP adapter for any JSON REST system (GH, SP)
- Kits, requestable assets, and digital acceptance on checkout (GH, SP)
- Translated into 55+ languages with per-user language and light/dark mode (GH)

## Common Complaints / Weaknesses
(Review-site pages returned 403, so these come from search snippets and are unverified in full. Reddit threads were not retrieved directly.)
- **Self-hosting burden:** Running it takes real web-server and database administration. A commenter on r/Snipe_IT says setup is not hard if you can run a basic web server, which implies the barrier is self-hosting itself (secondhand, unverified).
- **Upgrades and support:** A Capterra reviewer calls the upgrade process cumbersome. Customer service is the lowest-rated Capterra metric (3.6 from 11 ratings, snippet). Open-source use has no guaranteed support SLA; paid support is only on hosted plans or the Enterprise Support Plan.
- **Dated UI and UX:** One aggregator notes a dated interface and excess clicks (secondhand).
- **Reporting:** G2 reviewers note limited report customization. Reviews also flag reporting, integrations, and notifications as common criticisms in one comparison site.
- **Learning curve and performance:** G2 snippet mentions a steep learning curve and occasionally slow performance.
- **Mobile:** No official mobile app yet (beta only). Community apps vary, and one Android app is incompatible with hosted accounts.
- **Ratings (snippets, unverified):** G2 about 4.6/5 across 26 reviews; Capterra about 4.4 across 23 reviews, with 95% positive sentiment. Positive themes: easy-to-use interface, simple navigation, API, and low cost.
- **Scope gaps:** No discovery agent, no work orders, no contracts or procurement module, no CMDB, and no native AI features. Teams needing these will rely on integrations.
