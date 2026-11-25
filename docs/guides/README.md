# User guides (drafts)

Step-by-step guides for the people who set up and run the Asset Tracker in a school or a small organisation: IT staff and
office administrators. No technical knowledge is assumed. Each guide has the same parts: **Before you start**, numbered
**Steps** with screenshots, **If something goes wrong**, and links to related guides.

These are **drafts** (backlog story M2-DOC-01). They describe the web app as of **version 0.2.6 plus the unreleased changes
of wave 3 part 2** (add and remove access, the ED-29 fixes) and use the real button and label texts. The screenshots come from the demo data and are made by a script, so they can be remade after the
screens change: see [`tools/README.md`](tools/README.md).

## The guides

| #   | Guide                                                                      | You will learn how to                                                                                                        |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Import your spreadsheet (CSV or Excel)](01-import-your-spreadsheet.md)    | bring a device list in: templates, matching columns, the dry run, fixing errors, the error report, how long details are kept |
| 2   | [Import from Google Admin (ChromeOS)](02-import-from-google-admin.md)      | export Chromebooks from Google Admin and import them, with the columns matched for you                                       |
| 3   | [Print and apply labels](03-print-and-apply-labels.md)                     | pick a label sheet, choose where to start, make the PDF, test print, stick the labels on                                     |
| 4   | [Run a loaner day](04-run-a-loaner-day.md)                                 | set up a pool, lend and take back devices by scanning, read the dashboard, understand the reminders                          |
| 5   | [Log a repair](05-log-a-repair.md)                                         | log and close a repair, and how it keeps a device from being lent                                                            |
| 6   | [Limit a user to a site](06-limit-a-user-to-a-site.md)                     | give a role for one site only, what that person sees, and how to undo it                                                     |
| 7   | [People and logins](07-people-and-logins.md)                               | tell People from Users, link and unlink a person and a login                                                                 |
| 8   | [Schools (K-12): students, homerooms and carts](08-schools-k12-mapping.md) | map student IDs, homerooms and device and cart numbers onto the tracker                                                      |

A good order for a school that starts from nothing: 8 (decide what goes where), 1 and 2 (bring the data in), 3 (labels),
4 (carts), then 5, 6 and 7 as they come up.

## Good to know

- **Roles.** The built-in roles are Administrator, Asset manager, Technician, Auditor and Viewer. Each guide says who can
  do what it describes. In the demo data, `admin@acme.example` is an Asset manager and `owner@acme.example` an
  Administrator.
- **Words.** "Asset" is any device or item you track. A "person" is somebody who can hold assets; a "user" is somebody who
  signs in (see guide 7). A "pool" is a set of loaner devices.
- **Drafts.** A guide that needs a screen that is still changing says so at the top. Tell us where a guide is unclear or
  wrong.

Developers: the technical reference is in [`../engineering/developer-guide.md`](../engineering/developer-guide.md), the
feature list in [`../FEATURES.md`](../FEATURES.md), and how to run the whole thing in
[`../getting-started.md`](../getting-started.md).
