# Asset Tracker Wireframes: screen inventory and low-fi layouts (M1-M3)

Scope: M1 Core Registry, M2 Lifecycle and Check-out, M3 Tagging and Mobile, per the MVP checklist (plan 5.3). Web = Next.js static-export admin/desktop UI. Mobile = Expo technician app. Tokens and components: `design_system.md`. Clickable web prototype: `prototype.html` (list, detail, check-out dialog, settings).

Legend: `[Button]` button, `[x]`/`[ ]` checkbox, `(o)`/`( )` radio, `[v]` dropdown, `[____]` text input, `<link>` link, `{badge}` status badge, `...` more content, `#` repeated rows. Priority tags: **M** = MVP Must, **S** = Should, per plan 5.3.

---

## 1. Screen inventory

### 1.1 Web (admin/desktop)

| ID | Screen | Module | Purpose | Primary actions | Key fields / content |
|---|---|---|---|---|---|
| WEB-01 | Login | Platform | Authenticate | Sign in; Sign in with Google / Microsoft; Forgot password; SSO (S) | Email, password, MFA code (TOTP), passkey (optional), server/tenant hint on self-hosted |
| WEB-02 | First-run onboarding wizard | Platform (P1) | First asset labelled in under 30 min | Choose template; name organisation; add first location; import or add assets; invite team; print first labels | Org name, locale/timezone/currency, template (IT office / School / Clinic / Blank), first site, import choice |
| WEB-03 | Dashboard | M1-M3 | Landing: what needs attention | Jump to filtered list; scan | Counts by status/category/location, overdue returns, expiring warranties, low stock, recent activity |
| WEB-04 | Asset list | M1 (M) | The workhorse: find, filter, bulk-act | New asset; Import; Check out/in; Bulk edit; Print labels; Export; Save view; column picker | Tag, name, model, category, status, assignee, location, purchase date, warranty end, custom fields; filters; saved views; scan field |
| WEB-05 | Asset detail | M1/M2 (M) | One asset, everything | Edit; Check out/in; Transfer; Print label; Log repair; Dispose; Clone; Archive | Photo, tag, serial, model, category, status, assignee, location, purchase info, custom fields, tabs: Overview, History, Repairs, Attachments |
| WEB-06 | Asset create / edit | M1 (M) | Create or edit with category-driven fields | Save; Save and add another; Clone; Cancel | Name, tag (auto-numbered), serial, category, model, status, location, purchase info, notes, photos, **custom fields for category** |
| WEB-07 | Bulk edit dialog | M1 (M) | Change many assets at once | Apply; preview count; cancel | Field picker (status, location, category, custom fields), new value, affected count |
| WEB-08 | Settings: categories | M1 (M) | Manage categories | Add, rename, reorder, archive; set default depreciation | Name, icon, default custom fields, asset count |
| WEB-09 | Settings: manufacturers and models | M1 (M) | Model catalogue | Add model; upload image; set defaults | Manufacturer, model, category, image, default depreciation months, EOL date |
| WEB-10 | Settings: custom fields | M1 (M) | Typed fields per category | Add field; reorder; assign to categories; mark required/filterable | Label, key, type (text, number, date, select, multi-select, checkbox, URL), options, required, help text, categories |
| WEB-11 | Settings: status labels | M1/M2 (M) | Configurable names mapped to fixed state types | Add/rename label; map to state type; set default | Label, state type (ready, assigned, in repair, archived/disposed, lost), colour (derived), default-for-new |
| WEB-12 | Locations tree | M1 (M) | Hierarchy company > site > building > room | Add child; rename; move; archive; view assets here | Name, type, parent, asset count, address (site) |
| WEB-13 | Check-out / check-in dialog | M2 (M) | Hand over or receive | Check out; Check in; Transfer (tab) | Asset(s) (scan field), assignee (user/location/asset), expected return, notes, photo (check-in), condition/status after check-in |
| WEB-14 | CSV import wizard | Import (M) | Bulk load with dry run | Upload; map columns; dry run; commit; download error report | File, entity (assets/models/users), mapping, de-dupe rule (serial/tag), dry-run summary (create/update/skip/error), error list |
| WEB-15 | Label print | M3 (M) | Print QR/Code128 PDF label sheets | Choose template; select assets; preview; Download PDF | Sheet template, start position, copies, content toggles (QR/Code128, tag, name, location), asset selection |
| WEB-16 | Loaner pool | M2 (M) | Pool of loaner/spare devices | Quick check-out; Bulk check-in; set due date; extend | Pool membership, available/out counts, borrower, due date, overdue flag, device |
| WEB-17 | Repair log | M2 (M) | Repair record per asset + overview | Log repair; attach; close | Date, description, vendor, cost, attachments, resulting status, open/closed |
| WEB-18 | Stocktake (web) | M2 (M) | Create/review audit sessions | New session by location or filter; scan to confirm; mark missing/found; variance report | Name, scope, expected/found/missing/unexpected counts, scanner field, variance export |
| WEB-19 | Accessories and consumables | M1 (M) | Quantities and min-stock | Add stock; check out; consume; set min | Name, category, qty, min qty, location, checkout/consume log |
| WEB-20 | Disposal / retire dialog | M2 (M) | Retire an asset | Confirm disposal | Reason, date, notes, optional method |
| WEB-21 | Command palette | M1 (M) | Keyboard-first navigation | Navigate; run action; open asset by tag | Search input, grouped results, shortcuts |
| WEB-22 | Saved views and column picker | M1 (M) | Personalise lists | Save, rename, share, delete view; toggle columns | View name, scope (me / team), filters, columns, sort |
| WEB-23 | Users and roles (minimal) | Platform (M) | Invite, assign roles | Invite; change role; location scope (S) | Email, role (Owner, Admin, Asset Manager, Technician/Auditor, Viewer/Employee), scope |
| WEB-24 | Error and access screens | all | 403, 404, offline, read-only licence | Go home; retry | Message, request ID |

### 1.2 Mobile (Expo technician app)

| ID | Screen | Purpose | Primary actions | Key content |
|---|---|---|---|---|
| MOB-01 | Server connect and login | One app for Cloud and Self-hosted | Enter server URL / scan setup QR; sign in (email+password, MFA, Google/Microsoft) | URL field, QR button, login form |
| MOB-02 | Scan | Home screen: resolve a tag | Scan; torch; manual entry; mode switch; continuous mode | Camera, reticle, mode chips (Lookup, Check out, Check in, Stocktake) |
| MOB-03 | Asset quick view | See the asset and act | Check out/in; transfer; photo; log repair; open history | Photo, tag, status, assignee, location, key fields, 3 recent events |
| MOB-04 | Check-out flow (sheet) | Hand over in under 10 s | Pick assignee; set return date; photo; confirm; scan next | Assignee, expected return, notes, photo, undo |
| MOB-05 | Check-in flow (sheet) | Receive back | Confirm; set condition/status; photo; note | Condition, status after, photo, note |
| MOB-06 | Stocktake | Audit a location | Choose/continue session; scan to confirm; mark missing; finish | Progress, expected/found/missing/unexpected tabs |
| MOB-07 | Loaner pool | Quick loaner handling | Quick check-out; bulk check-in; due dates | Available, out, overdue |
| MOB-08 | Repair log | Record repair from the field | Save entry; add photos | Date, description, cost, photos |
| MOB-09 | Quick create | Add an unknown asset found in the field | Create; photo; assign tag | Name, category, model, location, tag, photo |
| MOB-10 | Offline / retry states | Network failure handling (online-first) | Retry; view queue | Banner, queue list |

---

## 2. Web wireframes

### WEB-01 Login

```
+--------------------------------------------------------------------------------+
|                                                                                |
|                         [logo] Asset Tracker                                   |
|                                                                                |
|                    +------------------------------------+                      |
|                    |  Sign in                           |                      |
|                    |                                    |                      |
|                    |  Email                             |                      |
|                    |  [__________________________]      |                      |
|                    |  Password              <Forgot?>   |                      |
|                    |  [__________________________] [o]  |  [o] = show password |
|                    |                                    |                      |
|                    |  [        Sign in         ]        |                      |
|                    |  --------- or ---------            |                      |
|                    |  [ G  Continue with Google    ]    |                      |
|                    |  [ M  Continue with Microsoft ]    |                      |
|                    |  <Sign in with SSO>  (S)           |                      |
|                    |                                    |                      |
|                    |  New here? <Create an account>     |  (Cloud only)        |
|                    +------------------------------------+                      |
|   <Docs>  <Status>  <Privacy>                         [Light/Dark]  Language   |
+--------------------------------------------------------------------------------+
Step 2 (after valid password):  "Enter the 6-digit code" [_ _ _ _ _ _] <Use a recovery code>
Errors: one inline message above the button ("Email or password is incorrect"), role=alert.
Paste allowed in all fields (WCAG 3.3.8).
```

### WEB-02 First-run onboarding wizard

```
+--------------------------------------------------------------------------------+
| [logo] Asset Tracker                                          Step 2 of 5   x  |
+--------------------------------------------------------------------------------+
|  (1)---(2)---( )---( )---( )                                                   |
|  Org   Where  Assets Team  Labels                                              |
|                                                                                |
|  Where are your assets?                                                        |
|  Start with your first site. You can add buildings and rooms later.           |
|                                                                                |
|  Template   (o) School   ( ) IT office   ( ) Clinic   ( ) Blank                |
|             Adds: categories Laptop, Chromebook, Tablet, Projector; statuses;  |
|             fields Serial, Purchase date, Warranty end.        <Preview>        |
|                                                                                |
|  Site name  [Riverside Elementary_______]                                      |
|  Building   [Main building______________]   Room [Room 101_______] [+ Add]     |
|                                                                                |
|  Locations added:  Riverside Elementary > Main building > Room 101             |
|                                                                                |
|                                         [ Back ]   [ Continue ]                |
|                                                                                |
|  Progress saved. <Skip for now>                                                |
+--------------------------------------------------------------------------------+
Step 3 "Assets": three cards  [Import a CSV]  [Import from Snipe-IT]  [Add one by one]
Step 5 "Labels": preview of first labels, [Download PDF], "Print them and stick them on your first 10 devices"
Goal: first 100 assets imported and labelled in < 30 min (P1).
```

### WEB-03 Dashboard (reference, brief)

```
+-----------+--------------------------------------------------------------------+
| Sidebar   |  Dashboard                                  [Scan or search tag___] |
|           |  +----------+ +----------+ +----------+ +----------+               |
|           |  | 1,204    | | 388      | | 41       | | 7        |               |
|           |  | Ready    | | Assigned | | In repair| | Overdue  |               |
|           |  +----------+ +----------+ +----------+ +----------+               |
|           |  Overdue returns (7)               Warranty ending (30 days) (12)   |
|           |  # tag  name   borrower  due       # tag  name        ends          |
|           |  Recent activity ...                                                |
+-----------+--------------------------------------------------------------------+
```

### WEB-04 Asset list (the workhorse)

```
+-----------+------------------------------------------------------------------------------------+
| [logo]    | Assets (1,204)                       [Scan or search tag___ /]  [Import] [+ New asset] |
| Asset Trk |------------------------------------------------------------------------------------|
|           | All assets | My checked-out | Overdue | In repair | Chromebooks* | [+]  <Save view>  |
| Assets *  | Status: Ready x  Location: Riverside > Main x   [+ Filter v]   <Clear all>          |
| Locations | [Columns v] [Density v]                                       Showing 1-50 of 1,204  |
| Loaner    |------------------------------------------------------------------------------------|
| Repairs   | [ ] Tag       Name              Model        Status        Assignee    Location  Warr. |
| Stocktake |------------------------------------------------------------------------------------|
| Labels    | [ ] AT-00123  Chromebook 3100   Dell 3100    {v Ready}     -           Room 101  2027  |
| Import    | [x] AT-00124  Chromebook 3100   Dell 3100    {u Assigned}  J. Okafor   Room 204  2027  |
|           | [x] AT-00125  iPad 9th gen      Apple A2602  {w In repair} -           Repairs   2026  |
| Settings  | [ ] AT-00126  Projector EB-X49  Epson EB-X49 {c Overdue}   M. Reyes    Gym       2025  |
|           | [ ] AT-00127  Chromebook 3100   Dell 3100    {v Ready}     -           Room 101  2027  |
|           |  ... virtualised, sticky header and first column ...                                |
|           |------------------------------------------------------------------------------------|
|           | 2 selected:  [Check out] [Check in] [Change status v] [Move v] [Print labels]       |
|           |              [Bulk edit] [Export v] [Archive]                       <Clear selection>|
+-----------+------------------------------------------------------------------------------------+
Notes
- Row click opens the drawer (480px) with quick view; Enter on a focused row does the same; "Open full page" in the drawer.
- Inline edit: double-click or Enter on a Status/Location/Assignee cell.
- Typing a full tag in the scan field + Enter jumps straight to that asset (wedge scanners work with no setup).
- Column picker lists standard + every custom field; Move up/down buttons (no drag-only).
- Empty (first use): "No assets yet" [Import CSV] [+ New asset]. Filtered-empty: "No assets match" <Clear filters>.
- Status badge = icon + text; colour from state type. {v}=ready {u}=assigned {w}=repair {c}=overdue (icons in the real UI).
```

Column picker popover:

```
+------------------------------+
| Columns                      |
| [Search columns____]         |
| [x] Tag            [^][v]    |
| [x] Name           [^][v]    |
| [x] Model          [^][v]    |
| [x] Status         [^][v]    |
| [ ] Serial         [^][v]    |
| --- Custom fields ---        |
| [ ] Screen size (in)         |
| [ ] OS version               |
| <Reset to default>   [Done]  |
+------------------------------+
```

### WEB-05 Asset detail (with history and tabs)

```
+-----------+--------------------------------------------------------------------------------+
| Sidebar   | Assets > AT-00124                                                              |
|           | +--------+  Chromebook 3100                  {u Assigned to J. Okafor}           |
|           | | photo  |  AT-00124 - Serial 5CG1234XYZ  - Dell Chromebook 3100                 |
|           | +--------+  Room 204, Main building, Riverside Elementary                        |
|           |  [Check in] [Transfer] [Edit] [Print label] [Log repair] [ ... v: Clone, Dispose ]|
|           |--------------------------------------------------------------------------------|
|           | Overview | History (14) | Repairs (1) | Attachments (3)                         |
|           |--------------------------------------------------------------------------------|
|           | Details                              Purchase                                  |
|           |  Category      Chromebook             Date         2024-08-12                  |
|           |  Model         Dell 3100              Cost         $289.00                     |
|           |  Status        Assigned               Supplier     CDW                         |
|           |  Assignee      J. Okafor              Order no.    PO-4471                     |
|           |  Due back      2026-12-18             Warranty end 2027-08-12                  |
|           |  Location      Room 204               Custom fields (Chromebook)               |
|           |  Notes         Cart 3, slot 14         Screen size  11.6 in                    |
|           |                                        OS version   ChromeOS 126               |
|           |                                        Managed      [x] Yes                    |
|           |--------------------------------------------------------------------------------|
|           | History tab                                         Filter: [All events v]     |
|           |  o 2026-11-10 14:02  Checked out to J. Okafor by S. Lee   due 2026-12-18  [photo]|
|           |  o 2026-11-10 13:58  Status Ready -> Assigned                                  |
|           |  o 2026-10-28 09:15  Checked in from M. Reyes by S. Lee   "Cracked bezel"      |
|           |  o 2026-10-02 11:40  Repair logged: replaced screen, $64                       |
|           |  o 2026-08-12 10:00  Created (imported from CSV batch #3)                      |
|           |  <Load more>                                                                   |
+-----------+--------------------------------------------------------------------------------+
Notes
- Action buttons depend on state/role: Ready shows [Check out]; Assigned shows [Check in] [Transfer]; Disposed shows none.
- History is the chain of custody (immutable); each row links to the audit entry (who, when, IP, before/after for admins).
- Tabs are URL-addressable (?tab=history). Count badges update live.
- Attachments tab: upload dropzone, per-file scan status chips (Scanning / Ready / Rejected).
```

### WEB-06 Asset create / edit with custom fields

```
+-----------+--------------------------------------------------------------------------+
| Sidebar   | Assets > New asset                                                       |
|           |--------------------------------------------------------------------------|
|           |  Basics                                                                  |
|           |  Category (required)   [Chromebook                  v]                   |
|           |  Model                 [Dell Chromebook 3100        v]  <Add model>      |
|           |  Name (required)       [Chromebook 3100_______________] (default: model) |
|           |  Asset tag             [AT-00131] auto-numbered  (o) Auto ( ) Enter own  |
|           |  Serial number         [______________________]   duplicate check inline |
|           |  Status                [Ready                       v]                   |
|           |  Location (required)   [Riverside > Main > Room 101 v]                   |
|           |                                                                          |
|           |  Purchase                                                                |
|           |  Date [2026-11-01]  Cost [$_____]  Supplier [CDW v]  Order no. [______]  |
|           |  Warranty ends [2029-11-01]                                              |
|           |                                                                          |
|           |  Fields for Chromebook                          (shown from category)    |
|           |  Screen size (in) [11.6]   OS version [ChromeOS 126]   Managed [x]       |
|           |  Enrollment date  [2026-11-02]   Admin console URL [https://_____]       |
|           |  Condition        [Good v]   Accessories [x] Charger [ ] Case (multi)    |
|           |                                                                          |
|           |  Photos and files   [ Drop files here or <browse> ]                      |
|           |  Notes  [_____________________________________________]                 |
|           |                                                                          |
|           |  [ Save ]  [ Save and add another ]  [ Cancel ]            Ctrl+Enter = Save|
+-----------+--------------------------------------------------------------------------+
Notes
- Changing Category swaps the "Fields for ..." section and warns if entered values would be discarded.
- Required fields marked "(required)" in text. Errors inline + summary on submit.
- "Save and add another" keeps category, model, location, purchase info (fast bulk entry, D1).
- Clone prefills everything except tag and serial.
- Serial/tag duplicates flagged on blur with a link to the existing asset.
```

### WEB-07 Bulk edit dialog

```
+------------------------------------------------+
| Edit 2 assets                              [x] |
|------------------------------------------------|
| Field   [Status                        v]      |
| New value [In repair                   v]      |
| [+ Add another field]                          |
| Preview: AT-00124, AT-00125 -> status "In repair"|
| Assets that are checked out will be skipped (1).|
|                       [Cancel] [Apply to 1 asset]|
+------------------------------------------------+
```

### WEB-08..11 Settings: categories, models, custom fields, status labels

Settings shell with sub-nav (shared by all four):

```
+-----------+--------------------------------------------------------------------------+
| Sidebar   | Settings                                                                 |
|           | +----------------+  +--------------------------------------------------+ |
|           | | Organisation   |  |  (selected sub-page content)                     | |
|           | | Users and roles|  |                                                  | |
|           | | Categories   * |  |                                                  | |
|           | | Models         |  |                                                  | |
|           | | Custom fields  |  |                                                  | |
|           | | Status labels  |  |                                                  | |
|           | | Locations      |  |                                                  | |
|           | | Label templates|  |                                                  | |
|           | | API and webhooks| |                                                  | |
|           | +----------------+  +--------------------------------------------------+ |
+-----------+--------------------------------------------------------------------------+
```

Categories (WEB-08):

```
| Categories                                                         [+ New category] |
|-------------------------------------------------------------------------------------|
| Name            Custom fields   Assets   Default depreciation                      |
| Chromebook      5               642      36 months      [Edit] [Move up][Move down] |
| Laptop          6               118      48 months      [Edit] [Move up][Move down] |
| Tablet          4               205      36 months      [Edit] [Move up][Move down] |
| Projector       3               31       60 months      [Edit] [Move up][Move down] |
| (Archived) <show>                                                                   |
| Deleting a category with assets requires choosing a replacement category.          |
```

Models (WEB-09):

```
| Models                       [Search____]  Manufacturer [All v]       [+ New model] |
| Img  Manufacturer  Model              Category     Assets  EOL        Default depr. |
| [ ]  Dell          Chromebook 3100    Chromebook   310     2029-06    36 mo   [Edit] |
| [ ]  Apple         iPad 9th gen       Tablet       205     2027-09    36 mo   [Edit] |
```

Custom fields (WEB-10):

```
| Custom fields                                                      [+ New field]  |
|------------------------------------------------------------------------------------|
| Label          Type          Categories             Required Filterable             |
| Screen size    Number (in)   Chromebook, Laptop     [ ]      [x]      [Edit][^][v] |
| OS version     Text          Chromebook, Laptop     [ ]      [x]      [Edit][^][v] |
| Managed        Checkbox      Chromebook             [ ]      [x]      [Edit][^][v] |
| Condition      Select        All                    [x]      [x]      [Edit][^][v] |
| Admin URL      URL           Chromebook             [ ]      [ ]      [Edit][^][v] |
|                                                                                     |
| New field (drawer)                                                                  |
|  Label [Screen size____]  Key [screen_size] (auto, locked after save)               |
|  Type  [Number v]  Unit [in]   Min [ ] Max [ ]                                      |
|  Applies to  [x] Chromebook [x] Laptop [ ] Tablet [ ] Projector  (or [All])         |
|  [ ] Required  [x] Filterable (appears in filter bar and column picker)             |
|  Help text [_______]   Default [_____]                                              |
|  Preview:  Screen size (in)  [11.6]                                                 |
|  Types: text, number, date, select, multi-select, checkbox, URL                     |
|  Changing type after assets have data is blocked; archive and recreate instead.     |
|                                                [Cancel] [Save field]                |
```

Status labels (WEB-11):

```
| Status labels                                                      [+ New label]   |
| Labels are names you choose. Each maps to a fixed state type that drives behaviour. |
|------------------------------------------------------------------------------------|
| Label          State type        Preview                Default  Assets             |
| Ready          Ready             {v Ready}              (o)      1,204              |
| Deployed       Assigned          {u Deployed}           ( )      388                |
| Out for fix    In repair         {w Out for fix}        ( )      41                 |
| Missing        Lost              {x Missing}            ( )      3                  |
| Retired        Archived/disposed {a Retired}            ( )      96   (not counted) |
| State type controls: deployability, whether it counts toward your asset band, and   |
| the badge colour. Retired/disposed assets do not count (P2).                        |
```

### WEB-12 Locations tree

```
+-----------+--------------------------------------------------------------------------+
| Sidebar   | Locations                                          [+ Add location]      |
|           |--------------------------------------------------------------------------|
|           | [Search locations___]        | Riverside Elementary > Main building      |
|           |                              |                                           |
|           | v Riverside Elementary  (412)| Main building            Type: Building   |
|           |   v Main building       (301)| 301 assets, 12 rooms                      |
|           |       Room 101           (38)| [+ Add room]  [Rename]  [Move...] [Archive]|
|           |       Room 204           (41)|                                           |
|           |       Library            (55)| Assets here (301)  <View in asset list>   |
|           |   > Gym                  (24)| # tag      name        status             |
|           |   > IT closet            (87)| ...                                       |
|           | v Northside Annex       (112)|                                           |
|           | > Storage unit           (12)|                                           |
|           | Keyboard: arrows move, Right/Left expand/collapse, Enter opens, F2 renames|
+-----------+--------------------------------------------------------------------------+
Hierarchy: company > site > building > room. "Move..." opens a dialog with a location picker (no drag-only).
```

### WEB-13 Check-out / check-in dialog

```
+--------------------------------------------------------------+
| Check out asset                                          [x] |
| [ Check out ]  [ Check in ]  [ Transfer ]                    |   <- tabs; default by state
|--------------------------------------------------------------|
| Asset      [Scan or type tag: AT-00123____]   <- wedge OK    |
|            AT-00123  Chromebook 3100  {v Ready}  Room 101    |
|            + Add another asset (bulk)   Selected: 1          |
| Check out to  (o) Person  ( ) Location  ( ) Asset            |
| Person     [J. Okafor (Year 5)                    v]         |
| Expected return [2026-12-18]  [Today][+1 week][End of term]  |
| Status after   [Deployed  v]                                 |
| Notes      [____________________________________]           |
| Photo      [ + Add photo ]                                   |
| [ ] Send acceptance request to assignee (S)                  |
|--------------------------------------------------------------|
| Esc closes                    [Cancel]  [Check out]  Ctrl+Enter |
+--------------------------------------------------------------+
After success: toast "AT-00123 checked out to J. Okafor. <Undo>" and the dialog stays open on
"Scan next" when launched from the scan field (rapid desk workflow).
Check-in tab: Asset, Condition [Good v], Status after [Ready v], Location [Room 101 v], Notes, Photo.
Transfer tab: from (read-only), to (person/location/asset), note.
Blocked states: asset already checked out -> inline danger banner "Already assigned to M. Reyes. <Check in first>".
```

### WEB-14 CSV import with dry-run results

```
Step indicator: (1) Upload --- (2) Map columns --- (3) Dry run --- (4) Import

Step 2 Map columns
+--------------------------------------------------------------------------------+
| Import assets                                                      Step 2 of 4 |
| File: chromebooks_2026.csv  (1,248 rows)        Template: [Google Admin ChromeOS v]|
| Your column        ->  Asset Tracker field          Sample                      |
| Serial Number      ->  [Serial number        v]     5CG1234XYZ         [ok]     |
| Asset ID           ->  [Asset tag            v]     AT-00123           [ok]     |
| Model              ->  [Model                v]     Chromebook 3100    [ok]     |
| Annotated User     ->  [Assignee             v]     jokafor@school.org [ok]     |
| Org Unit           ->  [Location (by name)   v]     /Main/Room 101     [!] 3 unmatched|
| Notes              ->  [(Do not import)      v]                                  |
| De-duplicate on:  [x] Serial   [x] Asset tag    If found: (o) Update ( ) Skip     |
| Create missing models, locations, users?  [x] Models [x] Locations [ ] Users      |
|                                                 [Back]  [Run dry run]             |
+--------------------------------------------------------------------------------+

Step 3 Dry run results   (info banner: "Preview, nothing has been saved yet")
+--------------------------------------------------------------------------------+
| Dry run: 1,248 rows                                                             |
| +-----------+ +-----------+ +-----------+ +-----------+                         |
| | 1,102     | | 118       | | 19        | | 9         |                         |
| | Will create| | Will update| | Duplicates| | Errors   |                         |
| |           | |           | | skipped   | |           |                         |
| +-----------+ +-----------+ +-----------+ +-----------+                         |
| Show: (o) All ( ) Errors only ( ) Duplicates     [Download error report CSV]    |
| Row  Action        Tag/Serial       Problem / change                            |
| 14   {Error}       (blank serial)   Serial number is required                   |
| 77   {Error}       5CG99            Location "/Main/Room 999" not found  [Map...]|
| 203  {Skip}        5CG1234XYZ       Duplicate of AT-00124 in file (row 2)        |
| 310  {Update}      5CG555           Status Ready -> Assigned; assignee added  [v] |
| 311  {Create}      5CG556           New asset AT-00210                           |
|                                                                                 |
| 9 rows with errors will be skipped.      [Back]  [Import 1,220 rows]            |
+--------------------------------------------------------------------------------+
Step 4: progress bar "Importing 640 / 1,220", then summary, <View imported assets> (filter by batch), <Print labels for new assets>.
(Undo/rollback moves to v1.1 per plan decision 22; keep a batch filter now.)
```

### WEB-15 Label print

```
+-----------+--------------------------------------------------------------------------+
| Sidebar   | Print labels                                                             |
|           |--------------------------------------------------------------------------|
|           |  Assets                          | Preview (page 1 of 3)                 |
|           |  (o) 12 selected from list       |  +--------------------------------+   |
|           |  ( ) By filter [Added today v]   |  | [QR] AT-00123  | [QR] AT-00124 |   |
|           |  ( ) Scan to add [______]        |  |  Chromebook    |  Chromebook   |   |
|           |  <Review list (12)>              |  |  Room 101      |  Room 204     |   |
|           |                                  |  |----------------+---------------|   |
|           |  Sheet template                  |  | [QR] AT-00125  | [ ] (used)    |   |
|           |  [Avery 5160 - 30 up (1x2.6in) v]|  |  ...                           |   |
|           |  [Round 1in - 20 up           ]  |  +--------------------------------+   |
|           |  [Small 0.5x1.75in - 80 up    ]  |  Zoom single label:                   |
|           |  Start at position [ 7 ] (reuse  |  +-------------------+                |
|           |       a partly used sheet)       |  | [QR]  AT-00123    |                |
|           |  Copies [1]                      |  |       Chromebook  |                |
|           |  Code type (o) QR ( ) Code128    |  |       Room 101    |                |
|           |  Include [x] Tag [x] Name        |  +-------------------+                |
|           |          [x] Location [ ] Serial |  QR encodes an opaque URL, not the id.|
|           |                                  |                                       |
|           |  [ Download PDF ]   Tip: print at 100% / "Actual size"                   |
+-----------+--------------------------------------------------------------------------+
Template editor is v1.1 (plan decision 22); MVP has a few fixed standard sheet templates.
```

### WEB-16 Loaner pool

```
+-----------+--------------------------------------------------------------------------+
| Sidebar   | Loaner pool                                    [Quick check-out] [Bulk check-in]|
|           |--------------------------------------------------------------------------|
|           | +----------+ +----------+ +----------+ +----------+                       |
|           | | 24       | | 9        | | 7        | | 3        |                       |
|           | | In pool  | | Available| | On loan  | | Overdue  |                       |
|           | +----------+ +----------+ +----------+ +----------+                       |
|           | Pool [Student Chromebook loaners v]  Show [All v]  [Search____]          |
|           | [ ] Tag       Device           Status         Borrower     Due        Days |
|           | [ ] AT-00311  Chromebook L-01  {v Available}  -            -          -    |
|           | [x] AT-00312  Chromebook L-02  {u On loan}    A. Chen      2026-11-20 3 left|
|           | [x] AT-00313  Chromebook L-03  {c Overdue}    D. Park      2026-11-12 5 over|
|           | 2 selected: [Check in] [Extend due date...] [Send reminder]              |
|           |--------------------------------------------------------------------------|
| Quick check-out dialog:  scan device [____]  borrower [____ v]  due [today+3 v]      |
|   -> [Check out] stays open for next scan.                                           |
| Overdue alerts: in-app + email to the borrower's manager (configurable). Modelled with|
| existing asset/assignment tables (no new entity; plan 5.3).                          |
+-----------+--------------------------------------------------------------------------+
```

### WEB-17 Repair log

```
+-----------+--------------------------------------------------------------------------+
| Sidebar   | Repairs                                            [+ Log repair]        |
|           | Open (6) | Closed (212)          Search [____]  Status [Any v]           |
|           |--------------------------------------------------------------------------|
|           | Date        Asset      Description                 Vendor     Cost  State |
|           | 2026-11-12  AT-00125   Replace screen             Acme Fix   $64   {w Open}|
|           | 2026-11-03  AT-00201   Battery swap               In-house   $22   {w Open}|
|           | 2026-10-02  AT-00124   Replace screen             Acme Fix   $64   {v Done}|
|           |--------------------------------------------------------------------------|
| Log repair (drawer, also on asset detail > Repairs tab and in the mobile app)         |
|  Asset [AT-00125 (scan)___]   Date [2026-11-12]                                       |
|  Description [Cracked screen, replace_________________]                               |
|  Vendor [Acme Fix v]   Cost [$64.00]   Status after [In repair v] -> [Ready v] on close|
|  Attachments [ drop quotes/receipts/photos ]                                          |
|                                          [Cancel] [Save]  [Save and close repair]     |
+-----------+--------------------------------------------------------------------------+
```

### WEB-18 Stocktake (web)

```
| Stocktake: Library, Q4 audit                          Status: {i In progress}  62%    |
| Scope: Riverside > Main > Library (55 assets)    [Scan or type tag to confirm___]     |
|---------------------------------------------------------------------------------------|
| Expected 55 | Found 34 | Missing 21 | Unexpected 2                                    |
| [ ] Tag       Name           Expected location   Result                               |
| [ ] AT-00501  iPad 9th gen   Library             {v Found}  by S. Lee 10:02           |
| [ ] AT-00502  iPad 9th gen   Library             {w Not scanned}   [Mark missing]     |
| [ ] AT-00911  Projector      Gym                 {i Unexpected here} [Move here][Ignore]|
|                                                [Finish stocktake...]  <Variance report>|
```

### WEB-19 Accessories and consumables (brief)

```
| Accessories and consumables                                  [+ New item]            |
| Name            Type        Qty  Min   Location       Status                          |
| USB-C charger   Accessory   42   10    IT closet      {v In stock}   [Check out][+Stock]|
| HDMI cable      Consumable  6    10    IT closet      {w Low stock}  [Consume][+Stock]  |
```

### WEB-20 Disposal dialog and WEB-21 Command palette

```
+---------------------------------------------+     +--------------------------------------+
| Dispose AT-00126                        [x] |     | > [Type a command or tag____________]|
| Reason [Beyond repair            v]         |     |  Go to                               |
| Date   [2026-11-17]  Method [Recycle v]     |     |   Assets            G A              |
| Notes  [_____________________________]      |     |   Locations         G L              |
| This removes it from your active asset      |     |  Actions                             |
| count. History is kept.                     |     |   New asset         C                |
|                 [Cancel] [Dispose asset]    |     |   Check out asset   X                |
+---------------------------------------------+     |   Import CSV                         |
                                                    |  Assets                              |
                                                    |   AT-00124 Chromebook 3100 (exact)   |
                                                    +--------------------------------------+
```

### WEB-23 Users and roles, WEB-24 error screens

```
| Users and roles                                          [+ Invite]                   |
| Name        Email              Role v               Scope (S)         Last active     |
| S. Lee      slee@school.org    Asset Manager        All locations      Today           |
| J. Park     jpark@school.org   Technician/Auditor   Riverside only     Yesterday       |

403:  [lock] You do not have access to this page.  Ask an admin for the Asset Manager role.   [Go to Assets]  Request ID: 7f3a...
Read-only licence banner: "This server is in read-only mode (licence expired). Export still works. <Learn more>"
```

---

## 3. Mobile wireframes (Expo, 390 x 844 reference)

### MOB-01 Server connect and login

```
+-----------------------------+      +-----------------------------+
| 9:41                  ||| ) |      |  <  Server                  |
|                             |      |                             |
|     [logo] Asset Tracker    |      |  Sign in                    |
|                             |      |  to https://assets.school.org|
|  Connect to your server     |      |  Email                      |
|                             |      |  [_________________________]|
|  Server URL                 |      |  Password                   |
|  [https://________________] |      |  [_________________________]|
|                             |      |                             |
|  [   Scan setup QR   ]      |      |  [        Sign in        ]  |
|                             |      |  [ G Continue with Google ] |
|  Using Asset Tracker Cloud? |      |  [ M Continue with Microsoft]|
|  [ Continue to Cloud ]      |      |  <Forgot password>          |
|  (MDM may preset the URL)   |      |                             |
+-----------------------------+      +-----------------------------+
```

### MOB-02 Scan screen

```
+-----------------------------+
| [x]   Lookup v        [torch]|   mode: Lookup | Check out | Check in | Stocktake
|                             |
|  +---------------------+    |
|  |                     |    |
|  |   +-------------+   |    |   camera fills screen; reticle in centre
|  |   |   (reticle) |   |    |
|  |   +-------------+   |    |
|  |                     |    |
|  +---------------------+    |
|  Point at a QR or barcode   |
|                             |
|  [ Continuous scan  (o--) ] |   on for stocktake
|  Last: AT-00124  Chromebook |   <- result chip, haptic + sound
|                             |
|  [ Enter tag manually ]     |   44pt+ targets
|-----------------------------|
| [Scan]  [Assets] [Pool] [Me]|
+-----------------------------+
States: camera permission needed ("Camera access is required to scan. [Open settings] [Enter tag manually]");
not found ("No asset with tag AT-99999. [Create asset] [Try again]"); logged-out label scan -> login first, reveals nothing.
```

### MOB-03 Asset quick view

```
+-----------------------------+
| <  AT-00124                 |
| +-----+  Chromebook 3100    |
| |photo|  {u Assigned}       |
| +-----+  J. Okafor          |
|          Due 2026-12-18     |
|-----------------------------|
| Location  Room 204          |
| Model     Dell Chromebook   |
| Serial    5CG1234XYZ        |
| > More details (custom fields)|
|-----------------------------|
| Recent                      |
|  Nov 10  Checked out to J.O.|
|  Oct 28  Checked in (M.R.)  |
|  <See all history>          |
|-----------------------------|
| [   Check in    ] (52pt)    |
| [Transfer] [Photo] [Repair] |
+-----------------------------+
Action set comes from the server's allowed actions for state + role (architecture 6.a). Ready asset shows [Check out].
```

### MOB-04 Check-out flow

```
Step A (after scan, action chosen)            Step B (bottom sheet)                    Step C (done)
+-----------------------------+      +-----------------------------+      +-----------------------------+
| <  Check out                |      |  ---                        |      |                             |
| AT-00123 Chromebook 3100    |      |  Check out AT-00123         |      |        (check)              |
| {v Ready}  Room 101         |      |                             |      |   Checked out               |
|                             |      |  To  (o)Person ( )Loc ( )Asset|     |   AT-00123 -> A. Chen       |
| [ + Scan another (bulk) ]   |      |  [ Search people____ ]      |      |   Due Fri 20 Nov            |
|                             |      |   A. Chen   (recent)        |      |                             |
|                             |      |   J. Okafor (recent)        |      |  [  Undo (8s)  ]            |
|                             |      |  Return by [Fri 20 Nov v]   |      |  [ Scan next   ]  (52pt)    |
|                             |      |  [Today][+1 day][+1 week]   |      |  [ Done        ]            |
|                             |      |  Note [_______]  [Photo +]  |      |                             |
| [   Continue   ]            |      |  [    Check out    ] (52pt) |      |                             |
+-----------------------------+      +-----------------------------+      +-----------------------------+
Idempotency key is created when the sheet opens, so a retry after a network error never double-posts.
Offline/network failure: sheet shows "Couldn't reach the server. Saved, will retry. [Retry now]" (banner MOB-10).
```

### MOB-05 Check-in flow (compact)

```
+-----------------------------+
|  Check in AT-00124          |
|  From J. Okafor             |
|  Condition (o)Good ( )Damaged ( )Needs repair   |
|  Status after [Ready v]  Location [Room 204 v]  |
|  Note [_______]   [Photo +]                     |
|  [        Check in        ]                     |
|  "Needs repair" also offers [Log repair now]    |
+-----------------------------+
```

### MOB-06 Stocktake

```
List of sessions                        Session: continuous scan
+-----------------------------+      +-----------------------------+
| Stocktakes          [+ New] |      | <  Library Q4 audit         |
| In progress                 |      | (62%)  34 of 55 found       |
|  Library Q4 audit    62% >  |      | [Expected 21][Found 34][Missing 0][Unexp. 2] |
|  Room 101 spot check 10% >  |      |-----------------------------|
| Completed                   |      |  [  scanner strip, 1 line ] |
|  Gym Q3 audit      done  >  |      |  Last: AT-00501 {v Found}   |
|                             |      |-----------------------------|
| New stocktake:              |      | Expected, not yet scanned   |
|  Location [Library v]       |      |  AT-00502 iPad 9th gen      |
|  or filter [Chromebooks v]  |      |    [ Found ]  [ Missing ]   |
|  [ Start ]                  |      |  AT-00503 iPad 9th gen      |
+-----------------------------+      |    [ Found ]  [ Missing ]   |
                                     | [ Scan ] [ Finish... ]      |
                                     +-----------------------------+
Unexpected item scanned: sheet "AT-00911 is registered in Gym. [Move to Library] [Ignore] [Flag]".
Finish: variance summary (found, missing, unexpected), [Submit] or [Keep open]. Progress persists if the app is backgrounded.
```

### MOB-07 to MOB-09 (brief)

```
Loaner pool                       Repair log                     Quick create
+-----------------------+  +-----------------------+  +-----------------------+
| Loaner pool           |  | Log repair AT-00125   |  | New asset (unknown tag)|
| Avail 9  Out 7  Over 3|  | Date [today]          |  | Tag AT-00950 (scanned) |
| [Quick check-out]     |  | What happened [_____] |  | Category [Tablet v]    |
| L-03 {c Overdue} D.Park|  | Cost [____]  [Photo +]|  | Model [___ v]          |
|   5 days over  [Check in]| | [      Save       ]   |  | Location [Gym v]       |
| L-02 {u On loan} A.Chen|  +-----------------------+  | [Photo +] [  Create  ] |
| [Bulk check-in: scan] |                              +-----------------------+
+-----------------------+
```

### MOB-10 Offline / retry banner states (online-first, MVP)

```
Offline:    +-------------------------------------------------+
            | [wifi-off] No connection. 2 actions waiting to send.   [Retry now] |
            +-------------------------------------------------+   (warning)
Retrying:   | [refresh] Sending 2 actions...                                      |   (info)
Sent:       | [check] All sent.                                       (auto-dismiss)|   (success)
Failed:     | [alert] 1 action failed: AT-00123 is already checked out. [View] [Discard]| (danger)
Queue sheet: lists queued actions with timestamp, [Retry] / [Discard] per item.
MVP = retry queue for network errors; full offline-first with "unsynced items" and conflict handling is v2.
```

---

## 4. Navigation map

```
Web:   Login -> (Onboarding first run) -> Assets (list) <-> Asset detail (tabs) -> Check-out/in dialog
                                       -> Create/edit asset     -> Label print
                                       -> Loaner pool, Repairs, Stocktake, Import wizard
                                       -> Settings: Org, Users, Categories, Models, Custom fields, Status labels, Locations
Mobile: Server connect -> Login -> Scan (home) -> Asset quick view -> Check-out/in sheet | Transfer | Photo | Repair
                                 -> Assets (search) | Loaner pool | Stocktake | Me (profile, server, sign out)
```

## 5. Open questions for design review

1. Row click: open the drawer (current) or navigate to the full page? Drawer favours scanning many assets; full page favours deep work. Proposal: drawer by default, `Enter` opens full page.
2. Should the global scan field live in the header on every page (current) or only on list/checkout screens?
3. Mobile home: Scan (current) versus a dashboard with a scan button. Proposal: Scan, because P5 says mobile-first scanning.
4. Loaner pool: is it a first-class sidebar item (current) or a saved view of Assets with a "pool" flag? Plan 5.3 says no new entity, so it is a flag and a purpose-built view.
5. Custom status colours: locked to state type colours for contrast safety in MVP.
