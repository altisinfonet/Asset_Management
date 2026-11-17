# Competitor fact validation (desk research)

Access date for every source below: **2026-11-17** unless stated. Scope: the competitor facts that `docs/02_product_plan.md` (sections 1, 2, 8, 10, risks 2 and 5) and `docs/01_feature_matrix.md` (section 5 data-quality notes) depend on.

Method and limits. Facts come from WebFetch/WebSearch. Fetches are summarised by a small model, so quoted wording is paraphrase unless shown in quotation marks. Blocked or empty pages are listed per item. Third-party sources (review sites, competitor blogs, resellers) are labelled as such and are never counted as Confirmed. "Confirmed" means an official vendor page (or the vendor's own repo/docs) states it. Some sources carry odd dates (for example blog titles saying "2027"); those are flagged where used.

Verdict key: Confirmed / Corrected (plan or matrix is wrong or outdated) / Still unverified.

---

## 1. Snipe-IT (importer feasibility, pricing, license, mobile)

### 1a. REST API coverage and auth: does a one-click importer work?

- **Claim in plan** (s10.1, s5.3): Snipe-IT's REST API is documented and broad; an importer taking URL + API token can map models, categories, locations, users, assets, licenses, accessories, consumables and history "where exposed". Matrix says API auth is personal access tokens.
- **Finding:**
  - Auth: the official readme says to generate a key under the user menu "Manage API Keys" and send it as `Authorization: Bearer <key>` plus `Accept` and `Content-Type: application/json`. The page calls it an "API key", not a "personal access token"; the fallback commands (`passport:install`, `passport:client --personal`) show it is a Laravel Passport personal-client token. The key belongs to a user; a third-party mirror says it inherits that user's permissions (not confirmed on an official page). Expiry is not stated on the official page (a third-party mirror says 15 years; unverified).
  - Coverage, from the project's `routes/api.php` on master (read through a summariser; confirm against a live instance before building): GET list endpoints exist for hardware (assets), models, categories, locations, users, licenses (plus nested license seats), accessories, consumables, components, fields (custom fields), fieldsets, manufacturers, suppliers, companies, departments, statuslabels, depreciations, maintenances, kits, groups, imports, labels, and reports/activity. Per-object `history` routes are present for hardware, models, locations, users, licenses, accessories, consumables, components and maintenances. A generic `{object_type}/{id}/files` route exists for assets, models, licenses, accessories, components, consumables, locations, users, suppliers, maintenances, companies and departments, so attachments are exportable too. The official readme index lists the activity report (`/reports/activity`) and files endpoints.
  - Pagination: `limit` and `offset` (the readme field doc says limit "defaults to 50"). The throttling page says the API returns "a maximum of 500 items per request by default" (as of v4.7.7); self-hosters can raise it with `MAX_RESULTS` in `.env`. The page does not say this applies to hosted instances.
  - Rate limit: "maximum of 120 requests per minute" by default; self-hosters can override with `API_THROTTLE_PER_MINUTE` (v5.4.0+). Hosted pricing page lists 120 / 240 / unlimited calls per minute across the three hosted tiers (mapping inferred from column order; the page does not label it explicitly).
  - Practical arithmetic (our calculation, not a source claim): list endpoints at 500 rows per call make bulk objects cheap (10,000 assets is about 20 calls). Per-asset history calls are the bottleneck: 5,000 assets at 120 requests/min is about 42 minutes on a hosted Basic plan, so the importer needs a progress UI, backoff on throttling and a "skip history" option. The `/reports/activity` feed may be a cheaper alternative to per-asset history; test it.
  - Custom field values appear in the asset payload; field definitions come from `/fields` and `/fieldsets` (route confirmed; payload shape not read).
- **Verdict: Confirmed** that a URL + API-key importer is feasible for every object type the plan lists, including history and files. Minor **Corrected**: the official term is "API key" (Passport personal client token), and plan s10.1 should note the 120 requests/min default and 500-row page size. Open points: token expiry, hosted `MAX_RESULTS`, and whether `/reports/activity` returns complete history.
- **Sources:** https://snipe-it.readme.io/reference-link/authenticating-with-the-api ; https://snipe-it.readme.io/reference/generating-api-tokens ; https://snipe-it.readme.io/reference/api-throttling ; https://snipe-it.readme.io/reference/hardware-list ; https://snipe-it.readme.io/llms.txt ; https://raw.githubusercontent.com/grokability/snipe-it/master/routes/api.php ; https://snipe-it.readme.io/reference/api-overview (does not cover auth or limits). Third-party (not relied on): https://www.mintlify.com/grokability/snipe-it/api/authentication. Accessed 2026-11-17.

### 1b. Hosted pricing tiers

- **Claim in plan** (s8.1): hosted flat tiers $39.99 / $99.99 / $249.99 per month, unlimited users and assets on the small plans, API rate limits differ.
- **Finding:** Basic Hosting $39.99/mo ($399.99/yr, "save 16%"), Small Business Hosting $99.99/mo ($999.99/yr), Dedicated Hosting (small) $249.99/mo ($2,499.99/yr). All three: unlimited users and unlimited assets. API calls per minute 120 / 240 / unlimited (hardware-limited). Site IP restrictions and more LDAP memory start at Small Business. Medium and large dedicated hosting are quoted at about $5k and $7.5k per year. No free trial mentioned for hosted. The page does not say which hosted tier includes SAML/SCIM (the product page lists SAML SSO, SCIM and LDAP as product features without tier detail).
- **Verdict: Confirmed.** Note: unlimited assets also on Dedicated, and the plan's "no SSO details cited" is still true for hosted tiers (**Still unverified** whether Basic includes SAML).
- **Sources:** https://snipeitapp.com/pricing ; https://snipeitapp.com/product . Accessed 2026-11-17.

### 1c. License

- **Claim:** Matrix s5 flags a conflict (AGPL-3.0 on GitHub vs GPLv3 in a snippet).
- **Finding:** The LICENSE file on master is GNU Affero General Public License v3 (19 Nov 2007 text); the GitHub page lists AGPL-3.0. The product page does not name a license.
- **Verdict: Confirmed (AGPL-3.0); matrix conflict resolved.** Implication: an API-only importer that does not copy Snipe-IT code is not affected; do not reuse its code in the closed-source Self-hosted edition.
- **Sources:** https://raw.githubusercontent.com/grokability/snipe-it/master/LICENSE ; https://github.com/grokability/snipe-it . Accessed 2026-11-17.

### 1d. Mobile app status

- **Claim:** Official app is beta (plan s1, M3).
- **Finding:** GitHub README and the product page both say the official mobile app "is currently in beta" with TestFlight (iOS) and Google Play (Android) betas; several third-party apps (SnipeMate, Snipe-Scan, AssetX, others) exist. Neither page is dated for that sentence. Latest release found: v8.8.3 published 2026-10-22; its notes do not mention the mobile app. SAML, SCIM and LDAP are native; OIDC only via a third-party plugin; 20 native MDM/RMM sync adapters (product page).
- **Verdict: Confirmed** (still beta as of the pages read; undated, so re-check before using in marketing copy).
- **Sources:** https://github.com/grokability/snipe-it ; https://snipeitapp.com/product ; https://api.github.com/repos/grokability/snipe-it/releases/latest . Accessed 2026-11-17.

---

## 2. Asset Panda

- **Claim in plan** (s1, s8.1, s10.1, matrix): no confirmed API/SSO/webhooks; pricing quote-only with third-party snippets of about $50/mo for 5 users / 1,000 assets and about $60/user/month; research "could not confirm" export or API formats.
- **Finding:**
  - Pricing: the official pricing page is a "Get a Quote" form with a 7-day free trial and no plans, prices or limits. Third-party figures conflict: Capterra lists Starter $50/mo (5 users, 1,000 assets) and Business+ $60 per user/mo (10 users, 5,000 assets); Toolradar lists $10/user/month up to $1,500/month across four tiers. Asset Panda's own marketing says it uses asset-based pricing with unlimited users, which contradicts the per-user figures.
  - API: **exists.** Official API docs (docs.api.assetpanda.app) describe a REST API authenticated with `Access-Key-Id` and `Access-Key-Secret` headers generated by an administrator in the dashboard under API Configuration (secret shown once). Endpoints per the docs index: collections (list, detail, columns), collection records (search, get, create, update, delete), accounts, modules, categories. Help-centre limit: "400 calls per three minute window" per IP address, and API access is limited to company administrators. Which plans include API is not stated. Webhooks: not found.
  - Export: UI export of a single record or a whole collection to PDF, Excel or CSV; reports export to Excel/CSV/PDF (help centre, linked to Asset Panda Pro). No bulk export endpoint appears in the API docs index.
  - SSO: help centre documents SAML 2.0 SSO (Okta, Microsoft Entra ID, OneLogin article, generic SAML) configured by an admin in "Asset Panda Pro" (Settings > Preferences > Single Sign-On).
- **Verdict:** Pricing quote-only: **Confirmed**; third-party figures stay **Still unverified**. API and SSO "not confirmed": **Corrected** (both exist; plan inclusion unknown). Webhooks: **Still unverified**. Importer in v2: **Confirmed feasible** via CSV/Excel export or the collection-records search API.
- **Sources:** https://www.assetpanda.com/pricing/ ; https://docs.api.assetpanda.app/docs/getting-started ; https://docs.api.assetpanda.app/llms.txt ; https://help.assetpanda.com/API_Configuration.html ; https://prohelp.assetpanda.com/maintain-records/export-record-data ; https://help.assetpanda.com/Okta_SSO.html ; https://help.assetpanda.com/MS_Entra_ID_SAML_Authentication_Setup.html . Third-party: https://www.capterra.com/p/142562/Asset-Panda/pricing/ ; https://toolradar.com/tools/asset-panda/pricing . Accessed 2026-11-17.

---

## 3. Lansweeper

- **Claim in plan** (s11 risk 5, matrix s5): cloud vs on-prem unresolved; per-asset pricing about $239/mo for 2,000 assets and about $439/mo Pro (third-party, conflicting); no confirmed barcode/mobile/check-out.
- **Finding:**
  - Deployment (resolved): Lansweeper sells both. Lansweeper Platform (also called Sites/Cloud) is the cloud product; Lansweeper Classic is the on-premises scanner. Official docs describe three installation types: cloud-first (Classic linked to a Platform site, digital license, must sync at least every 24 hours or it reverts to the Free plan), on-premises (license key, no link, suited to air-gapped networks) and hybrid (now equal to cloud-first). Platform has features Classic lacks (SSO/MFA, API access, cloud discovery for AWS/Azure/GCP/Entra/M365, risk insights) and Classic has some Platform lacks (custom scans, email-scheduled reports, XML export).
  - Pricing: official pricing page returned HTTP 403 (blocked). Official docs say Starter, Pro and Enterprise quotes are produced by sales and state no prices; free trial at app.lansweeper.com/try. A competitor blog (InvGate, biased) reports a Free plan up to 100 assets, Starter fixed at 2,000 assets, Pro 2,000 expandable to 9,000, Enterprise from 10,000, and that from 5 Nov 2026 every monitor counts as an asset (not confirmed on a Lansweeper page). Third-party price estimates conflict: CostBench Starter $299/mo billed annually (its own other page says $239/user/month); ITQlick about $2,400/yr Starter and about $4,308/yr Pro (about $359/mo). None matches the plan's $239 / $439 figures cleanly.
  - Barcode and mobile: Classic docs describe generating QR codes and barcodes that link to asset pages; community threads (dated, several years old) say the cloud portal lacks equivalent generation, there is no official mobile app, and for cloud barcode scanning staff pointed to an Asset Panda integration. No check-in/check-out found. Community thread also says QR generation is not in the freeware version.
- **Verdict:** Cloud vs on-prem: **Corrected** (resolved: both exist). Pricing: **Still unverified** (official page blocked; plan figures not reproducible). Barcode/mobile: **Corrected** in part (QR/barcode generation exists in Classic; no mobile app or scanning workflow found; evidence is community posts).
- **Sources:** https://docs.lansweeper.com/classic/docs/lansweeper-installation-and-management-types ; https://docs.lansweeper.com/classic/docs/comparing-lansweeper-sites-and-lansweeper-on-premises ; https://docs.lansweeper.com/classic/docs/request-a-lansweeper-price-quote.md ; https://docs.lansweeper.com/classic/docs/generate-qr-codes ; https://www.lansweeper.com/pricing/ (HTTP 403). Third-party: https://blog.invgate.com/lansweeper-pricing ; https://community.lansweeper.com/t5/general-discussions/qr-code-scanning-for-lansweeper-cloud/m-p/61888 ; https://community.lansweeper.com/t5/product-discussions/mobile-app/td-p/35285 ; https://www.itqlick.com/lansweeper/pricing ; https://costbench.com/software/it-asset-management/lansweeper/ . Accessed 2026-11-17.

---

## 4. Freshservice

- **Claim in plan** (s8.1, matrix): per agent per month $19 / $49 / $99 billed annually plus ITAM "Asset Units" in packs of 500; plan inclusion of ITAM, discovery and licenses unconfirmed; software license module limited to new signups after 31 March 2026.
- **Finding:**
  - Per-agent prices: official pricing page shows Starter $19, Growth $49, Pro $99 per agent per month billed annually; Enterprise custom. Monthly-billing prices were not retrievable.
  - ITAM inclusion: the official ITAM support article compares ITAM capabilities across Growth, Pro and Enterprise only (Starter not listed). Growth: discovery, hardware asset management, asset lifecycle, CMDB, workflow automation. Pro and Enterprise add contracts and purchase orders, software asset management, SaaS discovery and software normalization. Dependency mapping (service discovery, application dependency mapping, business service mapping) is Enterprise only. The official ITAM pricing page lists "Agentless and Agent-based Discovery" under Growth, Pro and Enterprise.
  - Asset Units: official wording "Asset Units (AUs) are Freshservice's licensing metric for IT Asset Management", sold in packs of 500, "Pricing starts at $125/mo per 500 Asset Units". Weights (official FAQ and support article): server/VM/network device 4; desktop/mobile/EUC device 1; SaaS user 1; container or function 1/2; archived device 1/25; non-IP physical asset 1/25; storage 1 per 5 TB; mainframe or mid-range 400. A reseller says Growth, Pro and Enterprise each include 100 AUs; the official pages read do not state an included allotment.
  - Date: the support article says ITAM "will be available for new Freshservice signups starting March 31, 2026" (article last modified 2026-04-24). This is about ITAM availability for new signups generally, which is broader than the matrix's "software license module" phrasing.
- **Verdict:** Per-agent prices: **Confirmed**. ITAM plan inclusion: **Corrected** (Growth and above; Starter not listed). Discovery agent: **Corrected** (agentless and agent-based discovery listed from Growth). AU pack price: **Confirmed** ("from $125/mo per 500"). Included AU allotment: **Still unverified** (reseller only). Matrix's 31 March 2026 statement: **Corrected** to the ITAM-wide wording above.
- **Sources:** https://www.freshworks.com/freshservice/pricing/ ; https://www.freshworks.com/freshservice/itam/pricing/ ; https://support.freshservice.com/support/solutions/articles/50000011902-freshservice-it-asset-management-plans-and-au-pricing . Third-party: https://www.getmacha.com/blog/freshservice-pricing-explained ; https://blog.invgate.com/freshservice-pricing (title dated "2027"). Accessed 2026-11-17.

---

## 5. ManageEngine AssetExplorer

- **Claim in plan** (s8.1, matrix): "free cloud 25 nodes; licence-based professional"; edition-by-edition cloud vs on-prem support unconfirmed; transparent pricing only from SIT and ME.
- **Finding:**
  - Cloud edition exists (SaaS hosted in ManageEngine data centres).
  - Free edition: fully functional, never expires, capped at **50 nodes in the cloud and 25 nodes on-premises** (general product page and cloud page both say this). A search summary claimed 25 on the cloud page; the direct fetch of that page says 50. Trial: 30 days, up to 250 nodes (then downgrades to Free).
  - Public price list (pricing page, markdown variant labels cloud vs on-prem; the HTML page showed two tables without clear labels):
    - Cloud monthly / yearly: 250 assets $115 / $1,245; 500 $225 / $2,345; 1,000 $360 / $3,895; 1,500 $515 / $5,545; 2,000 $580 / $6,245; 3,000 $865 / $9,345; 5,000 $1,155 / $12,445; 10,000 $1,545 / $16,695.
    - On-premises, billed annually: 250 $955; 500 $1,795; 1,000 $2,995; 1,500 $4,195; 2,000 $4,795; 3,000 $7,185; 5,000 $9,595; 10,000 $11,995; +$1,195 per extra 1,000 above that pack.
    - Our arithmetic: on-prem is about 0.77x the cloud yearly price at 500, 1,000, 2,000 and 5,000 assets.
  - Cloud page says barcode, QR and RFID scanners can import assets into inventory; it does not mention a mobile app.
- **Verdict:** Cloud edition: **Confirmed** (matrix gap closed). Free tier "25 cloud": **Corrected** (50 cloud / 25 on-prem). Pricing transparency: **Confirmed**, and the plan can now cite real numbers. Self-hosted multiplier implication is in section 7.
- **Sources:** https://www.manageengine.com/products/asset-explorer/ ; https://www.manageengine.com/products/asset-explorer/cloud.html ; https://www.manageengine.com/products/asset-explorer/pricing.md ; https://www.manageengine.com/products/asset-explorer/pricing.html . Accessed 2026-11-17.

---

## 6. Other SMB asset-tracking competitors

Newness: none of these pages gave a launch date, so I cannot confirm any is a 2024-2026 entrant. They are the SMB tools that surfaced as direct price/feature comparators. Prices are as displayed on 2026-11-17 and are USD unless noted.

| Product | Pricing model and published prices | Self-hosting | Mobile scanning | Open API |
|---|---|---|---|---|
| Reftab | Per asset tier (tiers of 250 up to 3,000+), unlimited platform users. Free: 50 assets. Hardware plans from $31.25 / $62.50 / $125 per month billed annually (base tier; price at higher tiers not shown). 14-day trial. | Not found | iOS and Android apps; barcodes and QR in Free | Yes, "API is now public", offered to paying customers, key from settings; plan detail not on pricing page |
| Sortly | Per unique items and user licences: Free $0 (100 items, 1 user); Advanced $49 list (500 items, 2 users); Ultra $149 (2,000 items, 5 users); Premium $299 (5,000 items, 8 users); first-year discounts of 50% shown. | Not found | In-app barcode/QR scanning described; per-tier detail unclear | API and webhooks listed under Enterprise only |
| EZOfficeInventory | Essential $81.41/mo for 500 items (up to 5,000 units); Advanced $117.11; Premium $142.10; unlimited users; yearly price not extracted. | Not found | Mobile app Essential and above | Exists (token auth); plan inclusion conflicts across sources; unverified |
| GoCodes | Annual per asset band and user cap: $550 (200 assets, 3 users); $1,100 (500, 5 users); $1,950 (1,000, 10); $2,750 (2,000, 20). Extra users $440/yr per 5; offline mode $385/yr add-on. | No (Azure-hosted cloud) | iOS and Android apps in every plan | Add-on $1,200/yr on lower plans; included in Enterprise |
| Assetbots | Per asset band and admin count: Free (200 assets, 1 admin); Starter $49/mo (1,000 assets, 5 admins); Growth $114 (3,000, 15); Scale $489 (10,000, 100). 30-day trial. | Not mentioned | QR scanning on all plans from "any device with a camera"; no native app mentioned | Not mentioned on pricing or home page |
| Shelf.nu | Free Personal (unlimited assets, 1 user); Plus $190/yr; Team $370/yr (unlimited users, unlimited assets; FAQ also shows $67/mo monthly); SAML/SSO add-on from $9/user/mo. Open source (AGPL-3.0). | Yes: community-maintained Docker support, requires an external Supabase; companion mobile app is under a separate non-distribution licence | Shelf Companion app (scan, audit, check in/out) free with every plan | Not mentioned on pricing page |

Also checked, not tabulated: itemit (UK; from GBP 399/yr Starter, REST API add-on GBP 699/yr on Pro, offline mobile apps, no self-hosting mentioned). Atera: per-technician price (third-party sources: Professional $149, Expert $189, Master $219 per technician per month billed annually); official page blocked (HTTP 403) and asset-inventory features by tier were not verified; it is an RMM, not an asset tracker. Oomnitza: quote-based, platform licence plus per-asset/per-user modules (vendor page). Device42: now a Freshworks company; public price figures conflict across third-party sources (Capterra $20 per user per year, SoftwareReview $1,499/yr, Virima about $1,449/yr); treat as quote-only. NinjaOne was not researched.

- **Claim in plan:** price transparency is a differentiator (gap 8: only SIT and ME publish prices; P2; s10.4); open developer surface at every tier is a visible contrast (P3, gap 5); unlimited users is part of the pitch.
- **Verdict: Corrected.** Among SMB tools, price transparency is the norm (Reftab, Sortly, GoCodes, EZO, Assetbots, Shelf, itemit, ME, Snipe-IT all publish). Unlimited users is also not unique (Snipe-IT, Reftab, Shelf Team, EZO). "API at every tier including Free" does remain unusual: GoCodes charges $1,200/yr for it, itemit GBP 699/yr, Sortly gates it to Enterprise. Asset Panda has an API (section 2), so gap 5 as written ("evidenced only for SIT") is out of date.
- **Sources:** https://www.reftab.com/pricing ; https://www.reftab.com/faq/does-reftab-offer-open-api ; https://www.sortly.com/pricing/ ; https://www.ezo.io/ezofficeinventory/pricing/ ; https://www.gocodes.com/pricing ; https://www.assetbots.com/pricing ; https://www.assetbots.com/ ; https://www.shelf.nu/pricing ; https://github.com/Shelf-nu/shelf.nu ; https://www.itemit.com/pricing ; https://www.oomnitza.com/oomnitza-pricing/ . Third-party: https://www.cynet.com/security-foundations/cybersecurity/atera-pricing-tiers-explained/ ; https://www.getapp.com/it-management-software/a/device42/pricing/ ; https://supergood.ai/docs/ezofficeinventory-api . Blocked: https://www.atera.com/pricing/ (403); https://www.reftab.com/api-documentation (title only). Accessed 2026-11-17.

---

## 7. Our proposed prices vs the market

Our prices (plan s8.2, s8.3): Free 100 assets; Starter $49/mo (500 assets); Pro $149/mo (2,500 assets), monthly figures billed annually (monthly billing about 20% higher); unlimited users; self-hosted about $735/yr (500) and $2,235/yr (2,500); Community licence free to 100 assets. Comparisons below use the published list prices from sections 1-6; annual-equivalents are our arithmetic.

| Our price point | Market evidence | Reading |
|---|---|---|
| **Free, 100 assets, unlimited users, API** | Assetbots Free 200 assets (1 admin); Sortly Free 100 items (1 user); Reftab Free 50 assets; ME Free 50 nodes cloud / 25 on-prem; Lansweeper Free 100 assets (competitor-blog source); Shelf Personal unlimited assets (1 user); Snipe-IT self-hosted unlimited | In line on assets, ahead on users and API-on-free; behind Assetbots on asset count and far behind Snipe-IT/Shelf self-host on cost. |
| **Starter $49/mo, 500 assets** ($588/yr) | Snipe-IT Basic hosted $39.99/mo or $399.99/yr, unlimited assets; Shelf Team $370/yr unlimited; Assetbots Starter $49/mo for 1,000 assets (5 admins); Sortly Advanced $49 for 500 items (2 users); Reftab Starter from $31.25/mo (250 assets); GoCodes $1,100/yr for 500 assets (5 users); EZO Essential $81.41/mo for 500 items; ME Cloud $2,345/yr for 500 assets; Freshservice Growth $49 per agent plus AUs | In line to slightly over the SMB cluster (about 1.5x Snipe-IT hosted and Shelf per year, same price as Assetbots for half the assets); well under GoCodes, EZO, ME, Freshservice. |
| **Pro $149/mo, 2,500 assets** ($1,788/yr) | Snipe-IT Small Business $99.99/mo or $999.99/yr, unlimited assets and users; Assetbots Growth $114/mo for 3,000 assets; GoCodes Professional $2,750/yr (2,000 assets, 20 users); ME Cloud 2,000 assets $6,245/yr and 3,000 $9,345/yr; Freshservice Growth for 3 agents $147/mo before AUs (ITAM, discovery included from Growth) and Pro for 3 agents $297 | Over the lowest-cost SMB options (about 1.8x Snipe-IT hosted per year), in line with GoCodes/mid-market, well under ME and Freshservice at similar scope. |
| **Self-hosted Starter about $735/yr, Pro about $2,235/yr** | Snipe-IT self-hosted free; Shelf self-host free (AGPL, needs Supabase); ME on-prem $1,795/yr (500) and $4,795/yr (2,000); Snipe-IT dedicated hosting $2,499.99/yr; Lansweeper Classic on-prem quote only | Under ME on-prem by more than half at comparable asset counts; infinitely over free open-source alternatives. Note: ME's own on-prem is cheaper than its cloud (about 0.77x), whereas our model prices self-hosted at 1.25x cloud. One vendor is thin evidence, but nothing found supports a self-hosted premium. |

Comparison caveat in plan s8.2: the plan compares Pro against Lansweeper's third-party estimate and a Freshservice Pro seat bill. Freshservice Growth already includes ITAM discovery and CMDB, so the like-for-like seat bill for hardware-only buyers is $49 per agent; 3 agents is $147, almost exactly our Pro price, before AUs (non-IP physical assets weigh 1/25 AU, so those are cheap to add).

---

## Verdict summary

| # | Item | Verdict |
|---|---|---|
| 1a | Snipe-IT API coverage and auth support a one-click importer (assets, models, categories, locations, users, licenses + seats, accessories, consumables, components, custom fields, history, files) | Confirmed (term "API key"; 120 req/min, 500 rows/page defaults noted) |
| 1b | Snipe-IT hosted $39.99 / $99.99 / $249.99, unlimited users and assets | Confirmed; hosted SAML inclusion still unverified |
| 1c | Snipe-IT license | Confirmed AGPL-3.0 (conflict resolved) |
| 1d | Snipe-IT official mobile app is beta | Confirmed (undated pages) |
| 2 | Asset Panda pricing quote-only | Confirmed; third-party prices still unverified |
| 2 | Asset Panda has no confirmed API/SSO | Corrected (REST API and SAML SSO documented; webhooks unverified) |
| 3 | Lansweeper cloud vs on-prem | Corrected (both exist: Platform/cloud and Classic/on-prem) |
| 3 | Lansweeper pricing ($239/$439) | Still unverified (official page 403; sources conflict) |
| 3 | Lansweeper barcode/mobile | Corrected in part (QR/barcode generation in Classic; no mobile app found) |
| 4 | Freshservice $19 / $49 / $99 per agent | Confirmed |
| 4 | Freshservice ITAM / discovery plan inclusion | Corrected (Growth, Pro, Enterprise; Starter not listed) |
| 4 | Freshservice Asset Units | Confirmed (from $125/mo per 500; weights known; included AUs unverified) |
| 5 | ManageEngine cloud edition exists | Confirmed |
| 5 | ManageEngine free cloud 25 nodes | Corrected (50 cloud / 25 on-prem); public price list now available |
| 6 | Price transparency / unlimited users as differentiators | Corrected (common among SMB tools); API-on-every-tier still distinctive |
| 6 | New 2024-2026 SMB entrants | Still unverified (six comparators listed; no launch dates found) |
| 7 | Free / Starter / Pro | In line (Free), in line to over (Starter), over low-cost SMB and Snipe-IT hosted (Pro) |
| 7 | Self-hosted $735 / $2,235 | Under ME on-prem; the 1.25x premium over cloud is unsupported by the one vendor with both prices |

---

## Changes the plan should make

Plan section numbers refer to `docs/02_product_plan.md`; "matrix s5" is `docs/01_feature_matrix.md` section 5.

- **s1 (Why there is room), s2.2 (gap rows), matrix s5 (AP, LS, FS, ME, SIT notes):** update stale statements. Asset Panda has a documented REST API and SAML SSO (webhooks still unconfirmed). Lansweeper deployment is resolved (Platform cloud + Classic on-prem). Freshservice ITAM and discovery start at Growth. ManageEngine has a cloud edition with a public price list. Snipe-IT license is AGPL-3.0, not in conflict. Re-state gap 5 ("API/webhooks evidenced only for SIT") and gap 8 (transparent pricing only SIT and ME) accordingly.
- **s2.2 gap 8, s3 P2, s10 item 4 (price page as differentiator):** stop framing price transparency or unlimited users as differentiating; Reftab, Sortly, GoCodes, EZO, Assetbots, Shelf, itemit, ME and Snipe-IT all publish prices, and Snipe-IT, Reftab, Shelf Team and EZO offer unlimited users. Keep "API, webhooks and signed webhooks on Free" as the distinctive claim (GoCodes $1,200/yr, itemit GBP 699/yr, Sortly Enterprise-only).
- **s8.1 (competitor list):** fix ManageEngine to "free edition 50 nodes cloud / 25 on-prem; public cloud prices $1,245/yr for 250 assets to $16,695/yr for 10,000; on-prem $955 to $11,995". Add Snipe-IT hosted limits 120 / 240 / unlimited API calls per minute and unlimited assets on all three tiers. Replace "plan inclusion unclear" for Freshservice with "ITAM from Growth ($49/agent); Asset Units from $125/mo per 500; weights: 1 per endpoint, 4 per server, 1/25 per non-IP physical asset". Label Lansweeper and Asset Panda figures "third-party, unverified; official pages are quote-only or blocked".
- **s8.2 Competitive reading:** rewrite. Add the like-for-like comparisons: Pro ($1,788/yr) is about 1.8x Snipe-IT Small Business ($999.99/yr, unlimited assets); Starter is about the same price as Assetbots Starter for half the assets and Sortly Advanced for similar assets; use Freshservice Growth ($147 for 3 agents) rather than Pro as the hardware-only comparison. Drop "no SSO details cited" or mark hosted SAML inclusion as unverified. Decide whether the premium over Snipe-IT hosted and Shelf is explained by the Expo app, importers and SOC 2, and test it in the WTP interviews (decision 20).
- **s8.2 tier table (Free):** note that Assetbots Free gives 200 assets and Shelf Personal unlimited assets; keep 100 only if the Free tier's value is users plus API plus mobile. Consider 200 as a cheap test in WTP interviews.
- **s8.3 (decision 23, multiplier 1.25x):** revisit. ManageEngine's own on-prem is about 0.77x its cloud price at 500, 1,000, 2,000 and 5,000 assets, and Snipe-IT and Shelf self-host are free. Add a validation question to design-partner interviews on whether self-hosted buyers expect a discount rather than a premium. Our $735 and $2,235 sit well under ME on-prem ($1,795 and $4,795), so there is headroom to go lower without under-pricing the market.
- **s10 item 1 (Snipe-IT importer) and s5.3 import line:** state the verified object list (add custom field definitions and fieldsets, maintenances, files, statuslabels, manufacturers, suppliers, companies, departments, depreciations). Specify auth as "Snipe-IT API key (Bearer)". Design for 120 requests/min default and 500 rows per page: bulk list endpoints first, history last and optional, exponential backoff on throttling, resumable import, progress UI. Show "history import may take about 40 min per 5,000 assets on hosted Basic" or fetch `/reports/activity` instead (test completeness first). Add a self-hosted note: if the source is a self-hosted Snipe-IT, the user can raise `API_THROTTLE_PER_MINUTE` and `MAX_RESULTS`.
- **s10 item 1 and s5.2 (Asset Panda / Lansweeper / Freshservice mappers, v2):** replace "research could not confirm export or API formats". Asset Panda: UI export to CSV/Excel/PDF plus an admin-key REST API (collections, collection records search, 400 calls per 3 minutes per IP). Keep Lansweeper (CSV/Excel export; Platform export needs a paid plan beyond 100 assets per the InvGate blog) and Freshservice as "verify before promising".
- **s11 risk 2 (free self-hosted Snipe-IT):** add Shelf.nu (AGPL-3.0, free self-host, Team $370/yr unlimited users and assets, free mobile app) as a second open-source/cheap anchor. Our Community licence (100 assets) is weaker than free unlimited Snipe-IT; the mitigation list should say so and lean on Expo app, importer, SOC 2 and support rather than price. Note the official Snipe-IT mobile app is still beta (supports the mobile differentiator, but pages are undated; recheck before launch copy).
- **s11 risk 5:** mark "Lansweeper deployment conflict unresolved" as resolved; change "free tiers exist for ME cloud, Lansweeper, Snipe-IT self-host" to the verified limits (ME cloud 50 nodes; Lansweeper Free 100 assets per a competitor blog; trial at app.lansweeper.com/try). Add the still-unverified list: Lansweeper prices, Asset Panda prices and API plan inclusion, Freshservice included AUs and monthly prices, hosted Snipe-IT SAML inclusion, Atera/NinjaOne asset features, Oomnitza/Device42 prices.
- **s5 Phase 0 / s12 decision 20:** add to the hands-on trial list the SMB comparators that actually share our price band (Assetbots, Reftab, Shelf.nu, Sortly) and run the WTP interviews against the Snipe-IT hosted $39.99 / $99.99 price points, since they bound willingness to pay for core tracking.
- **s10 item 3 (comparison pages):** every competitor claim on those pages needs a source and date; the ones verified here (with the dates above) can be reused, and Lansweeper/Asset Panda price claims must not be published until verified.

---

## Still unverified after this pass

- Lansweeper list prices (official page 403) and the 5 Nov 2026 monitor-counting change (competitor-blog source only).
- Asset Panda list prices, which plans include API, and webhooks.
- Freshservice monthly-billing prices and the included Asset Unit allotment per plan.
- Snipe-IT: hosted SAML tier, API token expiry, hosted `MAX_RESULTS`, and `/reports/activity` completeness (route file was read through a summariser).
- EZOfficeInventory and Reftab API plan inclusion; Assetbots API.
- Atera and NinjaOne asset-inventory features; Oomnitza and Device42 prices.
- Whether any of the SMB comparators entered the market in 2024-2026.
