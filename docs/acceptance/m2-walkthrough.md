# M2 founder acceptance walk-through

Backlog story **M2-UX-01** ([docs/05_backlog.md](../05_backlog.md)). You follow this checklist on your own machine at
http://localhost:3001, signed in as the demo users, and mark every step **OK** or **Not OK** with a note.

- **45 steps**, grouped by area; plan for two to three hours without the hardware steps. Steps marked 👤 **needs hardware / real data** need
  your label printer and scanner, or your own files.
- Written for **version 0.2.7** (`main` at `d1f826c`) and updated for **version 0.2.8**, which closed the gaps the first
  preparation run found (steps 2, 4, 5, 13, 18, 38, 39 and 44 test the new screens; see "Notes from the preparation run" at the end),
  and for **version 0.2.9**, which fixed what the automated run of this checklist found (steps 6, 12, 17, 20, 24, 27, 28, 39,
  40, 41, 43 and exit item 8 changed; see "Notes from the automated run" at the end), and for **version 0.2.10**, the
  import polish before your real-file trial (steps 25, 28, 38, 39 and exit item 8; see "Changes in 0.2.10" at the end).
- **Status (2026-11-27): deferred until you have the hardware (USB scanner, label stock, printer) and your real files.**
  All M2 features are built and released (0.2.10), and every step without hardware was run through the UI by the
  automated runs. Only your five steps remain: **17** (USB scanner), **19** (print on real label stock and scan), **28**
  (your own files, the 30-minute target, M2-IMP-09), **37** on a real second device (phone or tablet), and the
  **wrap-up**.
  Every step was checked against a fresh stack of the build it was written for; where the real app does not do what the
  backlog says, the step says `(known issue: ...)`.
- Do the steps **in order**: later steps use what earlier ones made (for example the laptop `LAP00004`, the person Bjorn
  Haugen, the location "Walkthrough annex").
- Words in **bold** are labels on the screen, exactly as written there.

## Before you start

### The demo users

Every demo user has the password `Demo-Passw0rd-2026`.

| Sign in as                | Role in this walk-through                                | Second step                                                                           |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `admin@acme.example`      | Asset manager: the day-to-day user (most steps)          | none                                                                                  |
| `owner@acme.example`      | Administrator: Settings, Users and roles, access changes | 6-digit code from an authenticator app. Setup key: `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| `technician@acme.example` | Technician (steps 33 to 35)                              | none                                                                                  |
| `admin@globex.example`    | The second organisation (step 15)                        | none                                                                                  |

A code works once; if it is refused, wait about 30 seconds for the next one. Use a private (incognito) window when a step asks you
to be a second user at the same time.

### Get a fresh demo stack

All commands are run in a terminal (PowerShell or Git Bash) in `E:\Sayak\asset_tracker`, with **Docker Desktop running**.

```powershell
cd E:\Sayak\asset_tracker
docker compose down -v          # DELIBERATE RESET ONLY: see the warning below
docker compose up -d --build    # starts everything; the "migrate" service seeds the demo data (Acme and Globex)
curl.exe http://localhost:3000/readyz      # repeat until it shows "status":"ready"
docker compose ps               # "clamav" must say (healthy) before file uploads are scanned
```

> **Warning: `docker compose down -v` deletes the database, every uploaded file and the virus-scanner signatures of this
> stack.** Use it only when you mean to reset to the demo data. Plain `docker compose down` (or `docker compose stop`) keeps
> everything. After a reset, ClamAV downloads its signatures again, which needs internet and can take several minutes: until
> `docker compose ps` shows `clamav ... (healthy)`, uploads stay "pending" (step 14).

If you would rather keep the virus-scanner signatures, reset only the data: `docker compose down`, then
`docker volume rm assettracker_pgdata assettracker_miniodata` (check the names with `docker volume ls` first), then
`docker compose up -d --build`.

If you do not reset, the steps still work, but the numbers on screen (and which assets are "Ready") will differ from what
is written here. A reset is recommended. A reset also removes anything you imported earlier.

The numbers written in this checklist are those of a fresh demo stack: 197 assets, 41 ready, 113 assigned, 19 not deployable, 5 overdue
check-outs, and "days late" counted from the day the stack was created.

### Rebuild the web app and restart serve-static

Needed after a `git pull`, or when a step is "fixed" and you want to retry it.

```powershell
cd E:\Sayak\asset_tracker
pnpm install                                            # after a git pull
docker compose up -d --build                            # after a git pull: rebuilds api, worker, scheduler
pnpm turbo run build --filter=@assettracker/web         # always through turbo, never plain "pnpm --filter ... build"
# stop the old web server first (Ctrl+C in the window that runs it), then:
node apps/web/scripts/serve-static.mjs apps/web/out --port=3001 --proxy=http://localhost:3000
```

Open http://localhost:3001.

### Where is Mailpit

All e-mail the app sends (invitations, "Your labels are ready", overdue loans) lands in **Mailpit**, a mail catcher:
**http://localhost:8025**. Nothing leaves your machine.

### Files you will need

| File                                                                                  | Used in          |
| ------------------------------------------------------------------------------------- | ---------------- |
| `E:\Sayak\asset_tracker\docs\guides\tools\samples\chromeos-export.csv` (Google Admin) | steps 25, 39     |
| `E:\Sayak\asset_tracker\docs\guides\tools\samples\school-devices.csv` (spreadsheet)   | steps 26, 27, 38 |
| Any small picture (PNG or JPG) and any small CSV or PDF                               | steps 8, 10, 14  |
| `E:\Sayak\import-samples\` (your own anonymised files, you create the folder)         | step 28 👤       |

These two sample files are already in your copy of the repository; there is nothing to download. In a browser's file window, paste the
full path above into the **File name** box.

## How to report

1. Work through the steps. Tick **one** box on each step's last line: `- [x] OK` or `- [x] Not OK`. For a Not OK, write what you
   saw instead after `note:`; a screenshot path or the text of the red message helps.
2. Mark a step you could not do as Not OK with the reason (for example "no label printer").
3. When you are done, **send this file back** (`docs/acceptance/m2-walkthrough.md`) or paste only the lines that say **Not OK**
   together with their step headings. Add the wrap-up at the end (speed ratings, change requests).

---

## 1. The new dashboard

### Step 1. Dashboard: tiles, charts, overdue table

- **Sign in as:** `admin@acme.example`
- **Where:** after sign-in you land on **Dashboard** (sidebar, top).
- **Do:**
  1. Read the five tiles across the top.
  2. Read the two panels under them.
  3. Scroll to **Needs attention**.
  4. Click the **Ready** tile, look at the asset list, then press the browser's Back button.
- **You should see:**
  - Heading **Dashboard**, "What needs attention across your assets."
  - Tiles **All assets** (197), **Ready** (41, "21% of all"), **Assigned** (113), **Not deployable** (19) and **Overdue check-outs** (5, "4% of assigned").
  - **Assets by status**: a ring with 197 in the middle and a legend Ready, Checked out, Pending, Not deployable, Lost, Archived.
  - **Utilisation**: a meter "73% IN USE", "113 of 154 usable assets", and three bars Ready to deploy, Check-outs on time, Not deployable.
  - **Needs attention**: a table **Overdue check-outs** (columns Asset, Holder, Due back, Status; "Every checked-out asset past its return date, loans included.") with a link **Overdue loans only**, then **Low stock** (HDMI cable 2 m, Toner cyan (HP 410X)) and **Open repairs** (12).
  - The **Ready** tile opens **Assets** already filtered to State **Ready**, with a **Clear all filters** button.

- [ ] OK - [ ] Not OK — note: ____

### Step 2. Theme menu

- **Sign in as:** `admin@acme.example` (still signed in)
- **Where:** the **Theme** button in the top bar (sun, moon or screen icon, right of the bell). It is the only theme control; the sidebar has none.
- **Do:** open **Theme**, choose **Dark**, look at the Dashboard; open it again, choose **Light**; reload the page (F5); open it and choose **Use system setting**.
- **You should see:** the whole app, including the charts and tiles, turns dark, then light. After the reload the choice is still **Light**. **Use system setting**
  follows your Windows setting. Text stays readable and the teal accent colour is used in both.

- [ ] OK - [ ] Not OK — note: ____

## 2. Locations and departments

### Step 3. Locations: the tree, add, edit

- **Sign in as:** `admin@acme.example`
- **Where:** sidebar **Locations**.
- **Do:**
  1. Click **Bergen campus**.
  2. Press **Add inside**. Name: `Walkthrough annex`. Type: **Building**. Press **Add location**.
  3. With the new location selected, press **Edit**. Change the Name to `Walkthrough annex (renamed)`. Press **Save**.
  4. Use the keyboard on the tree: arrow keys, Right and Left open and close, Enter selects.
- **You should see:**
  - Two sites, **Bergen campus** and **Oslo HQ**, each with an asset count (68 and 129).
  - Bergen campus shows Type **Site**, Code **BGO**, Sublocations **Library** and **Science block**, and **Assets here (68)** with a **View in asset list** link.
  - The new location appears as **Bergen campus > Walkthrough annex** with Type **Building**; after Edit the new name shows in the tree and in its heading.

- [ ] OK - [ ] Not OK — note: ____

### Step 4. Move a location, move an asset, move several assets

- **Sign in as:** `admin@acme.example`
- **Where:** **Locations**, then **Assets**.
- **Do:**
  1. Select **Walkthrough annex (renamed)**, press **Move**, type `Oslo` in **New parent**, choose **Oslo HQ (OSL)**, press **Move**. (Open Oslo HQ with the Right arrow if you cannot see it.)
  2. Go to **Assets**, search `LAP00048`, open it, press **Edit**. In **Location** type `Walkthrough annex` and choose **Walkthrough annex (renamed)**. Press **Save**.
  3. Open the asset's **History** tab, then go back to **Locations** and select the annex.
  4. Move several at once: in **Assets** search `LAP0004`, tick **LAP00042** and **LAP00047** (LAP00047 is checked out: a move is allowed anyway, the location is where it is). In the bar under the table press **Edit**. **Field**
     **Location**; in **New value** type `Walkthrough annex` and choose **Walkthrough annex (renamed)**; **Note for the history** `Walk-through bulk move`.
     Press **Apply to 2 assets**.
- **You should see:**
  - After the move the location reads **Oslo HQ > Walkthrough annex (renamed)** ("Everything inside it moves along with it").
  - The asset's History has **Location changed**, "Moved from ... to Walkthrough annex (renamed)".
  - The annex shows **Assets here (1)** with LAP00048; after the bulk move **Assets here (3)** with LAP00042, LAP00047 and LAP00048.
  - The bulk edit says "Done: 2 assets updated."; LAP00042's History has its own **Location changed** entry with the note.
  - The **Field** list of the bulk edit has Status, Category, Supplier, Department and **Location**; with Location there is also
    **No location (whereabouts unknown)** (a user limited to a site, step 34, sees only the places of that site and no "no location").

- [ ] OK - [ ] Not OK — note: ____

### Step 5. Departments

- **Sign in as:** `admin@acme.example`
- **Where:** sidebar **Settings**, then **Departments** in the Settings list.
- **First, the Settings landing page:** Settings opens on **Organisation**: **About** with the organisation's name **Acme**, the
  plan and the **Currency**, then **Check-out defaults** (the same two numbers as on the loaner pools page) and **Files and photos**
  (**Largest upload (MB)**, "Uploads up to ... are accepted now", and **Remove location and camera data (EXIF) from uploaded photos**).
  Change nothing there. As the Asset manager you can save the two forms; the name and currency cannot be changed on screen.
- **Do:**
  1. Read the list. Press **Add department**, Name `Walkthrough homeroom`, press **Add department**.
  2. Press **Edit Walkthrough homeroom**, rename it `Walkthrough homeroom 8A`, press **Save**.
  3. Press **Archive Library**, confirm **Archive**. Read the message, then press **Cancel**.
  4. Press **Archive Walkthrough homeroom 8A** and confirm **Archive**.
- **You should see:**
  - Six departments (Administration, Facilities, IT, Library, Mathematics, Science) with Code, Manager, People and Assets counts.
  - The new department in the list, then renamed.
  - For Library: **Library is still in use**, "Still in use by 2 people, 20 assets. Move them to another department to archive this one.", a **Move them to** picker and the button
    **Merge and archive**. Nothing is archived when you press Cancel.
  - The unused department archives straight away and disappears (**Show archived** brings it back).
  - On **People** and **Assets** there is a **Department** filter.

- [ ] OK - [ ] Not OK — note: ____

## 3. People and logins

### Step 6. People

- **Sign in as:** `admin@acme.example`
- **Where:** sidebar **People**.
- **Do:**
  1. Press **Add person**. Name `Walkthrough Student`, **Kind** Student, **Employee or student number** `S-9001`, **Department** Science. Press **Add person**.
  2. Open **Alice Johansen** (search `Alice`). Click the tabs **Assets held** and **History**.
- **You should see:**
  - The list has columns Name, E-mail, Kind, Department, Number, Home location, Login, Status; most demo people say **No login**, the four demo users say **Can sign in** and have the grey badge **Login's own record**.
  - The new student appears. Alice's page shows **Login: No login**, without a **Link to a login** button: only Administrators may link a person to a login (you do it as `owner@acme.example` in step 7). **Assets held** lists her laptops (one **Overdue**), **History** lists what happened.

- [ ] OK - [ ] Not OK — note: ____

### Step 7. Logins: invite, Pending badge, link a person

- **Sign in as:** `owner@acme.example` (password, then the 6-digit code)
- **Where:** **Settings**, **Users and roles**.
- **Do:**
  1. Press **Invite user**. Name `Bjorn Haugen`, Email `bjorn.h@acme.example`, Role **Viewer**, Access **Whole organisation**. Press **Send invitation**.
  2. Look at the list, then open Mailpit (http://localhost:8025).
  3. Go to **People**, open **Bjorn Haugen** (the one with `bjorn.haugen@acme.example`), press **Link to a login**. In **Login account** type `Bjorn` and choose the entry marked "(pending invitation)". Read the blue sentence, press **Link login**.
- **You should see:**
  - **Users** goes from 4 to 5 and **Pending invitations** shows 1; Bjorn's row has Status **Pending** and Person "None".
  - In Mailpit: a mail "You are invited to join Acme on Asset Tracker" to `bjorn.h@acme.example`.
  - The picker shows "Bjorn Haugen / bjorn.h@acme.example - Viewer - (pending invitation)". The blue sentence says Bjorn "will sign in as bjorn.h@acme.example. The empty person record the login came with is archived. Everything Bjorn Haugen holds, and the whole history, stays as it is."
  - The person page now says **Can sign in**, **Has a login account.**, with **Manage users** and **Unlink login**; on Settings, Users the Person column shows Bjorn Haugen.

- [ ] OK - [ ] Not OK — note: ____

## 4. Check-out, check-in, transfer, history

The laptop for steps 8 to 12 is **LAP00004** (EliteBook 840 G10 (Lab), Ready to deploy).

### Step 8. Check out with a due date, a note and a photo

- **Sign in as:** `admin@acme.example`
- **Where:** **Assets**, search `LAP00004`, open it.
- **Do:**
  1. Press **Check out**. Dialog **Check out LAP00004**: **Check out to** Person; type `Alice` in **Person** and choose Alice Johansen.
  2. **Expected return**: press **In a week**. **Notes**: `Walk-through check-out`.
  3. **Add photo**: choose any small PNG or JPG; wait until it says **Ready**.
  4. Press **Check out**. Do **not** press Undo.
- **You should see:**
  - The toast "LAP00004 checked out to Alice Johansen." with "You can undo this for 10 seconds." and **Undo**.
  - The asset shows **Deployed**, **Assigned to Alice Johansen**, **Due back** a week from today, and the buttons **Check in** and **Transfer**.
  - Other choices in the dialog: **Check out to** Location or Asset, and shortcuts **Tomorrow**, **In a month**, **No date**.

- [ ] OK - [ ] Not OK — note: ____

### Step 9. Transfer

- **Sign in as:** `admin@acme.example`
- **Where:** the same asset, LAP00004.
- **Do:** press **Transfer**. The dialog says **From Alice Johansen**. Under **Transfer to** (Person) choose **Bjorn Haugen** (`bjorn.haugen@acme.example`). **Notes**: `Walk-through transfer`. Press **Transfer**.
- **You should see:** **Assigned to Bjorn Haugen**. The status stays **Deployed**. The toast offers **Undo**.

- [ ] OK - [ ] Not OK — note: ____

### Step 10. Check in with condition and photo

- **Sign in as:** `admin@acme.example`
- **Where:** LAP00004.
- **Do:** press **Check in**. **Condition**: **Fair**. Leave **Status after check-in** at "Default (ready)". **Notes**: `Scratch on the lid`. Add a photo. Press **Check in**.
- **You should see:** the toast "LAP00004 checked in." The asset is **Ready to deploy** again with a **Check out** button. The condition list offers Not recorded, Good, Fair, Poor, Damaged.
  **Status after check-in** offers Ready to deploy, Pending, In repair, Broken, and **Location now** can be set.

- [ ] OK - [ ] Not OK — note: ____

### Step 11. Undo

- **Sign in as:** `admin@acme.example`
- **Where:** LAP00004.
- **Do:** check LAP00004 out to Alice Johansen again (Check out, choose Alice, Check out). Within 10 seconds press **Undo** in the **newest** toast (an older check-in toast may still be on screen).
- **You should see:** the asset is back to **Ready to deploy**, not assigned. Its **History** has a new entry **Custody undone** "Undid check-out (Alice Johansen)" above the check-out: undo adds an entry, it does not delete history.
  After 10 seconds the Undo link disappears.

- [ ] OK - [ ] Not OK — note: ____

### Step 12. Chain-of-custody history

- **Sign in as:** `admin@acme.example`
- **Where:** LAP00004, tab **History**; then **People**, Bjorn Haugen, tab **History**.
- **Do:** read both timelines. Filter **Show** is on **All events**.
- **You should see:** on the asset, newest first: **Custody undone**, **Checked out**, **Checked in** ("Checked in from Bjorn Haugen", "Condition: Fair", "Status: Deployed → Ready to deploy", "1 photo",
  “Scratch on the lid”), **Transferred** ("Alice Johansen → Bjorn Haugen", “Walk-through transfer”), **Checked out** ("Due ...", "1 photo", “Walk-through check-out”),
  **Created**. Every entry you made has "by Demo Asset Manager" and a time; the **Created** entry comes from the demo data and says "by the system". On Bjorn's page the same check-in and transfer appear with the asset tag LAP00004.

- [ ] OK - [ ] Not OK — note: ____

### Step 13. Lost and found, and dispose

- **Sign in as:** `admin@acme.example`
- **Where:** an asset's page (the buttons next to **Edit**), and **Stock**.
- **Do:**
  1. Open `LAP00009`, press **Check out**, check it out to Alice Johansen (as in step 8, no photo needed). Then press
     **Mark as lost or stolen**. Read the window, type `Left on the bus` in **What happened**, press **Mark as lost**.
  2. Press **Mark as found**. In **Where is it now?** type `Library` and choose **Library**; press **Mark as found**. Open **History**.
  3. Open `LAP00053`, press **Dispose**. **Reason** **Recycled**, leave **Date** as today, **Note** `Walk-through disposal`; press **Dispose**.
     Then go to **Assets** and search `LAP00053`; set **Show** to **Archived only**.
  4. The accessory check: in **Stock**, **Accessories**, on **Wireless mouse** press **Check out**, **Check out to** **Asset**, choose
     `LAP00060`, **Quantity** `1`, **Check out**. Open `LAP00060`, press **Dispose**, **Reason** **Scrapped**, press **Dispose**; read the
     message and press **Cancel**. Back on **Wireless mouse**, press **Return** on the LAP00060 row and return the unit.
  5. Open `LAP00060`, press **Edit**, and in **Status** choose **Lost or stolen** (do not save); then choose **Retired**; press **Cancel**.
- **You should see:**
  - The lost window: "It is checked out to Alice Johansen. Marking it lost closes that check-out: Alice Johansen no longer holds it."
    After it: "LAP00009 is marked lost", status **Lost or stolen**, no **Assigned to**, no **Check out**, **Check in** or **Transfer**,
    and a **Mark as found** button (no **Mark as lost or stolen**).
  - After found: "LAP00009 is marked found", **Ready to deploy**, **Check out** is back, and the location is Library. History has
    "Marked lost: Left on the bus" and "Marked found", and the check-out to Alice is closed.
  - The dispose window says the asset will be archived ("... The asset is then archived: it leaves the asset list and the counts.
    Restore brings it back."). After it: "LAP00053 is disposed of and archived", the archived mark, a line
    "Disposed of on <today>: Recycled. Walk-through disposal" and a **Restore** button. The asset is not in **Active assets**; it is listed
    with **Archived only**.
  - For LAP00060 with the mouse on it the dispose is refused inside the window: "1 accessory unit is still checked out to this asset.
    Check it in on the Stock page first." Nothing changes.
  - In the edit form, **Lost or stolen** shows a note "Setting a lost status here does not close a check-out. Use Mark as lost
    or stolen instead: it also ends the check-out." with **Mark as lost instead**; **Retired** shows the same kind of note with
    **Dispose instead**. (Saving the status by hand is still allowed; the note tells you what it does not do.)
  - The bar under the asset list also has **Dispose of N assets** (checked-out assets in the selection are left out, with a message).

- [ ] OK - [ ] Not OK — note: ____

## 5. Files, scan codes and the scan panel

### Step 14. Files and virus scan

- **Sign in as:** `admin@acme.example`
- **Where:** LAP00004, tab **Attachments**.
- **Do:**
  1. Press **Choose files** and pick a small PDF, CSV or picture.
  2. Optional, virus test: create a plain text file called `eicar-test.csv` containing exactly this one line (the harmless industry test string):
     `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*` and upload it. (Windows Security may delete a file with this content as soon as you save it: that is your antivirus working. Then skip this part and say so in the note.)
  3. Look at the bell (top right) and at Mailpit.
- **You should see:**
  - The clean file lists its name, size and **Ready** (it shows "pending" for a few seconds while it is scanned; it stays pending if ClamAV is not healthy: `docker compose ps`).
  - The test file: "A virus was found in this file (Eicar-Test-Signature), so it was rejected." with status **Rejected**.
  - A bell entry **A file you uploaded was blocked** ("File blocked") and an e-mail with the same subject in Mailpit.
  - The text under the upload box: "Images (JPEG, PNG, WebP, GIF), PDF, Office documents and CSV files, up to 10.5 MB each. Other types are refused."

- [ ] OK - [ ] Not OK — note: ____

### Step 15. QR and scan-code lookup

- **Sign in as:** `admin@acme.example`
- **Where:** the **Scan or type tag** box in the top bar (press `/` to jump into it).
- **Do:**
  1. Type `LAP00004` and press Enter.
  2. Get the asset's label code: open http://localhost:3001/v1/assets?q=LAP00004 in a new tab (you are signed in, so it shows data) and find `"label_code":"..."` (32 characters; Ctrl+F). Open `http://localhost:3001/s/<that code>`.
  3. Open the same `/s/` link in a **private window** (not signed in). Sign in there as `admin@acme.example`.
  4. In the first window open http://localhost:3001/s/NOPE1234ZZ.
  5. In a private window sign in as `admin@globex.example` and open the `/s/<code>` link of step 2.
- **You should see:**
  1. The asset opens. 2. The asset opens (this address is what a printed QR code contains).
  2. The private window shows the **Sign in** page first and reveals nothing about the asset; after signing in the asset opens.
  3. **Asset not found**, "It may have been removed, or you may not have access to it."
  4. The other organisation's user gets the same **Asset not found**: one organisation cannot open the other's label.

- [ ] OK - [ ] Not OK — note: ____

### Step 16. Scan panel and batch mode (typed in, no scanner)

- **Sign in as:** `admin@acme.example`
- **Where:** the scan icon next to the Scan box in the top bar (**Scan assets**).
- **Do:**
  1. In **When I scan** choose **Check out to a person**; in **Check out to** choose Alice Johansen.
  2. Type `LAP00009` Enter, `LAP00014` Enter, `NOSUCHTAG1` Enter.
  3. Change **When I scan** to **Check in**; type `LAP00009` Enter and `LAP00014` Enter. Press **Done**.
- **You should see:** the field keeps focus after each Enter. The list under **Scanned** shows "LAP00014 checked out to Alice Johansen.", "LAP00009 checked out to Alice Johansen." and
  `No asset matches "NOSUCHTAG1". (NOSUCHTAG1)`, then "LAP00014 checked in.", "LAP00009 checked in.". The third mode is **Open each asset**. There is a **Play a sound for each scan** option and **Clear list**.

- [ ] OK - [ ] Not OK — note: ____

### Step 17. 👤 needs hardware / real data: USB barcode scanner

- **Sign in as:** `admin@acme.example`
- **Needs:** a USB (or Bluetooth) keyboard-wedge barcode scanner (M2-TAG-04, LIFE-08, founder task F-02) and printed labels from step 19, or any barcode.
- **Do:**
  1. Click the **Scan or type tag** box (or press `/`). Scan one of your printed Code 128 labels, then at once five more, one after the other, without touching the mouse or the keyboard.
  2. Open **Scan assets**, choose **Check in** and scan five different labels in a row, as fast as you can.
  3. Scan something that is not in the system (a product barcode).
- **You should see:** the tag appears complete (no extra characters, no `'` instead of `-`), Enter is sent by the scanner and the asset opens at once. The cursor stays in the **Scan or type tag** box
  (0.2.9, founder decision: it no longer jumps to **Check in** / **Check out**), so each next label opens the next asset and no scan is lost or cut short, however fast you scan; a screen reader hears "Opened LAP...". The unknown code
  gives a red message `No asset matches "...".`. Write in the note: the scanner model, whether any scan was wrong or slow, and your verdict on speed and error feedback.

- [ ] OK - [ ] Not OK — note: ____

## 6. Label sheets

### Step 18. Label sheet: preview, PDF, start position

- **Sign in as:** `admin@acme.example`
- **Where:** **Assets**.
- **Do:**
  1. Search `LAP0000`, tick the boxes of three rows. The bar under the table shows **Print labels (3)**. Press it.
  2. Read the dialog **Print labels**: **Sheet template**, **Codes on the label** (**QR code**, **Code 128 barcode**), **Text on the label**, **One label**, **Sheet preview**.
  3. In **Sheet preview** click position **4**. Press **Generate PDF**.
  4. When it says **Your labels are ready**, press **Open PDF**, look at the new tab and close it; then press **Download PDF** and open the file.
  5. Open the bell, and one of the three assets' **History**.
- **You should see:**
  - Six templates: US Letter 30-up (Avery 5160 layout), A4 21-up (Avery L7160 layout), A4 24-up 3 x 8 (Avery L7159 layout), US Letter 10-up (Avery 5163 layout) QR and Code128, Single label 50 x 25 mm, Single label 2 x 1 inch for thermal / roll printers. For the first one: "3 x 10 labels of 66.68 x 25.4 mm".
  - The preview of one label at real size ("Actual size. The QR code holds a web address with an opaque code, never the asset id.") and a sheet of 30 numbered positions marked **Already used**, **Gets a label**, **Left empty**; after your click: "First label goes in position 4".
  - "Your labels are ready", "3 labels on 1 sheet. Print at 100% ("Actual size"), not "Fit to page"." The saved PDF has **three** labels, in the **second row** of the sheet (positions 4, 5, 6), each with a QR code, the tag and the name.
  - The bell has **Your labels are ready** (step 23 turns on the e-mail for it). Each asset's History has **Label printed (letter-30up-qr)**.
  - **Open PDF** shows the sheet in a new browser tab (nothing is saved); **Download PDF** saves the file.

- [ ] OK - [ ] Not OK — note: ____

### Step 19. 👤 needs hardware / real data: print on real label stock and scan the labels

- **Sign in as:** `admin@acme.example`
- **Needs:** your label printer and real label sheets (M2-TAG-04, F-02); a phone for the camera test.
- **Do:**
  1. **First, for the phone test:** do step 37 (LAN access) and then make the PDF again. The QR code on a label holds the address from `WEB_BASE_URL`, which is `http://localhost:3001` until you change it; a phone cannot open that.
  2. Generate a PDF for each template that you own sheets for, at the start position that matches a used sheet.
  3. Print a **test page on plain paper at 100 % (Actual size, no "Fit to page")**, hold it against a blank label sheet to the light: do the boxes sit inside the labels? Then print on the real sheet.
  4. Measure: is each label within 1 mm of the sticker's edge (top, left, right, bottom, and last row)?
  5. Scan the printed labels: USB scanner on the Code 128 (step 17), an iPhone camera and an Android camera on the QR code.
- **You should see:** the labels fit the stickers within 1 mm. The QR opens `http://<your address>:3001/s/<code>`, the sign-in page first, then the asset. The Code 128 scans into the **Scan or type tag** box.
  In the note write, per template: brand and article number of the sheet, fits or by how many mm and in which direction it is off (this calibration goes back to Claude), which phones scanned fine.

- [ ] OK - [ ] Not OK — note: ____

## 7. Stock

### Step 20. Accessories

- **Sign in as:** `admin@acme.example`
- **Where:** sidebar **Stock**, tab **Accessories**.
- **Do:**
  1. Look at the list; tick **Low stock only**, then untick it.
  2. On **USB-C cable 1 m** press **Check out**. **Person** Alice Johansen, **Quantity** `3`, press **Check out**.
  3. Open **USB-C cable 1 m**. In **People and places holding this** press **Return** on Alice's row, **Units coming back** `1`, press **Return**.
- **You should see:**
  - Columns Name, Category, Total, Checked out, Available, Stock, Minimum, Location; **HDMI cable 2 m** says **Low stock** ("1 item is low on stock.").
  - The check-out dialog says "74 available." and the quantity field "Up to 74."
  - On the item page after the check-out: Total 80, Checked out 9 (was 6), Available 71, Minimum 15, and Alice's row shows **Quantity 3**; after the return it shows **Returned 1**. The **Return** window says "Alice Johansen holds 3. Return some or all of them." and "Returning fewer leaves the rest checked out."

- [ ] OK - [ ] Not OK — note: ____

### Step 21. Consumables and low stock

- **Sign in as:** `admin@acme.example`
- **Where:** **Stock**, tab **Consumables**.
- **Do:**
  1. On **Toner black (HP 410X)** (9 on hand, minimum 4) press **Use**. **Units used** `6`, press **Use**.
  2. Open the bell. Then open the item and look at **Stock movements**.
  3. Press **Receive**, **Units received** `10`. Press **Save count** and read the dialog (do not save).
- **You should see:**
  - The row now says "3 cartridge" and **Low stock**.
  - Within a few seconds the bell has **Low stock: Toner black (HP 410X)**, "Toner black (HP 410X) is at or below its reorder level. 3 left (minimum 4)." (By default this type is e-mailed as a **Daily summary**, so no instant mail.)
  - **Stock movements** lists Used −6 (balance 3), then after Receive Received +10 (balance 13), above the earlier "Used" and "Opening stock" lines. **Save count** asks for **Counted on hand** and a required **Note**.

- [ ] OK - [ ] Not OK — note: ____

## 8. Repairs

### Step 22. Log a repair, see the status, close it

- **Sign in as:** `admin@acme.example`
- **Where:** sidebar **Repairs**.
- **Do:**
  1. Note the **Open** tab says 12. Press **Log repair**. **Asset**: type `LAP00025`, choose it. **What needs doing**: `Cracked screen, replace`. **Quoted cost**: `120`. Leave **Asset status while it is being repaired** on **In repair**. Press **Log repair**.
  2. The window says **Repair logged**: attach a small file or picture with **Choose files**, then **Done**.
  3. Open LAP00025 and the **Dashboard** (look at **Not deployable** and **Open repairs**).
  4. Back on **Repairs**, click the repair's title. Read the details, then press **Close repair**: **Final cost** `110`, **What was done** `Screen replaced and tested.`, **Asset status when done** stays "Ready to deploy (the status it had before)". Press **Close repair**.
- **You should see:**
  - The repair in the list: Reported today, Asset LAP00025, Kind Repair, Cost $120.00, Status **Open**; the tabs read Open 13.
  - LAP00025 is **In repair** (not deployable: no **Check out** button); the Dashboard's **Not deployable** and **Open repairs** are each one higher.
  - The details drawer has **Start work**, **Cancel repair**, **Close repair**. After closing: the toast **Repair closed.**, LAP00025 is **Ready to deploy**, the counts are back down.

- [ ] OK - [ ] Not OK — note: ____

## 9. Notifications and preferences

### Step 23. The bell, preferences and e-mail

- **Sign in as:** `admin@acme.example`
- **Where:** the bell (top right); the **User menu** (top right) then **Notification settings**.
- **Do:**
  1. Open the bell. Press **Unread** and **All**; press **Mark as read** on one entry, then **Mark all as read**.
  2. In **Notification settings** find **Labels ready**; in its **By e-mail** list choose **Right away**; press **Save changes**.
  3. Make a label PDF again (Assets, tick two rows, **Print labels (2)**, **Generate PDF**). Open Mailpit.
  4. Optional, as `owner@acme.example`: **Settings**, **Notification rules**.
- **You should see:**
  - The bell lists notifications such as **Low stock**, **Your labels are ready**, **File blocked**, **Loan overdue** ("Overdue: CHR-00001 Chromebook 01") with **View**; after Mark all as read the red unread count is gone.
  - **Notification settings** lists ten types (File blocked by the virus scan, Asset assigned to you, Export ready, Low stock, Low accessory stock, Labels could not be rendered, Labels ready, Loan overdue, Loan due soon, Import finished), each with **In the bell** (checkbox) and **By e-mail** (**Right away**, **Daily summary**, **Off**).
  - In Mailpit a new e-mail **Your labels are ready** to `admin@acme.example`.
  - The owner's **Notification rules** lets an administrator switch a type off for everybody.

- [ ] OK - [ ] Not OK — note: ____

## 10. Saved views and CSV export

### Step 24. Saved view and CSV export

- **Sign in as:** `admin@acme.example`
- **Where:** **Assets**.
- **Do:**
  1. Open the dashboard tile **Ready**, press **Save view**. **View name** `Ready devices (walkthrough)`. Press **Save view**.
  2. Press **Clear all filters**, then choose your view in the **View** list. Look at the buttons next to it, and press **Rename or share** (then **Cancel**).
  3. Press **Export CSV**. Wait. Press **Download CSV** and open the file.
- **You should see:**
  - After **Save view** the **View** list shows your view. **Clear all filters** sets it back to **All assets** (all assets listed); choosing your view again restores the filter (State Ready, the Ready count, and a **Clear all filters** button). If you change a filter by hand while a view is chosen, the list shows "Ready devices (walkthrough) (changed)", and choosing the view again restores it. Buttons **Update view**, **Rename or share** (with "Share with everyone in the organisation"), **Delete view**.
  - The dialog **Export to CSV** ("Exports every row the current search and filters show."), then **Your file is ready**, "N rows exported. The download link works until ..." (tomorrow), **Download CSV**. The file starts with `asset_tag,name,serial,category,model,status,location,department,assigned_to,expected_return,...,label_code,...`
    and has one line per row the list showed (plus the header). Its `label_code` column is the code that is in the QR codes.

- [ ] OK - [ ] Not OK — note: ____

## 11. Import

### Step 25. Import from Google Admin (the sample file in the repo)

- **Sign in as:** `admin@acme.example`
- **The sample file:** `E:\Sayak\asset_tracker\docs\guides\tools\samples\chromeos-export.csv` (10 Chromebooks, made for this). It is in your repository checkout: nothing to download. A bigger one (48 devices, used by the tests) is
  `E:\Sayak\asset_tracker\apps\api\test\importer\fixtures\google-admin-chromeos-sample.csv`; on the demo data 4 of its rows fail because their tags already exist: use it for a dry run only.
- **Where:** **Assets**, **Import** (top right).
- **Do:**
  1. Choose **Google Admin ChromeOS**, read the blue text, press **Continue**.
  2. **Choose a file** and select the sample. Read the column screen. Press **Continue** (if a **Match values** screen appears, press **Run the dry run**).
  3. Read the dry run, then press **Import 10 rows**.
  4. Press **View assets** and search `GA-10`. Look at **Settings**, **Departments**.
  5. Optional: run the same import again and read the dry run; leave without pressing Import (**All imports**).
- **You should see:**
  - The blue text lists what is created (the Chromebook category and fields, statuses: Active and Provisioned map to your ready label, Disabled and Deprovisioned to Retired; the org unit becomes the department).
  - "We matched 11 of your columns." and **Fixed values**: "Category = Chromebook". Serial number, Asset ID (to **Asset tag**), Status, Model and **User** (to **Assigned to**) are matched for you.
  - Dry run: "Preview. Nothing has been saved yet." **10 Will create, 0 Will update, 0 Skipped, 0 Errors**, and "Records the import would create on the way" (4 models; departments **Students / Grade 8**, **Students / Grade 9**, **Spare pool**, **Staff**, **Retired**).
  - **Import finished**, "Your data is in the register.", **10 Created**. GA-1001 to GA-1010 are listed; GA-1001 is **Deployed** to Gustav Eriksen, GA-1007 and GA-1010 are **Retired**; the new departments are under Settings, Departments.
  - Second run: **0 Will create, 0 Will update, 10 Skipped**, "Nothing to change; left as it is.", and a blue note
    **Nothing to change: every row matches what is already there.** (0.2.10; before, an amber "No row can be imported").

- [ ] OK - [ ] Not OK — note: ____

### Step 26. Spreadsheet import: dry run

- **Sign in as:** `admin@acme.example`
- **The file:** `E:\Sayak\asset_tracker\docs\guides\tools\samples\school-devices.csv` (10 tablets; row 6 has a cost "about 389", row 8 has no category, row 9 repeats a tag: deliberate mistakes).
- **Where:** **Assets**, **Import**.
- **Do:**
  1. Choose **Assets**, press **Continue**. (**Download the Assets template (CSV)** is on this screen: it saves `assets-template.csv`.)
  2. **Choose a file** and select `school-devices.csv`. Read **Match your columns** and **Duplicates and settings**. Press **Continue**.
  3. On **Match values** the statuses **Good** and **Needs repair** say "Not found: its rows will be errors". For **What to do with "Good"** choose **Use an existing one** and **Existing record for "Good"** **Ready to deploy**; for "Needs repair" choose **In repair**.
  4. Press **Run the dry run**. Read the result. Press **Download error report** and open the CSV.
- **You should see:**
  - "We matched 10 of your columns."; **Tag** to **Asset tag** (Suggested), **Type** to **Category (required)**, **Model** (Exact) and so on; "Recognise existing assets by: Tag, else serial number", "When the record exists already: Leave it as it is".
  - **Match values**: the location **Room 205** says "Will be created".
  - "Preview. Nothing has been saved yet." Tiles **7 Will create, 0 Will update, 1 Skipped, 2 Errors**. **Why rows were rejected**: "1 row: a number cannot be read (purchase_cost)", "1 row: a required value is missing (category)", "1 row: a value is not valid (model)".
  - Rows: 6 TAB-106 **Error** `Purchase cost "about 389" is not a number`; 8 TAB-108 **Error** "The row has no category ..."; 9 TAB-103 **Skip** "Same tag or serial number as row 3 of the file; skipped."
  - The error report starts `Row,Line,Fields,Problems,Warnings,Tag,Device,...` and holds exactly the two rejected rows, your own columns unchanged.
  - Nothing is in the asset list yet (search `TAB-10`: no results).

- [ ] OK - [ ] Not OK — note: ____

### Step 27. Spreadsheet import: commit, results, error report

- **Sign in as:** `admin@acme.example`
- **Where:** the dry-run screen of step 26.
- **Do:** press **Import 7 rows**. When **Import finished** shows, press **Download error report** again, then **Print labels for the new assets** (look at the window, then close it), then **View assets**. Look at the bell and at **Locations**.
- **You should see:**
  - A progress bar ("Imported x of y rows"; ten rows can finish before you see it), then **Import finished** with **7 Created, 0 Updated, 1 Skipped, 2 Failed**, "2 rows could not be imported. Download the error report, fix them and import them again.", a table **Rows that could not be imported** (6 TAB-106, 8 TAB-108), and the buttons **View assets**, **Print labels for the new assets**, **Start another import**.
  - **Print labels for the new assets** opens the **Print labels** window for exactly the assets this import created: "7 assets match the current filter" (0.2.9; before, it opened the plain asset list).
  - The seven created assets TAB-101, TAB-102, TAB-103, TAB-104, TAB-105, TAB-107 and TAB-110 are in the asset list (TAB-106 and TAB-108 failed; TAB-105 shows **In repair**, with the hint "No repair is logged for this asset ..."). **Room 205** is a new top-level location with 2 assets.
  - The bell has **Import finished**, and Mailpit an e-mail **Import finished**.
  - **All imports** (or **Settings**, **Imports**) lists both imports as **Done**, with **View**. (The details of a finished import are kept for 30 days: download the report you need before then.)

- [ ] OK - [ ] Not OK — note: ____

### Step 28. 👤 needs hardware / real data: your own files, and the 30-minute target (IMP-09)

- **Sign in as:** `admin@acme.example`
- **Needs:** two files of yours in **`E:\Sayak\import-samples\`** (create the folder): (1) a spreadsheet of your real assets, **anonymised** (no real names, e-mail addresses or serial numbers you must not share), as `.xlsx`, `.csv` or Excel's **Unicode Text (.txt)** (0.2.10: `.txt` and `.tsv` are taken as they are, no renaming); (2) a real **Google Admin ChromeOS export** (Google Admin, Devices, Chrome, Devices, Export), also anonymised. Do this step last, or on a fresh stack, so the demo data does not get in the way.
- **Do:**
  1. Start a stopwatch the moment you choose the first file. Import the spreadsheet through the wizard (**Assets**, **Import**): match columns, match values, dry run, fix or accept errors, **Import**.
  2. Import the Google Admin export the same way. People in its **User** column must exist first (see guide 2): on **Match values** a user that is not in **People** says "Not found: its rows will be errors", and the dry run makes those rows errors. Choose **Leave it empty** for such a value to import the device without an assignee.
  3. On **Import finished** press **Print labels for the new assets**: the **Print labels** window opens for exactly the assets that import created. Generate the PDF. **Stop the stopwatch when the PDF with the labels of 100 assets is ready** (printing and sticking are not part of the clock).
  4. Write down: the number of rows in each file; minutes to the first dry run; minutes to the PDF; every row error and what caused it; every column that was matched wrongly; anything you did not understand.
- **You should see:** both imports finish, the dry runs show problems in words you can act on, and the **time from choosing the file to a PDF of 100 labels is 30 minutes or less** (the M2 target). If the time is longer, say where it went (waiting for the screen, fixing the file, mapping).
  Since 0.2.9 (from the substitute run with `E:\Sayak\import-samples\`): **Match values** shows a name that exists but would still fail as **Needs a decision** with the reason (a bare room name such as "Lab 1" when the file also has "Main Building / Lab 1", or a model that exists under another category), so it is not skipped; a "TOTAL ITEMS: 120" line at the end of a sheet is **Skipped** as "A summary line"; with "Tag, else serial number" a new tag whose serial number another asset has is an **Error** ("Serial number ... is already used by ..."); "Bought From", "Date of Purchase", "Tag No." and "Item" are suggested as Vendor, Purchase date, Asset tag and Name; and **Why rows were rejected** says "a value is too long or too large (name)", not "too_big (name)".
  Since 0.2.10 (ED-40): prices such as `Rs.44000/-`, `Rs 44,000/-`, `INR 44000` and `₹1,14,900.00` are read as numbers in INR;
  **Needs a decision** says how many rows will be errors and, for a model, in which category ("3 rows in category Network will be
  errors"), and a long reason stays in its column (two lines, **Show the whole reason** for the rest); a Google row whose tag another
  asset has says "Asset tag CHR-00001 is already used by another asset."; and a second import of an unchanged file says **Nothing to
  change: every row matches what is already there.** in a blue note.
  Defects become stories; the time is recorded as the baseline for the target (M2-IMP-09).

- [ ] OK - [ ] Not OK — note: ____

## 12. Loaners

### Step 29. Loaner pools and the overview

- **Sign in as:** `admin@acme.example`
- **Where:** sidebar **Loaners**.
- **Do:** read the **Overview** tab. Open the **Pools** tab and click **Chromebook cart**. Press **Edit** on the Pools tab and read the fields (then **Cancel**).
- **You should see:**
  - Overview: **All pools together**: **In pools** 10, **Available** 5, **On loan** 5, **Overdue loans** 2; a card **Chromebook cart** ("10 devices") with **Due today** 1; a table **Overdue loans** (CHR-00001, Gustav Eriksen, 6 days late; CHR-00002, Hanna Solberg, 2 days late, each with **Extend**) and **Recent activity**.
  - Pools: **Loan defaults** ("Return date offered at check-out (days from today)", "Remind the borrower (days before the due date)", **Save defaults**) and the pool row (Home location Bergen campus > Science block > Lab 1, Default loan 7 days, Longest loan 21 days, Per borrower 2, 10 devices, Active).
  - The pool page lists each device with its **State** (Available, On loan, Overdue, Due today) and filter buttons, and has **Lend a device**, **Add device**, **Edit pool**, **Archive pool**.
  - The edit window has **Default loan length (days)**, **Longest loan (days)**, **Devices per borrower**, **Who may borrow**, **Owner**, **E-mail borrowers who have no login** and **Lend devices from this pool**.

- [ ] OK - [ ] Not OK — note: ____

### Step 30. The loaner desk: lend devices by typing or scanning

- **Sign in as:** `admin@acme.example`
- **Where:** **Loaners**, **Loaner desk**.
- **Do:**
  1. **Lend from** is **Chromebook cart**. In **Device** type `CHR-00008`, Enter. In **Borrower** type `S-2011`, Enter.
  2. Read the **Due date** line. Press **Lend 1 device**.
  3. Then try the limit: add `CHR-00006` and `CHR-00007`, find borrower `S-2008` (Ivar Moen, who already holds one), press **Lend 2 devices**.
- **You should see:**
  - The borrower card "Lise Bakke, lise.bakke@acme.example - S-2011"; "The pool lends for 7 days. The latest date the pool allows is ..." and "Lend 1 device to Lise Bakke, due ...". The green message "CHR-00008 lent to Lise Bakke, due ...", and the line under **This session**.
  - The third try lends one and refuses the other: "1 of 2 devices lent to Ivar Moen. 1 could not be lent: see the list." with "CHR-00007: Ivar Moen already holds the most devices this pool allows." (the pool allows 2 per borrower).
  - To lend five devices, repeat the first part for five different students.

- [ ] OK - [ ] Not OK — note: ____

### Step 31. "Lend next available device", and refusal of a broken device

- **Sign in as:** `admin@acme.example`
- **Where:** the desk, after step 30.
- **Do:**
  1. Open `CHR-00010` in **Assets**, **Edit**, **Status** **Broken**, **Save**.
  2. On the desk type `CHR-00010` in **Device**, Enter.
  3. Find borrower `S-2011` (Lise Bakke). Press **Lend next available device** (the device list stays empty).
- **You should see:**
  - Refusal: "CHR-00010 is Broken and cannot be lent. Choose another device." (the same for **In repair** and **Retired**).
  - "CHR-00007 is the next available device: lent to Lise Bakke, due ... Hand over CHR-00007." with the tag shown large: the pool picked the device idle the longest (never lent first, then the lowest tag).
    If nothing is free the desk says "No device of this pool is free."

- [ ] OK - [ ] Not OK — note: ____

### Step 32. Overdue loans, extend, bulk return

- **Sign in as:** `admin@acme.example`
- **Where:** **Loaners**, **Dashboard**, the bell, Mailpit.
- **Do:**
  1. Read **Overdue loans** on the Loaners overview, then the **Dashboard**'s **Overdue check-outs** table. Open the bell and Mailpit.
  2. On **Loaners** press **Extend** next to CHR-00002. **New due date**: a date a week away, **Reason** `Walk-through`. Press **Extend loan**.
  3. Press **Bulk return** and type `CHR-00001`, Enter.
- **You should see:**
  - The two overdue loans of the demo data (these exist from the start, because the stack's scheduler marks them; a loan that becomes overdue later is flagged the same way once a day, UTC). The Dashboard says "Every checked-out asset past its return date, loans included" and counts more than the 2 loans (it also counts overdue laptops).
  - In the bell **Overdue: CHR-00001 Chromebook 01** ("... is 6 day(s) overdue. Borrower: Gustav Eriksen.", "Loan overdue") and the same e-mail in Mailpit, to `admin@acme.example` (the pool's owner).
  - After Extend the overview says "Nothing is overdue" once CHR-00001 is back too. "Extend the loan of CHR-00002", "Now due Nov 24, 2026. The new date must be later and within what the pool allows."
  - Bulk return: "CHR-00001 returned, 6 days late.", "1 device returned"; the device goes back to the pool's home location (Lab 1) and is **Available**.

- [ ] OK - [ ] Not OK — note: ____

## 13. Roles limited to a location

### Step 33. Add access limited to a site

- **Sign in as:** `owner@acme.example`
- **Where:** **Settings**, **Users and roles**.
- **Do:**
  1. In the row of **Demo Technician** press **Actions for Demo Technician**, **Change role and access**.
  2. Press **Add access**. **Role** **Technician**, **Access** **Limited to a location**, **Location** **Bergen campus (BGO)**. Press **Add access**.
  3. Press **Remove** next to **Technician · Whole organisation**, read the question, press **Remove**. Press **Close**.
- **You should see:**
  - First the window **Role and access of Demo Technician** with **Technician · Whole organisation** and the message "This is the only access of the user. Add another first, or deactivate the user instead."; Remove is greyed out. The window warns "A role limited to a location never includes managing users, roles, the catalogue, departments or notification rules. Changing access signs the user out of every device."
  - After adding: **Technician at Bergen campus** is listed too; under the Location list "The role applies to this location and everything inside it."
  - The question "Remove this access? Demo Technician will no longer have Technician. They are signed out of every device and sign in again with the access that remains." After it, only **Technician at Bergen campus** is left; the Users list shows Role **Technician** _at Bergen campus_.

- [ ] OK - [ ] Not OK — note: ____

### Step 34. Sign in as the limited user: only that site is visible

- **Sign in as:** `technician@acme.example` (in a private window; the owner can stay signed in elsewhere)
- **Where:** the whole app.
- **Do:** look at the top bar and the Dashboard. Open **Assets**, **Locations** and **People**. Type `LAP00004` (an Oslo asset) into **Scan or type tag**, Enter. Search `LAP00004` in **Assets**.
- **You should see:**
  - A chip **Scoped to: Bergen campus** in the top bar. No **Settings** in the sidebar.
  - **Locations** has only **Bergen campus** (about 73 assets), no Oslo HQ. The Dashboard numbers are smaller (about 73 assets, all other tiles smaller than yours too). **Assets** says "Showing 1-50 of 73"; every row's location starts with "Bergen campus".
  - The Oslo asset is not found: a red message `No asset matches "LAP00004".` and in Assets "No assets match" (the app does not say that it exists).

- [ ] OK - [ ] Not OK — note: ____

### Step 35. Remove access (give the whole-organisation access back)

- **Sign in as:** `owner@acme.example`
- **Where:** **Settings**, **Users and roles**, **Actions for Demo Technician**, **Change role and access**.
- **Do:** press **Add access**, **Role** **Technician**, **Access** **Whole organisation**, **Add access**. Then press **Remove** next to **Technician at Bergen campus** (not the other line) and confirm **Remove**.
- **You should see:** the window lists only **Technician · Whole organisation** again (Remove greyed out, "This is the only access of the user ..."), and the Users list shows Role **Technician** without "at Bergen campus". The technician's next sign-in has no **Scoped to** chip and sees all of Acme.

- [ ] OK - [ ] Not OK — note: ____

### Step 36. The guard that refuses removing the last administrator

- **Sign in as:** `owner@acme.example`
- **Where:** **Settings**, **Users and roles**, **Actions for Acme Owner**, **Change role and access**.
- **Do:**
  1. Read the window: the owner has only **Administrator · Whole organisation**.
  2. Press **Add access**, **Role** **Viewer**, **Access** **Whole organisation**, **Add access**.
  3. Press **Remove** next to **Administrator · Whole organisation**, then **Remove** in the question.
  4. Press **Cancel**. Then **Remove** the **Viewer · Whole organisation** line again (tidy up) and **Close**.
- **You should see:** at first **Remove** is greyed out with "This is the only access of the user. Add another first, or deactivate the user instead." After adding Viewer, removing Administrator is **refused** with the red message "The last active administrator cannot be removed, demoted, disabled or archived." (and a Request ID). Administrator is still listed: nothing changed.

- [ ] OK - [ ] Not OK — note: ____

## 14. LAN access from a second device

### Step 37. Open the app from a second device

Your machine's address is **192.168.1.101**. Without these settings you can open the page from another device but **sign-in does not stick**: the session cookie is `Secure`, and a browser keeps such a cookie over plain HTTP only on `localhost`. (Development only; the API refuses to start with this in production.)

- **Sign in as:** `admin@acme.example` on the second device (phone, tablet or laptop on the same network).
- **Do:**
  1. Open (or create) `E:\Sayak\asset_tracker\.env` and add these lines (the first two are the ones from `docs/getting-started.md`; the third lets photos and PDFs open from the other device). If `.env` already has a line for one of these names, change that line instead of adding a second:

     ```
     SESSION_COOKIE_SECURE=false
     WEB_BASE_URL=http://192.168.1.101:3001
     S3_PUBLIC_ENDPOINT=http://192.168.1.101:9000
     ```

  2. In `E:\Sayak\asset_tracker` run `docker compose up -d` (recreates api, worker and scheduler; no rebuild). Check the API log: `docker compose logs api` shows a warning "SESSION_COOKIE_SECURE=false: the session cookie is "at_session" WITHOUT the Secure flag ...".
  3. Make sure the website is served (`node apps/web/scripts/serve-static.mjs apps/web/out --port=3001 --proxy=http://localhost:3000`; it listens on every network address).
  4. Open **PowerShell as administrator** and allow the ports for the **Private** network profile:

     ```powershell
     New-NetFirewallRule -DisplayName "Asset Tracker web (dev)" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
     New-NetFirewallRule -DisplayName "Asset Tracker files (dev)" -Direction Inbound -Protocol TCP -LocalPort 9000 -Action Allow -Profile Private
     ```

     If Windows classes the network as Public, change it to Private (Settings, Network) or add `Public` to `-Profile`.

  5. On the second device open `http://192.168.1.101:3001`, sign in as `admin@acme.example`, open an asset and upload a picture in **Attachments**.
  6. When you are done, remove the rules and the three `.env` lines, then run `docker compose up -d` again:
     `Remove-NetFirewallRule -DisplayName "Asset Tracker web (dev)"` and `Remove-NetFirewallRule -DisplayName "Asset Tracker files (dev)"`.
- **You should see:** before step 1, sign-in on the second device returns to the sign-in page. After it, sign-in works, the Dashboard shows, and the upload ends as **Ready**.
  `http://localhost:3001` keeps working on your machine (sign in again once, an old cookie is not read). Invitation and reset mails now link to `192.168.1.101:3001`, and labels made from now on carry QR codes with that address (step 19).

- [ ] OK - [ ] Not OK — note: ____

## 15. Review of the eight user guides

Guides are in `E:\Sayak\asset_tracker\docs\guides\` (start with `README.md`, the index). For each: **read the whole guide**, try the one task named, and mark
Not OK for any sentence that is unclear, any button or label that is not on the screen as written, a step that does not work, or a missing warning. Quote the sentence in the note.

### Step 38. Guide 1: Import your spreadsheet (CSV or Excel)

- **Read:** `01-import-your-spreadsheet.md`. **Sign in as:** `admin@acme.example`.
- **Try one task:** in **Assets**, **Import**, **Assets**, press **Download the Assets template (CSV)**, open it, and use **What the template contains**. Then upload `school-devices.csv` again to the column screen, type a name under **Saved mappings** and press **Save this mapping**; leave the wizard without importing.
- **You should see:** `assets-template.csv` with the columns Asset tag, Name, Serial number, Category, Manufacturer, Model, Status, Location, Department, Vendor, Assigned to, ... and an example row. After saving, the mapping is offered under **Saved mappings** ("Choose a saved mapping", **Use this mapping**).
  Also check the guide's error report example against step 27: row 8 names the fields `category, model`. And "Before you start"
  lists the Excel save formats that work (**Excel Workbook (.xlsx)**, the two **CSV** formats and **Unicode Text (.txt)**) and the
  price notations it reads (0.2.10); the upload box says ".txt or .tsv, such as Excel's "Unicode text"".

- [ ] OK - [ ] Not OK — note: ____

### Step 39. Guide 2: Import from Google Admin (ChromeOS)

- **Read:** `02-import-from-google-admin.md`. **Sign in as:** `admin@acme.example`.
- **Try one task:** guide step 7, "Next term: import again": run the import of step 25 again and read the dry run; then look at **Settings**, **Departments**.
- **You should see:** every device **Skipped** ("Nothing to change; left as it is.") with the blue note **Nothing to change: every row matches what is already there.** (0.2.10), and the departments created from the org units (**Students / Grade 8**, **Students / Grade 9**, **Spare pool**, **Staff**, **Retired**). Also compare the guide's "Who can do this" sentence with what you saw: it says an Administrator or an Asset manager can run the first import, and the import worked for the Asset manager.
  And the guide's "Create the people first": a **User** that is not in **People** makes that row an error. **Match values** says so for each such address ("Not found: its rows will be errors") and the dry run lists those rows under **Errors** with "No person named ..." (0.2.9, ED-34; before, they were imported without an assignee).

- [ ] OK - [ ] Not OK — note: ____

### Step 40. Guide 3: Print and apply labels

- **Read:** `03-print-and-apply-labels.md`. **Sign in as:** `admin@acme.example`.
- **Try one task:** guide step 1: open one asset and press **Print labels**; compare the window with the guide; choose **Single label 50 x 25 mm, QR (one per page)** and read the line under it. Cancel. (The test print and sticking are step 19.)
- **You should see:** the window **Print label for LAP00004** with "1 selected asset", the same six templates as the guide's table (with their full names, such as "Single label 2 x 1 inch for thermal / roll printers, QR and Code128"), and for the single-label template the line "One label per page (50 x 25 mm)".

- [ ] OK - [ ] Not OK — note: ____

### Step 41. Guide 4: Run a loaner day

- **Read:** `04-run-a-loaner-day.md`. **Sign in as:** `admin@acme.example`.
- **Try one task:** guide "Part 1, step 2": **Loaners**, **Pools**, **Edit** on the cart (or **New pool**) and compare every field with the guide; **Cancel**. Compare "Reminders" and the e-mail table with the **E-mail borrowers who have no login** list.
- **You should see:** the fields **Name**, **Description**, **Home location**, **Default loan length (days)**, **Longest loan (days)**, **Devices per borrower**, **Who may borrow** (Employees, Students, Contractors, External people), **Owner**, **E-mail borrowers who have no login**
  (Automatic: employees, contractors and external people, not students / Always, students too / Never), **Lend devices from this pool**, and **Save changes** (**Create pool** for a new one).
  The guide's "Reminders" sends each person to the **User menu** (their name, top right), **Notification settings**.

- [ ] OK - [ ] Not OK — note: ____

### Step 42. Guide 5: Log a repair

- **Read:** `05-log-a-repair.md`. **Sign in as:** `admin@acme.example`.
- **Try one task:** guide step 4: log a repair on `LAP00075` (see step 22), open it, press **Start work**, then **Cancel repair** and confirm.
- **You should see:** status **In progress** with a Started date; the question "Cancel this repair? Nothing was fixed: the repair is closed as cancelled and the asset returns to the status it had before."; LAP00075 is **Ready to deploy** again.

- [ ] OK - [ ] Not OK — note: ____

### Step 43. Guide 6: Limit a user to a site

- **Read:** `06-limit-a-user-to-a-site.md`. **Sign in as:** `owner@acme.example`.
- **Try one task:** you did the task in steps 33 to 36. Compare the guide line by line with what you saw: the button **Actions for Demo Technician**, the menu entry **Change role and access**, the window titles, the toasts "Access added for Demo Technician." / "Access removed from Demo Technician.", the chip **Scoped to: Bergen campus**, and the sections "Records with no location are hidden" and "A site administrator".
- **You should see:** the same words as the guide; mark Not OK for every difference. The window lists the accesses oldest first: after you add the limited access (step 33) it shows "Technician · Whole organisation" first and "Technician at Bergen campus" below it, so the guide's "Remove next to the old access" is the first **Remove**. (In step 35, after the whole-organisation access was added back, the Bergen line is the older one and comes first.)

- [ ] OK - [ ] Not OK — note: ____

### Step 44. Guide 7: People and logins

- **Read:** `07-people-and-logins.md`. **Sign in as:** `owner@acme.example`.
- **Try one task:** guide "Unlink": **People**, **Bjorn Haugen**, press **Unlink login**, read the window, press **Unlink**. Then link him again from the other side: **Settings**, **Users and roles**, **Actions for Bjorn Haugen**, **Link to a person**.
- **You should see:** "Unlink Bjorn Haugen from their login? Bjorn Haugen keeps everything they hold and their history, but is no longer the person behind bjorn.h@acme.example. The login account gets a new, empty person record. Nobody is signed out and nothing is deleted." Afterwards the person says **No login**, and the message says "Bjorn Haugen keeps their assets and history. The login bjorn.h@acme.example now has its own empty record." with **Open the new record**.
  Press **Open the new record**: a second "Bjorn Haugen" with the grey badge **Login's own record**, no **Unlink login** button, and the sentence "This is the automatic record of the login bjorn.h@acme.example; there is nothing to unlink. ..." (0.2.8, ED-33: before, unlinking that record again made one more empty record each time). In **People** the two Bjorn Haugen rows are told apart by that badge.
  From the other side, the **Actions** menu of the login has **Link to a person**: it offers only people without a login ("Bjorn Haugen / bjorn.haugen@acme.example - IT - E-1001") and repeats the same blue sentence; after **Link login** the Person column shows Bjorn Haugen again.

- [ ] OK - [ ] Not OK — note: ____

### Step 45. Guide 8: Schools (K-12): students, homerooms and carts

- **Read:** `08-schools-k12-mapping.md`. **Sign in as:** `admin@acme.example`.
- **Try one task:** guide step 2 and step 6: the student `Walkthrough Student` (number `S-9001`, department Science) you made in step 6: open the **Loaners** desk and type `S-9001` in **Borrower**. Also read the "What goes where" table against your own school's words.
- **You should see:** the desk finds "Walkthrough Student, S-9001". (Lending then works for kinds the pool allows: the cart's **Who may borrow** is empty, so everyone.) Decide whether the table (student ID = Employee or student number, homeroom = Department, device number = Asset tag, cart = loaner pool) matches how your school talks.

- [ ] OK - [ ] Not OK — note: ____

---

## Exit criteria

The eight items of the M2 exit criteria in the backlog (docs/05_backlog.md, Milestone M2), and the steps that cover them.

| #   | Backlog exit criterion                                                                                                    | Steps                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Import a real spreadsheet and a real Google Admin CSV through the wizard; review the dry run and the error report; commit | 25, 26, 27, **28 👤** (real files)                           |
| 2   | Build a location tree (site > building > room) and move assets between locations                                          | 3, 4                                                         |
| 3   | Check a laptop out, transfer it, check it in with a photo; see the full chain-of-custody timeline                         | 8, 9, 10, 12 (and 11, undo)                                  |
| 4   | PDF label sheet with QR and Code128; print on real stock; resolve a label with a USB scanner and with a phone camera      | 18, **19 👤**, 15, 16, **17 👤**                             |
| 5   | A loaner day: quick check-out of loaner Chromebooks with default due dates, one overdue with an alert, bulk check-in      | 29, 30, 31, 32                                               |
| 6   | A repair record with cost and attachment, which sets "in repair", and closing it                                          | 22                                                           |
| 7   | Accessories checked out, consumables used, with a low-stock alert                                                         | 20, 21                                                       |
| 8   | The isolation suite (direct and pooled) still passes with every new table and route                                       | automated, see below; visible spot checks in steps 15 and 34 |

Item 8 is not a click-through. Run it (Git Bash, in `E:\Sayak\asset_tracker`, stack running) or check the `api-e2e` job of the latest CI run.
Run the API suite only (`pnpm --filter @assettracker/api test:e2e`; a plain `pnpm test:e2e` also builds and runs the web
app's Playwright suite and stops at its first failure). Set the mail, file-storage and virus-scan variables as well: without
them the 5 tests of `test/platform-services.e2e.test.ts` (and the mail block and the S3 / ClamAV variants of `test/files`)
skip and "0 skipped" cannot be met.

```bash
export MIGRATOR_DATABASE_URL=postgres://app_owner:dev@localhost:5433/app
export ADMIN_DATABASE_URL=postgres://postgres:dev@localhost:5433/app
export SMTP_URL=smtp://localhost:1025 MAILPIT_API_URL=http://localhost:8025
export S3_ENDPOINT=http://localhost:9000 CLAMD_HOST=localhost CLAMD_PORT=3310
ISOLATION_MODE=direct DATABASE_URL=postgres://app_user:dev@localhost:5433/app pnpm --filter @assettracker/api test:e2e
ISOLATION_MODE=pooled DATABASE_URL=postgres://app_user:dev@localhost:6432/app POOLED_ONE_URL=postgres://app_user:dev@localhost:6432/app_one pnpm --filter @assettracker/api test:e2e
```

Each run ends with a line such as `Tests  803 passed (803)` (0.2.10): the item passes with 0 failed and 0 skipped in both modes.

Mark item 8 here: - [ ] Passes (0 skipped) - [ ] Fails — note: ____

## Wrap-up (M2-UX-01)

- Import speed, rated against "100 labelled assets in 30 minutes" (step 28): ____ minutes. - [ ] Good enough - [ ] Too slow, because: ____
- Check-out speed (steps 8 to 11 and the desk, steps 30 to 32): - [ ] Good enough - [ ] Too slow, because: ____
- Change requests (each becomes a story): ____
- Overall: - [ ] M2 accepted - [ ] M2 accepted after the Not OK steps are fixed - [ ] Not accepted

## Notes from the preparation run

Findings while clicking through every step on a fresh stack of version 0.2.7, and what version 0.2.8 did about them.

- **Lost, found and dispose had no screens** (step 13): fixed in 0.2.8. The asset page has **Mark as lost or stolen**, **Mark as found**
  and **Dispose**; the asset list has **Dispose of N assets**. A status picked by hand in the form is still allowed, with a note that
  points at the right action (ED-32).
- **Bulk move had no screen** (step 4): fixed in 0.2.8. Bulk **Edit** has **Location**.
- **Settings opened on a placeholder** (step 5): fixed in 0.2.8. **Organisation** shows the organisation and the settings the API
  has (check-out defaults, files and photos). The name and currency are shown, not edited: there is no way to change them yet.
- **Small differences between guides, docs and screen:** fixed in 0.2.8. Guide 1 names `category, model` for row 8; guide 2 says an
  Asset manager can run the first Google import; `docs/getting-started.md` says **Use** and **Save count** for consumables and
  **User menu**, **Notification settings**; **Open PDF** on the label window shows the PDF instead of saving it.
- **Unlinking the automatic record** (found by the founder after the first run): pressing **Unlink login** on the record a login
  got after an unlink made yet another empty record with the same name each time. 0.2.8 refuses it (ED-33): such a record has the
  badge **Login's own record** and no Unlink button, and the unlink message says where the login went (step 44). Archive the empty
  duplicates the earlier clicks left behind.
- **Theme switch:** 0.2.8 removed the System / Light / Dark switch from the bottom of the sidebar; the **Theme** button in the top
  bar is the only theme control (step 2).

## Notes from the automated run

An automated run of this checklist (a real browser driven step by step on a fresh demo stack of 0.2.8, 2026-11-26; step 28 with
the substitute files in `E:\Sayak\import-samples\`) marked 33 steps OK and 12 Not OK. Version 0.2.9 fixed the app bugs it found and
this checklist where the checklist was wrong:

- **App, fixed in 0.2.9:** a saved view chosen again after **Clear all filters** did nothing (step 24); **Print labels for the new
  assets** opened the plain list (steps 27, 28; ED-38); "too_big (name)" in **Why rows were rejected** (step 28); an unknown
  **User** was imported without an assignee although **Match values** and guide 2 said "error" (steps 28, 39; ED-34); **Match values**
  said "Matches Lab 1" or "Matches UniFi U6 Pro" for rows the dry run then rejected (step 28; ED-37); a new tag with a serial number
  another asset has made a second asset with that serial (step 28; ED-35, founder decision: error the row); "Bought From" was
  suggested as the purchase date (step 28); a "TOTAL ITEMS" line was an error with a misleading reason (step 28; ED-36); after a scan
  the cursor left the scan box for **Check in** / **Check out** (step 17; founder decision: stay in the scan box).
- **Checklist and guides, corrected in 0.2.9:** step 6 (**Link to a login** is for Administrators; the Kind column and the badge),
  step 12 (the seeded **Created** entry is "by the system"), step 20 (the Category column), step 27 (the created tags), step 40 and
  guide 3 (the thermal template's full name), step 41 and guide 4 (**User menu**, **Notification settings**), step 43 and guide 6
  (accesses are listed oldest first), exit item 8 (the API suite only, with every variable set).

## Changes in 0.2.10

The import polish before your real-file trial (ED-40), from the "seen, not changed" list of the automated run and the import
corpus. Nothing else in the checklist changed.

- **Unicode text files** (M2-IMP-10): the upload box takes `.csv`, `.txt`, `.tsv` and `.xlsx`; Excel's **Unicode Text (.txt)** is
  imported under its own name (steps 28, 38).
- **Rupee prices**: `Rs.44000/-`, `Rs 44,000/-`, `INR 44000` and `₹1,14,900.00` are numbers in INR (step 28).
- **Tags that another asset has**: the row says "Asset tag CHR-00001 is already used by another asset." instead of "is already in
  use" (steps 25, 28).
- **Match values**: **Needs a decision** says how many rows will be errors and, for a model, in which category; a long reason
  stays in its column, two lines with **Show the whole reason** (step 28).
- **A re-import where nothing changed**: a blue **Nothing to change: every row matches what is already there.** instead of the
  amber "No row can be imported" (steps 25, 39).
