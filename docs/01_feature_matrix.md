# 01 - Feature Matrix: 10-Competitor Asset Management Landscape

Scope: consolidated feature catalogue, pricing and deployment summary, recurring customer complaints, market gaps and data-quality notes for ten researched products. Every mark below is derived only from the research files in `E:\Sayak\asset_tracker\research\` (plus the product list in `E:\Sayak\asset_tracker\asset_management_systems.md`). No outside knowledge was added. Where a research file says "unverified", the mark is partial (◐), never ✅.

## How to read the matrix

### Product codes

| Code | Product (research file) | Segment per research | Evidence base |
|---|---|---|---|
| SN | ServiceNow ITAM: SAM Pro, HAM Pro, CMDB (`servicenow.md`) | Enterprise (target segment unverified) | Vendor docs + one partner blog; G2/Capterra via snippets |
| FS | Freshservice ITAM within ITSM (`freshservice.md`) | SMB / mid-market (unverified) | Vendor pages + support docs; reviews via snippets |
| MX | IBM Maximo Application Suite (`ibm_maximo.md`) | Enterprise / industrial | Marketing pages; mostly snippets |
| SAP | SAP EAM / Service and Asset Manager / APM (`sap_eam.md`) | Enterprise on SAP | Almost entirely snippets (SAP pages returned 403) |
| INF | Infor EAM, now HxGN EAM by Hexagon (`infor_eam.md`) | Enterprise / asset-intensive | Snippets only (all official pages failed) |
| FLX | Flexera One (`flexera_one.md`) | Enterprise | Three vendor pages read; vendor claims |
| LS | Lansweeper (`lansweeper.md`) | Mid-market to enterprise (SMB per context file) | Snippets only (all vendor/review pages 403) |
| ME | ManageEngine AssetExplorer (`manageengine_assetexplorer.md`) | SMB to enterprise, budget-conscious | Four vendor pages read; thin reviews |
| AP | Asset Panda (`asset_panda.md`) | SMB, government, education | Homepage read; rest snippets |
| SIT | Snipe-IT (`snipe_it.md`) | SMB, schools, nonprofits (inferred) | GitHub, product, pricing and docs pages read |

### Legend

| Mark | Meaning |
|---|---|
| ✅ | Supported per the research (stated as a feature, not tagged "unverified") |
| ◐ | Partial, add-on / separately sold component, unverified, vendor-claim-only-in-snippet, or community/third-party only |
| ❌ | Researched and not offered: the research file says "Not offered" or a bare "Not found" for that item (or for its whole category) |
| ? | Not found / unknown: the research says "not found in sources read", "not confirmed", "not verified", "not checked", or is silent |

Important: ❌ means "the researcher looked and found nothing", not proof of absence. This matters most for snippet-based products (MX, SAP, INF, LS, AP). Where a research file used the hedged phrase "not found in sources read/reviewed" (for example SN, FS, LS, ME) the mark is `?`, not ❌.

Item-level labels govern: for Asset Panda the research states that search-snippet items are unverified, so those are ◐. For Infor EAM every item is snippet-derived (see Data quality notes); items tagged "(snippet)" without "unverified" are shown ✅, items tagged "unverified" are ◐.

### Prevalence and Tier

- **Prevalence** = number of products (out of 10) marked ✅ or ◐. The "SMB n/5" suffix counts the same marks among the five SMB / mid-market products: FS, LS, ME, AP, SIT. SN, FLX, MX, SAP and INF are treated as the enterprise group.
- **Tier** is assigned mechanically from the SMB count, so it can be audited:
  - **Table-stakes**: at least 3 of the 5 SMB/mid-market products are ✅ or ◐, and at least one of them is ✅.
  - **Differentiator**: 1 or 2 of the 5 SMB/mid-market products have it (or 3 or more but all only ◐).
  - **Enterprise/Niche**: none of the 5 SMB/mid-market products has it (only enterprise-group products, or nobody).
- Because many research files were thin, a low prevalence on a basic feature (custom fields, REST API, locations) often reflects research depth rather than reality. These cases are flagged in the notes under each table. Treat the tier as "what the research evidences", not as a market truth.

## 1. Consolidated feature catalogue

### 1. Asset Registry & Data Model

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 1.1 | Core asset master record | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 10/10 (SMB 5/5) | **Table-stakes** |
| 1.2 | Asset categories / asset types | ? | ✅ | ◐ | ? | ❌ | ❌ | ? | ✅ | ◐ | ✅ | 5/10 (SMB 4/5) | **Table-stakes** |
| 1.3 | Custom fields / configurable attributes | ? | ? | ❌ | ? | ❌ | ❌ | ? | ? | ✅ | ✅ | 2/10 (SMB 2/5) | Differentiator |
| 1.4 | Model / manufacturer catalog and normalization | ◐ | ◐ | ❌ | ? | ❌ | ✅ | ? | ? | ? | ✅ | 4/10 (SMB 2/5) | Differentiator |
| 1.5 | Parent-child / hierarchical assets | ? | ? | ? | ? | ✅ | ❌ | ? | ? | ◐ | ◐ | 3/10 (SMB 2/5) | Differentiator |
| 1.6 | Locations / sites on asset records | ? | ? | ✅ | ◐ | ✅ | ? | ? | ? | ✅ | ✅ | 5/10 (SMB 2/5) | Differentiator |
| 1.7 | Depreciation | ? | ? | ❌ | ? | ✅ | ❌ | ? | ✅ | ◐ | ✅ | 4/10 (SMB 3/5) | **Table-stakes** |
| 1.8 | Consumables / accessories / components | ? | ? | ? | ? | ? | ? | ? | ✅ | ◐ | ✅ | 3/10 (SMB 3/5) | **Table-stakes** |
| 1.9 | Attachments, photos and documents on records | ? | ? | ✅ | ◐ | ? | ? | ? | ? | ✅ | ◐ | 4/10 (SMB 2/5) | Differentiator |
| 1.10 | Non-IT / physical / OT asset coverage | ◐ | ◐ | ✅ | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ? | 8/10 (SMB 4/5) | **Table-stakes** |
| 1.11 | EOL / EOS lifecycle-date enrichment | ? | ✅ | ? | ? | ? | ✅ | ? | ? | ? | ? | 2/10 (SMB 1/5) | Differentiator |
| 1.12 | Linear / spatial / GIS assets | ? | ? | ◐ | ? | ◐ | ? | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |

Notes:
- 1.3: Custom fields: MX/INF/FLX research says 'not found' (bare); SN/FS/LS/ME say 'not found in sources read', so shown as ?. Low prevalence likely reflects research depth, not true absence.
- 1.6: Locations are almost certainly more common than shown; most files simply did not detail them.
- 1.7: FS is '?' (research: depreciation "not mentioned" on one page, and "not found in sources read" elsewhere).
- 1.10: FS marked partial because a reviewer says hybrid IT/physical setups need significant upfront design. SN: EAM is a separate product area.

### 2. Lifecycle & Assignment

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 2.1 | End-to-end lifecycle tracking (acquire to retire) | ✅ | ✅ | ✅ | ? | ? | ◐ | ◐ | ✅ | ✅ | ◐ | 8/10 (SMB 5/5) | **Table-stakes** |
| 2.2 | Asset history / chain of custody | ✅ | ? | ✅ | ? | ? | ? | ? | ✅ | ✅ | ✅ | 5/10 (SMB 3/5) | **Table-stakes** |
| 2.3 | Check-in / check-out | ? | ? | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | 2/10 (SMB 2/5) | Differentiator |
| 2.4 | Assignment to users / locations and transfers | ? | ? | ? | ? | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | 3/10 (SMB 3/5) | **Table-stakes** |
| 2.5 | End-user acknowledgement / digital acceptance | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | ✅ | 2/10 (SMB 2/5) | Differentiator |
| 2.6 | Physical audits / stocktakes | ✅ | ◐ | ❌ | ? | ◐ | ❌ | ◐ | ✅ | ◐ | ✅ | 7/10 (SMB 5/5) | **Table-stakes** |
| 2.7 | Configurable lifecycle states and automated state actions | ◐ | ? | ? | ? | ? | ? | ◐ | ✅ | ? | ? | 3/10 (SMB 2/5) | Differentiator |
| 2.8 | Disposal / retirement handling | ◐ | ✅ | ◐ | ? | ❌ | ❌ | ❌ | ❌ | ✅ | ? | 4/10 (SMB 2/5) | Differentiator |
| 2.9 | Reservations / booking | ? | ? | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | 1/10 (SMB 1/5) | Differentiator |
| 2.10 | Requestable assets / software requests | ✅ | ? | ? | ? | ? | ? | ? | ? | ? | ✅ | 2/10 (SMB 1/5) | Differentiator |
| 2.11 | Kits / bundled checkout | ? | ? | ? | ? | ? | ? | ? | ? | ◐ | ✅ | 2/10 (SMB 2/5) | Differentiator |
| 2.12 | Lease tracking | ✅ | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | 2/10 (SMB 1/5) | Differentiator |
| 2.13 | Hardware refresh / aging-asset planning | ✅ | ? | ? | ? | ? | ◐ | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 2.14 | Loaned-asset tracking | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | ? | 1/10 (SMB 1/5) | Differentiator |

Notes:
- 2.3: ME has 'loaned assets' (row 2.14) but the research says check-in/check-out was not found.
- 2.6: FS: barcode scanning for physical audits is on the HAM page, but the file also lists audits as 'not found'. AP/LS audit items are search-snippet or unverified.

### 3. Discovery & Inventory Automation

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 3.1 | Agentless / network discovery | ◐ | ◐ | ❌ | ? | ❌ | ◐ | ✅ | ✅ | ❌ | ❌ | 5/10 (SMB 3/5) | **Table-stakes** |
| 3.2 | Agent-based discovery | ✅ | ◐ | ❌ | ? | ❌ | ✅ | ✅ | ◐ | ◐ | ❌ | 6/10 (SMB 4/5) | **Table-stakes** |
| 3.3 | Multi-OS and network-device coverage (Windows/Mac/Linux, printers, switches) | ? | ◐ | ? | ? | ? | ? | ✅ | ✅ | ? | ? | 3/10 (SMB 3/5) | **Table-stakes** |
| 3.4 | Cloud infrastructure discovery (AWS / Azure / GCP) | ? | ◐ | ❌ | ? | ❌ | ✅ | ◐ | ◐ | ❌ | ❌ | 4/10 (SMB 3/5) | Differentiator |
| 3.5 | OT / IoT device discovery | ? | ? | ? | ? | ? | ? | ✅ | ? | ? | ? | 1/10 (SMB 1/5) | Differentiator |
| 3.6 | MDM / RMM / directory / SCCM connectors | ✅ | ◐ | ❌ | ? | ❌ | ◐ | ? | ✅ | ◐ | ✅ | 6/10 (SMB 4/5) | **Table-stakes** |
| 3.7 | CSV / XLS bulk import | ? | ? | ? | ? | ✅ | ? | ? | ✅ | ? | ✅ | 3/10 (SMB 2/5) | Differentiator |
| 3.8 | Generic API / custom connector for any data source | ? | ? | ? | ? | ? | ✅ | ? | ? | ? | ✅ | 2/10 (SMB 1/5) | Differentiator |
| 3.9 | Distributed probes for multi-site scanning | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | ? | 1/10 (SMB 1/5) | Differentiator |
| 3.10 | Active + passive scanning / unmanaged-device detection | ? | ? | ? | ? | ? | ? | ✅ | ? | ? | ? | 1/10 (SMB 1/5) | Differentiator |

Notes:
- 3.4: All three SMB/mid-market marks are partial (FS: unverified announcements; LS: third-party page; ME: Azure/Intune integrations).
- 3.1, 3.2, 3.4, 3.6: SAP is '?' ("not found in sources read" is a hedged phrase). 3.7: AP is '?' (the research says "CSV / bulk import: Not confirmed"; reviewers only say onboarding is difficult), so CSV import is a Differentiator by the mechanical rule, though it is almost certainly basic in reality.
- 3.6: AP: Google Workspace / Intune are search-snippet only; JAMF from a customer story.

### 4. Tagging & Mobile

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 4.1 | Barcode scanning | ✅ | ✅ | ✅ | ? | ✅ | ❌ | ? | ✅ | ✅ | ✅ | 7/10 (SMB 4/5) | **Table-stakes** |
| 4.2 | QR code scanning / generation | ✅ | ? | ❌ | ? | ? | ❌ | ◐ | ✅ | ✅ | ✅ | 5/10 (SMB 4/5) | **Table-stakes** |
| 4.3 | RFID | ? | ? | ✅ | ? | ❌ | ❌ | ? | ✅ | ❌ | ❌ | 2/10 (SMB 1/5) | Differentiator |
| 4.4 | Label design / printing | ? | ? | ❌ | ? | ✅ | ❌ | ? | ❌ | ✅ | ✅ | 3/10 (SMB 2/5) | Differentiator |
| 4.5 | Native mobile app | ✅ | ? | ✅ | ✅ | ✅ | ❌ | ? | ◐ | ✅ | ◐ | 7/10 (SMB 3/5) | **Table-stakes** |
| 4.6 | Offline mode | ? | ? | ✅ | ? | ✅ | ❌ | ? | ❌ | ◐ | ❌ | 3/10 (SMB 1/5) | Differentiator |
| 4.7 | GPS / geolocation capture | ? | ? | ◐ | ? | ❌ | ❌ | ? | ❌ | ◐ | ❌ | 2/10 (SMB 1/5) | Differentiator |
| 4.8 | Mobile work-order execution | ? | ? | ✅ | ✅ | ✅ | ❌ | ? | ❌ | ? | ❌ | 3/10 (SMB 0/5) | Enterprise/Niche |
| 4.9 | Photo / voice capture and signatures on mobile | ? | ? | ✅ | ? | ? | ❌ | ? | ? | ✅ | ? | 2/10 (SMB 1/5) | Differentiator |
| 4.10 | Mobile-responsive web UI | ? | ? | ? | ? | ? | ? | ? | ? | ? | ✅ | 1/10 (SMB 1/5) | Differentiator |

Notes:
- 4.8: AP is '?': the research shows work orders (snippet) and a mobile app (inspections, transfers) but never work-order execution on mobile.
- 4.5: ME: mobile app unclear (one listing says Android only). SIT: official app in beta; third-party apps exist.

### 5. Software & License Management (SAM)

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 5.1 | Software license records | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ◐ | ✅ | ❌ | ✅ | 6/10 (SMB 4/5) | **Table-stakes** |
| 5.2 | Seat / entitlement tracking | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ◐ | ✅ | ❌ | ✅ | 6/10 (SMB 4/5) | **Table-stakes** |
| 5.3 | License compliance (over / under-licensing) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ◐ | ✅ | ❌ | ❌ | 5/10 (SMB 3/5) | **Table-stakes** |
| 5.4 | License expiry / renewal alerts | ◐ | ✅ | ❌ | ❌ | ❌ | ✅ | ? | ◐ | ❌ | ✅ | 5/10 (SMB 3/5) | **Table-stakes** |
| 5.5 | Installed-software inventory from discovery | ◐ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ? | ? | 5/10 (SMB 3/5) | **Table-stakes** |
| 5.6 | Software usage metering | ◐ | ◐ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | 4/10 (SMB 2/5) | Differentiator |
| 5.7 | Reclamation / optimization recommendations | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ? | ? | ❌ | ? | 3/10 (SMB 1/5) | Differentiator |
| 5.8 | SaaS management (discovery, usage, spend) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | 3/10 (SMB 1/5) | Differentiator |
| 5.9 | Shadow-IT / prohibited-software detection | ? | ✅ | ❌ | ❌ | ❌ | ✅ | ? | ? | ❌ | ? | 2/10 (SMB 1/5) | Differentiator |
| 5.10 | Publisher-specific license modeling (e.g. Microsoft) | ✅ | ? | ❌ | ❌ | ❌ | ✅ | ? | ? | ❌ | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 5.11 | Vendor-audit defense support | ? | ? | ❌ | ❌ | ❌ | ✅ | ? | ? | ❌ | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 5.12 | Multi-pack / suite licensing | ? | ? | ❌ | ❌ | ❌ | ? | ? | ◐ | ❌ | ◐ | 2/10 (SMB 2/5) | Differentiator |
| 5.13 | Cloud license management | ? | ? | ❌ | ❌ | ❌ | ✅ | ? | ? | ❌ | ? | 1/10 (SMB 0/5) | Enterprise/Niche |

Notes:
- 5.1-5.13: MX, SAP, INF and AP: research says SAM not offered / not found.
- 5.4: ME renewal alerts are for contracts, not licences (partial).

### 6. Maintenance & Work Orders (EAM)

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 6.1 | Work orders | ◐ | ? | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ◐ | ❌ | 5/10 (SMB 1/5) | Differentiator |
| 6.2 | Preventive-maintenance scheduling (calendar / meter) | ◐ | ? | ◐ | ◐ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | 5/10 (SMB 1/5) | Differentiator |
| 6.3 | Inspections / checklists | ? | ? | ? | ? | ✅ | ❌ | ❌ | ❌ | ✅ | ? | 2/10 (SMB 1/5) | Differentiator |
| 6.4 | Condition-based maintenance | ? | ? | ◐ | ◐ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | 3/10 (SMB 0/5) | Enterprise/Niche |
| 6.5 | Spare parts / storeroom inventory | ? | ? | ✅ | ◐ | ✅ | ❌ | ❌ | ◐ | ? | ◐ | 5/10 (SMB 2/5) | Differentiator |
| 6.6 | Repair / maintenance logging | ? | ? | ? | ? | ? | ❌ | ❌ | ❌ | ✅ | ◐ | 2/10 (SMB 2/5) | Differentiator |
| 6.7 | Calibration management | ? | ? | ✅ | ? | ? | ❌ | ❌ | ❌ | ✅ | ? | 2/10 (SMB 1/5) | Differentiator |
| 6.8 | Job plans and failure codes | ? | ? | ✅ | ? | ? | ❌ | ❌ | ❌ | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 6.9 | Labor / crew / qualification management | ? | ? | ✅ | ? | ◐ | ❌ | ❌ | ❌ | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 6.10 | Graphical / advanced maintenance scheduling | ? | ? | ✅ | ? | ? | ❌ | ❌ | ❌ | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 6.11 | IoT / sensor data ingestion | ? | ? | ◐ | ◐ | ? | ❌ | ❌ | ❌ | ❌ | ❌ | 2/10 (SMB 0/5) | Enterprise/Niche |
| 6.12 | Safety permits / lock-out-tag-out display | ? | ? | ? | ✅ | ? | ❌ | ❌ | ❌ | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 6.13 | Facilities / fleet / tools modules | ? | ? | ? | ? | ? | ❌ | ❌ | ❌ | ✅ | ? | 1/10 (SMB 1/5) | Differentiator |

### 7. Contracts, Vendors & Finance

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 7.1 | Contract tracking with expiry / renewal alerts | ✅ | ✅ | ? | ? | ◐ | ✅ | ? | ✅ | ❌ | ? | 5/10 (SMB 2/5) | Differentiator |
| 7.2 | Purchase orders / procurement | ✅ | ✅ | ? | ? | ✅ | ❌ | ? | ✅ | ❌ | ❌ | 4/10 (SMB 2/5) | Differentiator |
| 7.3 | Multi-currency / GL-code support | ? | ? | ✅ | ? | ? | ? | ? | ✅ | ? | ? | 2/10 (SMB 1/5) | Differentiator |
| 7.4 | Vendor / supplier records | ? | ? | ◐ | ? | ❌ | ? | ? | ❌ | ❌ | ◐ | 2/10 (SMB 1/5) | Differentiator |
| 7.5 | Warranty tracking | ? | ? | ? | ? | ◐ | ❌ | ? | ❌ | ✅ | ? | 2/10 (SMB 1/5) | Differentiator |
| 7.6 | Per-asset cost / TCO tracking | ✅ | ? | ✅ | ✅ | ◐ | ✅ | ? | ◐ | ✅ | ◐ | 8/10 (SMB 3/5) | **Table-stakes** |
| 7.7 | Showback / chargeback and cost-center allocation | ✅ | ? | ? | ? | ? | ✅ | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 7.8 | Budget management | ? | ? | ? | ? | ✅ | ? | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 7.9 | ERP / finance / procurement-tool integration | ? | ? | ✅ | ✅ | ? | ✅ | ? | ? | ? | ? | 3/10 (SMB 0/5) | Enterprise/Niche |
| 7.10 | Cloud cost management (FinOps) | ✅ | ? | ? | ? | ? | ✅ | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 7.11 | Software / SaaS spend analytics | ✅ | ✅ | ? | ? | ? | ✅ | ? | ? | ? | ? | 3/10 (SMB 1/5) | Differentiator |

Notes:
- 7.1, 7.2, 7.5: MX is '?': the research says contracts, warranties and purchase orders are "not confirmed (unverified)". 
- 7.6: AP costs are stored on asset records (vendor page); ME limited to contract cost; SIT/INF unverified.

### 8. CMDB / Relationships / ITSM

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 8.1 | CMDB / configuration items | ✅ | ✅ | ❌ | ❌ | ? | ? | ? | ✅ | ❌ | ❌ | 3/10 (SMB 2/5) | Differentiator |
| 8.2 | CI relationship / dependency maps | ◐ | ◐ | ❌ | ❌ | ? | ? | ? | ✅ | ❌ | ❌ | 3/10 (SMB 2/5) | Differentiator |
| 8.3 | Built-in service desk / ticketing | ◐ | ✅ | ❌ | ❌ | ? | ❌ | ◐ | ◐ | ✅ | ❌ | 5/10 (SMB 4/5) | **Table-stakes** |
| 8.4 | Incident / change linkage to assets | ? | ◐ | ❌ | ❌ | ? | ❌ | ? | ? | ❌ | ❌ | 1/10 (SMB 1/5) | Differentiator |
| 8.5 | Self-service portal / service catalog | ✅ | ✅ | ? | ? | ? | ? | ? | ✅ | ? | ? | 3/10 (SMB 2/5) | Differentiator |
| 8.6 | Integration with external ITSM / CMDB platforms | ? | ? | ? | ? | ? | ◐ | ◐ | ◐ | ? | ◐ | 4/10 (SMB 3/5) | Differentiator |
| 8.7 | Discovery auto-populates CMDB | ◐ | ◐ | ? | ? | ? | ? | ? | ✅ | ? | ? | 3/10 (SMB 2/5) | Differentiator |
| 8.8 | CMDB health / duplicate cleanup | ◐ | ? | ? | ? | ? | ? | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 8.9 | Shared ITAM + ITSM + security data model | ◐ | ? | ? | ? | ? | ? | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 8.10 | Custom CI types / business views | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | ? | 1/10 (SMB 1/5) | Differentiator |

Notes:
- 8.3: LS and ME: helpdesk / ServiceDesk Plus links are reviewer or third-party mentions (unverified). SN: ITSM data-model sharing is a search snippet (unverified).

### 9. Reporting, Dashboards & Alerts

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 9.1 | Built-in standard reports | ? | ? | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | ◐ | 8/10 (SMB 4/5) | **Table-stakes** |
| 9.2 | Custom report builder / ad hoc queries | ? | ? | ✅ | ◐ | ◐ | ❌ | ✅ | ✅ | ◐ | ❌ | 6/10 (SMB 3/5) | **Table-stakes** |
| 9.3 | Dashboards | ✅ | ? | ✅ | ? | ◐ | ✅ | ? | ✅ | ? | ◐ | 6/10 (SMB 2/5) | Differentiator |
| 9.4 | Scheduled reports | ? | ? | ✅ | ? | ❌ | ❌ | ? | ✅ | ? | ? | 2/10 (SMB 1/5) | Differentiator |
| 9.5 | Export (CSV / XLS / PDF) | ? | ? | ✅ | ? | ? | ? | ? | ✅ | ✅ | ✅ | 4/10 (SMB 3/5) | **Table-stakes** |
| 9.6 | Alerts and notifications (expiry, low stock, renewals) | ? | ✅ | ✅ | ✅ | ❌ | ❌ | ? | ✅ | ? | ✅ | 5/10 (SMB 3/5) | **Table-stakes** |
| 9.7 | Slack / Teams notifications | ? | ◐ | ? | ? | ? | ? | ? | ? | ? | ✅ | 2/10 (SMB 2/5) | Differentiator |
| 9.8 | Compliance / audit / depreciation reports | ? | ? | ✅ | ? | ? | ✅ | ? | ? | ✅ | ? | 3/10 (SMB 1/5) | Differentiator |
| 9.9 | External BI / analytics integration | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | ? | 1/10 (SMB 1/5) | Differentiator |

Notes:
- 10.3: FS is '?' (research: "approval workflows and rule engine: not verified").
- 9.3: Dashboards: 'not confirmed' for FS, LS, AP and SAP in research (shown ?). SIT has a recent-activity dashboard and calendar view only.

### 10. Workflow & Automation

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 10.1 | Approval workflows | ? | ? | ✅ | ? | ✅ | ❌ | ? | ✅ | ❌ | ❌ | 3/10 (SMB 1/5) | Differentiator |
| 10.2 | Custom workflow designer | ◐ | ◐ | ✅ | ? | ❌ | ❌ | ? | ✅ | ✅ | ❌ | 5/10 (SMB 3/5) | **Table-stakes** |
| 10.3 | Rules / triggers / policy engine | ◐ | ? | ✅ | ✅ | ❌ | ✅ | ? | ✅ | ❌ | ❌ | 5/10 (SMB 1/5) | Differentiator |
| 10.4 | Escalations / scheduled jobs | ? | ? | ✅ | ? | ? | ? | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 10.5 | Onboarding / provisioning / lifecycle automation | ◐ | ✅ | ? | ? | ? | ? | ? | ? | ? | ? | 2/10 (SMB 1/5) | Differentiator |
| 10.6 | Auto-create tickets from asset events | ? | ? | ? | ? | ? | ✅ | ? | ? | ◐ | ? | 2/10 (SMB 1/5) | Differentiator |
| 10.7 | Role-restricted status transitions | ? | ? | ? | ? | ✅ | ? | ? | ✅ | ? | ? | 2/10 (SMB 1/5) | Differentiator |
| 10.8 | Low-code app / form customization | ? | ? | ✅ | ? | ? | ? | ? | ◐ | ? | ? | 2/10 (SMB 1/5) | Differentiator |
| 10.9 | Renewal / expiry workflow automation | ◐ | ✅ | ? | ? | ? | ? | ? | ✅ | ? | ? | 3/10 (SMB 2/5) | Differentiator |

### 11. Integrations & API

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 11.1 | REST API | ? | ? | ? | ? | ◐ | ? | ◐ | ? | ✅ | ✅ | 4/10 (SMB 3/5) | **Table-stakes** |
| 11.2 | Webhooks | ? | ? | ? | ? | ❌ | ? | ? | ? | ❌ | ✅ | 1/10 (SMB 1/5) | Differentiator |
| 11.3 | SAML / SSO | ◐ | ◐ | ? | ? | ❌ | ? | ◐ | ? | ✅ | ✅ | 5/10 (SMB 4/5) | **Table-stakes** |
| 11.4 | LDAP / Active Directory | ? | ◐ | ? | ? | ❌ | ❌ | ? | ? | ❌ | ✅ | 2/10 (SMB 2/5) | Differentiator |
| 11.5 | SCIM provisioning | ? | ? | ? | ? | ❌ | ❌ | ? | ? | ❌ | ✅ | 1/10 (SMB 1/5) | Differentiator |
| 11.6 | Prebuilt connectors to named third-party tools | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | ✅ | ◐ | ✅ | 10/10 (SMB 5/5) | **Table-stakes** |
| 11.7 | iPaaS / low-code connectors (Zapier etc.) | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | ✅ | 2/10 (SMB 2/5) | Differentiator |
| 11.8 | Enterprise integration bus / middleware | ? | ? | ✅ | ◐ | ✅ | ? | ? | ? | ? | ? | 3/10 (SMB 0/5) | Enterprise/Niche |
| 11.9 | API client libraries / scripting support | ? | ? | ? | ? | ? | ? | ? | ? | ? | ✅ | 1/10 (SMB 1/5) | Differentiator |

Notes:
- 11.1: REST API is '?' for many products only because the research did not verify it, not because it is absent. LS is ◐: the research cites a "Lansweeper API" but says REST/GraphQL details are not confirmed. FLX 11.1/11.2 are '?' because the research says "not found in sources reviewed".
- 11.3: SN/FS/LS marks are indirect (complaints or unverified third-party summaries). INF: 'SSO/LDAP: Not found'.
- Updated 2026-11-17 (validation: competitor): AP 9.5, 11.1 and 11.3 changed to ✅ (CSV/Excel/PDF export; REST API with admin-only key pair, 400 calls per 3 minutes per IP; SAML 2.0 SSO). AP plan inclusion unverified. AP 11.2 webhooks stay ❌ (not found; unverified).

### 12. Security, Multi-tenancy & Compliance

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 12.1 | RBAC / granular permissions | ? | ◐ | ✅ | ? | ✅ | ? | ◐ | ◐ | ◐ | ✅ | 7/10 (SMB 5/5) | **Table-stakes** |
| 12.2 | Audit log / activity history | ✅ | ? | ? | ? | ? | ? | ? | ✅ | ◐ | ✅ | 4/10 (SMB 3/5) | **Table-stakes** |
| 12.3 | Multi-company / multi-organization in one instance | ? | ? | ✅ | ? | ✅ | ? | ? | ? | ? | ✅ | 3/10 (SMB 1/5) | Differentiator |
| 12.4 | Site / org / asset-scoped access control | ? | ? | ✅ | ? | ✅ | ? | ◐ | ? | ? | ? | 3/10 (SMB 1/5) | Differentiator |
| 12.5 | Published compliance attestations (SOC 2 / HIPAA / GovRAMP) | ? | ? | ? | ? | ? | ? | ? | ? | ✅ | ❌ | 1/10 (SMB 1/5) | Differentiator |
| 12.6 | Data-residency options | ? | ? | ? | ? | ? | ? | ? | ? | ❌ | ❌ | 0/10 (SMB 0/5) | Enterprise/Niche |
| 12.7 | Self-hosted / on-prem option | ❌ | ❌ | ◐ | ◐ | ◐ | ❌ | ✅ | ✅ | ❌ | ✅ | 6/10 (SMB 3/5) | **Table-stakes** |
| 12.8 | IP / network access restrictions | ? | ? | ? | ? | ? | ? | ? | ? | ? | ✅ | 1/10 (SMB 1/5) | Differentiator |
| 12.9 | Built-in backups | ? | ? | ? | ? | ? | ? | ? | ? | ? | ✅ | 1/10 (SMB 1/5) | Differentiator |
| 12.10 | Vulnerability / EOL risk visibility | ◐ | ? | ? | ? | ? | ✅ | ◐ | ? | ? | ? | 3/10 (SMB 1/5) | Differentiator |
| 12.11 | Security and regulatory compliance tracking | ✅ | ? | ✅ | ? | ? | ? | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 12.12 | Sustainability / carbon reporting | ? | ? | ? | ? | ? | ✅ | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |

Notes:
- 12.2: FS is '?' because the only evidence is a reviewer summary saying audit logs are missing (a complaint is not evidence of the feature).
- 12.7: SAP 'private cloud' and MX/INF on-prem are unverified or listing-based. LS deployment conflict resolved (cloud Platform and on-prem Classic); see Data quality notes.

### 13. AI / Advanced

| # | Feature | SN | FS | MX | SAP | INF | FLX | LS | ME | AP | SIT | Prevalence | Tier |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 13.1 | Generative AI assistant / natural-language query | ✅ | ? | ✅ | ✅ | ◐ | ? | ? | ? | ✅ | ❌ | 5/10 (SMB 1/5) | Differentiator |
| 13.2 | Predictive maintenance / failure prediction | ? | ? | ◐ | ◐ | ◐ | ? | ❌ | ? | ❌ | ❌ | 3/10 (SMB 0/5) | Enterprise/Niche |
| 13.3 | Asset health / risk scoring | ? | ? | ◐ | ✅ | ◐ | ? | ? | ? | ? | ? | 3/10 (SMB 0/5) | Enterprise/Niche |
| 13.4 | Auto-generated work orders from alerts / predictions | ? | ? | ? | ✅ | ◐ | ? | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 13.5 | AI work-order data quality checks | ? | ? | ✅ | ? | ? | ? | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 13.6 | AI license optimization / reclamation | ✅ | ? | ? | ? | ? | ◐ | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 13.7 | AI-usage and AI-spend discovery | ? | ? | ? | ? | ? | ✅ | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |
| 13.8 | AI condition grading from inspection photos | ? | ? | ? | ? | ? | ? | ? | ? | ✅ | ? | 1/10 (SMB 1/5) | Differentiator |
| 13.9 | Data normalization / catalog enrichment | ✅ | ? | ? | ? | ❌ | ✅ | ❌ | ? | ? | ◐ | 3/10 (SMB 1/5) | Differentiator |
| 13.10 | AI document intelligence (contracts, invoices, schematics) | ? | ? | ? | ? | ◐ | ✅ | ? | ? | ? | ? | 2/10 (SMB 0/5) | Enterprise/Niche |
| 13.11 | AI-agent access (MCP server) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ◐ | 1/10 (SMB 1/5) | Differentiator |
| 13.12 | Investment / lifecycle optimization models | ? | ? | ✅ | ? | ? | ? | ? | ? | ? | ? | 1/10 (SMB 0/5) | Enterprise/Niche |

Notes:
- 13.1: LS is '?' (only an AI info page URL was seen, no feature detail); ME is '?' ("not found in sources reviewed", a hedged phrase).
- 13.6: FLX is ◐: the research describes "optimization recommendations" but does not say they are AI-driven.
- 13.9: SIT: a data-normalization CLI utility exists (purpose not detailed), so partial.

## 2. Pricing & deployment summary

All figures are as reported in the research. "Not public" means the research found no list price. Third-party figures are unverified unless stated.

| Product | Vendor / licence | Deployment | Pricing model and known figures | Free tier / trial | Confidence |
|---|---|---|---|---|---|
| SN ServiceNow ITAM | Commercial, proprietary (Now Platform) | SaaS. Self-hosted: not found | Not public. SAM Pro and HAM Pro described as separate subscriptions beyond base ITSM/ITAM; Now Assist in SAM Pro limited to higher-tier SAM Pro licences and add-ons (Plus, Enterprise) per a partner blog | Not found | Medium (docs + blog; product pages 403) |
| FS Freshservice | Commercial SaaS (Freshworks) | SaaS. Self-hosted: not found | Per agent per month, billed annually: Starter $19, Growth $49, Pro $99, Enterprise custom. ITAM + discovery from Growth ($49/agent/mo annual; Starter not listed for ITAM); Pro adds SAM + contracts. Asset Units from $125/mo per 500 (ITAM metering; included AUs unverified). ITAM available to new signups from 31 March 2026 | Not found | Medium |
| MX IBM Maximo Application Suite | Commercial, proprietary (IBM) | Both (unverified): suite on IBM platform with Db2/Oracle/SQL Server and WebSphere; SaaS tier not confirmed | Not public. Free trial and live demo offered; no list prices on pages read | Free trial, live demo | Low-medium (marketing pages) |
| SAP SAP EAM / SSAM / APM | Commercial, proprietary (SAP) | Both: S/4HANA Asset Management in private and public cloud editions; SSAM on SAP BTP; APM deployment unconfirmed | Not public. SSAM needs its own production licence. No price figures found | Not found | Low (snippets) |
| INF Infor EAM / HxGN EAM | Commercial (Hexagon AB, acquired from Infor late 2021; date unverified) | Both: marketed as SaaS; on-prem customers exist (unverified) | Not public (contact sales) | Not found | Low (snippets) |
| FLX Flexera One | Commercial (Flexera) | SaaS. No self-hosted option stated | Not public. Demo request and ROI calculator offered | Not found | Medium (vendor pages, vendor claims) |
| LS Lansweeper | Commercial, proprietary | Both (cloud Lansweeper Platform/Sites + on-prem Classic) | Quote-only (third-party figures unverified). Asset-based tiers. Third-party estimates (conflicting): Starter about $239/month billed annually incl. 2,000 assets; Pro about $439/month billed annually (bands of 1,000 assets from 2,000 to 9,000); Enterprise from 10,000 assets, quote only. SAM add-on priced per asset | Free plan and 14-day trial (vendor) | Low (official pricing is quote-only; third-party figures unverified) |
| ME ManageEngine AssetExplorer | Commercial, proprietary (Zoho) | Both (vendor on-prem vs cloud page) | Cloud edition ✅ (confirmed). Editions: Free (no expiry; 50 nodes cloud / 25 on-prem), Trial (cloud, 250 nodes, 30 days), Professional (licence-based). Public prices (billed yearly): cloud 500 assets $2,345/yr; on-prem 500 assets $1,795/yr. Cloud billed monthly or yearly; on-prem yearly or perpetual. A third-party marketplace lists about $795 per feature one-time (unverified, not on vendor page) | Free: 50 nodes cloud / 25 on-prem; 30-day trial | Medium |
| AP Asset Panda | Commercial, proprietary SaaS | SaaS only ("100% cloud based"; on-prem never mentioned) | Vendor page: no prices ("Get a Quote"), free trial/demo, Enterprise tier. Third-party snippets (unverified): Starter about $50/month for 5 users and 1,000 assets; Business+ about $60/user/month for 10 users and 5,000 assets; Enterprise quote | Free trial, demo; a free plan with an asset cap is mentioned by reviewers (unverified) | Low-medium |
| SIT Snipe-IT | Open source (AGPL-3.0, confirmed from the LICENSE file) by Grokability | Both: self-hosted (Linux/Windows/macOS, Docker) plus vendor-hosted | Software free when self-hosted. Hosted (USD): Basic $39.99/month or $399.99/year (120 API calls/min, community support); Small Business $99.99/month or $999.99/year (240 calls/min, email support, automated upgrades); Dedicated (small) $249.99/month or $2,499.99/year (unlimited calls subject to hardware, more LDAP syncs, site IP restrictions); Medium and Large Dedicated about $5k and $7.5k per year (limits not shown). Users and assets unlimited on the three small plans. Enterprise Support Plan (phone, private Slack) not priced | Free self-hosted | High (pricing page read) |

Context-file discrepancy: `asset_management_systems.md` says Freshservice starts "from $19/user/mo", but the Freshservice research says $19 per **agent** per month (agents are the IT staff, not end users) with ITAM separately metered by Asset Units. The research value is used here.

## 3. Top recurring customer complaints across the market

Evidence caveat: almost all review data was read from search snippets because G2, Capterra and similar pages returned 403. Counts below are indicative only; "anecdotal" means a single reviewer.

| # | Theme | Products affected (evidence) | Opportunity for us |
|---|---|---|---|
| 1 | Complexity, steep learning curve and long implementation | **SN** (stakeholder alignment and governance struggles; hard CMDB/ITAM reconciliation), **MX** (about 7 months average implementation, "wall of modules"), **SAP** (needs expert team even for a simple MVP), **INF** (most common complaint), **FLX** (G2 cons: complexity 37, difficult learning 35; about 5 months to implement), **LS** (hidden/collapsed settings, hard to learn), **AP** (hard setup and data migration), **SIT** (steep learning curve per a G2 snippet), **FS** (hybrid IT/physical needs heavy upfront design, anecdotal) | Guided onboarding, sensible defaults, time-to-first-value in days |
| 2 | High cost, cost scaling and surprise add-ons | **SN** (high licence cost for advanced features; cited complaint is platform-wide), **MX** (G2 top cost tier), **SAP** (especially for smaller firms; TCO beyond licences), **INF** (value 2.8/5; "very expensive"), **FS** (add-ons add up even on top tier; small-team pricing), **LS** (higher priced than alternatives; per-asset model rises with count), **AP** (most common complaint; unexpected extra costs; free plan asset cap) | Transparent, predictable pricing without per-module or per-asset surprises |
| 3 | Weak or technical reporting | **LS** (custom reports need SQL/database knowledge; glitches), **FS** (limited reporting customization), **SAP** (inflexible reporting), **INF** (report setup needs scarce technicians; limited dashboards), **SIT** (limited report customization), **AP** (limited audit reporting), **ME** (occasional report/PO-module bugs, single reviewer) | No-code report builder, scheduled and shareable reports |
| 4 | Dated, clunky UI and too many clicks | **MX** (dated, rigid UI; mobile needs more clicks), **SAP** (complex, dated EAM UI), **INF** (dull interface, limited themes), **LS** (dated but functional), **SIT** (dated, excess clicks), **AP** (interface design, tedious data entry), **FLX** (dated UI, unverified), **SN** (unintuitive navigation, anecdotal) | Modern, fast, low-click UX as a headline differentiator |
| 5 | Painful data onboarding and import | **AP** (getting assets in is difficult), **INF** (import slow to learn), **SN** (reconciling CMDB and ITAM data), **FS** (competitor-claimed manual entry; unverified) | Guided CSV/MDM import, de-duplication and mapping assistant |
| 6 | Rigid customization / process lock-in | **SAP** (must align to SAP standards), **MX** (hard to customize), **FS** (limited complex workflow customization), **AP** (parent-child relationships limited; straight-line depreciation only, one reviewer) | Configurable data model and workflows that do not need consultants |
| 7 | Integration and SSO friction | **SN** (SSO problems, skilled admins needed; anecdotal), **SAP** (integration and complex setup is top APM complaint, about 9 reviews), **INF** (ION auth documentation inconsistent: OAuth 1.0a vs 2.0), **AP** (difficulty integrating with databases and major platforms), **FS** (SSO limitations, constrained third-party integrations per competitor claim), **FLX** (integration outages, unverified) | Open API, webhooks and standard SSO/SCIM included at all tiers |
| 8 | Mobile gaps | **AP** (mobile incomplete versus desktop; vendor acknowledged), **SIT** (official app only in beta; third-party apps vary), **MX** (more clicks than modern alternatives), **ME** (mobile support unclear, possibly Android only), **SN** (mobile access problems, anecdotal) | First-class mobile scanning and audit app |
| 9 | Support, upgrades and version churn | **SIT** (cumbersome upgrades; support is lowest-rated metric, 3.6; no SLA unless paid), **INF** (support 3.2/5; slow customization response), **LS** (email-only canned replies, old KB, per a competitor article; biased), **MX** (7.6.x end of support Sept 2025 forces migration) | Responsive support and zero-effort upgrades (a SaaS advantage) |
| 10 | Performance at scale | **FLX** (large datasets slow), **LS** (slows as endpoints grow, unverified), **SAP** (occasional freezing), **SIT** (occasionally slow), **AP** (lag and glitches) | Performance and scale as a stated design goal |
| 11 | Discovery quality and platform gaps | **LS** (weaker Linux/Mac, poor software removal, VM discovery), **ME** (agent-based scan still Beta; clear agentless coverage only for Windows), **AP** (device agent did not work as expected), **FS** (cloud asset management needs improvement, anecdotal) | Reliable cross-platform discovery without heavy setup |
| 12 | Permissions and audit granularity | **FS** (limited permission granularity, unclear role assignment, missing audit logs; 24-review Capterra summary, unverified) | Granular RBAC and full audit logs as standard |
| 13 | Self-hosting burden | **SIT** (needs web server and database administration) | Hosted option with open-API ethos |

## 4. Market gaps / white space

Each gap is stated with the evidence from the matrix. "Few or none" is relative to what the research evidences, not to the whole market.

1. **One product for IT assets, physical/fixed assets and light maintenance at SMB price.** Enterprise EAM (MX, SAP, INF) covers work orders and PM but is complex and costly. The IT-focused SMB tools (LS, ME, FS, SIT) have no work orders (6.1 is ❌ or ? for all four). Only AP spans physical assets and maintenance modules (PM module ✅ on the vendor page; work orders ◐ from a snippet), but it has no confirmed discovery (3.1 ❌, 3.2 ◐) and no software licence tracking (5.x ❌).
2. **Discovery combined with physical tracking and mobile.** Only ME is ✅ on both agentless discovery (3.1) and barcode/QR (4.1, 4.2); FS has ✅ barcode but only ◐ discovery (software scanning limited to Windows and Linux), and ME's mobile support is unclear. LS has the strongest discovery; its QR/barcode generation is Classic only (4.2 ◐), and no mobile app or check-out is found (4.x ?). AP and SIT have barcode/QR/mobile but no confirmed network discovery (AP's agent is a reviewer mention only; SIT only syncs from MDM/RMM). A product that does both (scan the network and scan the shelf) is not evidenced anywhere.
3. **Software and SaaS licence management for SMB.** SaaS management (5.8) is ✅ only for SN, FS and FLX; none of LS, ME, AP or SIT offer it. Usage metering (5.6) is ✅ only for FLX and ME. FS's licence module is limited to new signups after 31 March 2026 and plan inclusion is unconfirmed. Mid-market buyers are either under-served or pushed to enterprise SAM tools that complaints say are complex (theme 1).
4. **Fast time-to-value and self-serve onboarding.** Implementation times of 5 to 7 months (FLX, MX), expert-team requirements (SAP, INF) and import pain (AP, INF) recur in every enterprise product. No product in the research advertises self-serve import plus mapping, de-duplication or guided setup.
5. **Open, developer-friendly API stack in a commercial SMB product.** Webhooks (11.2), SCIM (11.5) and API libraries (11.9) are still evidenced only for SIT. REST API (11.1) is now ✅ for SIT and AP (Asset Panda: admin-only key pair, 400 calls per 3 minutes per IP; plan inclusion unverified); LS is ◐. SAML/SSO (11.3) is ✅ for AP and SIT. AP and INF are ❌ for webhooks (AP unverified); FLX is `?` (not found in sources reviewed). A commercial product with webhooks, SCIM and a documented API at every tier is still a clear opening; API existence alone no longer is.
6. **No-code reporting and dashboards.** Custom reporting is either SQL-dependent (LS), limited (FS, SIT, AP) or inflexible (SAP). Scheduled reports (9.4) are ✅ for only MX and ME; dashboards (9.3) are unconfirmed for FS, LS and AP.
7. **Practical AI for SMB.** AI evidence is concentrated in enterprise suites (SN, MX, SAP) and is often limited, add-on or higher-tier (SN Now Assist; MX Health/Predict/Monitor as separate components). In the SMB group only AP (UrsaAI, vendor claim) has AI; SIT has none (community MCP server only), and ME and LS show no AI evidence (ME: not found in sources reviewed; LS: an AI info page exists, no detail retrieved). Unclaimed ground includes catalogue normalization (13.9), natural-language query, AI licence reclamation and data-quality checks.
8. **Transparent, public pricing (weak gap).** Most SMB tools publish prices: SIT, ME and FS (per agent) do within this matrix, and desk validation (docs/validation/competitor_validation.md, section 6) found Reftab, Sortly, GoCodes, EZOfficeInventory, Assetbots, Shelf.nu and itemit publish too. Still quote-only: SN, MX, SAP, INF, FLX, AP and LS (LS third-party figures conflict). Price transparency is therefore not a differentiator on its own.
9. **Compliance posture.** SOC 2 / HIPAA / GovRAMP badges are claimed only by AP (vendor page). SIT shows no SOC 2/ISO/data residency; data-residency options (12.6) are evidenced nowhere; FS reviewers cite data-residency limits (unverified). Buyers with compliance needs have little to compare.
10. **Granular security and multi-tenancy in SMB tools.** Multi-company (12.3) is evidenced for MX, INF and SIT only; FS complaints cite permission and audit-log gaps; AP's multi-company support is unconfirmed. Agencies, MSPs and multi-site SMBs lack a clearly evidenced option.
11. **Check-out, reservations and discovery in one place.** Reservations (2.9) are ✅ only for AP; check-in/check-out (2.3) only AP and SIT. Neither has discovery, and the discovery tools (LS, ME) have no confirmed check-out.
12. **Relationship and dependency mapping at mid-market price.** CI relationship maps (8.2) are ✅ only for ME and ◐ for SN and FS; FS dependency mapping is contested between Freshworks and a competitor blog.
13. **Offline mobile for IT and fixed assets.** Offline (4.6) is ✅ only for MX and INF (enterprise EAM); AP's offline is a vendor claim, not verified in depth.
14. **Finance depth for fixed assets.** Depreciation is evidenced for INF, ME, SIT and AP (AP only straight-line, one reviewer). Accounting-system connectors do not appear in any research file (ERP integration 7.9 is ✅ only for MX, SAP and FLX), which matters for SMB fixed-asset use cases.

## 5. Data quality notes

General
- Most review ratings and complaints come from search-result snippets because G2, Capterra, SoftwareAdvice, GetApp and many vendor pages returned 403 (SN, FS, MX, SAP, INF, LS, AP and others). Treat complaint counts as indicative.
- `?` is the most common mark. It usually means the research did not look or could not read the page, not that the product lacks the feature.
- Products differ in scope (FLX is SAM/FinOps; LS is discovery; MX/SAP/INF are EAM), so many ❌ marks are scope-driven, not weaknesses.
- Several files are marketing-level (MX, FLX, AP) or compare against competitor blogs (FS, LS), which are biased.
- Ratings are not comparable across products: SAP ratings mostly cover S/4HANA Cloud or the wider suite, not EAM alone; INF includes reviews of the older Infor CloudSuite EAM.
- Validation (2026-11-17): competitor facts and their sources are in `docs/validation/competitor_validation.md`. Rows and notes changed on that basis are marked "Updated 2026-11-17".
- Possible upgrades, pending direct verification (cells deliberately unchanged): LS 11.1 REST API and 11.3 SAML/SSO (Platform docs list API access and SSO/MFA) may move from ◐; FS 3.1 agentless and 3.2 agent-based discovery may move from ◐ (ITAM pricing page lists both from Growth).

Per product
- **SN**: ServiceNow product pages returned 403; features come from ServiceNow docs and a partner blog. Many items are "not found in sources read" (custom fields, check-in/out, depreciation, REST API, RBAC), shown as `?`. Target segment (large enterprise) is inferred, not stated. The cost complaint refers to the ITSM platform generally.
- **FS**: G2/Capterra 403; discovery details come from snippets or a competitor blog (Virima, biased). Dependency mapping is announced by Freshworks but a competitor says it is "Not included" (conflict, so ◐). Which plans include ITAM, discovery and licence management is unconfirmed. Software licence management is limited to new signups after 31 March 2026 per a support article.
- **MX**: IBM docs table of contents was truncated; Assets, PM, Contracts and Reporting modules were not confirmed in full. Several marks are "not found" or "unverified" (custom fields, hierarchy, procurement, REST API, SSO). Health, Predict and Monitor are separate components (◐). Deployment model unconfirmed. Custom fields and models are bare "not found", shown ❌, but this is likely a research-depth issue.
- **SAP**: SAP feature and pricing pages returned 403; essentially all content is snippets. The column blends three products (S/4HANA EAM, SSAM, APM). SSAM features are tied to releases 2205/2305. Cloud edition feature parity unconfirmed.
- **INF**: official Hexagon and Infor pages returned 403 or 404; **every item is snippet-derived** and the file instructs treating items as unverified until checked. Item-level "(unverified)" tags are shown ◐; untagged snippet items are shown ✅, which is a weaker standard than for other products. REST API authentication conflicts (OAuth 1.0a per Infor doc versus OAuth 2.0 per a third-party index). Product renamed HxGN EAM; some reviews concern the older version. Only about 24 Capterra reviews.
- **FLX**: three vendor pages read; claims are vendor-supplied. Whether Snow Atlas capabilities are included in Flexera One is unclear. No Flexera One Capterra page exists in the research (the one found was FlexNet Manager Suite, a different product). Dated-UI and outage complaints may refer to the wider Flexera brand.
- **LS**: no Lansweeper vendor or review page could be read; everything is snippets or third parties. **Cloud versus on-prem conflict RESOLVED** (validation: competitor, 2026-11-17): Lansweeper sells both Lansweeper Platform (Sites/cloud) and Lansweeper Classic (on-premises), per official docs. Self-hosted/on-prem is therefore ✅ (12.7); QR/barcode generation is Classic only (4.2 ◐); no mobile app or check-out was found. The official pricing page is blocked (403), so pricing stays quote-only. Third-party pricing sources conflict.
- **ME**: the on-prem vs cloud feature table lost its checkmarks, so edition-by-edition support (on-prem vs cloud, Free vs Professional) is not confirmed; features cited from the "on-prem table" may not apply to the cloud edition. Agent-based scan is Beta. Only about 13 reviews on G2 and Capterra; help portal showed only an Overview.
- **AP**: the homepage was fetched, and API docs, SAML docs and the pricing page were also checked on 2026-11-17 (validation: competitor); other items remain snippets, so those are ◐ per the file. Pricing is third-party and unverified. Compliance badges (SOC 2, HIPAA, GovRAMP) are vendor claims. No Reddit threads found. The "device agent" is mentioned only in a reviewer complaint.
- **SIT**: best sourced (GitHub, product page, pricing page, docs index). **Licence conflict RESOLVED**: AGPL-3.0 confirmed from the LICENSE file (validation: competitor, 2026-11-17). Remaining conflict: sync adapter count (25 on GitHub vs 17 native/20 total on the product page). Several items are community or third-party (MCP server, OIDC plugin, Go client, mobile apps, Jira app). Review data from snippets only.

Out-of-scope note: `asset_management_systems.md` also names Ivanti Neurons for ITAM under software licence compliance; it was not researched and is not in the matrix.
