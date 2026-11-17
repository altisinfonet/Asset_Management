# Lansweeper

- **Vendor / License:** Lansweeper (commercial, proprietary)
- **Category:** IT asset discovery & inventory (vendor positions it across IT, OT, IoT and cloud assets); adjacent modules for software license (SAM) and helpdesk/CMDB linkage
- **Target customers:** IT operations and sysadmin teams; mid-market to enterprise (Enterprise tier starts at 10,000 assets per third-party pricing pages). Source-level detail on verticals not found.
- **Deployment:** Both (per vendor; a Lansweeper cloud product page exists, but one review source states it is on-prem only with no vendor-hosted option; conflict unresolved, see Complaints)
- **Pricing model:** Asset-based tiers (per-asset bands). Official rate card not public; quote via vendor. Third-party estimates: Starter ~$239/mo billed annually (includes 2,000 assets), Pro ~$439/mo billed annually (bands of 1,000 assets from 2,000 to 9,000), Enterprise starts at 10,000 assets and is quote-only. Free plan and 14-day free trial (vendor). Third-party sources conflict on exact prices (unverified).
- **Sources:** See the Sources section at the bottom of this file.

## Features
For each category, bullet the concrete features. Write "Not offered / not found" if none. Mark anything uncertain with (unverified).

**Source note:** The official Lansweeper product pages (`/product/asset-inventory/`, `/product-overview/`, `/cloud/`) and the G2 and Capterra feature and review pages returned HTTP 403 to WebFetch. Feature claims below come from search-result snippets of Lansweeper's own pages, plus third-party write-ups, so they are weaker than a direct read of the vendor docs.

### 1. Asset Registry & Data Model
- Single, continuously updated inventory of hardware, software, cloud and mobile assets (vendor positioning; search snippets)
- Covers IT, OT and IoT assets (vendor tagline)
- Custom fields, asset categories, models/manufacturers, hierarchies, locations, depreciation: not found in sources reviewed (unverified where listed in other sections)

### 2. Lifecycle & Assignment
- Asset tracking and asset states: mentioned on the G2 feature list snippet (unverified)
- Check-in/check-out, assignment to user/location, disposal/retirement, reservations: not found
- Audits: asset metrics and audits (listed in G2 snippet, unverified)

### 3. Discovery & Inventory Automation
- Agentless and agent-based discovery; active and passive scanning; device recognition (vendor)
- Live scanning producing a full asset list (reviewer comment on G2)
- Cloud discovery connectors for AWS, Azure and GCP (third-party page, unverified against vendor)
- Unmanaged device detection (reviewer mention; unverified)
- Import/CSV: not confirmed in sources reviewed
- Feeds discovered data to ITSM/CMDB platforms (third-party description; unverified)

### 4. Tagging & Mobile
- Mobile assets are included in the inventory (vendor/reviewer mention)
- Barcode/QR/RFID, label printing, mobile app, offline mode, GPS: not found in sources reviewed

### 5. Software & License Management (SAM)
- Software license management, license agreement management, software license compliance management (G2 feature snippet, unverified)
- Software asset inventory is a strong area per G2 (score 9.8 from 18 reviews, per search snippet)
- SAM add-on priced per asset (third-party; tier labels unclear)
- Usage metering and SaaS management: not found

### 6. Maintenance & Work Orders (EAM)
- Not offered / not found (no preventive maintenance, work orders, spare parts or IoT maintenance found in sources reviewed). OT/IoT discovery is covered in section 3, not maintenance.

### 7. Contracts, Vendors & Finance
- Not found in sources reviewed (contracts, warranties, purchase orders, vendor records, cost tracking). Pricing is per asset for the product itself, not an asset-finance feature.

### 8. CMDB / Relationships / ITSM
- Helpdesk integration (reviewer mention, e.g. HelpDesk section with custom fields; unverified details)
- Feeds ITSM/CMDB systems via API and integrations (third-party; unverified)
- Configuration items, relationship maps, change/incident linkage: not found in sources reviewed

### 9. Reporting, Dashboards & Alerts
- Built-in reports, custom query reports (reviewers note custom reporting needs SQL knowledge, see Complaints)
- Vendor and reviewers mention reporting capability; scheduled reports, dashboards and alerts: not confirmed

### 10. Workflow & Automation
- Not confirmed in sources reviewed (no approval workflow, rules engine or trigger details found)

### 11. Integrations & API
- Lansweeper API to pull inventory data into other tools (vendor docs snippet)
- Helpdesk integration (reviewer mention)
- SSO and asset-level access scoping for permissions (vendor, per third-party summary; unverified)
- REST/GraphQL details, webhooks, LDAP/SCIM: not confirmed

### 12. Security, Multi-tenancy & Compliance
- Asset-level access scoping and SSO (see section 11, unverified)
- Vulnerability reporting (reviewer mention; unverified)
- RBAC detail, audit logs, multi-company tenancy, SOC2/ISO, data residency: not found

### 13. AI / Advanced
- Vendor has an AI information page (`/ai-info/` appears in search results), but no AI feature detail was retrieved (unverified)
- Predictive maintenance, normalization: not found

## Standout Differentiators
- Breadth of discovery: agentless plus agent-based, active plus passive, with recognition across Windows, Mac, Linux, network and printer devices (vendor and reviewers; reviewers often praise agentless discovery)
- Covers IT, OT, IoT and cloud assets in one inventory (vendor positioning)
- Asset-based pricing bands with a SAM add-on priced per asset (third-party pricing pages)
- Strong reputation in discovery and inventory on G2 and Capterra (G2 4.4/5 from 67 reviews; Capterra 4.5 from 75 reviews; counts vary by snapshot)

## Common Complaints / Weaknesses
- **Steep learning curve and hidden settings:** Capterra reviewer says it is hard to learn; another says settings are buried in collapsed sections (e.g. adding a custom-field value in HelpDesk takes several expansions). Also G2 mentions setup difficulty and UI performance.
- **Reporting and queries need SQL/database knowledge:** G2 and GetApp reviewers say custom reporting suits technicians who know database relationships; PeerSpot reviewers say reporting has glitches and needs customization.
- **Scaling:** a third-party comparison says the product can slow as endpoints grow (unverified; small sample).
- **Support and product age:** a competitor marketing article (Atera) says support is email-only with "canned" replies and that most KB articles are over 10 years old. Treat as biased but worth checking.
- **Platform gaps:** weaker Linux and Mac support, poor built-in software removal, VM inventory and VM discovery could be better (reviewer mentions).
- **Deployment conflict:** one review says Lansweeper is on-prem only with no vendor hosting, while the vendor appears to have a cloud product page. Not resolved; verify before design decisions.
- **Pricing:** reviewers call it high-priced versus alternatives; third-party sources report a per-asset model that can rise with count.
- **Dated UI:** one reviewer calls it dated but functional.
- Small review sample per complaint; most negatives come from one or two reviews each.

## Sources
Fetched successfully (text read):
- None of the Lansweeper vendor or review pages returned content to WebFetch (403)

Search results consulted (titles and snippets only, pages not read in full):
- https://www.lansweeper.com/ (vendor home)
- https://www.lansweeper.com/product/asset-inventory/ (403 on fetch; snippet only)
- https://www.lansweeper.com/product-overview/ (403 on fetch; snippet only)
- https://www.lansweeper.com/cloud/ (403 on fetch; snippet only)
- https://www.lansweeper.com/ai-info/ (snippet only)
- https://www.lansweeper.com/product/sam/ (snippet only)
- https://lansweeper.com/?p=132 (snippet only)
- https://www.lansweeper.com/use-cases/manual-versus-automated-network-inventory/ (snippet only)
- https://virima.com/blog/what-is-lansweeper-features-use-cases-alternatives (third-party; snippet only)
- https://www.g2.com/products/lansweeper/features (403 on fetch; snippet only)
- https://www.g2.com/products/lansweeper (snippet only)
- https://www.capterra.com/p/126334/Lansweeper/reviews/ (403 on fetch; snippet only)
- https://www.capterra.com/p/126334/Lansweeper/reviews/?page=2 (snippet only)
- https://www.capterra.com/p/126334/Lansweeper/pricing/ (snippet only)
- https://blog.invgate.com/lansweeper-pricing (snippet only)
- https://costbench.com/software/it-asset-management/lansweeper/ (snippet only)
- https://www.trustradius.com/products/lansweeper/pricing (snippet only)
- https://www.peerspot.com/products/lansweeper-pros-and-cons (snippet only)
- https://www.softwarereviews.com/products/lansweeper?offering_page=8 (snippet only)
- https://www.atera.com/blog/lansweeper-alternatives/ (competitor blog; snippet only)
- https://www.getapp.com/software/2053728/lansweeper (snippet only; getapp.ca listing)
- https://www.schneider.im/lansweeper-price-increase-2025-10/ (snippet only; monitor-counting note)
