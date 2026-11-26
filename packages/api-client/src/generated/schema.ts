/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: docs/engineering/openapi.yaml. Regenerate with
 * `pnpm --filter @assettracker/api-client generate`; CI fails when this file is stale.
 */

export interface paths {
    "/v1/accessories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List accessories
         * @description Cursor-paginated list.
         *
         *     Requires permission `accessory:read`.
         */
        get: operations["listAccessories"];
        put?: never;
        /**
         * Create accessory
         * @description Requires permission `accessory:manage`.
         */
        post: operations["createAccessory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accessories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get accessory
         * @description Requires permission `accessory:read`.
         */
        get: operations["getAccessory"];
        put?: never;
        post?: never;
        /**
         * Archive accessory
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `accessory:manage`.
         */
        delete: operations["archiveAccessory"];
        options?: never;
        head?: never;
        /**
         * Update accessory
         * @description Requires permission `accessory:manage`.
         */
        patch: operations["updateAccessory"];
        trace?: never;
    };
    "/v1/accessories/{id}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Who holds this accessory
         * @description Newest first. Each row carries `quantity`, `quantity_returned` and `target_name`.
         *
         *     Requires permission `accessory:read`.
         */
        get: operations["listAccessoryAssignments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accessories/{id}/checkin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Return accessory units
         * @description Returns `quantity` units (default: everything still outstanding) of an open assignment. A partial return increases `quantity_returned` on the same assignment, which stays open; the return that completes it sets `checked_in_at`. The returned units are available again immediately. Returning more than the outstanding units is rejected with 422.
         *
         *     Requires permission `accessory:checkout`.
         */
        post: operations["checkinAccessory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/accessories/{id}/checkout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check out accessory units
         * @description Hands `quantity` units (default 1) to a person, a location or an asset: one assignment row with `quantity` and `quantity_returned = 0`. Fails with 409 `insufficient-stock` if the quantity exceeds what is available (`qty_total` minus the units still outstanding on open assignments); concurrent check-outs are serialised on the accessory, so the stock is never exceeded. The person must be active, the location and target asset live. Writes an audit record and the outbox event `accessory.checked_out` in the same transaction; when the check-out brings `qty_available` to or below `min_qty` the outbox event `accessory.low_stock` is emitted once per crossing.
         *
         *     Requires permission `accessory:checkout`.
         */
        post: operations["checkoutAccessory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List API keys
         * @description Requires permission `apikey:manage`.
         */
        get: operations["listApiKeys"];
        put?: never;
        /**
         * Create an API key
         * @description The secret is returned **once** in this response. Scopes must be a subset of the caller's own permissions.
         *
         *     Requires permission `apikey:manage`.
         */
        post: operations["createApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/api-keys/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke an API key
         * @description Immediately revokes the key (removes it from the pre-auth lookup).
         *
         *     Requires permission `apikey:manage`.
         */
        delete: operations["revokeApiKey"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List and search assets
         * @description The main registry query. `q` searches tag, serial and name (trigram); `tag` / `serial` are exact. Soft-deleted assets are excluded unless `archived` says otherwise.
         *
         *     [M2-REG-03, ED-22] `sort` also takes `location` (the full location path, `HQ > Floor 2 > Room 4`, case-insensitive), `assignee` (the name of whoever holds the asset: person, location or asset tag, case-insensitive) and `due` (the expected return date of the open custody). For these three keys an asset with no value (no location, not checked out, no expected return) is listed **last in both directions**, ordered by `id` among themselves, so a page boundary never splits or repeats rows. The other keys keep sorting an empty value as the smallest. Cursors are bound to the sort: a cursor of another sort is 400 `invalid-cursor`.
         *
         *     Requires permission `asset:read`.
         */
        get: operations["listAssets"];
        put?: never;
        /**
         * Create an asset
         * @description Writes the asset, a `created` history event, an audit record and an outbox event in one transaction. `custom_data` is validated against the category's custom field definitions.
         *
         *     Requires permission `asset:create`.
         */
        post: operations["createAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an asset
         * @description Requires permission `asset:read`.
         */
        get: operations["getAsset"];
        put?: never;
        post?: never;
        /**
         * Archive an asset
         * @description Soft delete. Rejected with 409 while the asset is checked out or has an open repair. Disposal/retirement is a status change, not a delete.
         *
         *     Requires permission `asset:delete`.
         */
        delete: operations["archiveAsset"];
        options?: never;
        head?: never;
        /**
         * Update an asset
         * @description Merge semantics. Status and location changes are recorded as history events. Custody changes must use check-out / check-in / transfer, not this endpoint.
         *
         *     Requires permission `asset:update`.
         */
        patch: operations["updateAsset"];
        trace?: never;
    };
    "/v1/assets/{id}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Assignment history of an asset
         * @description Every custody period of the asset, newest first.
         *
         *     Requires permission `asset:read`.
         */
        get: operations["listAssetAssignments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/checkin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check in an asset
         * @description Closes the open custody period (409 `asset-not-checked-out` if none) and optionally moves the asset and sets a new status.
         *
         *     Requires permission `asset:checkin`.
         */
        post: operations["checkinAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/checkout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check out an asset
         * @description Opens a custody period to a person, a location or another asset. The asset must be in a `deployable` state and not already checked out (409 `asset-already-checked-out`). Sets the status to the tenant's deployed label and writes history, audit and outbox rows atomically.
         *
         *     Requires permission `asset:checkout`.
         */
        post: operations["checkoutAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/clone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Clone an asset
         * @description Creates `count` copies of the asset with fresh tags (the numbering template, or the explicit `asset_tags`) and a cleared serial. `copy_fields` chooses what is copied (default: all of `name`, `model_id`, `status_id`, `vendor_id`, `location_id`, `parent_asset_id`, `purchase_date`, `purchase_cost`, `order_number`, `warranty_end`, `notes`, `custom_data`). All or nothing: one transaction, one audit record and outbox event per copy.
         *
         *     Added by M1-REG-09 (not part of the first contract draft).
         *
         *     Requires permission `asset:create`.
         */
        post: operations["cloneAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/dispose": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dispose of an asset
         * @description Retires the asset for good: sets an `archived`-type status, records the reason, the date and the note (`Asset.disposal`), and archives the asset so it leaves default lists and active counts. Not allowed while the asset is checked out (`409 asset-already-checked-out`: check it in first) or already archived. Writes an `archived` history event, an audit record and an outbox event. `POST /v1/assets/{id}/restore` takes a disposed asset back (the disposal record is cleared and the status returns to the tenant default).
         *
         *     Requires permission `asset:delete`.
         */
        post: operations["disposeAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Chain of custody and lifecycle events
         * @description Newest first. Includes custody changes, status/location changes, repairs and imports.
         *
         *     Requires permission `asset:read`.
         */
        get: operations["listAssetHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/mark-found": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark a lost asset found
         * @description Returns a lost asset to a `deployable` status (and optionally a location). `409 conflict` when the asset is not lost. Writes a `status_changed` history event.
         *
         *     Requires permission `asset:update`.
         */
        post: operations["markAssetFound"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/mark-lost": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark an asset lost or stolen
         * @description Moves the asset to a `lost`-type status. An open custody period is closed (its `checkin_note` says the asset was lost). A lost asset cannot be checked out. Not allowed when the asset is already lost or archived. Writes a `status_changed` history event.
         *
         *     Requires permission `asset:update`.
         */
        post: operations["markAssetLost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move an asset to a location
         * @description Changes `location_id` and writes a `location_changed` history event with the note, an audit record and an outbox event. Allowed while the asset is checked out (the location is where it physically is). Archived assets cannot be moved. `If-Match` is optional; with it a stale version is `412`.
         *
         *     Requires permission `asset:update`.
         */
        post: operations["moveAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/repair-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Repair totals of an asset
         * @description Counts and the total recorded cost per currency of the asset's repair and maintenance records (cancelled and archived records excluded).
         *
         *     Requires permission `repair:read`.
         */
        get: operations["getAssetRepairSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restore an archived asset
         * @description Requires permission `asset:delete`.
         */
        post: operations["restoreAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Transfer an asset to a new holder
         * @description Atomically closes the current assignment (if any) and opens a new one, and records a `Transfer`. User to user, user to location and location to user all work; an asset in stock (no open assignment) is handed out like a check-out and needs a `deployable` state. If either half fails the whole transfer rolls back: the asset is never left unassigned. One audit record and one `transferred` history event. The new holder must differ from the current one (422).
         *
         *     Requires permission `asset:transfer`.
         */
        post: operations["transferAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/{id}/undo-custody": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Undo the last custody action of an asset
         * @description Reverses the **last** check-out, check-in or transfer of the asset as an inverse action, in one transaction, never as a delete: a check-out is undone by closing its period and restoring the previous status; a check-in by re-opening custody for the same holder (a NEW assignment: a closed period is never re-opened) and restoring the previous status and location; a transfer by moving the asset back to the previous holder (or, for a transfer out of stock, like a check-out). The original event, assignment and audit row stay; the undo adds a `custody_undone` history event, an audit row `asset.custody_undone` and a new version of the asset.
         *
         *     Guards: `If-Match` is required and must be the ETag the action answered with (412 when the asset changed in any way since); `assignment_id` must belong to the newest history event of the asset (409 `undo-asset-changed` otherwise, 409 `undo-not-possible` when that event is already an undo); the action is at most five minutes old (409 `undo-expired`); the caller needs the permission of the action it reverses (`asset:checkout`, `asset:checkin` or `asset:transfer`; 403 otherwise); and the previous holder and status must still be valid (409 `undo-not-possible`, for example the person was deactivated meanwhile). Loaner custody is not undone here. Requires an `Idempotency-Key`: a retry replays the stored answer.
         *
         *     Requires permission `asset:checkout`.
         */
        post: operations["undoAssetCustody"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/bulk-archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Archive many assets
         * @description Soft-deletes the listed assets (same rules as `DELETE /v1/assets/{id}`).
         *
         *     At most 100 ids per request. The response is `200` with one result per id, in request order (`results[].status` is the status the single-asset operation would have returned, `results[].error` the problem document when it failed); a failing item does not roll back the others. Each item writes its own audit record and outbox event, plus one `bulk_operation` audit record for the request. Idempotent with `Idempotency-Key`.
         *
         *     Added by M1-REG-09 (not part of the first contract draft).
         *
         *     Requires permission `asset:delete`.
         */
        post: operations["bulkArchiveAssets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/bulk-move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move many assets to a location
         * @description Moves every listed asset to `location_id` (same rules as `POST /v1/assets/{id}/move`).
         *
         *     At most 100 ids per request. The response is `200` with one result per id, in request order (`results[].status` is the status the single-asset operation would have returned, `results[].error` the problem document when it failed); a failing item does not roll back the others. Each item writes its own audit record and outbox event, plus one `bulk_operation` audit record for the request. Idempotent with `Idempotency-Key`.
         *
         *     Added by M1-REG-09 (not part of the first contract draft).
         *
         *     Requires permission `asset:update`.
         */
        post: operations["bulkMoveAssets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/bulk-restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restore many assets
         * @description Restores the listed archived assets.
         *
         *     At most 100 ids per request. The response is `200` with one result per id, in request order (`results[].status` is the status the single-asset operation would have returned, `results[].error` the problem document when it failed); a failing item does not roll back the others. Each item writes its own audit record and outbox event, plus one `bulk_operation` audit record for the request. Idempotent with `Idempotency-Key`.
         *
         *     Added by M1-REG-09 (not part of the first contract draft).
         *
         *     Requires permission `asset:delete`.
         */
        post: operations["bulkRestoreAssets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/assets/bulk-update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Edit many assets
         * @description Applies the same `changes` (status, category, model, vendor, department, `custom_data` merge) to every listed asset.
         *
         *     At most 100 ids per request. The response is `200` with one result per id, in request order (`results[].status` is the status the single-asset operation would have returned, `results[].error` the problem document when it failed); a failing item does not roll back the others. Each item writes its own audit record and outbox event, plus one `bulk_operation` audit record for the request. Idempotent with `Idempotency-Key`.
         *
         *     Added by M1-REG-09 (not part of the first contract draft).
         *
         *     Requires permission `asset:update`.
         */
        post: operations["bulkUpdateAssets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List attachments of a record
         * @description Requires permission `attachment:read`.
         */
        get: operations["listAttachments"];
        put?: never;
        /**
         * Start an upload
         * @description Creates the metadata row (`scan_status=pending`) and returns a presigned PUT URL with size and content-type conditions and a tenant-prefixed key. After the PUT, call `POST /v1/attachments/{id}/complete`.
         *
         *     The declared `content_type` must be on the allow-list (JPEG, PNG, WebP, GIF, PDF, Office documents, ODF, CSV; never SVG or HTML) and match the file name extension; the size must be within the organisation's cap. The owner (`entity_type` + `entity_id`) must exist in your organisation (`422` otherwise, also for an owner type that is not available yet). To attach photos to a record that does not exist yet (a check-in), upload them against the asset and send their ids with the check-in.
         *
         *     Requires permission `attachment:write`.
         */
        post: operations["createAttachment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/attachments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an attachment
         * @description Returns a short-lived `download_url` only when the virus scan has finished clean.
         *
         *     Requires permission `attachment:read`.
         */
        get: operations["getAttachment"];
        put?: never;
        post?: never;
        /**
         * Archive an attachment
         * @description Soft delete. `409` while the attachment is the primary picture of an asset or model (clear it there first).
         *
         *     Requires permission `attachment:write`.
         */
        delete: operations["archiveAttachment"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/attachments/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm an upload
         * @description Verifies the object exists with exactly the declared size, checks that its first bytes are really of the declared type, and queues the virus scan. Idempotent: confirming twice returns the same attachment. A rejected upload (wrong size, content that does not match its type) is archived with `scan_status=error` and its object deleted.
         *
         *     Requires permission `attachment:write`.
         */
        post: operations["completeAttachment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/audit-log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Query the audit log
         * @description Newest first. Retention depends on the plan tier. Responses are also available as CSV with `Accept: text/csv`.
         *
         *     Requires permission `audit:read`.
         */
        get: operations["listAuditLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/invitations/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Look up an invitation
         * @description Shows what an invitation link is for, before the invitee chooses a password. Does not consume the token. Throttled per IP.
         */
        get: operations["getInvitation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept an invitation and set a password
         * @description Consumes the single-use invitation token, activates the account with the chosen password and display name, and signs the user in (cookie + `csrf_token`, same as login, `status` is `authenticated`). If the tenant requires MFA for the role (`InvitationInfo.mfa_enrolment_required`) the new session is *limited* until MFA enrolment is confirmed (`Me.mfa_enrolment_required`). A rejected password does not consume the token.
         */
        post: operations["acceptInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in with email and password
         * @description Creates a server-side session and sets the `__Host-at_session` cookie. If the account has MFA the response is `mfa_required` and no session is created until `POST /v1/auth/mfa/verify`. Throttled per email and per IP.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign out
         * @description Revokes the current session and clears the cookie. For API keys this is a no-op `204`.
         */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current principal
         * @description The authenticated user (or the user that owns the API key), tenant (with branding), effective permissions and role scopes, plus, for cookie sessions, the session lifetime (`session`) and whether the user must still enrol in MFA (`mfa_enrolment_required`). This is one of the few endpoints that still works on a *limited* session (MFA enrolment pending), so the web app calls it first to decide where to route.
         */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/mfa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Disable MFA
         * @description Removes the user's own TOTP factor and recovery codes. Requires re-authentication (password or current TOTP code in the body) and revokes all the user's **other** sessions. Forbidden while tenant policy enforces MFA for this user (`403 mfa-required-by-policy`); an administrator can reset a lost factor with `DELETE /v1/users/{id}/mfa`.
         */
        delete: operations["disableMfa"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/mfa/enrol": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start TOTP enrolment
         * @description Creates a pending TOTP factor (secret stored envelope-encrypted) and returns the secret and the `otpauth://` URI for the QR code. Works on a *limited* session (MFA enrolment pending). Not active until `POST /v1/auth/mfa/enrol/confirm`; calling it again replaces the pending secret. The response contains secrets and is never stored for idempotent replay, so no `Idempotency-Key` is accepted.
         */
        post: operations["startMfaEnrolment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/mfa/enrol/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm TOTP enrolment
         * @description Verify-then-activate: a valid current code activates the factor, generates ten single-use recovery codes (stored hashed) and returns them **once**. If the session was limited it becomes a full session and `mfa_verified` is true. The session id is rotated (new cookie) and the response carries the new `csrf_token`. Works on a limited session. Attempts are throttled. The response contains secrets and is never stored for idempotent replay, so no `Idempotency-Key` is accepted.
         */
        post: operations["confirmMfaEnrolment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/mfa/recovery-codes/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Regenerate recovery codes
         * @description Replaces all recovery codes with ten new ones (the old ones stop working) and returns them once. Requires recent re-authentication: the current password or a current TOTP code in the body. The response contains secrets and is never stored for idempotent replay, so no `Idempotency-Key` is accepted.
         */
        post: operations["regenerateRecoveryCodes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/mfa/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Complete an MFA challenge
         * @description Exchanges a pending MFA challenge for a session (TOTP, WebAuthn/passkey or a one-time recovery code).
         */
        post: operations["verifyMfa"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/password-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Password policy
         * @description Public. The rules the server enforces for new passwords (minimum 12, maximum 128, breached-password check), so clients and forms do not hardcode them. The values can differ per deployment (self-hosted operators may enable the online breach provider).
         */
        get: operations["getPasswordPolicy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/password/forgot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request a password-reset email
         * @description Always answers `202`, whether or not an account exists for the email, so it cannot be used to discover accounts; the response time does not depend on it either. If an active account matches, a single-use reset link (token stored hashed, short expiry) is emailed. Throttled per IP and per email. `422` only for a malformed email.
         */
        post: operations["forgotPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a new password with a reset token
         * @description Consumes a single-use reset token and sets the new password (policy: see `PasswordPolicy` and `GET /v1/auth/password-policy`). On success **every session of the user is revoked** and no session is created: the user signs in again. Failure modes: `404 token-invalid` (unknown or already used), `410 token-expired`, `422` with `errors[]` at pointer `/password` (code `too-short`, `too-long` or `breached`); a rejected password does not consume the token.
         */
        post: operations["resetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my active sessions
         * @description The caller's unrevoked, unexpired browser sessions (devices), newest activity first, with the current one flagged. Not paginated (a user has few live sessions).
         */
        get: operations["listMySessions"];
        put?: never;
        post?: never;
        /**
         * Sign out everywhere else
         * @description Revokes every session of the caller except the current one. Revoked sessions fail on their next request with `401 session-expired`.
         */
        delete: operations["revokeOtherSessions"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke one of my sessions
         * @description Revokes one of the caller's own sessions. The current session cannot be revoked here (use `POST /v1/auth/logout`). An unknown id, or one that belongs to another user, is `404`.
         */
        delete: operations["revokeMySession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List categories
         * @description Cursor-paginated list.
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["listCategories"];
        put?: never;
        /**
         * Create category
         * @description Requires permission `catalog:manage`.
         */
        post: operations["createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get category
         * @description Requires permission `catalog:read`.
         */
        get: operations["getCategory"];
        put?: never;
        post?: never;
        /**
         * Archive category
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `catalog:manage`.
         */
        delete: operations["archiveCategory"];
        options?: never;
        head?: never;
        /**
         * Update category
         * @description Requires permission `catalog:manage`.
         */
        patch: operations["updateCategory"];
        trace?: never;
    };
    "/v1/companies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List companies
         * @description Every tenant has a default company; multi-company management UI arrives in v2.
         *
         *     Requires permission `company:read`.
         */
        get: operations["listCompanies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/consumables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List consumables
         * @description Cursor-paginated list.
         *
         *     Requires permission `consumable:read`.
         */
        get: operations["listConsumables"];
        put?: never;
        /**
         * Create consumable
         * @description A positive `initial_qty` is recorded as the first `receive` movement of the ledger (note: "Opening stock"), in the same transaction.
         *
         *     Requires permission `consumable:manage`.
         */
        post: operations["createConsumable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/consumables/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get consumable
         * @description Requires permission `consumable:read`.
         */
        get: operations["getConsumable"];
        put?: never;
        post?: never;
        /**
         * Archive consumable
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `consumable:manage`.
         */
        delete: operations["archiveConsumable"];
        options?: never;
        head?: never;
        /**
         * Update consumable
         * @description Requires permission `consumable:manage`.
         */
        patch: operations["updateConsumable"];
        trace?: never;
    };
    "/v1/consumables/{id}/movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stock ledger of a consumable
         * @description The consume log of one consumable, newest first; filter by reason and by the person the stock went to.
         *
         *     Requires permission `consumable:read`.
         */
        get: operations["listStockMovements"];
        put?: never;
        /**
         * Receive, issue or adjust stock
         * @description Appends to the ledger and updates `qty_on_hand` atomically; concurrent movements of one consumable are serialised, so stock can never go negative (409 `insufficient-stock`). The ledger is append-only: fix mistakes with a `correction` movement. Writes an audit record and the outbox event `consumable.stock_moved`; when the movement brings `qty_on_hand` to or below `min_qty` the outbox event `consumable.low_stock` is emitted once per crossing (ids only; re-armed when the stock rises above the minimum again). An archived consumable takes no movements (409 `conflict`).
         *
         *     Requires permission `consumable:adjust`.
         */
        post: operations["createStockMovement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/custom-fields": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List custom fields
         * @description Cursor-paginated list.
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["listCustomFields"];
        put?: never;
        /**
         * Create custom field definition
         * @description Requires permission `catalog:manage`.
         */
        post: operations["createCustomFieldDef"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/custom-fields/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get custom field definition
         * @description Requires permission `catalog:read`.
         */
        get: operations["getCustomFieldDef"];
        put?: never;
        post?: never;
        /**
         * Archive custom field definition
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `catalog:manage`.
         */
        delete: operations["archiveCustomFieldDef"];
        options?: never;
        head?: never;
        /**
         * Update custom field definition
         * @description Requires permission `catalog:manage`.
         */
        patch: operations["updateCustomFieldDef"];
        trace?: never;
    };
    "/v1/departments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List departments
         * @description Cursor-paginated list. `q` matches the name and the code (case-insensitive). Every row carries `person_count` and `asset_count` (live people / assets), so the settings page needs one call.
         */
        get: operations["listDepartments"];
        put?: never;
        /**
         * Create department
         * @description Creates a department. The name (and the code, when set) must be unique among live departments, ignoring case (409 `conflict`, pointer `/name` or `/code`). The manager must be a live person (422).
         */
        post: operations["createDepartment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/departments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get department
         * @description Requires permission `department:read`.
         */
        get: operations["getDepartment"];
        put?: never;
        post?: never;
        /**
         * Archive department
         * @description Soft delete. While live people or assets still reference the department the answer is `409 conflict` with `usage` (`people`, `assets`), unless `reassign_to` names another live department: then every person and asset (archived ones included) moves there in the same transaction and the department is archived (this is how two departments are merged). The move is recorded in the audit entry (`meta.reassigned_to`, `people`, `assets`).
         */
        delete: operations["archiveDepartment"];
        options?: never;
        head?: never;
        /**
         * Update department
         * @description Merge semantics. Renaming keeps every person and asset linked: they reference the id.
         */
        patch: operations["updateDepartment"];
        trace?: never;
    };
    "/v1/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * My exports
         * @description The caller's exports, newest first. `download_url` is never set in a list; fetch one export for a link.
         *
         *     Requires permission `export:run`. Every principal lists its own exports only.
         */
        get: operations["listExports"];
        put?: never;
        /**
         * Export a list to CSV
         * @description Queues a background job that writes every row matching `filters` to a UTF-8 CSV file (with a byte order mark, CRLF line ends, a header row) and stores it for 24 hours. Poll `GET /v1/exports/{id}` until `status=succeeded`, then use `download_url`.
         *
         *     The caller also needs the read permission of the list (`asset:read`, `person:read` or `location:read`, `403` otherwise). Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe so spreadsheets never run them as formulas. Asset exports include one `cf:<key>` column per custom field. At most 100,000 rows. Requested and downloaded exports are audited (sensitive read).
         *
         *     The same query parameters as the list endpoint (`GET /v1/assets`, `/v1/people` or `/v1/locations`) without paging (`limit`, `cursor`, `include_total`, `fields`, `expand`), as a flat object: arrays are sent as arrays of strings, booleans and numbers as such; custom-field filters as `"cf[key]": "value"`.
         *
         *     Requires permission `export:run`. A location-scoped requester (ED-26) gets only the rows inside its scope: the scope at request time is stored with the export and applied by the worker.
         */
        post: operations["createExport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/exports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an export
         * @description Status of one export. For a succeeded one it issues a fresh short-lived `download_url` (audited as a sensitive read). Another user's export is `404`.
         *
         *     Requires permission `export:run`.
         */
        get: operations["getExport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/files/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a file from local storage (presigned)
         * @description Only with the **local filesystem** storage driver: the short-lived URL returned as `download_url` / `thumbnail_url`. The signed token is the credential; no cookie is read or set. The response carries `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`, `Cross-Origin-Resource-Policy: cross-origin`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a content type from the allow-list and `Content-Disposition: attachment` for everything except raster images.
         */
        get: operations["downloadLocalFile"];
        /**
         * Upload a file to local storage (presigned)
         * @description Only with the **local filesystem** storage driver (the self-hosted fallback): the "presigned PUT" URL returned by `POST /v1/attachments`. The signed token is the credential (no cookie or API key is read). Send exactly the promised content type and byte count as the raw request body. With the S3 driver the upload URL points at the object store and this route answers `404`.
         */
        put: operations["uploadLocalFile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health with a database round trip
         * @description Liveness plus a database round trip (through PgBouncer when so configured). No credential needed. `503` with the same body shape when the database does not answer.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Saved mapping templates
         * @description Requires permission `import:read`.
         */
        get: operations["listImportTemplates"];
        put?: never;
        /**
         * Save a mapping as a template
         * @description From an import (`from_import_id`: its mapped columns by header, and its options) or from explicit `columns`. Names are unique per entity type (ignoring case).
         *
         *     Requires permission `import:run`.
         */
        post: operations["createImportTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/import-templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a mapping template
         * @description Requires permission `import:read`.
         */
        get: operations["getImportTemplate"];
        put?: never;
        post?: never;
        /**
         * Delete a mapping template
         * @description Requires permission `import:run`.
         */
        delete: operations["deleteImportTemplate"];
        options?: never;
        head?: never;
        /**
         * Edit a mapping template
         * @description Requires permission `import:run`.
         */
        patch: operations["updateImportTemplate"];
        trace?: never;
    };
    "/v1/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List imports
         * @description Newest first. Without the heavy members (`profile`, `samples`, `value_map`, `confidence`): fetch one import for those.
         *
         *     Requires permission `import:read`. A location-scoped principal (ED-26) lists only the imports it started itself.
         */
        get: operations["listImports"];
        put?: never;
        /**
         * Create an import
         * @description Creates a `draft` import. Then upload the file through the attachments API (`POST /v1/attachments` with `entity_type: "import_job"`, `entity_id` = this import, `kind: "import_file"`, content type `text/csv` or the XLSX type; a CSV may be UTF-8, UTF-16 or Windows-1252), complete the upload, and call `POST /v1/imports/{id}/analyze`.
         *
         *     The caller needs the write permission of the entity type (`asset:create`, `person:manage`, `location:manage`, `department:manage`). `preset_key: google_admin_chromeos` also creates the Chromebook category and its custom fields when missing.
         *
         *     Every long step is a background job: poll `GET /v1/imports/{id}` (`state`, `progress`, `counts`) until it leaves the running state. Nothing is written to the registry before the commit; a dry run changes no registry data.
         *
         *     Requires permission `import:run`.
         */
        post: operations["createImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an import
         * @description Requires permission `import:read`.
         */
        get: operations["getImport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edit mapping, options and value mapping
         * @description Unknown or repeated targets are `422`. Missing essentials (no category column and no default category, ...) are reported when the dry run is requested.
         *
         *     Requires permission `import:run`.
         */
        patch: operations["updateImport"];
        trace?: never;
    };
    "/v1/imports/{id}/analyze": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read and profile the uploaded file
         * @description Queues the analysis: the file (which must have passed the upload scan) is read once as a stream; its format, encoding, delimiter and header row are detected, every data row is stored, each column is profiled (distinct values, blanks, duplicates, detected type, date order), 50 rows are kept as a sample and a mapping is suggested (or the preset's applied). A malformed file ends the analysis as `failed` with `error` naming the line. At most 100,000 data rows.
         *
         *     Every long step is a background job: poll `GET /v1/imports/{id}` (`state`, `progress`, `counts`) until it leaves the running state. Nothing is written to the registry before the commit; a dry run changes no registry data.
         *
         *     Requires permission `import:run`.
         */
        post: operations["analyzeImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}/apply-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply a saved mapping template
         * @description Maps the columns of the analysed file by header text and takes the template's options. Returns the import in state `mapped`.
         *
         *     Requires permission `import:run`.
         */
        post: operations["applyImportTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel an import
         * @description Before a dry run or commit starts: `cancelled` at once. While one runs: `cancel_requested` is set and the job stops after its current batch (rows already written stay). A completed or cancelled import is `409`.
         *
         *     Requires permission `import:run`.
         */
        post: operations["cancelImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Commit a reviewed dry run
         * @description Only valid in `dry_run_done`, and only with the `dry_run_digest` the user reviewed (`409 import-stale-dry-run` otherwise). The rows classified `create` and `update` are written in batches, one short transaction per batch, through the same services as the API, so validation, history, audit rows and events are never bypassed; every audit entry carries the `import_job_id`. A row that fails is recorded (`result: error`) and does not stop the import; a record edited after the dry run is left alone (`changed-since-dry-run`). The commit can be cancelled between batches and survives a worker restart without creating duplicates. On completion the requester is notified (`import.completed`). Rolling a commit back is v1.1 (the before-image of every update is stored already).
         *
         *     Every long step is a background job: poll `GET /v1/imports/{id}` (`state`, `progress`, `counts`) until it leaves the running state. Nothing is written to the registry before the commit; a dry run changes no registry data.
         *
         *     Requires permission `import:run`. A location-scoped principal (ED-26) imports only inside its scope: rows match existing records inside the scope only, and a location, person or parent outside it is reported like one that does not exist. The scope at commit time travels with the job.
         */
        post: operations["commitImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}/dry-run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run the import without writing
         * @description Queues the dry run: every row is parsed with the mapping, its references are resolved, de-duplicated within the file and against the registry, and validated by the very code behind the API (`POST /v1/assets` ... in a mode that stops before the first write; people, locations and departments run the service in a transaction that is rolled back), then classified `create`, `update`, `skip` or `error` with per-row messages. The references the commit would create (category, model, location, department, person...) are created for real inside a savepoint that is rolled back after each batch, so a row that needs one is checked like any other row (ED-29); only a location below a parent the same import creates is left to the commit (counted in `summary.validated_at_commit`, row warning `validated-at-commit`). **No registry data is changed.** When it is done the import is `dry_run_done` with `dry_run_digest`, `counts.dry_run` and `summary`.
         *
         *     The caller needs the permissions the commit would use (the write permission of the entity, `asset:update` when `on_match` is `update`, `catalog:manage` and the like when missing references are created).
         *
         *     Every long step is a background job: poll `GET /v1/imports/{id}` (`state`, `progress`, `counts`) until it leaves the running state. Nothing is written to the registry before the commit; a dry run changes no registry data.
         *
         *     Requires permission `import:run`.
         */
        post: operations["startImportDryRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}/errors.csv": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download the error report
         * @description A CSV (UTF-8 with byte order mark) with one line per row that has errors: `Row`, `Line`, `Fields`, `Problems`, `Warnings`, then the original cells under their headers, so it can be corrected and uploaded again. After a commit it lists the rows that failed; before, the rows the dry run rejected. Cells that could be read as formulas get a leading apostrophe (the importer removes it again).
         *
         *     Requires permission `import:run`.
         */
        get: operations["downloadImportErrors"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}/rows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Per-row results
         * @description Rows in file order with their errors and warnings (field + message) and the non-empty source cells. Raw file content: needs `import:run`, not just `import:read`.
         *
         *     Requires permission `import:run`.
         */
        get: operations["listImportRows"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/{id}/values": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Distinct values of a reference column
         * @description For the value mapping step: the distinct values of the column mapped to the reference with their row counts, the existing record that matches each by name, and the current value-map entry. [ED-37] A value is resolved by the same rules as the dry run, so a value shown as matched never fails the dry run for its name: a model is looked up in the category (and manufacturer) of its rows, and a bare location name counts the locations the import itself creates from the paths of the same column; when a record of that name exists but the rows will still fail, `issue` says why.
         *
         *     Requires permission `import:run`.
         */
        get: operations["listImportValues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Built-in import presets
         * @description The templates for assets, people, locations and departments and the Google Admin ChromeOS preset, each with its data dictionary (column, target field, description, example). Pass `preset_key` when creating an import to apply one. Recommended order of imports: locations, departments, people, assets.
         *
         *     Requires permission `import:read`.
         */
        get: operations["listImportPresets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/imports/presets/{key}/template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a template file
         * @description A CSV (UTF-8 with byte order mark) or XLSX template with the header row of the preset and example rows; the XLSX has the data dictionary on a second sheet. The asset templates also carry one `cf:<key>` column per custom field of the organisation.
         *
         *     Requires permission `import:read`.
         */
        get: operations["downloadImportTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/labels/batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my label batches
         * @description The label batches the caller requested, newest first. Nobody sees another user's batches.
         *
         *     Requires permission `asset:label`.
         */
        get: operations["listLabelBatches"];
        put?: never;
        /**
         * Request a PDF label sheet
         * @description Queues a worker job that renders QR and/or Code128 labels for the assets (explicit `asset_ids`, or the current list `filter`) into a PDF on the chosen template, starting at `start_position` on the first sheet. Answers `202` with the batch; poll `GET /v1/labels/batches/{id}` until `status` is `ready`, then download the PDF from the short-lived `download_url`. Each QR encodes `<web base url>/s/<label_code>`, each Code128 the asset tag. A `label_printed` event is added to the history of every asset when the file is ready, and a `label.batch.ready` event (ids only) is published.
         *
         *     Requires permission `asset:label`. For a location-scoped principal (ED-26) an asset outside its scope is reported like a missing one (`422` at `/asset_ids/<n>`), and a filter selects inside the scope only.
         */
        post: operations["createLabelBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/labels/batches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a label batch
         * @description The status of a batch (poll this) and, once `ready`, a fresh presigned `download_url` (valid for a couple of minutes; read again for a new one). `404` for a batch someone else requested.
         *
         *     Requires permission `asset:label`.
         */
        get: operations["getLabelBatch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/labels/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List fixed label templates
         * @description The fixed sheet templates: US Letter 30-up (Avery 5160 layout), A4 21-up (L7160) and 24-up 3 x 8 (L7159), US Letter 10-up (5163), and two single-label pages for roll and thermal printers (50 x 25 mm and 2 x 1 inch). Geometry is fixed in the MVP (the editor arrives in v1.1); only the calibration offsets can change.
         *
         *     Requires permission `asset:label`.
         */
        get: operations["listLabelTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/labels/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a label template
         * @description Requires permission `asset:label`.
         */
        get: operations["getLabelTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Calibrate a label template
         * @description Sets the calibration offsets of a template after a test print on real label stock (M2-TAG-04). The geometry itself cannot be changed.
         *
         *     Requires permission `catalog:manage`.
         */
        patch: operations["updateLabelTemplate"];
        trace?: never;
    };
    "/v1/loaner-pools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List loaner pools
         * @description Cursor-paginated list. `q` matches the name. Every pool carries its live counts (`member_count`, `available_count`, `checked_out_count`, `overdue_count`, `due_today_count`), so the pool list needs one call.
         */
        get: operations["listLoanerPools"];
        put?: never;
        /**
         * Create loaner pool
         * @description Creates a pool. The name is unique among live pools, ignoring case (409 `conflict`, pointer `/name`); `home_location_id` must be a live location and `owner_user_id` an active user (422); `max_loan_days` must be >= `default_loan_days` (422).
         */
        post: operations["createLoanerPool"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loaner-pools/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get loaner pool
         * @description Requires permission `loaner:read`.
         */
        get: operations["getLoanerPool"];
        put?: never;
        post?: never;
        /**
         * Archive loaner pool
         * @description Soft delete. `409 conflict` with `usage.open_loans` while a member is checked out; otherwise the pool is archived and its memberships are removed, so the assets can join another pool. Switch a pool off with `is_active: false` instead to keep its members.
         */
        delete: operations["archiveLoanerPool"];
        options?: never;
        head?: never;
        /**
         * Update loaner pool
         * @description Requires permission `loaner:manage`.
         */
        patch: operations["updateLoanerPool"];
        trace?: never;
    };
    "/v1/loaner-pools/{id}/checkout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Quick loan from the pool
         * @description Checks out a specific pool member, or the next available one (lowest asset tag first), to a person with a due date: `expected_return`, else today (UTC) + the pool's `default_loan_days`, else + the organisation's `default_expected_return_days`, else + 7 days (ED-24; never beyond the pool's `max_loan_days`). Without `asset_id` the device is the member that has been idle the longest (earliest return of its last custody period, a device never lent first), ties by the lowest asset tag. Return it with `POST /v1/assets/{id}/checkin` or `POST /v1/loans/return`. 409 `no-loaner-available` when the pool is empty, `loaner-pool-inactive` when it is switched off, `loan-limit-reached` when the borrower is at the pool's limit; 422 when the person is inactive or of a kind the pool does not serve (`not-eligible`) or the due date is past the pool's `max_loan_days`. Like a normal check-out it returns the updated asset (the client may not have known which pool member was chosen) and the assignment, which carries `loaner_pool_id`.
         *
         *     Requires permission `loaner:checkout`.
         */
        post: operations["checkoutLoaner"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loaner-pools/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List pool members
         * @description The assets of the pool, in asset-tag order, with the full asset (status, location, `current_assignment`) and whether each can be lent right now.
         *
         *     Requires permission `loaner:read`.
         */
        get: operations["listLoanerPoolMembers"];
        put?: never;
        /**
         * Add an asset to the pool
         * @description An asset belongs to at most one pool (409 `conflict` if it is in another one; adding it to the pool it is in answers 200 with the existing member). Archived assets cannot join (422). A member can still be checked out the regular way.
         *
         *     Requires permission `loaner:manage`.
         */
        post: operations["addLoanerPoolMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loaner-pools/{id}/members/{asset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove an asset from the pool
         * @description Rejected with 409 while the asset is on loan from this pool (`usage.open_loans`); a regular check-out of a member does not block removal.
         *
         *     Requires permission `loaner:manage`.
         */
        delete: operations["removeLoanerPoolMember"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loaner-pools/{id}/members/bulk-add": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add many assets to the pool
         * @description Adds every listed asset (same rules as `POST /v1/loaner-pools/{id}/members`). At most 100 ids; the response is `200` with one result per id, in request order, and a failing item does not roll back the others. Idempotent with `Idempotency-Key`.
         *
         *     Requires permission `loaner:manage`.
         */
        post: operations["bulkAddLoanerPoolMembers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loaner-pools/{id}/members/bulk-remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove many assets from the pool
         * @description Removes every listed asset (same rules as `DELETE /v1/loaner-pools/{id}/members/{asset_id}`). At most 100 ids; `200` with one result per id (status 204 on success, no `data`), a failing item does not roll back the others.
         *
         *     Requires permission `loaner:manage`.
         */
        post: operations["bulkRemoveLoanerPoolMembers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loaner-pools/{id}/quick-checkout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Quick loan by scanning: one borrower, many devices
         * @description The quick check-out screen in one call: the borrower (`person_id`, or `borrower` = the scanned email / badge, see `QuickLoanRequest`) and the scanned devices (`codes`: label code or URL, asset tag, serial). The due date is `expected_return`, else today (UTC) + the pool's `default_loan_days`, else + the organisation's `default_expected_return_days`, else + 7 days (ED-24). The borrower is validated once (whole request `422`: unknown, inactive, not eligible; `409 loaner-pool-inactive`); then every code is a loan of its own, in order, answered per item (`results[].status`, `results[].error`): unknown code `404`, ambiguous serial `409 conflict`, not a member of this pool `422` (`not-in-pool`, pointer `/codes/<i>`), already out `409 asset-already-checked-out`, not deployable `409 asset-not-deployable`, past the borrower's limit `409 loan-limit-reached`. A failing item does not roll back the others. Every loan is a normal check-out (one open custody per asset, history, audit, outbox) with the pool on the assignment. Unknown codes count towards the scan-resolve throttle (429 once exceeded). Replaying the same `Idempotency-Key` answers the stored result.
         *
         *     Requires permission `loaner:checkout`.
         */
        post: operations["quickCheckoutLoaners"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loaners/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Loaner dashboard
         * @description Per-pool counts (pool size, available, out, overdue, due today, due soon) with their totals, and the latest check-outs and returns. Counts cover live (not archived) pools and members; "today" is the UTC date (`as_of`). Inactive pools are listed (with `is_active: false`) and counted.
         *
         *     Requires permission `loaner:read`. For a location-scoped principal (ED-26) the pools, counts and activity inside its scope.
         */
        get: operations["getLoanerDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List loans
         * @description Loans from loaner pools (assignments with a `loaner_pool_id`): the click-through lists behind the dashboard. By default the open ones (`on_loan`, `due_today`, `overdue`); add `returned` to include closed ones. `q` matches the asset tag and name and the borrower's name.
         *
         *     Requires permission `loaner:read`.
         */
        get: operations["listLoans"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a loan
         * @description One loan by its assignment id (open or returned).
         *
         *     Requires permission `loaner:read`.
         */
        get: operations["getLoan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loans/{id}/extend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Extend a loan
         * @description Moves the due date of an open loan to a later date: not before today (UTC) and within the pool's `max_loan_days` counted from the day the loan started (422 `/expected_return`). A closed loan is `409 conflict`. Extending is a logged action: an audit record (`loan.extended`, with the old and new date and the note), an outbox event and an entry in the asset's history (event type `updated`, `payload.loan_extended`). The asset's ETag changes (its `current_assignment` did). The "due soon" and "overdue" alerts re-arm for the new date.
         *
         *     Requires permission `loaner:checkout`.
         */
        post: operations["extendLoan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loans/overdue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Overdue check-outs
         * @description Open asset check-outs past `expected_return` (before today, UTC), loaner or not, to anyone or anywhere: the data behind the overdue view. Only loans from a loaner pool raise alerts (see ED-21). `days_overdue` counts whole days.
         *
         *     Requires permission `loaner:read`.
         */
        get: operations["listOverdueCheckouts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/loans/return": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Quick return by scanning (one or many devices)
         * @description The bulk check-in screen in one call: the scanned devices (`codes`, at most 100) are checked in one after the other, answered per item in request order. A device must be a member of a loaner pool (of `loaner_pool_id` when given): else `422` (`not-in-pool`, pointer `/codes/<i>`); not checked out `409 asset-not-checked-out`; unknown code `404`. Each return is a normal check-in (history, audit, outbox, status back to deployable) and moves the device to `checkin_location_id`, or to the pool's `home_location_id`. A failing item does not roll back the others; unknown codes count towards the scan-resolve throttle. Replaying the same `Idempotency-Key` answers the stored result; returning a device twice with different keys is a per-item `409 asset-not-checked-out`.
         *
         *     Requires permission `loaner:checkout`.
         */
        post: operations["returnLoans"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List locations
         * @description Cursor-paginated list.
         *
         *     Requires permission `location:read`.
         */
        get: operations["listLocations"];
        put?: never;
        /**
         * Create location
         * @description Creates a location under `parent_id` (a root when null). The name must be unique among the live children of the same parent (409 `conflict`, pointer `/name`); the hierarchy is at most ten levels deep (422, pointer `/parent_id`). Requires permission `location:manage`.
         */
        post: operations["createLocation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get location
         * @description Requires permission `location:read`.
         */
        get: operations["getLocation"];
        put?: never;
        post?: never;
        /**
         * Archive location
         * @description Soft delete. Refused with `409 conflict` and `usage` (`children`, `assets`, `people`, `open_assignments`: how many live records still reference the location) while anything is located here or below it. Requires permission `location:manage`.
         */
        delete: operations["archiveLocation"];
        options?: never;
        head?: never;
        /**
         * Update location
         * @description Merge semantics. Changing `parent_id` **moves the whole subtree** (every descendant's `ancestor_ids` and `depth` are rewritten in the same transaction). Moving a location under itself or one of its descendants is 422 (pointer `/parent_id`, code `cycle`), as is exceeding the depth limit or an archived parent. Requires permission `location:manage`.
         */
        patch: operations["updateLocation"];
        trace?: never;
    };
    "/v1/manufacturers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List manufacturers
         * @description Cursor-paginated list.
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["listManufacturers"];
        put?: never;
        /**
         * Create manufacturer
         * @description Requires permission `catalog:manage`.
         */
        post: operations["createManufacturer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/manufacturers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get manufacturer
         * @description Requires permission `catalog:read`.
         */
        get: operations["getManufacturer"];
        put?: never;
        post?: never;
        /**
         * Archive manufacturer
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `catalog:manage`.
         */
        delete: operations["archiveManufacturer"];
        options?: never;
        head?: never;
        /**
         * Update manufacturer
         * @description Requires permission `catalog:manage`.
         */
        patch: operations["updateManufacturer"];
        trace?: never;
    };
    "/v1/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List models
         * @description Cursor-paginated list.
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["listModels"];
        put?: never;
        /**
         * Create asset model
         * @description Requires permission `catalog:manage`.
         */
        post: operations["createAssetModel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/models/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get asset model
         * @description Requires permission `catalog:read`.
         */
        get: operations["getAssetModel"];
        put?: never;
        post?: never;
        /**
         * Archive asset model
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `catalog:manage`.
         */
        delete: operations["archiveAssetModel"];
        options?: never;
        head?: never;
        /**
         * Update asset model
         * @description Requires permission `catalog:manage`.
         */
        patch: operations["updateAssetModel"];
        trace?: never;
    };
    "/v1/notification-deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Delivery log
         * @description What was delivered, queued, deferred (digest) or skipped, newest first.
         *
         *     Requires permission `notification:manage`.
         */
        get: operations["listNotificationDeliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notification-preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * My notification preferences
         * @description One entry per notification type, with the caller's choice (or the default).
         */
        get: operations["listNotificationPreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notification-preferences/{type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set my preference for a type
         * @description Chooses in-app and email delivery (`immediate`, `digest`, `off`) for one notification type. Omitted fields keep their current value (or the default).
         */
        put: operations["updateNotificationPreference"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notification-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Notification rules of the organisation
         * @description Every notification type with whether it is enabled and who receives it.
         *
         *     Requires permission `notification:manage`.
         */
        get: operations["listNotificationRules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notification-rules/{type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Enable, disable or re-address a type
         * @description Requires permission `notification:manage`.
         */
        put: operations["updateNotificationRule"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * My notifications
         * @description The caller's in-app notifications, newest first.
         */
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark a notification read
         * @description Idempotent: an already-read notification keeps its first `read_at`. Another user's notification is `404`.
         */
        post: operations["markNotificationRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark every notification read */
        post: operations["markAllNotificationsRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Number of unread notifications */
        get: operations["getNotificationUnreadCount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/people": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List people
         * @description Cursor-paginated list.
         *
         *     Requires permission `person:read`.
         */
        get: operations["listPeople"];
        put?: never;
        /**
         * Create person
         * @description Creates an assignable person (no login). `email` and `employee_ref` are unique per tenant among live people (409 `conflict`). A login account (`POST /v1/users`) gets its person automatically; a person created here with the same email is linked to the account when it is created. People never receive login emails. Requires permission `person:manage`.
         */
        post: operations["createPerson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/people/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get person
         * @description Requires permission `person:read`.
         */
        get: operations["getPerson"];
        put?: never;
        post?: never;
        /**
         * Archive person
         * @description Soft delete. `409 conflict` with `usage.open_assignments` while the person still holds assets, and for a person linked to a login account (archive the account first). Requires permission `person:manage`.
         */
        delete: operations["archivePerson"];
        options?: never;
        head?: never;
        /**
         * Update person
         * @description Merge semantics. Setting `status: "inactive"` while the person still holds assets is `409 conflict` with `usage.open_assignments`, unless `force: true` and a `reason` are sent (the reason lands in the audit trail; the custody stays open). An inactive person cannot receive new check-outs. Requires permission `person:manage`.
         */
        patch: operations["updatePerson"];
        trace?: never;
    };
    "/v1/people/{id}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What is checked out to a person
         * @description Assignments (assets and accessories) targeting this person; defaults to open ones, which is the offboarding checklist.
         *
         *     Requires permission `person:read`.
         */
        get: operations["listPersonAssignments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/people/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Chain of custody of a person
         * @description Newest first: every custody event (check-out, check-in, transfer) that involved this person, across assets.
         *
         *     Requires permission `person:read`.
         */
        get: operations["listPersonHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/people/{id}/link-user": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Link a person to a login account
         * @description Makes the person the person record of the login account (Administrators only, audited as `person.user_linked`). Every login account already has the person the database created for it, so linking **replaces** that placeholder: it is archived (never deleted; its history keeps pointing at it) and a department it headed is headed by the linked person. The linked person keeps all of its assignments and history. One person per login and one login per person: a person that already has a login is 409 `person-already-linked`, a login whose person was chosen by somebody (not the system-made placeholder, which has no `created_by`) is 409 `login-already-linked` (unlink it first), a placeholder that still holds assets is 409 `login-person-in-use` (`usage.open_assignments`). Linking the pair that is already linked changes nothing (200). 422 `/user_id` when the account does not exist in the tenant or is archived. The person's name and email are not changed, but a later rename of the login account renames the person again (ED-15).
         *
         *     Requires permission `user:manage`.
         */
        post: operations["linkPersonToUser"];
        /**
         * Unlink a person from its login account
         * @description Removes the login from the person (Administrators only, audited as `person.user_unlinked`). The person stays with all its assignments and history, as a person without a login. The login account keeps exactly one person (ED-15): a new one is created from its name and email (the email is left empty while a live person uses it, which is the case right after this call; `GET /v1/users/{id}` gives its `person_id`). 409 `conflict` when the person has no login, and when the person is the login's own automatic record (`is_login_placeholder`, ED-33): there is nothing to unlink, and unlinking it would only make another empty record with the same name. The login account is not changed, disabled or signed out.
         *
         *     Requires permission `user:manage`.
         */
        delete: operations["unlinkPersonFromUser"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/people/{id}/stock-movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Consumption log of a person
         * @description Every stock movement issued to or returned by this person, across consumables, newest first (M2-ACC-02: "consume log queryable per person").
         *
         *     Requires permission `consumable:read`.
         */
        get: operations["listPersonStockMovements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/repairs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List repairs
         * @description Cursor-paginated list.
         *
         *     Requires permission `repair:read`.
         */
        get: operations["listRepairs"];
        put?: never;
        /**
         * Create repair record
         * @description Opens a repair or maintenance record for an asset.
         *
         *     `set_status_id` (typically an `undeployable` label such as "In repair") moves the asset to that status and so blocks its check-out; the status the asset had before (or the tenant's default deployable one, when it was checked out) is remembered as `restore_status_id` and put back when the record is completed or cancelled. Only one open record at a time may move an asset's status (`409 conflict` otherwise). An asset whose status is already `undeployable` and that no open record holds (the status was set by hand) is asked to take the same status: the new record adopts it (`set_status_id` = that label) and puts the tenant's default deployable label back when it is completed or cancelled.
         *
         *     A checked-out asset goes to repair through check-in first; with `force_checkin` and `force_note` (and the `asset:checkin` permission) the custody period is closed in the same transaction. A lost or retired asset, or an archived one, cannot be repaired (`409`).
         *
         *     Writes a `repair_opened` history event, an audit row and the outbox event `repair.opened`. Requires permission `repair:manage`.
         */
        post: operations["createRepair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/repairs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get repair record
         * @description Requires permission `repair:read`.
         */
        get: operations["getRepair"];
        put?: never;
        post?: never;
        /**
         * Archive repair record
         * @description Soft delete. `409` while the record is open or in progress (cancel or complete it first).
         *
         *     Requires permission `repair:manage`.
         */
        delete: operations["archiveRepair"];
        options?: never;
        head?: never;
        /**
         * Update repair record
         * @description Edit a record (RFC 7396 merge). `status` may move to `in_progress` or `cancelled`; cancelling restores the asset status. The asset cannot change. Closed records stay editable except for their status. Requires permission `repair:manage`.
         */
        patch: operations["updateRepair"];
        trace?: never;
    };
    "/v1/repairs/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Complete a repair
         * @description Sets `completed_at` and status `completed`, records cost and resolution, and restores the asset status: the explicit `restore_status_id` of the request, else the one remembered when the repair opened, but only when the asset still has the status the repair moved it to (a status someone chose meanwhile is left alone). Writes a `repair_completed` history event, an audit row and the outbox event `repair.completed`. `409` when the record is already closed.
         *
         *     Requires permission `repair:manage`.
         */
        post: operations["completeRepair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List roles
         * @description Built-in roles in the MVP (custom roles arrive in v2).
         *
         *     Requires permission `role:read`.
         */
        get: operations["listRoles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/saved-views": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Saved views I can use
         * @description The caller's own views plus the views shared in the organisation, ordered by name (`is_owner` tells them apart).
         */
        get: operations["listSavedViews"];
        put?: never;
        /**
         * Save a view
         * @description Creates a private view. The name is unique among the caller's views of the list (`409`); at most 50 per user and list. Share it afterwards with `PUT /v1/saved-views/{id}/sharing`.
         */
        post: operations["createSavedView"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/saved-views/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a saved view
         * @description An own view or a shared one; anybody else's private view is `404`.
         */
        get: operations["getSavedView"];
        put?: never;
        post?: never;
        /**
         * Delete a view
         * @description Deletes the view for good. Only the owner (`404` for anybody else).
         */
        delete: operations["deleteSavedView"];
        options?: never;
        head?: never;
        /**
         * Rename or change a view
         * @description Only the owner (`404` for anybody else, also for a shared view). A shared view stays shared.
         */
        patch: operations["updateSavedView"];
        trace?: never;
    };
    "/v1/saved-views/{id}/sharing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Share a view with the organisation, or stop sharing
         * @description Owner only. A shared view is visible to every user of the organisation (read only, they can copy it). The name must be unique among the shared views of the list (`409`).
         *
         *     Requires permission `view:share`.
         */
        put: operations["shareSavedView"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/scan/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resolve a scanned code
         * @description Accepts the opaque QR `label_code`, the whole label URL (`<PUBLIC_URL>/s/<label_code>` or `/s/<label_code>`: its last path segment is used) a Code128 `asset_tag` or the exact device `serial` number (matched case-insensitively, tried in that order; `match_type` says which one it was), and returns the asset with the actions allowed right now. `entity_type` says what the code identifies: `asset`, or (M2 wave 2) `accessory` / `consumable`, which are found by the `label_code` of their label only and answered with their own member (`accessory` / `consumable`) and actions; the accessory and consumable answers need `accessory:read` / `consumable:read` (without it the code is a plain 404). `404` when nothing matches in the caller's tenant and scope: unknown, foreign and out-of-scope codes are indistinguishable. Enumeration resistance: a signed-in caller whose lookups keep missing (60 per throttle window by default) is answered `429` with `Retry-After` for every code until the window ends (hits never count towards the limit). The web route `/s/<label_code>` sends signed-out users to sign-in first and reveals nothing about the code; this endpoint answers `401` without a credential whatever the code. Responses are `Cache-Control: private, no-store`. A serial number is not unique per organisation: when it belongs to more than one asset the answer is `409 conflict` (scan the label or enter the tag instead) rather than a guess.
         *
         *     Requires permission `asset:read`. A code of a record outside the scope of a location-scoped principal answers `404`, like an unknown code (ED-26).
         */
        get: operations["resolveScan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search across the registry
         * @description One box, several entity types. Results are filtered by the caller's permissions *per type* (and by location scope): a type the caller may not read is silently left out, never a `403`. `search:read` is granted to every built-in role; the per-type permissions are in `x-permission-by-type`.
         *
         *     **Availability:** `asset`, `model`, `category`, `person` (name, email, employee number) and `location` (name, code) results. Matching is a case-insensitive prefix / trigram match on tag, serial, name and code. Archived records are excluded.
         *
         *     Requires permission `search:read`. For a location-scoped principal (ED-26) assets, people and locations inside its scope only; models and categories are the tenant-wide catalogue.
         */
        get: operations["search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/asset-tag-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the asset tag numbering template
         * @description The template used to generate asset tags when `POST /v1/assets` omits `asset_tag`: `prefix` + the category `tag_prefix` (when `use_category_prefix`) + a counter zero-padded to `width`. Counters are per tenant and per full prefix; tags are never reused.
         *
         *     Added by M1-REG-06 (not part of the first contract draft).
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["getAssetTagTemplate"];
        /**
         * Replace the asset tag numbering template
         * @description Existing tags are never rewritten. `If-Match` is the ETag of `GET` (the tenant settings version).
         *
         *     Requires permission `catalog:manage`.
         */
        put: operations["putAssetTagTemplate"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/custody": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the custody settings
         * @description Organisation-wide custody defaults: `default_expected_return_days` (the web app pre-fills the expected return of check-out and transfer dialogs with today + N days; the API never applies it to an ordinary check-out, but a loaner loan whose pool has no `default_loan_days` takes it, ED-24) and `loan_reminder_days` (lead time of the "due soon" reminder of loaner loans).
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["getCustodySettings"];
        /**
         * Replace the custody settings
         * @description Replaces both settings (an omitted one is reset to its default). `If-Match` is the ETag of `GET` (the tenant settings version). Audited like the other settings.
         *
         *     Requires permission `catalog:manage`.
         */
        put: operations["putCustodySettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the file settings
         * @description Upload cap (tier default, override, effective) and the EXIF-stripping option of the organisation.
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["getFilesSettings"];
        /**
         * Replace the file settings
         * @description Replaces `strip_exif_original` and `max_upload_bytes`. The override can only lower the cap that the plan allows.
         *
         *     Requires permission `catalog:manage`.
         */
        put: operations["putFilesSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/status-labels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List status labels
         * @description Cursor-paginated list.
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["listStatusLabels"];
        put?: never;
        /**
         * Create status label
         * @description Requires permission `catalog:manage`.
         */
        post: operations["createStatusLabel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/status-labels/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get status label
         * @description Requires permission `catalog:read`.
         */
        get: operations["getStatusLabel"];
        put?: never;
        post?: never;
        /**
         * Archive status label
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `catalog:manage`.
         */
        delete: operations["archiveStatusLabel"];
        options?: never;
        head?: never;
        /**
         * Update status label
         * @description Requires permission `catalog:manage`.
         */
        patch: operations["updateStatusLabel"];
        trace?: never;
    };
    "/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List users
         * @description Requires permission `user:read`.
         */
        get: operations["listUsers"];
        put?: never;
        /**
         * Create or invite a user
         * @description Creates an account in status `invited` and (with `send_invite`) emails a single-use invitation link. A matching `Person` record is created automatically.
         *
         *     Requires permission `user:manage`. A role assignment can be limited to a location subtree with `scope_type=location` and `location_id` (ED-26).
         */
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a user
         * @description Requires permission `user:read`.
         */
        get: operations["getUser"];
        put?: never;
        post?: never;
        /**
         * Disable and archive a user
         * @description Revokes all sessions, disables login and archives the account; the linked `Person` and the audit trail are kept.
         *
         *     Requires permission `user:manage`.
         */
        delete: operations["archiveUser"];
        options?: never;
        head?: never;
        /**
         * Update a user and role assignments
         * @description `role_assignments`, when present, replaces the full set. The last active `tenant_admin` cannot be removed or disabled (409).
         *
         *     Requires permission `user:manage`.
         */
        patch: operations["updateUser"];
        trace?: never;
    };
    "/v1/users/{id}/invitation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a user's pending invitation
         * @description Marks the invitation `revoked` (the link then answers `404 invitation-not-found`) and archives the never-activated account. `409 conflict` if the user already accepted. The action is audited.
         *
         *     Requires permission `user:manage`.
         */
        delete: operations["revokeUserInvitation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/{id}/invitation/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resend a user's invitation
         * @description For a user still in status `invited`: invalidates the previous link, issues a fresh single-use token with a new expiry and emails it. Also the way to recover from `410 invitation-expired`. `409 conflict` if the user has no pending or expired invitation (already active or disabled).
         *
         *     Requires permission `user:manage`.
         */
        post: operations["resendUserInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/{id}/mfa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Reset a user's MFA
         * @description For a user who lost their device and recovery codes: removes all MFA factors and recovery codes and revokes all their sessions. If tenant policy requires MFA the user must enrol again at the next sign-in. You cannot reset your own MFA this way (`409 conflict`; use `DELETE /v1/auth/mfa`). Audited.
         *
         *     Requires permission `user:manage`.
         */
        delete: operations["resetUserMfa"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/{id}/role-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a role assignment to a user
         * @description Adds ONE role assignment (a role for the whole organisation, or limited to a location subtree with `scope_type=location` and `location_id`, ED-26) to the user and returns the updated user with its new `ETag`. The rules of `PATCH /v1/users/{id}` apply: nobody grants a role with permissions they lack or wider than they hold them (`403`), a location-scoped assignment never grants the org-only permissions, an unknown or archived role or location is `422` (`/role_id`, `/location_id`). `409 conflict` when the user already holds the same role with the same scope or already has 20 assignments. The target's sessions are revoked (yours stays when you edit yourself) and the change is audited (`user.role_assigned`).
         *
         *     Requires permission `user:manage`.
         */
        post: operations["addUserRoleAssignment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/{id}/role-assignments/{assignment_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a role assignment of a user
         * @description Removes ONE role assignment and returns the updated user with its new `ETag`. `404` for an assignment that is not this user's. `409 conflict` (the user is unchanged) when it is the user's only assignment (add another first, or disable or archive the user), when it is the assignment that makes the last active administrator an administrator, or when it would remove your own last administrator access (`user:manage` for the whole organisation). The target's sessions are revoked (yours stays when you edit yourself) and the change is audited (`user.role_removed`).
         *
         *     Requires permission `user:manage`.
         */
        delete: operations["removeUserRoleAssignment"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/{id}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a user's active sessions
         * @description Administrator view of the same device list as `GET /v1/auth/sessions` (`current` is always false). Not paginated.
         *
         *     Requires permission `user:manage`.
         */
        get: operations["listUserSessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/{id}/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke one session of a user
         * @description Revokes a single session of another user (the user's whole set is also revoked by role change, deactivation and password reset). Audited.
         *
         *     Requires permission `user:manage`.
         */
        delete: operations["revokeUserSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/vendors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List vendors
         * @description Cursor-paginated list.
         *
         *     Requires permission `catalog:read`.
         */
        get: operations["listVendors"];
        put?: never;
        /**
         * Create vendor
         * @description Requires permission `catalog:manage`.
         */
        post: operations["createVendor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/vendors/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get vendor
         * @description Requires permission `catalog:read`.
         */
        get: operations["getVendor"];
        put?: never;
        post?: never;
        /**
         * Archive vendor
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `catalog:manage`.
         */
        delete: operations["archiveVendor"];
        options?: never;
        head?: never;
        /**
         * Update vendor
         * @description Requires permission `catalog:manage`.
         */
        patch: operations["updateVendor"];
        trace?: never;
    };
    "/v1/version": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Build version
         * @description Name, version, commit and process role of the running build. No credential needed.
         */
        get: operations["getVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AssetCloneRequest: {
            /** @default 1 */
            count?: number;
            /** @description Fields to copy from the source. Default - all of them. */
            copy_fields?: ("name" | "model_id" | "status_id" | "vendor_id" | "location_id" | "department_id" | "parent_asset_id" | "purchase_date" | "purchase_cost" | "order_number" | "warranty_end" | "notes" | "custom_data")[];
            /** @description One explicit tag per copy; omit to generate them from the numbering template. */
            asset_tags?: string[];
        };
        AssetCloneResult: {
            data: components["schemas"]["Asset"][];
        };
        BulkAssetIds: {
            ids: string[];
        };
        BulkAssetUpdate: {
            ids: string[];
            /** @description At least one of these. `custom_data` merges per key (`null` removes a key). */
            changes: {
                /** Format: uuid */
                status_id?: string;
                /** Format: uuid */
                category_id?: string;
                /** Format: uuid */
                model_id?: string | null;
                /** Format: uuid */
                vendor_id?: string | null;
                /**
                 * Format: uuid
                 * @description [ED-17] Department for every listed asset; `null` clears it.
                 */
                department_id?: string | null;
                custom_data?: components["schemas"]["CustomData"];
            };
        };
        BulkAssetResult: {
            results: {
                index: number;
                /** @description HTTP status the single-asset operation would have returned. */
                status: number;
                data?: components["schemas"]["Asset"];
                error?: components["schemas"]["Problem"];
            }[];
            summary: {
                total: number;
                succeeded: number;
                failed: number;
            };
        };
        AssetTagTemplate: {
            /** @default  */
            prefix?: string;
            /**
             * @description Zero-padded width of the counter.
             * @default 5
             */
            width?: number;
            /** @default true */
            use_category_prefix?: boolean;
            /** @description A sample tag produced by the template (counter 42). */
            readonly example?: string;
        };
        /** @description Health of the API process and its database. `200` when `ok`, `503` (same shape) when `degraded`. */
        HealthResponse: {
            /** @enum {string} */
            status: "ok" | "degraded";
            checks: {
                db: {
                    /** @enum {string} */
                    status: "ok" | "error";
                    /** @description Round trip of the database probe (only when `ok`). */
                    latencyMs?: number;
                    /** @description Why the probe failed (only when `error`). */
                    error?: string;
                };
            };
            uptimeSeconds: number;
        };
        VersionResponse: {
            /** @description Package name of the API build. */
            name: string;
            /** @description Semantic version of the build. */
            version: string;
            /** @description Git commit the image was built from (`dev` for local runs). */
            commit: string;
            /** @description Process role: `api`, `worker`, `scheduler` or `migrate`. */
            role: string;
        };
        /** @description RFC 9457 problem details. */
        Problem: {
            /**
             * Format: uri-reference
             * @description Problem type URI.
             */
            type: string;
            title: string;
            status: number;
            detail?: string;
            /** Format: uri-reference */
            instance?: string;
            code?: components["schemas"]["ProblemCode"];
            request_id?: string;
            errors?: components["schemas"]["FieldError"][];
            /** @description Extension member of a `409` that refuses to delete or change something still in use: what references it (for example `{"assets": 12, "models": 3}`). */
            usage?: {
                [key: string]: number;
            };
        };
        /**
         * @description Stable machine-readable problem code. The set is open (new codes may appear): branch on codes you know and fall back to the HTTP status. The full catalogue (code, HTTP status, meaning) is the root `x-problem-codes` extension of this document; each error response lists its own subset in `x-problem-codes`.
         * @example validation
         * @example invalid-credentials
         * @example mfa-enrolment-required
         * @example asset-already-checked-out
         */
        ProblemCode: string;
        FieldError: {
            /** @description JSON pointer into the request body, or `query:<name>`. */
            pointer: string;
            message: string;
            /** @description Per-field code, e.g. `pattern`, `required`; for passwords `too-short`, `too-long`, `breached`. */
            code?: string;
        };
        PageInfo: {
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
            has_more: boolean;
            /** @description Only with `include_total=true`. */
            total?: number | null;
        };
        Money: {
            /**
             * Format: int64
             * @description Integer minor units (cents).
             */
            amount_minor: number;
            /** @description ISO 4217. */
            currency: string;
        };
        /** @description Custom field values keyed by `custom_field_def.key`; validated against the definitions. */
        CustomData: {
            [key: string]: unknown;
        };
        Address: {
            line1?: string | null;
            line2?: string | null;
            city?: string | null;
            region?: string | null;
            postal_code?: string | null;
            /** @description ISO 3166-1 alpha-2: exactly two letters, stored upper-case (`no` is saved as `NO`); anything else is a 422 on `/address/country`. */
            country?: string | null;
        };
        /** @description Exactly one target: a person, a location, or another asset. */
        AssignmentTarget: {
            /** Format: uuid */
            person_id?: string;
            /** Format: uuid */
            location_id?: string;
            /** Format: uuid */
            target_asset_id?: string;
        } & (unknown | unknown | unknown);
        Category: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            name: string;
            /**
             * @description Fixed at creation; assets, models, accessories and consumables only accept categories of their own kind.
             * @default asset
             * @enum {string}
             */
            kind?: "asset" | "accessory" | "consumable" | "component" | "license";
            /** @description Prefix for generated asset tags, e.g. `LAP-`. */
            tag_prefix?: string | null;
            description?: string | null;
        };
        CategoryCreate: {
            name: string;
            /**
             * @description Fixed at creation; assets, models, accessories and consumables only accept categories of their own kind.
             * @default asset
             * @enum {string}
             */
            kind?: "asset" | "accessory" | "consumable" | "component" | "license";
            /** @description Prefix for generated asset tags, e.g. `LAP-`. */
            tag_prefix?: string | null;
            description?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        CategoryUpdate: {
            name?: string;
            /**
             * @description Fixed at creation; assets, models, accessories and consumables only accept categories of their own kind.
             * @default asset
             * @enum {string}
             */
            kind?: "asset" | "accessory" | "consumable" | "component" | "license";
            /** @description Prefix for generated asset tags, e.g. `LAP-`. */
            tag_prefix?: string | null;
            description?: string | null;
        };
        CategoryList: {
            data: components["schemas"]["Category"][];
            page: components["schemas"]["PageInfo"];
        };
        Manufacturer: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            name: string;
            /** Format: uri */
            url?: string | null;
            /** Format: uri */
            support_url?: string | null;
            /** Format: email */
            support_email?: string | null;
            support_phone?: string | null;
            notes?: string | null;
        };
        ManufacturerCreate: {
            name: string;
            /** Format: uri */
            url?: string | null;
            /** Format: uri */
            support_url?: string | null;
            /** Format: email */
            support_email?: string | null;
            support_phone?: string | null;
            notes?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        ManufacturerUpdate: {
            name?: string;
            /** Format: uri */
            url?: string | null;
            /** Format: uri */
            support_url?: string | null;
            /** Format: email */
            support_email?: string | null;
            support_phone?: string | null;
            notes?: string | null;
        };
        ManufacturerList: {
            data: components["schemas"]["Manufacturer"][];
            page: components["schemas"]["PageInfo"];
        };
        Vendor: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            name: string;
            contact_name?: string | null;
            /** Format: email */
            contact_email?: string | null;
            phone?: string | null;
            /** Format: uri */
            url?: string | null;
            address?: string | null;
            notes?: string | null;
        };
        VendorCreate: {
            name: string;
            contact_name?: string | null;
            /** Format: email */
            contact_email?: string | null;
            phone?: string | null;
            /** Format: uri */
            url?: string | null;
            address?: string | null;
            notes?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        VendorUpdate: {
            name?: string;
            contact_name?: string | null;
            /** Format: email */
            contact_email?: string | null;
            phone?: string | null;
            /** Format: uri */
            url?: string | null;
            address?: string | null;
            notes?: string | null;
        };
        VendorList: {
            data: components["schemas"]["Vendor"][];
            page: components["schemas"]["PageInfo"];
        };
        AssetModel: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /**
             * Format: uuid
             * @description An asset-kind category.
             */
            category_id: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            name: string;
            model_number?: string | null;
            default_depreciation_months?: number | null;
            /** Format: date */
            eol_date?: string | null;
            notes?: string | null;
            /**
             * Format: uuid
             * @description Primary picture: an image attachment (`entity_type=asset_model`) of this model. Upload it with `POST /v1/attachments`, then set its id here; `null` clears it.
             */
            image_attachment_id?: string | null;
        };
        AssetModelCreate: {
            /**
             * Format: uuid
             * @description An asset-kind category.
             */
            category_id: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            name: string;
            model_number?: string | null;
            default_depreciation_months?: number | null;
            /** Format: date */
            eol_date?: string | null;
            notes?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        AssetModelUpdate: {
            /**
             * Format: uuid
             * @description An asset-kind category.
             */
            category_id?: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            name?: string;
            model_number?: string | null;
            default_depreciation_months?: number | null;
            /** Format: date */
            eol_date?: string | null;
            notes?: string | null;
            /**
             * Format: uuid
             * @description Primary picture: an image attachment (`entity_type=asset_model`) of this model. Upload it with `POST /v1/attachments`, then set its id here; `null` clears it.
             */
            image_attachment_id?: string | null;
        };
        AssetModelList: {
            data: components["schemas"]["AssetModel"][];
            page: components["schemas"]["PageInfo"];
        };
        StatusLabel: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            name: string;
            /**
             * @description Fixed state types; labels are configurable.
             * @enum {string}
             */
            state_type: "deployable" | "deployed" | "pending" | "undeployable" | "archived" | "lost";
            color?: string | null;
            description?: string | null;
            /** @default 0 */
            position?: number;
            /**
             * @description Status given to newly created assets; exactly one non-archived label is the default.
             * @default false
             */
            is_default?: boolean;
        };
        StatusLabelCreate: {
            name: string;
            /**
             * @description Fixed state types; labels are configurable.
             * @enum {string}
             */
            state_type: "deployable" | "deployed" | "pending" | "undeployable" | "archived" | "lost";
            color?: string | null;
            description?: string | null;
            /** @default 0 */
            position?: number;
            /**
             * @description Status given to newly created assets; exactly one non-archived label is the default.
             * @default false
             */
            is_default?: boolean;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        StatusLabelUpdate: {
            name?: string;
            /**
             * @description Fixed state types; labels are configurable.
             * @enum {string}
             */
            state_type?: "deployable" | "deployed" | "pending" | "undeployable" | "archived" | "lost";
            color?: string | null;
            description?: string | null;
            /** @default 0 */
            position?: number;
            /**
             * @description Status given to newly created assets; exactly one non-archived label is the default.
             * @default false
             */
            is_default?: boolean;
        };
        StatusLabelList: {
            data: components["schemas"]["StatusLabel"][];
            page: components["schemas"]["PageInfo"];
        };
        CustomFieldDef: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /**
             * Format: uuid
             * @description Null = applies to every asset category.
             */
            category_id?: string | null;
            /** @description Key inside `custom_data`; immutable after creation. */
            key: string;
            label: string;
            /** @enum {string} */
            data_type: "text" | "long_text" | "number" | "boolean" | "date" | "select" | "multiselect" | "url" | "email";
            /** @default false */
            required?: boolean;
            /** @description Required for select / multiselect. */
            options?: {
                value: string;
                label?: string;
            }[] | null;
            /** @description e.g. `{"min":0,"max":100}` or `{"pattern":"^[A-Z]{2}-\\d+$"}`. */
            validation?: {
                [key: string]: unknown;
            } | null;
            help_text?: string | null;
            /** @default 0 */
            position?: number;
            /** @default false */
            show_in_list?: boolean;
        };
        CustomFieldDefCreate: {
            /**
             * Format: uuid
             * @description Null = applies to every asset category.
             */
            category_id?: string | null;
            /** @description Key inside `custom_data`; immutable after creation. */
            key: string;
            label: string;
            /** @enum {string} */
            data_type: "text" | "long_text" | "number" | "boolean" | "date" | "select" | "multiselect" | "url" | "email";
            /** @default false */
            required?: boolean;
            /** @description Required for select / multiselect. */
            options?: {
                value: string;
                label?: string;
            }[] | null;
            /** @description e.g. `{"min":0,"max":100}` or `{"pattern":"^[A-Z]{2}-\\d+$"}`. */
            validation?: {
                [key: string]: unknown;
            } | null;
            help_text?: string | null;
            /** @default 0 */
            position?: number;
            /** @default false */
            show_in_list?: boolean;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        CustomFieldDefUpdate: {
            /**
             * Format: uuid
             * @description Null = applies to every asset category.
             */
            category_id?: string | null;
            /** @description Key inside `custom_data`; immutable after creation. */
            key?: string;
            label?: string;
            /** @enum {string} */
            data_type?: "text" | "long_text" | "number" | "boolean" | "date" | "select" | "multiselect" | "url" | "email";
            /** @default false */
            required?: boolean;
            /** @description Required for select / multiselect. */
            options?: {
                value: string;
                label?: string;
            }[] | null;
            /** @description e.g. `{"min":0,"max":100}` or `{"pattern":"^[A-Z]{2}-\\d+$"}`. */
            validation?: {
                [key: string]: unknown;
            } | null;
            help_text?: string | null;
            /** @default 0 */
            position?: number;
            /** @default false */
            show_in_list?: boolean;
        };
        CustomFieldDefList: {
            data: components["schemas"]["CustomFieldDef"][];
            page: components["schemas"]["PageInfo"];
        };
        Location: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /**
             * Format: uuid
             * @description Parent location; null = root. Moving a location re-parents its subtree.
             */
            parent_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default company.
             */
            company_id?: string;
            name: string;
            /**
             * @default other
             * @enum {string}
             */
            kind?: "site" | "building" | "floor" | "room" | "storage" | "vehicle" | "other";
            code?: string | null;
            address?: components["schemas"]["Address"] | null;
            latitude?: number | null;
            longitude?: number | null;
            notes?: string | null;
            /** @description Distance from the root (a root has depth 0). The hierarchy is limited to depth 9, i.e. ten levels. */
            readonly depth?: number;
            /** @description Root..self. */
            readonly ancestor_ids?: string[];
            /** @description Live (not archived) assets located here **or in any descendant** location. */
            readonly asset_count?: number;
            /** @description Live assets located exactly here. */
            readonly direct_asset_count?: number;
            /** @description Live direct child locations. */
            readonly child_count?: number;
        };
        LocationCreate: {
            /**
             * Format: uuid
             * @description Parent location; null = root. Moving a location re-parents its subtree.
             */
            parent_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default company.
             */
            company_id?: string;
            name: string;
            /**
             * @default other
             * @enum {string}
             */
            kind?: "site" | "building" | "floor" | "room" | "storage" | "vehicle" | "other";
            code?: string | null;
            address?: components["schemas"]["Address"] | null;
            latitude?: number | null;
            longitude?: number | null;
            notes?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        LocationUpdate: {
            /**
             * Format: uuid
             * @description Parent location; null = root. Moving a location re-parents its subtree.
             */
            parent_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default company.
             */
            company_id?: string;
            name?: string;
            /**
             * @default other
             * @enum {string}
             */
            kind?: "site" | "building" | "floor" | "room" | "storage" | "vehicle" | "other";
            code?: string | null;
            address?: components["schemas"]["Address"] | null;
            latitude?: number | null;
            longitude?: number | null;
            notes?: string | null;
        };
        LocationList: {
            data: components["schemas"]["Location"][];
            page: components["schemas"]["PageInfo"];
        };
        Person: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /**
             * @default employee
             * @enum {string}
             */
            kind?: "employee" | "student" | "contractor" | "external";
            display_name: string;
            first_name?: string | null;
            last_name?: string | null;
            /** Format: email */
            email?: string | null;
            phone?: string | null;
            /** @description Unique per tenant when set (employee / student number). */
            employee_ref?: string | null;
            /**
             * Format: uuid
             * @description [ED-17] A managed department (`POST /v1/departments`); `null` = none. Replaces the free-text department.
             */
            department_id?: string | null;
            job_title?: string | null;
            /**
             * Format: uuid
             * @description Primary or home location.
             */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            /**
             * @default active
             * @enum {string}
             */
            status?: "active" | "inactive";
            notes?: string | null;
            /**
             * Format: uuid
             * @description Linked login account, if this person can sign in.
             */
            readonly user_id?: string | null;
            /** @description [ED-17] The NAME of the linked department (read-only; write `department_id`). Kept so readers of the old free-text field keep working. */
            readonly department?: string | null;
            /** @description Number of assets currently checked out to this person. */
            readonly assets_held?: number;
            /** @description [ED-33] True for the login account's own automatic person record: the one the system made when the login was created (ED-15) or after an unlink, never chosen by anybody (`user_id` set, no `created_by` and no `updated_by`: a person that was linked to the login, or edited, is not). Such a record cannot be unlinked (409); link the login to a real person instead (`POST /v1/people/{id}/link-user`). */
            readonly is_login_placeholder?: boolean;
        };
        PersonCreate: {
            /**
             * @default employee
             * @enum {string}
             */
            kind?: "employee" | "student" | "contractor" | "external";
            display_name: string;
            first_name?: string | null;
            last_name?: string | null;
            /** Format: email */
            email?: string | null;
            phone?: string | null;
            /** @description Unique per tenant when set (employee / student number). */
            employee_ref?: string | null;
            /**
             * Format: uuid
             * @description [ED-17] A managed department (`POST /v1/departments`); `null` = none. Replaces the free-text department.
             */
            department_id?: string | null;
            job_title?: string | null;
            /**
             * Format: uuid
             * @description Primary or home location.
             */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            /**
             * @default active
             * @enum {string}
             */
            status?: "active" | "inactive";
            notes?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        PersonUpdate: {
            /**
             * @default employee
             * @enum {string}
             */
            kind?: "employee" | "student" | "contractor" | "external";
            display_name?: string;
            first_name?: string | null;
            last_name?: string | null;
            /** Format: email */
            email?: string | null;
            phone?: string | null;
            /** @description Unique per tenant when set (employee / student number). */
            employee_ref?: string | null;
            /**
             * Format: uuid
             * @description [ED-17] A managed department (`POST /v1/departments`); `null` = none. Replaces the free-text department.
             */
            department_id?: string | null;
            job_title?: string | null;
            /**
             * Format: uuid
             * @description Primary or home location.
             */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            /**
             * @default active
             * @enum {string}
             */
            status?: "active" | "inactive";
            notes?: string | null;
            /**
             * @description With `status: "inactive"`: deactivate even though the person still holds assets. Needs `reason`. Not stored on the person.
             * @default false
             */
            force?: boolean;
            /** @description Why a forced deactivation is justified (audit trail). Ignored without `force`. */
            reason?: string;
        };
        PersonList: {
            data: components["schemas"]["Person"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description A managed department: chosen from a list instead of typed, so the same department is never spelled three ways. People and assets reference it by id. */
        Department: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /** @description Unique among the live departments of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`). */
            name: string;
            /** @description Short code or cost-centre number; unique among live departments when set (409, pointer `/code`). An empty string means none. */
            code?: string | null;
            description?: string | null;
            /**
             * Format: uuid
             * @description The head of the department: a live person (422 on `/manager_person_id` otherwise).
             */
            manager_person_id?: string | null;
            /** @description Display name of the manager. */
            readonly manager_name?: string | null;
            /** @description Live (not archived) people in this department. Present on the department endpoints only. */
            readonly person_count?: number;
            /** @description Live (not archived) assets owned by this department. Present on the department endpoints only. */
            readonly asset_count?: number;
        };
        DepartmentCreate: {
            /** @description Unique among the live departments of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`). */
            name: string;
            /** @description Short code or cost-centre number; unique among live departments when set (409, pointer `/code`). An empty string means none. */
            code?: string | null;
            description?: string | null;
            /**
             * Format: uuid
             * @description The head of the department: a live person (422 on `/manager_person_id` otherwise).
             */
            manager_person_id?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        DepartmentUpdate: {
            /** @description Unique among the live departments of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`). */
            name?: string;
            /** @description Short code or cost-centre number; unique among live departments when set (409, pointer `/code`). An empty string means none. */
            code?: string | null;
            description?: string | null;
            /**
             * Format: uuid
             * @description The head of the department: a live person (422 on `/manager_person_id` otherwise).
             */
            manager_person_id?: string | null;
        };
        DepartmentList: {
            data: components["schemas"]["Department"][];
            page: components["schemas"]["PageInfo"];
        };
        Accessory: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /**
             * Format: uuid
             * @description An accessory-kind category.
             */
            category_id: string;
            name: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            model_number?: string | null;
            qty_total: number;
            /**
             * @description Low-stock alert threshold on available quantity.
             * @default 0
             */
            min_qty?: number;
            /** Format: date */
            purchase_date?: string | null;
            /** @description Per-unit or total cost; unit semantics are tenant convention. */
            purchase_cost?: components["schemas"]["Money"] | null;
            notes?: string | null;
            /** @description Units still out: the sum of `quantity - quantity_returned` over the open assignments. */
            readonly qty_checked_out: number;
            /** @description `qty_total - qty_checked_out`: what can be checked out right now. */
            readonly qty_available: number;
            /** @description True while `min_qty > 0` and `qty_available <= min_qty`. */
            readonly low_stock: boolean;
            /** @description Opaque QR payload of the label: `GET /v1/scan/resolve?code=` answers it with `entity_type: accessory`. */
            readonly label_code: string;
        };
        AccessoryCreate: {
            /**
             * Format: uuid
             * @description An accessory-kind category.
             */
            category_id: string;
            name: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            model_number?: string | null;
            qty_total: number;
            /**
             * @description Low-stock alert threshold on available quantity.
             * @default 0
             */
            min_qty?: number;
            /** Format: date */
            purchase_date?: string | null;
            /** @description Per-unit or total cost; unit semantics are tenant convention. */
            purchase_cost?: components["schemas"]["Money"] | null;
            notes?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        AccessoryUpdate: {
            /**
             * Format: uuid
             * @description An accessory-kind category.
             */
            category_id?: string;
            name?: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            model_number?: string | null;
            qty_total?: number;
            /**
             * @description Low-stock alert threshold on available quantity.
             * @default 0
             */
            min_qty?: number;
            /** Format: date */
            purchase_date?: string | null;
            /** @description Per-unit or total cost; unit semantics are tenant convention. */
            purchase_cost?: components["schemas"]["Money"] | null;
            notes?: string | null;
        };
        AccessoryList: {
            data: components["schemas"]["Accessory"][];
            page: components["schemas"]["PageInfo"];
        };
        Consumable: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /**
             * Format: uuid
             * @description A consumable-kind category.
             */
            category_id: string;
            name: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            model_number?: string | null;
            /** @default each */
            unit?: string;
            /**
             * @description Low-stock alert threshold.
             * @default 0
             */
            min_qty?: number;
            unit_cost?: components["schemas"]["Money"] | null;
            notes?: string | null;
            /** @description Changed only through stock movements; always the sum of the ledger. */
            readonly qty_on_hand: number;
            /** @description True while `min_qty > 0` and `qty_on_hand <= min_qty`. */
            readonly low_stock: boolean;
            /** @description Opaque QR payload of the label: `GET /v1/scan/resolve?code=` answers it with `entity_type: consumable`. */
            readonly label_code: string;
        };
        ConsumableCreate: {
            /**
             * Format: uuid
             * @description A consumable-kind category.
             */
            category_id: string;
            name: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            model_number?: string | null;
            /** @default each */
            unit?: string;
            /**
             * @description Low-stock alert threshold.
             * @default 0
             */
            min_qty?: number;
            unit_cost?: components["schemas"]["Money"] | null;
            notes?: string | null;
            /**
             * @description Creates an initial `receive` stock movement.
             * @default 0
             */
            initial_qty?: number;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        ConsumableUpdate: {
            /**
             * Format: uuid
             * @description A consumable-kind category.
             */
            category_id?: string;
            name?: string;
            /** Format: uuid */
            manufacturer_id?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            company_id?: string;
            model_number?: string | null;
            /** @default each */
            unit?: string;
            /**
             * @description Low-stock alert threshold.
             * @default 0
             */
            min_qty?: number;
            unit_cost?: components["schemas"]["Money"] | null;
            notes?: string | null;
        };
        ConsumableList: {
            data: components["schemas"]["Consumable"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description A loaner pool (ED-20): a named set of spare devices (a Chromebook cart, a laptop trolley) with loan rules. An asset belongs to at most one pool. */
        LoanerPool: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /** @description Unique among the live pools of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`). */
            name: string;
            description?: string | null;
            /**
             * Format: uuid
             * @description Where returned devices go back to: a quick return moves the asset here unless the request names another location.
             */
            home_location_id?: string | null;
            /** @description Length of a loan when the request has no `expected_return`: today (UTC) + this many days. null (the default) = the organisation's `default_expected_return_days` (`GET /v1/settings/custody`), else 7 (ED-24); the result is never longer than `max_loan_days`. */
            default_loan_days?: number | null;
            /** @description Longest a loan may run, counted from the day it started (also bounds an extension). Must be >= default_loan_days when that is set; null = no limit. */
            max_loan_days?: number | null;
            /** @description Most open loans one person may hold from this pool at once (409 `loan-limit-reached`); null = no limit. */
            max_loans_per_person?: number | null;
            /** @description Kinds of people who may borrow from the pool (422 `not-eligible` otherwise); null = every kind. */
            eligible_person_kinds?: ("employee" | "student" | "contractor" | "external")[] | null;
            /**
             * Format: uuid
             * @description The user told about overdue loans of this pool in addition to the borrower; without one the users who hold `loaner:manage` are told.
             */
            owner_user_id?: string | null;
            /**
             * @description false = the pool lends nothing (409 `loaner-pool-inactive`) but keeps its members and open loans.
             * @default true
             */
            is_active?: boolean;
            /** @description Whether a borrower who has no login account but has an e-mail address gets the due-soon and overdue e-mails (no in-app notification, there is no account). null (the default) = automatic: every kind of person except students; true = every borrower with an address; false = nobody (ED-24). Overdue loans are always also reported to the pool owner or the loaner managers. */
            email_borrowers_without_login: boolean | null;
            /** @description The loan length a request without `expected_return` gets right now: `default_loan_days`, else the organisation's `default_expected_return_days`, else 7, cut to `max_loan_days` (ED-24). What the loaner desk pre-fills. */
            readonly effective_default_loan_days: number;
            /** @description Live (not archived) assets in the pool. */
            readonly member_count: number;
            /** @description Members that can be lent right now: not archived, in a `deployable` state and not checked out. */
            readonly available_count: number;
            /** @description Members that are checked out (a loan from the pool or a regular check-out). */
            readonly checked_out_count: number;
            /** @description Checked-out members whose `expected_return` is before today (UTC). */
            readonly overdue_count: number;
            /** @description Checked-out members whose `expected_return` is today (UTC). */
            readonly due_today_count: number;
        };
        LoanerPoolCreate: {
            /** @description Unique among the live pools of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`). */
            name: string;
            description?: string | null;
            /**
             * Format: uuid
             * @description Where returned devices go back to: a quick return moves the asset here unless the request names another location.
             */
            home_location_id?: string | null;
            /** @description Length of a loan when the request has no `expected_return`: today (UTC) + this many days. null (the default) = the organisation's `default_expected_return_days` (`GET /v1/settings/custody`), else 7 (ED-24); the result is never longer than `max_loan_days`. */
            default_loan_days?: number | null;
            /** @description Longest a loan may run, counted from the day it started (also bounds an extension). Must be >= default_loan_days when that is set; null = no limit. */
            max_loan_days?: number | null;
            /** @description Most open loans one person may hold from this pool at once (409 `loan-limit-reached`); null = no limit. */
            max_loans_per_person?: number | null;
            /** @description Kinds of people who may borrow from the pool (422 `not-eligible` otherwise); null = every kind. */
            eligible_person_kinds?: ("employee" | "student" | "contractor" | "external")[] | null;
            /**
             * Format: uuid
             * @description The user told about overdue loans of this pool in addition to the borrower; without one the users who hold `loaner:manage` are told.
             */
            owner_user_id?: string | null;
            /**
             * @description false = the pool lends nothing (409 `loaner-pool-inactive`) but keeps its members and open loans.
             * @default true
             */
            is_active?: boolean;
            /** @description Whether a borrower who has no login account but has an e-mail address gets the due-soon and overdue e-mails (no in-app notification, there is no account). null (the default) = automatic: every kind of person except students; true = every borrower with an address; false = nobody (ED-24). Overdue loans are always also reported to the pool owner or the loaner managers. */
            email_borrowers_without_login?: boolean | null;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        LoanerPoolUpdate: {
            /** @description Unique among the live pools of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`). */
            name?: string;
            description?: string | null;
            /**
             * Format: uuid
             * @description Where returned devices go back to: a quick return moves the asset here unless the request names another location.
             */
            home_location_id?: string | null;
            /** @description Length of a loan when the request has no `expected_return`: today (UTC) + this many days. null (the default) = the organisation's `default_expected_return_days` (`GET /v1/settings/custody`), else 7 (ED-24); the result is never longer than `max_loan_days`. */
            default_loan_days?: number | null;
            /** @description Longest a loan may run, counted from the day it started (also bounds an extension). Must be >= default_loan_days when that is set; null = no limit. */
            max_loan_days?: number | null;
            /** @description Most open loans one person may hold from this pool at once (409 `loan-limit-reached`); null = no limit. */
            max_loans_per_person?: number | null;
            /** @description Kinds of people who may borrow from the pool (422 `not-eligible` otherwise); null = every kind. */
            eligible_person_kinds?: ("employee" | "student" | "contractor" | "external")[] | null;
            /**
             * Format: uuid
             * @description The user told about overdue loans of this pool in addition to the borrower; without one the users who hold `loaner:manage` are told.
             */
            owner_user_id?: string | null;
            /**
             * @description false = the pool lends nothing (409 `loaner-pool-inactive`) but keeps its members and open loans.
             * @default true
             */
            is_active?: boolean;
            /** @description Whether a borrower who has no login account but has an e-mail address gets the due-soon and overdue e-mails (no in-app notification, there is no account). null (the default) = automatic: every kind of person except students; true = every borrower with an address; false = nobody (ED-24). Overdue loans are always also reported to the pool owner or the loaner managers. */
            email_borrowers_without_login?: boolean | null;
        };
        LoanerPoolList: {
            data: components["schemas"]["LoanerPool"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Repair / maintenance log entry (table `maintenance_record`). */
        Repair: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /** Format: uuid */
            asset_id: string;
            /**
             * @default repair
             * @enum {string}
             */
            kind?: "repair" | "maintenance" | "inspection" | "upgrade";
            title: string;
            description?: string | null;
            /** Format: date-time */
            reported_at?: string;
            /** Format: date-time */
            started_at?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            performed_by_person_id?: string | null;
            ticket_ref?: string | null;
            cost?: components["schemas"]["Money"] | null;
            /**
             * Format: uuid
             * @description Asset status restored on completion. Defaults to the asset status before the repair opened.
             */
            restore_status_id?: string | null;
            /** @enum {string} */
            status?: "open" | "in_progress" | "completed" | "cancelled";
            /** Format: date-time */
            readonly completed_at?: string | null;
            readonly resolution_notes?: string | null;
            /**
             * Format: uuid
             * @description The status label the asset was moved to when the repair opened (null when the repair did not move it).
             */
            readonly set_status_id?: string | null;
            /** @description Tag of the asset, so lists can label their rows. */
            readonly asset_tag?: string | null;
            readonly asset_name?: string | null;
            readonly vendor_name?: string | null;
        };
        RepairCreate: {
            /** Format: uuid */
            asset_id: string;
            /**
             * @default repair
             * @enum {string}
             */
            kind?: "repair" | "maintenance" | "inspection" | "upgrade";
            title: string;
            description?: string | null;
            /** Format: date-time */
            reported_at?: string;
            /** Format: date-time */
            started_at?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            performed_by_person_id?: string | null;
            ticket_ref?: string | null;
            cost?: components["schemas"]["Money"] | null;
            /**
             * Format: uuid
             * @description Asset status restored on completion. Defaults to the asset status before the repair opened.
             */
            restore_status_id?: string | null;
            /**
             * @description Initial status (`in_progress` also sets `started_at`). A record is closed by `POST /v1/repairs/{id}/complete` or by cancelling it.
             * @default open
             * @enum {string}
             */
            status?: "open" | "in_progress";
            /**
             * Format: uuid
             * @description Status label to put the asset in while the repair is open (typically an undeployable label such as "In repair"). Required with `force_checkin`.
             */
            set_status_id?: string;
            /** @description Ids of attachments (photos, invoices) uploaded against the asset beforehand: they are re-pointed at this repair record. */
            attachment_ids?: string[];
            /**
             * @description The asset is checked out: close its custody period (a check-in) and open the repair in one step. Needs `asset:checkin` as well as `repair:manage`, and `force_note`. Without it a checked-out asset is refused with `409 asset-already-checked-out` (check it in first).
             * @default false
             */
            force_checkin?: boolean;
            /** @description Why the custody period is closed (recorded on the check-in, the history and the audit log). Required with `force_checkin`. */
            force_note?: string;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        RepairUpdate: {
            /**
             * @default repair
             * @enum {string}
             */
            kind?: "repair" | "maintenance" | "inspection" | "upgrade";
            title?: string;
            description?: string | null;
            /** Format: date-time */
            reported_at?: string;
            /** Format: date-time */
            started_at?: string | null;
            /** Format: uuid */
            vendor_id?: string | null;
            /** Format: uuid */
            performed_by_person_id?: string | null;
            ticket_ref?: string | null;
            cost?: components["schemas"]["Money"] | null;
            /**
             * Format: uuid
             * @description Asset status restored on completion. Defaults to the asset status before the repair opened.
             */
            restore_status_id?: string | null;
            /**
             * @description Move to `in_progress`, or `cancelled` (restores the asset status like a completion). A closed record (`completed`, `cancelled`) keeps its status.
             * @enum {string}
             */
            status?: "open" | "in_progress" | "cancelled";
        };
        RepairList: {
            data: components["schemas"]["Repair"][];
            page: components["schemas"]["PageInfo"];
        };
        AssignmentSummary: {
            /** Format: uuid */
            assignment_id: string;
            /** @enum {string} */
            target_type: "person" | "location" | "asset";
            /** Format: uuid */
            target_id: string;
            target_name?: string | null;
            /** Format: date-time */
            checked_out_at: string;
            /** Format: date */
            expected_return?: string | null;
            /** @description [M2-W1] Computed: the assignment is open and `expected_return` is before today (UTC). */
            overdue?: boolean;
            /** Format: uuid */
            loaner_pool_id?: string | null;
        };
        /** @description [M2-W1] Why and when the asset left the inventory. */
        AssetDisposal: {
            /** Format: date */
            disposed_on: string;
            /** @enum {string} */
            reason: "sold" | "donated" | "recycled" | "scrapped" | "stolen" | "returned_to_vendor" | "other";
            note?: string | null;
        };
        Asset: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /** @description Unique per tenant (case-insensitive). If omitted on create, generated from the category `tag_prefix`. */
            asset_tag: string;
            name?: string | null;
            serial?: string | null;
            /**
             * Format: uuid
             * @description An asset-kind category. Must equal the model's category when a model is set.
             */
            category_id: string;
            /** Format: uuid */
            model_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default status label.
             */
            status_id: string;
            /** Format: uuid */
            location_id?: string | null;
            /**
             * Format: uuid
             * @description [ED-17] The owning / cost-centre department (optional); where the asset is stays `location_id`.
             */
            department_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default company.
             */
            company_id?: string;
            /** Format: uuid */
            vendor_id?: string | null;
            /**
             * Format: uuid
             * @description Parent asset (e.g. a laptop in a cart).
             */
            parent_asset_id?: string | null;
            /** Format: date */
            purchase_date?: string | null;
            purchase_cost?: components["schemas"]["Money"] | null;
            order_number?: string | null;
            /** Format: date */
            warranty_end?: string | null;
            notes?: string | null;
            custom_data: components["schemas"]["CustomData"];
            /** @description Origin system, e.g. `snipe_it`, `google_admin`. Set together with `external_id`. */
            external_source?: string | null;
            external_id?: string | null;
            /** @description Opaque, unguessable code encoded in the QR label URL. */
            readonly label_code?: string;
            /** @description Open custody period, or null when in stock. */
            readonly current_assignment?: components["schemas"]["AssignmentSummary"] | null;
            /** @description Set once the asset was disposed of (`POST /v1/assets/{id}/dispose`); null otherwise. */
            readonly disposal?: components["schemas"]["AssetDisposal"] | null;
            readonly status?: {
                /** Format: uuid */
                id: string;
                name: string;
                state_type: string;
            };
            /** @description Related objects requested through `expand` (model, category, location, vendor, department). */
            readonly expanded?: {
                [key: string]: unknown;
            };
            /**
             * Format: uuid
             * @description Primary picture: an image attachment (`entity_type=asset`) of this asset. Upload it with `POST /v1/attachments`, then set its id here; `null` clears it. Not accepted on create.
             */
            image_attachment_id?: string | null;
        };
        AssetCreate: {
            /** @description Unique per tenant (case-insensitive). If omitted on create, generated from the category `tag_prefix`. */
            asset_tag?: string;
            name?: string | null;
            serial?: string | null;
            /**
             * Format: uuid
             * @description An asset-kind category. Must equal the model's category when a model is set.
             */
            category_id: string;
            /** Format: uuid */
            model_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default status label.
             */
            status_id?: string;
            /** Format: uuid */
            location_id?: string | null;
            /**
             * Format: uuid
             * @description [ED-17] The owning / cost-centre department (optional); where the asset is stays `location_id`.
             */
            department_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default company.
             */
            company_id?: string;
            /** Format: uuid */
            vendor_id?: string | null;
            /**
             * Format: uuid
             * @description Parent asset (e.g. a laptop in a cart).
             */
            parent_asset_id?: string | null;
            /** Format: date */
            purchase_date?: string | null;
            purchase_cost?: components["schemas"]["Money"] | null;
            order_number?: string | null;
            /** Format: date */
            warranty_end?: string | null;
            notes?: string | null;
            custom_data?: components["schemas"]["CustomData"];
            /** @description Origin system, e.g. `snipe_it`, `google_admin`. Set together with `external_id`. */
            external_source?: string | null;
            external_id?: string | null;
        };
        /** @description Partial update (merge semantics). `custom_data` is merged per key; set a key to null to remove it. Changing status or location writes history events. */
        AssetUpdate: {
            /** @description Unique per tenant (case-insensitive). If omitted on create, generated from the category `tag_prefix`. */
            asset_tag?: string;
            name?: string | null;
            serial?: string | null;
            /**
             * Format: uuid
             * @description An asset-kind category. Must equal the model's category when a model is set.
             */
            category_id?: string;
            /** Format: uuid */
            model_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default status label.
             */
            status_id?: string;
            /** Format: uuid */
            location_id?: string | null;
            /**
             * Format: uuid
             * @description [ED-17] The owning / cost-centre department (optional); where the asset is stays `location_id`.
             */
            department_id?: string | null;
            /**
             * Format: uuid
             * @description Defaults to the tenant default company.
             */
            company_id?: string;
            /** Format: uuid */
            vendor_id?: string | null;
            /**
             * Format: uuid
             * @description Parent asset (e.g. a laptop in a cart).
             */
            parent_asset_id?: string | null;
            /** Format: date */
            purchase_date?: string | null;
            purchase_cost?: components["schemas"]["Money"] | null;
            order_number?: string | null;
            /** Format: date */
            warranty_end?: string | null;
            notes?: string | null;
            custom_data?: components["schemas"]["CustomData"];
            /** @description Origin system, e.g. `snipe_it`, `google_admin`. Set together with `external_id`. */
            external_source?: string | null;
            external_id?: string | null;
            /**
             * Format: uuid
             * @description Primary picture: an image attachment (`entity_type=asset`) of this asset. Upload it with `POST /v1/attachments`, then set its id here; `null` clears it. Not accepted on create.
             */
            image_attachment_id?: string | null;
        };
        AssetList: {
            data: components["schemas"]["Asset"][];
            page: components["schemas"]["PageInfo"];
        };
        ScanResolveResult: {
            /**
             * @description What the code was: the opaque `label_code` of the label, the `asset_tag`, or the device `serial` (checked in that order).
             * @enum {string}
             */
            match_type: "label_code" | "asset_tag" | "serial";
            asset: components["schemas"]["Asset"];
            /** @description Actions valid for the asset in its current state and for the caller. */
            allowed_actions: ("checkout" | "checkin" | "transfer" | "update" | "open_repair")[];
            /**
             * @description Kind of record the code identifies: always `asset` in this result. Accessories and consumables are answered with their own results (`ScanResolveAccessoryResult`, `ScanResolveConsumableResult`; see `ScanResolveResponse`), so branch on this field. (enum property replaced by openapi-typescript)
             * @enum {string}
             */
            entity_type: "asset";
        };
        /** @description A scanned accessory label. */
        ScanResolveAccessoryResult: {
            /**
             * @description Accessories are found by their `label_code` only.
             * @enum {string}
             */
            match_type: "label_code";
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            entity_type: "accessory";
            accessory: components["schemas"]["Accessory"];
            /** @description `checkout`: the caller may check units out and some are available. `checkin`: the caller may return units and some are out. `update`: the caller may edit the accessory. */
            allowed_actions: ("checkout" | "checkin" | "update")[];
        };
        /** @description A scanned consumable label. */
        ScanResolveConsumableResult: {
            /** @enum {string} */
            match_type: "label_code";
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            entity_type: "consumable";
            consumable: components["schemas"]["Consumable"];
            /** @description `issue` (consume) needs stock on hand; `receive` and `adjust` need `consumable:adjust`; `update` needs `consumable:manage`. */
            allowed_actions: ("issue" | "receive" | "adjust" | "update")[];
        };
        /** @description What a scanned code identifies. Branch on `entity_type`. */
        ScanResolveResponse: components["schemas"]["ScanResolveResult"] | components["schemas"]["ScanResolveAccessoryResult"] | components["schemas"]["ScanResolveConsumableResult"];
        /** @description One custody period. Exactly one of asset_id / accessory_id and exactly one of person_id / location_id / target_asset_id is set. */
        Assignment: {
            /** Format: uuid */
            readonly id: string;
            /** Format: uuid */
            asset_id?: string | null;
            /** Format: uuid */
            accessory_id?: string | null;
            /** Format: uuid */
            person_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            target_asset_id?: string | null;
            quantity: number;
            /** @description Units already returned. Always 0 while an asset is out and 1 once it is checked in; for accessories it grows with each partial return. `0 <= quantity_returned <= quantity`, and the assignment is closed (`checked_in_at` set) exactly when `quantity_returned = quantity`. Outstanding units = `quantity - quantity_returned`. */
            quantity_returned: number;
            /** Format: uuid */
            loaner_pool_id?: string | null;
            /** Format: date-time */
            checked_out_at: string;
            /** Format: uuid */
            checked_out_by?: string | null;
            /** Format: date */
            expected_return?: string | null;
            /** Format: date-time */
            checked_in_at?: string | null;
            /** Format: uuid */
            checked_in_by?: string | null;
            /** Format: uuid */
            checkin_location_id?: string | null;
            /** @enum {string} */
            acceptance_state: "not_required" | "pending" | "accepted" | "declined";
            note?: string | null;
            checkin_note?: string | null;
            /**
             * @description Condition of the asset when it came back (`CheckinRequest.condition`); `null` while the assignment is open or when none was stated.
             * @enum {string|null}
             */
            checkin_condition?: "good" | "fair" | "poor" | "damaged" | null;
            /** @description Photos / signatures linked at check-out (ids only; the attachments service owns the files). */
            attachment_ids?: string[];
            /** @description Photos linked at check-in. */
            checkin_attachment_ids?: string[];
            /** @description Computed: the assignment is open and `expected_return` is before today (UTC). */
            overdue?: boolean;
            /** @description Tag of the asset; present in the assignment lists of a person and of an asset. */
            asset_tag?: string | null;
            /** @description Name of the asset; present together with `asset_tag`. */
            asset_name?: string | null;
            /** @description Name of the accessory; present in the assignment lists of a person and of an accessory (accessory assignments only). */
            accessory_name?: string | null;
            /** @description Display name of the person, location or asset the units are with; present in the assignment list of an accessory. */
            target_name?: string | null;
        };
        AssignmentList: {
            data: components["schemas"]["Assignment"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Check an asset out to a person, location or another asset. */
        CheckoutRequest: components["schemas"]["AssignmentTarget"] & {
            /**
             * Format: date
             * @description Required for loaner pool check-outs.
             */
            expected_return?: string;
            note?: string;
            /**
             * @description Creates the assignment with `acceptance_state=pending`.
             * @default false
             */
            acceptance_required?: boolean;
            /** @description Photos/signatures uploaded against the asset beforehand (`POST /v1/attachments` with `entity_type=asset`; `pending` or `clean`). They are linked to the new assignment and then list under it (`entity_type=assignment`). `422` with the pointer `/attachment_ids/<index>` when an id is unknown, belongs to another asset or organisation, or was rejected (infected, error). */
            attachment_ids?: string[];
            /**
             * Format: uuid
             * @description Status to give the asset: a non-archived label of type `deployed`. Default: the organisation's first deployed label.
             */
            status_label_id?: string;
        };
        CheckinRequest: {
            /**
             * Format: uuid
             * @description Where the asset is now; also updates the asset location.
             */
            checkin_location_id?: string | null;
            /**
             * Format: uuid
             * @description Status to set on check-in (default: the tenant default deployable status).
             */
            status_id?: string | null;
            /**
             * @description Condition of the asset as it comes back; stored on the assignment (`checkin_condition`) and shown in the history.
             * @enum {string}
             */
            condition?: "good" | "fair" | "poor" | "damaged";
            note?: string;
            /** @description Photos uploaded against the asset beforehand (`pending` or `clean`); linked to the closed assignment, same rules and `422` pointers as at check-out. */
            attachment_ids?: string[];
        };
        /** @description Atomic hand-over: closes the current assignment (if any) and opens a new one to the given target. */
        TransferRequest: components["schemas"]["AssignmentTarget"] & {
            /**
             * Format: uuid
             * @description Physical destination, if different from the new assignee's location.
             */
            to_location_id?: string | null;
            /** Format: date */
            expected_return?: string;
            reason?: string;
            note?: string;
            /** @description Photos uploaded against the asset beforehand; linked to the new assignment (same rules and `422` pointers as at check-out). */
            attachment_ids?: string[];
        };
        Transfer: {
            /** Format: uuid */
            readonly id: string;
            /** Format: uuid */
            asset_id: string;
            /** Format: uuid */
            from_assignment_id?: string | null;
            /** Format: uuid */
            to_assignment_id: string;
            /** Format: uuid */
            from_location_id?: string | null;
            /** Format: uuid */
            to_location_id?: string | null;
            reason?: string | null;
            note?: string | null;
            /** Format: date-time */
            transferred_at: string;
            /** Format: uuid */
            transferred_by?: string | null;
        };
        /** @description Result of a check-out or check-in: the **updated asset** (status, location and `current_assignment` reflect the change; its new `ETag` is also in the response header) and the assignment that was opened (check-out) or closed (check-in). */
        CustodyResult: {
            asset: components["schemas"]["Asset"];
            assignment: components["schemas"]["Assignment"];
        };
        /** @description Result of a transfer: the **updated asset** (new `ETag` also in the header), the `Transfer` record and the newly opened assignment. */
        TransferResult: {
            asset: components["schemas"]["Asset"];
            transfer: components["schemas"]["Transfer"];
            assignment: components["schemas"]["Assignment"];
        };
        HistoryEvent: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            asset_id: string;
            /** Format: date-time */
            at: string;
            /** @enum {string} */
            event_type: "created" | "updated" | "status_changed" | "location_changed" | "checked_out" | "checked_in" | "transferred" | "repair_opened" | "repair_completed" | "archived" | "restored" | "label_printed" | "imported" | "custody_undone";
            /** @enum {string} */
            actor_type: "user" | "api_key" | "integration" | "system";
            /** Format: uuid */
            actor_id?: string | null;
            /** @description Who did it, resolved for display (the user, or the API key name for `actor_type: api_key`); null for system events or when the user no longer exists. */
            actor?: {
                /** Format: uuid */
                id: string;
                display_name: string;
            } | null;
            /** @description [M2-W1] Tag of the asset, so a per-person timeline can label its entries. */
            asset_tag?: string | null;
            /** Format: uuid */
            assignment_id?: string | null;
            /** Format: uuid */
            transfer_id?: string | null;
            summary?: string | null;
            /**
             * @description Event details; the keys depend on `event_type` (all ids are uuids, names are display strings, optional keys are absent when empty):
             *
             *     - `created`: `{status_id, location_id, cloned_from?}`
             *     - `updated`: `{fields: string[]}`, the names of the fields that changed
             *     - `status_changed`: `{from, to, from_name, to_name}` (status label ids and names); a lost/found mark adds `action: "lost" | "found"` and `note?`
             *     - `location_changed`: `{from, to, from_name, to_name, note?}` (location ids, `null` when unknown)
             *     - `checked_out`: `{assignment_id, target_type: "person"|"location"|"asset", target_id, target_name, expected_return, status: {from, to, from_id, to_id}, note?, attachment_ids?}`
             *     - `checked_in`: `{assignment_id, target_type, target_id, target_name, status: {from, to, from_id, to_id}, location?: {from, to}, condition?: "good"|"fair"|"poor"|"damaged", note?, attachment_ids?}`
             *     - `transferred`: `{from: {type, id, name} | null, to: {type, id, name}, from_assignment_id, to_assignment_id, status?: {from, to, from_id, to_id} (only for a transfer out of stock), location?: {from, to}, reason?, note?, attachment_ids?}`
             *     - `custody_undone` ([M2-UX-02, ED-23]): written by `POST /v1/assets/{id}/undo-custody` next to (never instead of) the event it reverses: `{undone: "checkout"|"checkin"|"transfer", undone_event_type, undone_assignment_id, assignment_id?, target_type?, target_id?, target_name?, status: {from, to}, location?: {from, to}}`
             *     - `archived`: `{}`; when the asset was disposed of: `{disposal: {disposed_on, reason, note}, from, to, from_name, to_name}`
             *     - `restored`: `{}` or `{was_disposed: true}`
             *     - `label_printed` ([M2-W2 LABELS]): `{batch_id, template_key, copies}`; the actor is the user (or API key) that requested the label batch
             *     - `repair_opened`, `repair_completed`, `imported`: reserved for later milestones (an empty object until then)
             */
            payload?: {
                [key: string]: unknown;
            };
        };
        HistoryEventList: {
            data: components["schemas"]["HistoryEvent"][];
            page: components["schemas"]["PageInfo"];
        };
        AccessoryCheckoutRequest: components["schemas"]["AssignmentTarget"] & {
            /** @default 1 */
            quantity?: number;
            /** Format: date */
            expected_return?: string;
            note?: string;
        };
        AccessoryCheckinRequest: {
            /**
             * Format: uuid
             * @description The open assignment being returned.
             */
            assignment_id: string;
            /** @description Units being returned now; defaults to everything still outstanding (`quantity - quantity_returned`). A partial return adds to `quantity_returned` and leaves the assignment open; the return that brings `quantity_returned` up to `quantity` closes it. More than the outstanding units is rejected with 422. */
            quantity?: number;
            note?: string;
        };
        StockMovement: {
            /** Format: uuid */
            readonly id: string;
            /** Format: uuid */
            consumable_id: string;
            /** @description Non-zero; negative = stock leaves. */
            qty_delta: number;
            /** @enum {string} */
            reason: "receive" | "issue" | "return" | "adjust" | "correction";
            /** Format: uuid */
            person_id?: string | null;
            note?: string | null;
            /** @description Stock on hand right after this movement. */
            balance_after: number;
            /** Format: uuid */
            by_user_id?: string | null;
            /** Format: date-time */
            at: string;
            /** @description Name of the consumable; present in the lists. */
            consumable_name?: string | null;
            /** @description Name of the person the stock was issued to / returned by; present in the lists. */
            person_name?: string | null;
        };
        StockMovementCreate: {
            /** @description Non-zero. The sign must match the reason: `receive` and `return` are positive, `issue` is negative, `adjust` and `correction` either way (422 `validation` otherwise). Rejected with 409 `insufficient-stock` if it would make stock negative. */
            qty_delta: number;
            /**
             * @description `receive`: stock arrives. `issue`: stock is consumed (optionally by a person). `return`: unused stock comes back. `adjust` / `correction`: the count differs from the ledger; these two need a `note` saying why.
             * @enum {string}
             */
            reason: "receive" | "issue" | "return" | "adjust" | "correction";
            /**
             * Format: uuid
             * @description Who it was issued to / returned by.
             */
            person_id?: string | null;
            /** @description Required (non-blank) for `adjust` and `correction`. */
            note?: string;
        };
        StockMovementList: {
            data: components["schemas"]["StockMovement"][];
            page: components["schemas"]["PageInfo"];
        };
        LoanerPoolMember: {
            /** Format: uuid */
            asset_id: string;
            /** Format: uuid */
            loaner_pool_id: string;
            /** Format: date-time */
            added_at: string;
            /** @description Can be lent right now: not archived, in a `deployable` state and not checked out. */
            available: boolean;
            asset?: components["schemas"]["Asset"];
        };
        LoanerPoolMemberList: {
            data: components["schemas"]["LoanerPoolMember"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Asset ids (at most 100). */
        LoanerPoolMembersBulk: {
            ids: string[];
        };
        LoanerPoolMemberBulkResult: {
            results: {
                index: number;
                /** @description HTTP status the single-asset operation would have returned (201 added, 204 removed). */
                status: number;
                data?: components["schemas"]["LoanerPoolMember"];
                error?: components["schemas"]["Problem"];
            }[];
            summary: {
                total: number;
                succeeded: number;
                failed: number;
            };
        };
        LoanerCheckoutRequest: {
            /** Format: uuid */
            person_id: string;
            /**
             * Format: uuid
             * @description A specific pool member. If omitted, the next available member is chosen (ED-24: the member idle the longest, a device never lent first, ties by the lowest asset tag; the answer names it).
             */
            asset_id?: string;
            /**
             * Format: date
             * @description Defaults to today (UTC) + the pool's `default_loan_days`, else + the organisation's `default_expected_return_days`, else + 7 days (ED-24), cut to `max_loan_days`; an explicit date must not exceed the start day + pool.max_loan_days.
             */
            expected_return?: string;
            note?: string;
        };
        /** @description The borrower a scan resolved to. */
        PersonBrief: {
            /** Format: uuid */
            id: string;
            display_name: string;
            /** @enum {string} */
            kind: "employee" | "student" | "contractor" | "external";
            email?: string | null;
            employee_ref?: string | null;
        };
        /** @description Quick check-out by scanning: one borrower, one or more devices. */
        QuickLoanRequest: {
            /**
             * Format: uuid
             * @description The borrower by id. Exactly one of `person_id` and `borrower`.
             */
            person_id?: string;
            /** @description The borrower as scanned or typed: the exact email address or the exact `employee_ref` (the badge / student number), matched case-insensitively. Exactly one of `person_id` and `borrower`. 422 (pointer `/borrower`, code `not-found`) when nobody matches, 409 `conflict` when the text matches two different people. */
            borrower?: string;
            /** @description The devices: the opaque QR `label_code` (or the whole label URL), the asset tag or the exact serial number, as `GET /v1/scan/resolve` accepts them. Several devices per borrower in one request. */
            codes: string[];
            /**
             * Format: date
             * @description One due date for every device. Defaults like `LoanerCheckoutRequest.expected_return` (pool default, organisation default, 7 days); must not exceed the start day + pool.max_loan_days.
             */
            expected_return?: string;
            note?: string;
        } & (unknown | unknown);
        /** @description Per-device outcome of a quick check-out, in request order. A device that fails (unknown code, not in this pool, already out, borrower at the pool's limit...) does not stop the others. */
        QuickLoanResult: {
            person: components["schemas"]["PersonBrief"];
            /** Format: uuid */
            loaner_pool_id: string;
            /**
             * Format: date
             * @description The due date that applied (the request's, or the pool default).
             */
            expected_return: string;
            results: {
                /** @description Position of the code in the request. */
                index: number;
                /** @description The code as sent. */
                code: string;
                /** @description 201 when the loan was opened, otherwise the status of the problem. */
                status: number;
                data?: components["schemas"]["CustodyResult"];
                error?: components["schemas"]["Problem"];
            }[];
            summary: {
                total: number;
                succeeded: number;
                failed: number;
            };
        };
        /** @description Return by scanning: one or many devices, any borrowers. */
        LoanReturnRequest: {
            /** @description The returned devices (label code or URL, asset tag or serial), as for a quick check-out. */
            codes: string[];
            /**
             * Format: uuid
             * @description Only accept devices of this pool (422 `not-in-pool` for others).
             */
            loaner_pool_id?: string;
            /**
             * Format: uuid
             * @description Where the devices are now; default the pool's `home_location_id`.
             */
            checkin_location_id?: string | null;
            /**
             * Format: uuid
             * @description Status to set on every device (default: the tenant default deployable status).
             */
            status_id?: string | null;
            /** @enum {string} */
            condition?: "good" | "fair" | "poor" | "damaged";
            note?: string;
        };
        /** @description Per-device outcome of a quick return, in request order (the per-scan feedback of the bulk check-in screen). Returning a device that is not out is a per-item `409 asset-not-checked-out`. */
        LoanReturnResult: {
            results: {
                /** @description Position of the code in the request. */
                index: number;
                /** @description The code as sent. */
                code: string;
                /** @description 200 when the device was checked in, otherwise the status of the problem. */
                status: number;
                data?: components["schemas"]["CustodyResult"];
                error?: components["schemas"]["Problem"];
            }[];
            summary: {
                total: number;
                succeeded: number;
                failed: number;
            };
        };
        /** @description A loan: one device out of a pool (an assignment with `loaner_pool_id`). */
        Loan: {
            /**
             * Format: uuid
             * @description The assignment id.
             */
            id: string;
            /** Format: uuid */
            asset_id: string;
            asset_tag: string;
            asset_name?: string | null;
            /** Format: uuid */
            loaner_pool_id: string;
            pool_name: string;
            /** Format: uuid */
            person_id?: string | null;
            person_name?: string | null;
            person_email?: string | null;
            /** @description The borrower's `employee_ref` (badge, student number). */
            person_ref?: string | null;
            /** Format: date-time */
            checked_out_at: string;
            /** Format: date */
            expected_return: string;
            /**
             * Format: date-time
             * @description When the device came back; null while it is out.
             */
            returned_at?: string | null;
            /**
             * @description `on_loan` = out and due after today, `due_today`, `overdue` = out and due before today, `returned`. "Today" is the UTC date.
             * @enum {string}
             */
            state: "on_loan" | "due_today" | "overdue" | "returned";
            /** @description Whole days past the due date while `overdue`; 0 otherwise. */
            days_overdue: number;
            note?: string | null;
        };
        LoanList: {
            data: components["schemas"]["Loan"][];
            page: components["schemas"]["PageInfo"];
        };
        LoanExtendRequest: {
            /**
             * Format: date
             * @description The new due date: later than the current one, not before today (UTC) and within the pool's `max_loan_days` counted from the day the loan started.
             */
            expected_return: string;
            /** @description Why (audit trail and history). */
            note?: string;
        };
        OverdueCheckout: {
            /** Format: uuid */
            assignment_id: string;
            /** Format: uuid */
            asset_id: string;
            asset_tag: string;
            asset_name?: string | null;
            /** Format: uuid */
            person_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            target_asset_id?: string | null;
            /** @description Display name of the person, location or asset the device is with. */
            holder_name?: string | null;
            /** Format: uuid */
            loaner_pool_id?: string | null;
            pool_name?: string | null;
            /** Format: date */
            expected_return: string;
            days_overdue: number;
        };
        OverdueCheckoutList: {
            data: components["schemas"]["OverdueCheckout"][];
            page: components["schemas"]["PageInfo"];
        };
        LoanerDashboardPool: {
            /** Format: uuid */
            id: string;
            name: string;
            is_active: boolean;
            member_count: number;
            available_count: number;
            /** @description Members that are checked out (includes the overdue ones and those due today). */
            checked_out_count: number;
            overdue_count: number;
            due_today_count: number;
            /** @description Checked-out members due after today but within the tenant's `loan_reminder_days`. */
            due_soon_count: number;
        };
        LoanerActivity: {
            /** Format: date-time */
            at: string;
            /** @enum {string} */
            kind: "checked_out" | "checked_in";
            /** Format: uuid */
            assignment_id: string;
            /** Format: uuid */
            asset_id: string;
            asset_tag: string;
            asset_name?: string | null;
            /** Format: uuid */
            person_id?: string | null;
            person_name?: string | null;
            /** Format: uuid */
            loaner_pool_id: string;
            pool_name: string;
            /** Format: date */
            expected_return: string;
        };
        /** @description Everything the loaner dashboard page shows, in one call. Each count has a list behind it: `GET /v1/loans` (`loaner_pool_id`, `state`) for out / overdue / due today, `GET /v1/loaner-pools/{id}/members?available=true` for available. */
        LoanerDashboard: {
            /**
             * Format: date
             * @description The UTC date the counts are for.
             */
            as_of: string;
            totals: {
                pools: number;
                members: number;
                available: number;
                checked_out: number;
                overdue: number;
                due_today: number;
                due_soon: number;
            };
            pools: components["schemas"]["LoanerDashboardPool"][];
            /** @description The latest check-outs and returns of loans from the pools, newest first (at most 20). */
            recent: components["schemas"]["LoanerActivity"][];
        };
        CustodySettings: {
            /** @description Pre-fill for the expected return of a check-out or transfer: today + this many days; null = none. A hint for clients: the API never applies it to an ordinary check-out (one without `expected_return` stays open-ended); a loaner loan whose pool has no `default_loan_days` takes it (ED-24). */
            default_expected_return_days: number | null;
            /**
             * @description How many days before the due date a borrower of a loaner pool gets the "due soon" reminder; 0 = no reminder.
             * @default 2
             */
            loan_reminder_days: number;
        };
        /** @description Replaces the settings; an omitted member is reset to its default (`null` / 2). */
        CustodySettingsUpdate: {
            default_expected_return_days?: number | null;
            loan_reminder_days?: number;
        };
        RepairCompleteRequest: {
            /**
             * Format: date-time
             * @description Defaults to now.
             */
            completed_at?: string;
            resolution_notes?: string;
            cost?: components["schemas"]["Money"] | null;
            /**
             * Format: uuid
             * @description Overrides the repair's `restore_status_id`.
             */
            restore_status_id?: string | null;
            /** @description Ids of attachments (photos, invoices) uploaded against the asset beforehand: they are re-pointed at this repair record. */
            attachment_ids?: string[];
        };
        LabelTemplate: {
            /** Format: uuid */
            id: string;
            /** @description Stable key, the `template_key` of a batch. */
            key: string;
            name: string;
            /** @enum {string} */
            page_size: "letter" | "a4" | "custom";
            page_width_mm: number;
            page_height_mm: number;
            label_width_mm: number;
            label_height_mm: number;
            cols: number;
            rows: number;
            /** @description Labels per sheet (`cols` x `rows`): the upper bound of a batch's `start_position`. */
            slots: number;
            margin_top_mm?: number;
            margin_left_mm?: number;
            /** @description Space between two columns of labels. */
            gap_x_mm?: number;
            /** @description Space between two rows of labels. */
            gap_y_mm?: number;
            /** @description Calibration: shifts the whole sheet to the right (negative: left). Change it with `PATCH` after a test print (M2-TAG-04). */
            offset_x_mm: number;
            /** @description Calibration: shifts the whole sheet down (negative: up). */
            offset_y_mm: number;
            /**
             * @description The codes the template draws unless a batch says otherwise.
             * @enum {string}
             */
            code_type: "qr" | "code128" | "qr_and_code128";
            /** @description The text lines the template prints unless a batch says otherwise, first line first. */
            fields: ("asset_tag" | "name" | "serial" | "location" | "model" | "organisation")[];
            /** @description System templates are fixed in the MVP (the editor arrives in v1.1): only the two calibration offsets can change. */
            is_system: boolean;
        };
        LabelTemplateList: {
            data: components["schemas"]["LabelTemplate"][];
        };
        /** @description Calibration of a fixed template. At least one offset. */
        LabelTemplateUpdate: {
            offset_x_mm?: number;
            offset_y_mm?: number;
        };
        /** @description The filters of `GET /v1/assets` that narrow the set (no paging, no `cf[...]` custom-field filters), as JSON: lists are arrays, flags are booleans. */
        LabelAssetFilter: {
            q?: string;
            /**
             * @default exclude
             * @enum {string}
             */
            archived?: "exclude" | "include" | "only";
            tag?: string;
            serial?: string;
            status_id?: string[];
            state_type?: ("deployable" | "deployed" | "pending" | "undeployable" | "archived" | "lost")[];
            category_id?: string[];
            model_id?: string[];
            /** Format: uuid */
            manufacturer_id?: string;
            /** Format: uuid */
            location_id?: string;
            /** @default true */
            include_sublocations?: boolean;
            assigned?: boolean;
            /** Format: uuid */
            assigned_person_id?: string;
            overdue?: boolean;
            /** Format: uuid */
            company_id?: string;
            /** Format: uuid */
            vendor_id?: string;
            /** Format: uuid */
            parent_asset_id?: string;
            /**
             * Format: uuid
             * @description {
             *       "description": "[ED-38] The assets this import created (\"Print labels for the new assets\")."
             *     }
             */
            import_job_id?: string;
            /** Format: date */
            warranty_end_before?: string;
            /** Format: date */
            warranty_end_after?: string;
            /** Format: date */
            purchase_date_from?: string;
            /** Format: date */
            purchase_date_to?: string;
            /** Format: date-time */
            updated_since?: string;
            /** @description As the `sort` of `GET /v1/assets` (`asset_tag` by default here, so a sheet reads in tag order). */
            sort?: string;
        };
        /** @description Exactly one of `asset_ids` and `filter`. At most 2000 assets and 2000 labels (assets x copies) per batch. */
        LabelBatchCreate: {
            /** @description Key from `GET /v1/labels/templates`. */
            template_key: string;
            /** @description The assets, printed in this order. Send this or `filter`. */
            asset_ids?: string[];
            filter?: components["schemas"]["LabelAssetFilter"];
            /**
             * @description 1-based slot of the first label on the first sheet (re-use a partly used sheet); at most the template's `slots`. Slots are numbered row by row, left to right.
             * @default 1
             */
            start_position?: number;
            /**
             * @description Labels per asset, printed next to each other.
             * @default 1
             */
            copies?: number;
            /** @description Which codes to draw; default: the template's `code_type`. The QR encodes `<web base url>/s/<label_code>` (an opaque code, never an internal id), the Code128 encodes the asset tag (printable ASCII only). An empty list prints text only. */
            codes?: ("qr" | "code128")[];
            /** @description The text lines to print, first line first and largest; default: the template's `fields`. Text shrinks to fit and ends with an ellipsis when it still does not. */
            fields?: ("asset_tag" | "name" | "serial" | "location" | "model" | "organisation")[];
            /**
             * Format: uuid
             * @description Optional logo: a clean PNG or JPEG attachment of your organisation (at most 2 MiB), printed small above the text.
             */
            logo_attachment_id?: string | null;
            /**
             * @description Draw a hairline around every label: for calibration prints on plain paper.
             * @default false
             */
            outlines?: boolean;
        };
        /** @description One request to print labels. Visible to the user (or API key) that made it, nobody else. */
        LabelBatch: {
            /** Format: uuid */
            readonly id: string;
            /**
             * @description `queued` until the worker has rendered the PDF, then `ready` (download it), `failed` (see `error`) or, after `expires_at`, `expired` (the file is deleted).
             * @enum {string}
             */
            readonly status: "queued" | "ready" | "failed" | "expired";
            template_key: string;
            /** @enum {string} */
            source: "asset_ids" | "filter";
            asset_count: number;
            copies: number;
            /** @description Labels printed: `asset_count` x `copies`. */
            label_count: number;
            start_position: number;
            codes: ("qr" | "code128")[];
            fields: ("asset_tag" | "name" | "serial" | "location" | "model" | "organisation")[];
            outlines: boolean;
            /** Format: uuid */
            logo_attachment_id?: string | null;
            /** @description Sheets in the PDF, once rendered. */
            page_count: number | null;
            /** @description Suggested file name, once ready. */
            filename?: string | null;
            /** Format: int64 */
            size_bytes?: number | null;
            /** Format: date-time */
            readonly created_at: string;
            /** Format: date-time */
            readonly rendered_at?: string | null;
            /**
             * Format: date-time
             * @description After this moment the file is deleted and the batch becomes `expired`.
             */
            readonly expires_at: string;
            /**
             * Format: uri
             * @description A short-lived presigned URL of the PDF; only when `ready`. A fresh one comes with every read.
             */
            readonly download_url: string | null;
            /** Format: date-time */
            readonly download_expires_at?: string | null;
            /** @description Why the batch failed; `null` otherwise. */
            readonly error: {
                /** @description e.g. `logo-invalid`, `render-failed`. */
                code: string;
                detail: string;
            } | null;
        };
        LabelBatchList: {
            data: components["schemas"]["LabelBatch"][];
            page: components["schemas"]["PageInfo"];
        };
        Attachment: {
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            entity_type: "asset" | "asset_model" | "accessory" | "consumable" | "location" | "person" | "maintenance_record" | "assignment" | "import_job";
            /** Format: uuid */
            entity_id: string;
            /** @enum {string} */
            kind: "photo" | "document" | "signature" | "import_file" | "other";
            filename: string;
            content_type: string;
            /** Format: int64 */
            size_bytes: number;
            sha256?: string | null;
            /** @enum {string} */
            readonly scan_status: "pending" | "clean" | "infected" | "error";
            /** Format: date-time */
            readonly uploaded_at?: string | null;
            /** Format: date-time */
            readonly created_at: string;
            /** @description Why the status is what it is: the signature name when `infected`, a short reason when `error` (`size-mismatch`, `content-mismatch`, `upload-abandoned`...), `scan-disabled` when the deployment runs without a scanner. */
            readonly scan_detail?: string | null;
            /** @description Pixel width of an image, once its thumbnail exists. */
            readonly width?: number | null;
            /** @description Pixel height of an image, once its thumbnail exists. */
            readonly height?: number | null;
            /**
             * Format: uri
             * @description Short-lived URL of the metadata-free WebP thumbnail (images only, once generated, and only when `scan_status=clean`). Present on list and get.
             */
            readonly thumbnail_url?: string | null;
            /**
             * Format: uri
             * @description Short-lived signed URL, only when `scan_status=clean`; present on the list and on `GET /v1/attachments/{id}` alike (no per-item request needed). Images are served inline, everything else as an attachment download.
             */
            readonly download_url?: string | null;
        };
        AttachmentCreate: {
            /** @enum {string} */
            entity_type: "asset" | "asset_model" | "accessory" | "consumable" | "location" | "person" | "maintenance_record" | "assignment" | "import_job";
            /** Format: uuid */
            entity_id: string;
            /**
             * @default document
             * @enum {string}
             */
            kind?: "photo" | "document" | "signature" | "import_file" | "other";
            filename: string;
            content_type: string;
            /** Format: int64 */
            size_bytes: number;
            sha256?: string;
        };
        AttachmentUpload: {
            attachment: components["schemas"]["Attachment"];
            upload: {
                /** @enum {string} */
                method: "PUT";
                /**
                 * Format: uri
                 * @description Presigned URL with size and content-type conditions; PUT the bytes here.
                 */
                url: string;
                /** @description Headers that must accompany the PUT. */
                headers?: {
                    [key: string]: string;
                };
                /** Format: date-time */
                expires_at: string;
            };
        };
        AttachmentList: {
            data: components["schemas"]["Attachment"][];
            page: components["schemas"]["PageInfo"];
        };
        FilesSettings: {
            /** @description Re-encode every uploaded image without EXIF/GPS metadata (the stored original is replaced). Thumbnails are always metadata-free. */
            strip_exif_original: boolean;
            /** @description Lower the upload cap below the tier default; `null` = the tier default. It can never raise the cap above the tier. */
            max_upload_bytes: number | null;
            /** @description The cap that applies: the smaller of the override (or tier default) and the deployment ceiling. */
            readonly effective_max_upload_bytes?: number;
            /** @description The cap of the organisation's plan. */
            readonly tier_max_upload_bytes?: number;
        };
        FilesSettingsUpdate: {
            strip_exif_original: boolean;
            max_upload_bytes: number | null;
        };
        AuditEntry: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            at: string;
            /** @enum {string} */
            actor_type: "user" | "api_key" | "integration" | "system";
            /** Format: uuid */
            actor_user_id?: string | null;
            /** Format: uuid */
            actor_ref?: string | null;
            /** @example asset.checkout */
            action: string;
            entity_type: string;
            /** Format: uuid */
            entity_id?: string | null;
            /** @description `{before, after}` with sensitive fields redacted. */
            diff?: {
                [key: string]: unknown;
            } | null;
            ip?: string | null;
            user_agent?: string | null;
            request_id?: string | null;
        };
        AuditEntryList: {
            data: components["schemas"]["AuditEntry"][];
            page: components["schemas"]["PageInfo"];
        };
        LoginRequest: {
            /** Format: email */
            email: string;
            /** Format: password */
            password: string;
            /** @description Needed when the email exists in several tenants (or when using a tenant vanity host). */
            tenant_slug?: string;
        };
        TenantChoice: {
            slug: string;
            name: string;
        };
        LoginResponse: {
            /** @enum {string} */
            status: "authenticated" | "mfa_required" | "tenant_selection_required";
            /** @description For `authenticated`: send as `X-CSRF-Token` on cookie-authenticated mutations. */
            csrf_token?: string;
            /** @description For `mfa_required`. */
            mfa?: {
                challenge_id: string;
                methods: ("totp" | "webauthn" | "recovery_code")[];
            };
            /** @description For `tenant_selection_required`. */
            tenants?: components["schemas"]["TenantChoice"][];
            user?: components["schemas"]["User"];
        };
        MfaVerifyRequest: {
            challenge_id: string;
            /** @enum {string} */
            method: "totp" | "webauthn" | "recovery_code";
            /** @description TOTP code, recovery code, or the WebAuthn assertion (JSON string). */
            code: string;
        };
        Me: {
            user: components["schemas"]["User"];
            tenant: {
                /** Format: uuid */
                id: string;
                name: string;
                plan?: string;
                base_currency: string;
                cell?: string;
                /** @description Tenant branding for the web shell. Always present; both fields are null in M1-M3 (clients use the default theme). */
                branding: {
                    /**
                     * Format: uri
                     * @description Absolute URL of the tenant logo. Always null until tenant branding ships (M4+).
                     */
                    logo_url: string | null;
                    /** @description Accent colour as `#rrggbb`. Always null until tenant branding ships (M4+). */
                    accent_color: string | null;
                };
            };
            /** Format: uuid */
            default_company_id?: string;
            /** @description Effective permissions of the principal (role permissions, or the API key scopes). */
            permissions: string[];
            role_assignments?: components["schemas"]["RoleAssignment"][];
            auth: {
                /** @enum {string} */
                method: "session" | "api_key";
                mfa_verified?: boolean;
                /** Format: uuid */
                api_key_id?: string | null;
                scopes?: string[];
            };
            /** @description True when tenant policy requires MFA for this user and the user has not enrolled yet. The session is then *limited*: every endpoint except `/v1/auth/me`, `/v1/auth/logout` and `/v1/auth/mfa/enrol*` returns 403 `mfa-enrolment-required`. Always false for API keys. */
            mfa_enrolment_required: boolean;
            /** @description Lifetime of the current browser session; null when authenticated with an API key. */
            session: components["schemas"]["SessionExpiry"] | null;
            /** @description Only for cookie sessions. */
            csrf_token?: string;
            /** @description The organisation's MFA policy and whether it applies to the caller (M2-AUTH-01). */
            mfa_policy: {
                /** @description True when the policy requires THIS user to have two-step verification (always false for API keys). While true, "Turn off" is refused with `403 mfa-required-by-policy`. */
                required: boolean;
                /**
                 * @description Who the organisation requires to use two-step verification: nobody, administrators (roles holding `*` or `user:manage`), or everybody.
                 * @enum {string}
                 */
                scope: "off" | "admins" | "all";
            };
            /** @description [M2-LOC-03] `null` when the principal holds at least one org-wide role assignment; otherwise the location subtrees it is limited to (the web shell shows "Scoped to: ..."). A principal with both kinds is limited per permission: see the Permissions section. */
            location_scope: {
                /** @description The roots of the subtrees the principal is limited to, by path. Empty when the scoped assignments name no location any more. */
                locations: components["schemas"]["ScopeLocation"][];
            } | null;
        };
        SessionExpiry: {
            /**
             * Format: date-time
             * @description The session ends at this time unless there is activity before it; each authenticated request pushes it forward, never beyond `absolute_expires_at`.
             */
            idle_expires_at: string;
            /**
             * Format: date-time
             * @description Hard end of the session regardless of activity.
             */
            absolute_expires_at: string;
        };
        /** @description The password rules enforced by `POST /v1/auth/password/reset` and `POST /v1/auth/invitations/accept`. Defaults: min 12, max 128, breached-password check on (bundled local list; optional online k-anonymity provider). Clients read this instead of hardcoding limits. */
        PasswordPolicy: {
            /**
             * @description Minimum length in Unicode code points after NFKC normalisation.
             * @example 12
             */
            min_length: number;
            /**
             * @description Maximum length in Unicode code points (bounds hashing cost).
             * @example 128
             */
            max_length: number;
            /** @description Always false: no required character classes. Length and the breach check are the policy. */
            composition_rules: boolean;
            breached_check: {
                enabled: boolean;
                /** @description Always includes `local_list` (bundled, works offline and in self-hosted installs). `online_k_anonymity` is present only when the operator enabled the optional provider; only a hash prefix ever leaves the server. */
                sources: ("local_list" | "online_k_anonymity")[];
            };
            /** @description Field codes returned in `errors[].code` at pointer `/password` on a 422. */
            rejection_codes?: ("too-short" | "too-long" | "breached")[];
        };
        /**
         * Format: password
         * @description New password. Policy: 12-128 characters, no composition rules, NFKC-normalised, rejected if found in the breached-password list. A violation returns 422 with `errors[]` pointer `/password` and code `too-short`, `too-long` or `breached`. Live limits: `GET /v1/auth/password-policy`.
         */
        Password: string;
        ForgotPasswordRequest: {
            /** Format: email */
            email: string;
        };
        ResetPasswordRequest: {
            /** @description Single-use token from the reset email link. */
            token: string;
            password: components["schemas"]["Password"];
        };
        /** @description What the accept-invitation screen shows before the user picks a password. Contains no secret. */
        InvitationInfo: {
            /** Format: email */
            email: string;
            /** @description Name the administrator entered; the invitee may change it on accept. */
            display_name: string;
            tenant_name: string;
            /** @description Display name of the invited role (for example "Asset Manager"). */
            role_name?: string;
            /** Format: date-time */
            expires_at: string;
            /** @description The tenant requires MFA for this role: after accepting, the new session is limited until the user enrols (see `Me.mfa_enrolment_required`). */
            mfa_enrolment_required: boolean;
        };
        AcceptInvitationRequest: {
            /** @description Single-use invitation token from the email link. */
            token: string;
            password: components["schemas"]["Password"];
            display_name: string;
        };
        /** @description A pending (not yet active) TOTP factor. It becomes active only after `POST /v1/auth/mfa/enrol/confirm`. Calling enrol again before confirming replaces the pending secret. */
        MfaEnrolment: {
            /** @description Base32 TOTP shared secret, for manual entry. */
            secret: string;
            /** @description `otpauth://totp/...` URI that the QR code encodes. */
            provisioning_uri: string;
        };
        MfaConfirmRequest: {
            /** @description Current 6-digit TOTP code (spaces ignored). */
            code: string;
        };
        MfaRecoveryCodes: {
            /** @description Ten single-use recovery codes. Shown **once**; only their hashes are stored. Any earlier set is invalidated. */
            recovery_codes: string[];
        };
        MfaEnrolmentConfirmed: {
            /** @description Ten single-use recovery codes. Shown **once**; only their hashes are stored. Any earlier set is invalidated. */
            recovery_codes: string[];
            /** @description The session is rotated on activation, so the CSRF token changes: store this one and send it as `X-CSRF-Token` on the next cookie-authenticated mutation. */
            csrf_token: string;
        };
        /** @description Proof of a recent sign-in for a sensitive action. Send the current password **or** a current TOTP code. A wrong value returns 403 `reauth-failed` and counts toward the account lockout. */
        ReauthRequest: {
            /** Format: password */
            password?: string;
            totp_code?: string;
        } | unknown | unknown;
        SessionInfo: {
            /**
             * Format: uuid
             * @description Session id (not the cookie token).
             */
            id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            last_seen_at: string;
            /** @description IP address the session was last seen from. */
            ip: string | null;
            /** @description Raw or summarised user agent. */
            user_agent: string | null;
            /** @description True for the session making this request. */
            current: boolean;
        };
        SessionInfoList: {
            data: components["schemas"]["SessionInfo"][];
        };
        SearchResult: {
            /** @enum {string} */
            type: "asset" | "model" | "category" | "person" | "location";
            /** Format: uuid */
            id: string;
            /** @description Primary text, e.g. asset tag + name, model name, category name. */
            label: string;
            /** @description Secondary text, e.g. serial number or model; null if none. */
            sublabel: string | null;
            /** @description App-relative path the web client may navigate to (for example `/assets/view?id=<uuid>`). A hint only: clients own routing and may build the URL from `type` and `id`. */
            href_hint: string;
        };
        SearchResultList: {
            /** @description Grouped by type in the order of the `types` parameter (default: asset, model, category, person, location), best match first within a group; at most `limit` per type. */
            data: components["schemas"]["SearchResult"][];
        };
        RoleAssignment: {
            /** Format: uuid */
            readonly id?: string;
            /** Format: uuid */
            role_id: string;
            /**
             * @description `tenant`: the whole organisation. `location`: the location named by `location_id` and everything below it (ED-26); the org-only permissions of the role (`user:*`, `role:read`, `apikey:manage`, `audit:read`, `catalog:manage`, `department:manage`, `notification:manage`) do not apply. `company`: accepted, enforced like `tenant` until company scoping ships.
             * @default tenant
             * @enum {string}
             */
            scope_type?: "tenant" | "company" | "location";
            /**
             * Format: uuid
             * @description Required when scope_type=company.
             */
            company_id?: string | null;
            /**
             * Format: uuid
             * @description Required when scope_type=location: an existing, active location; the grant covers it and its whole subtree. A missing or archived location is `422` (`not-found` at `/role_assignments/<n>/location_id`).
             */
            location_id?: string | null;
        };
        /** @description Login-capable account. People who only receive assets are `Person` records. */
        User: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            /** Format: email */
            email: string;
            display_name: string;
            /** @enum {string} */
            status?: "invited" | "active" | "disabled";
            locale?: string | null;
            timezone?: string | null;
            role_assignments: components["schemas"]["RoleAssignment"][];
            readonly mfa_enabled?: boolean;
            /** Format: date-time */
            readonly last_login_at?: string | null;
            /**
             * Format: uuid
             * @description [M2-USR-03] The person record of this login account (every login has exactly one; see `POST /v1/people/{id}/link-user`). Filled by `/v1/users` and `/v1/me`; null in login responses.
             */
            readonly person_id?: string | null;
        };
        UserCreate: {
            /** Format: email */
            email: string;
            display_name: string;
            /** @enum {string} */
            status?: "invited" | "active" | "disabled";
            locale?: string | null;
            timezone?: string | null;
            role_assignments: components["schemas"]["RoleAssignment"][];
            /** @default true */
            send_invite?: boolean;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        UserUpdate: {
            /** Format: email */
            email?: string;
            display_name?: string;
            /** @enum {string} */
            status?: "invited" | "active" | "disabled";
            locale?: string | null;
            timezone?: string | null;
            role_assignments?: components["schemas"]["RoleAssignment"][];
        };
        UserList: {
            data: components["schemas"]["User"][];
            page: components["schemas"]["PageInfo"];
        };
        Role: {
            /** Format: uuid */
            id: string;
            key: string;
            name: string;
            description?: string | null;
            permissions: string[];
            is_builtin: boolean;
        };
        RoleList: {
            data: components["schemas"]["Role"][];
        };
        Company: {
            /** Format: uuid */
            id: string;
            name: string;
            code?: string | null;
            is_default: boolean;
        };
        CompanyList: {
            data: components["schemas"]["Company"][];
        };
        ApiKey: {
            /** Format: uuid */
            readonly id: string;
            name: string;
            readonly key_prefix: string;
            /** @description `resource:action` strings; a subset of the creator's permissions. */
            scopes: string[];
            /** Format: date-time */
            expires_at?: string | null;
            /** Format: date-time */
            readonly last_used_at?: string | null;
            /** Format: date-time */
            readonly revoked_at?: string | null;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: uuid */
            readonly created_by?: string | null;
        };
        ApiKeyCreate: {
            name: string;
            scopes: string[];
            /** Format: date-time */
            expires_at?: string | null;
        };
        ApiKeyCreated: components["schemas"]["ApiKey"] & {
            /** @description The full key (`<prefix>.<secret>`). Shown **once**; only its hash is stored. */
            secret: string;
        };
        ApiKeyList: {
            data: components["schemas"]["ApiKey"][];
            page: components["schemas"]["PageInfo"];
        };
        PersonLinkUserRequest: {
            /**
             * Format: uuid
             * @description The login account (`User.id`) to link: live, in this tenant.
             */
            user_id: string;
        };
        UndoCustodyRequest: {
            /**
             * Format: uuid
             * @description The `assignment.id` the action answered with: the new assignment of a check-out or transfer, the closed one of a check-in.
             */
            assignment_id: string;
        };
        /** @description Result of an undo: the **updated asset** (new `ETag` also in the header), the assignment that is now in effect (the closed one after undoing a check-out or a transfer from stock, the re-opened one after undoing a check-in or a transfer between holders) and what was undone. */
        UndoResult: {
            asset: components["schemas"]["Asset"];
            assignment: components["schemas"]["Assignment"];
            /** @enum {string} */
            undone: "checkout" | "checkin" | "transfer";
        };
        /** @description Moves an asset to a location. */
        MoveRequest: {
            /**
             * Format: uuid
             * @description Destination location; `null` clears the location (whereabouts unknown).
             */
            location_id: string | null;
            note?: string;
        };
        BulkAssetMove: {
            ids: string[];
            /**
             * Format: uuid
             * @description Destination location for every asset; `null` clears it.
             */
            location_id: string | null;
            note?: string;
        };
        DisposeRequest: {
            /** @enum {string} */
            reason: "sold" | "donated" | "recycled" | "scrapped" | "stolen" | "returned_to_vendor" | "other";
            /** @description Free text (buyer, recipient, certificate number...). */
            note?: string;
            /**
             * Format: date
             * @description Defaults to today (UTC).
             */
            disposed_on?: string;
            /**
             * Format: uuid
             * @description An `archived`-type status label; default: the first one of the tenant.
             */
            status_id?: string;
        };
        MarkLostRequest: {
            note?: string;
            /**
             * Format: uuid
             * @description A `lost`-type status label; default: the first one of the tenant.
             */
            status_id?: string;
        };
        MarkFoundRequest: {
            /**
             * Format: uuid
             * @description A `deployable`-type status label to return the asset to; default: the tenant default (or first deployable) label.
             */
            status_id?: string;
            /**
             * Format: uuid
             * @description Where the asset was found / is now.
             */
            location_id?: string | null;
            note?: string;
        };
        RepairSummary: {
            /** Format: uuid */
            asset_id: string;
            /** @description Records in status `open` or `in_progress`. */
            open_count: number;
            /** @description Records that are not cancelled or archived. */
            total_count: number;
            /** @description Total recorded cost of the non-cancelled records, one entry per currency (amounts in different currencies are never added together). */
            total_cost: components["schemas"]["Money"][];
        };
        Notification: {
            /** Format: uuid */
            id: string;
            /** @description Notification type (the domain event it comes from), e.g. `attachment.infected`. */
            type: string;
            title: string;
            body: string | null;
            /** @description Path inside the web app that shows the subject, e.g. `/assets/view?id=...`. */
            link: string | null;
            entity_type: string | null;
            /** Format: uuid */
            entity_id: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            read_at: string | null;
        };
        NotificationList: {
            data: components["schemas"]["Notification"][];
            page: components["schemas"]["PageInfo"];
        };
        NotificationUnreadCount: {
            count: number;
        };
        NotificationReadAllResult: {
            /** @description Notifications that were unread and are now read. */
            updated: number;
        };
        NotificationPreference: {
            type: string;
            label: string;
            description: string;
            /** @description Show in the notification bell. */
            in_app: boolean;
            /**
             * @description `immediate`: one email per notification (more than a handful per hour are folded into the digest); `digest`: collected into one daily email (at most 50 items listed); `off`: no email.
             * @enum {string}
             */
            email: "immediate" | "digest" | "off";
            /** @description True while the user has not chosen: the values are the type's defaults. */
            is_default: boolean;
        };
        NotificationPreferenceList: {
            data: components["schemas"]["NotificationPreference"][];
        };
        /** @description At least one field. */
        NotificationPreferenceUpdate: {
            in_app?: boolean;
            /**
             * @description `immediate`: one email per notification (more than a handful per hour are folded into the digest); `digest`: collected into one daily email (at most 50 items listed); `off`: no email.
             * @enum {string}
             */
            email?: "immediate" | "digest" | "off";
        };
        NotificationRule: {
            type: string;
            label: string;
            description: string;
            /** @description When false the type produces no notification for anybody in this organisation. */
            enabled: boolean;
            /** @description Who gets it by default, in words. */
            recipients: string;
            /** @description True when `recipient_roles` can replace the default recipients (types addressed to users that hold a permission). */
            role_configurable: boolean;
            /** @description Role keys that receive it instead of the default recipients; null = the default. */
            recipient_roles: string[] | null;
            /** Format: date-time */
            updated_at: string | null;
        };
        NotificationRuleList: {
            data: components["schemas"]["NotificationRule"][];
        };
        /** @description At least one field. */
        NotificationRuleUpdate: {
            enabled?: boolean;
            /** @description Role keys, or null to go back to the default recipients. Only for `role_configurable` types. */
            recipient_roles?: string[] | null;
        };
        /** @description `queued` = handed to the mail queue (the mail job has its own retries and dead-letter list). */
        NotificationDelivery: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            notification_id: string | null;
            /** Format: uuid */
            user_id: string;
            type: string;
            /** @enum {string} */
            channel: "in_app" | "email";
            /** @enum {string} */
            status: "delivered" | "queued" | "deferred" | "skipped" | "failed";
            /** @description Why a delivery was skipped or deferred, e.g. `preference-off`, `no-email`, `throttled`, `digest`. */
            reason: string | null;
            /** Format: date-time */
            created_at: string;
        };
        NotificationDeliveryList: {
            data: components["schemas"]["NotificationDelivery"][];
            page: components["schemas"]["PageInfo"];
        };
        SavedView: {
            /** Format: uuid */
            id: string;
            /**
             * @description The list the view belongs to.
             * @enum {string}
             */
            resource: "assets";
            name: string;
            /** @description The list filters as the client keeps them (opaque to the server apart from the id references checked for `warnings`). */
            filters: {
                [key: string]: unknown;
            };
            /** @description Visible column ids in display order. */
            columns: string[];
            /** @description Sort key with `-` for descending, or null for the default. */
            sort: string | null;
            /** @description Visible to everybody in the organisation. */
            is_shared: boolean;
            /** @description The caller created it (only the owner edits it). */
            is_owner: boolean;
            owner: {
                /** Format: uuid */
                id: string;
                display_name: string;
            };
            /** @description Id references in `filters` (status, category, location, model, vendor, person) that no longer resolve: the client applies the rest of the view and shows a warning. */
            warnings: {
                field: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                reason: "not-found" | "archived";
            }[];
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
        };
        SavedViewList: {
            data: components["schemas"]["SavedView"][];
            page: components["schemas"]["PageInfo"];
        };
        SavedViewCreate: {
            /**
             * @default assets
             * @enum {string}
             */
            resource?: "assets";
            name: string;
            /** @description At most 16 KiB of JSON. */
            filters?: {
                [key: string]: unknown;
            };
            columns?: string[];
            sort?: string | null;
        };
        /** @description Partial update (RFC 7396 merge semantics). */
        SavedViewUpdate: {
            name?: string;
            /** @description At most 16 KiB of JSON. */
            filters?: {
                [key: string]: unknown;
            };
            columns?: string[];
            sort?: string | null;
        };
        SavedViewShare: {
            shared: boolean;
        };
        ExportCreate: {
            /** @enum {string} */
            resource: "assets" | "people" | "locations";
            /**
             * @default csv
             * @enum {string}
             */
            format?: "csv";
            /** @description The same query parameters as the list endpoint (`GET /v1/assets`, `/v1/people` or `/v1/locations`) without paging (`limit`, `cursor`, `include_total`, `fields`, `expand`), as a flat object: arrays are sent as arrays of strings, booleans and numbers as such; custom-field filters as `"cf[key]": "value"`. */
            filters?: {
                [key: string]: string | number | boolean | string[];
            };
        };
        Export: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            resource: "assets" | "people" | "locations";
            /** @enum {string} */
            format: "csv";
            /** @enum {string} */
            status: "queued" | "running" | "succeeded" | "failed" | "expired";
            /** @description The filters the export was requested with (normalised to query-string form). */
            filters: {
                [key: string]: unknown;
            };
            row_count: number | null;
            size_bytes: number | null;
            filename: string | null;
            /** @description Why a failed export failed (a sentence without internals). */
            error: string | null;
            /** Format: uuid */
            requested_by: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            started_at: string | null;
            /** Format: date-time */
            completed_at: string | null;
            /**
             * Format: date-time
             * @description The file is deleted at this time (24 hours after completion).
             */
            expires_at: string | null;
            /**
             * Format: uri
             * @description Short-lived link to the CSV file; only while `status=succeeded`. A new link is issued by every `GET /v1/exports/{id}` and each issue is audited as a sensitive read.
             */
            download_url: string | null;
            /** Format: date-time */
            download_expires_at: string | null;
        };
        ExportList: {
            data: components["schemas"]["Export"][];
            page: components["schemas"]["PageInfo"];
        };
        ImportOptions: {
            /**
             * @description Assets: how an existing asset is found. `auto` = the tag when the row has one, else the serial number (a tag and a serial that name different assets is a row error).
             * @default auto
             * @enum {string}
             */
            match_on?: "auto" | "asset_tag" | "serial" | "external_id";
            /**
             * @description What to do with a row whose record exists already, and with a row that repeats an earlier row of the file (same tag, serial, email, path or name): leave it, update it with the cells of the file, or report an error.
             * @default skip
             * @enum {string}
             */
            on_match?: "skip" | "update" | "error";
            /**
             * @description Update only: an empty cell leaves the field alone, or empties it.
             * @default ignore
             * @enum {string}
             */
            blank_cells?: "ignore" | "clear";
            /**
             * @description `auto` reads ISO dates, month names and unambiguous day/month dates; `03/04/2024` needs `dmy` or `mdy`.
             * @default auto
             * @enum {string}
             */
            date_format?: "auto" | "iso" | "dmy" | "mdy";
            /**
             * @description The decimal separator of numbers in the file; `auto` decides where the text is unambiguous (`1.234,50`, `1,234.50`) and reads `1,234` as a thousand.
             * @default auto
             * @enum {string}
             */
            number_format?: "auto" | "dot" | "comma";
            /** @description Currency of costs that name none; else the organisation's base currency. */
            default_currency?: string;
            /** @description Source recorded with a mapped external id (default `import`; the Google preset uses `google_admin`). */
            external_source?: string;
            /** @description Per reference kind (`category`, `manufacturer`, `model`, `status`, `location`, `department`, `vendor`, `person`): create what is missing, or require it to exist. Defaults: `create`, except `status` and `person` (`must_exist`; a status label is never created). */
            references?: {
                [key: string]: "create" | "must_exist";
            };
            /** @description Ids used when a row's own cell is empty. */
            defaults?: {
                /** Format: uuid */
                category?: string;
                /** Format: uuid */
                status?: string;
                /** Format: uuid */
                location?: string;
                /** Format: uuid */
                department?: string;
                /** Format: uuid */
                vendor?: string;
            };
            /**
             * @description Kind of the locations the import creates.
             * @default other
             * @enum {string}
             */
            location_kind?: "site" | "building" | "floor" | "room" | "storage" | "vehicle" | "other";
            /**
             * @description Assets: check an asset out to the person in `assigned_to` (only when it can be checked out; otherwise a warning).
             * @default true
             */
            assign?: boolean;
            /**
             * @description Update only: a record edited after the dry run is not touched (row error `changed-since-dry-run`).
             * @default true
             */
            detect_changes?: boolean;
        };
        ImportMappingColumn: {
            /** @description 0-based column of the file. */
            index: number;
            /** @description A field of the entity (`GET /v1/imports/presets` lists them), `cf:<custom field key>` for an asset custom field, or null to ignore the column. */
            target: string | null;
            /**
             * @description Overrides the job's date format for this column.
             * @enum {string}
             */
            date_format?: "auto" | "iso" | "dmy" | "mdy";
        };
        ImportMapping: {
            columns: components["schemas"]["ImportMappingColumn"][];
            /** @description Text for a target that has no column (`{"category": "Chromebook"}`), used for every row whose own cell is empty. */
            constants?: {
                [key: string]: string;
            };
        };
        ImportValueEntry: {
            /** Format: uuid */
            id: string;
        } | {
            /** @constant */
            create: true;
            name?: string;
        } | {
            /** @constant */
            skip: true;
        };
        /** @description By reference kind, then by the NORMALISED source value (trimmed, spaces collapsed, lower case): what that value of the file means. */
        ImportValueMap: {
            [key: string]: {
                [key: string]: components["schemas"]["ImportValueEntry"];
            };
        };
        ImportParse: {
            /** @description `csv` or `xlsx`. */
            format: string | null;
            /** @description CSV: `utf-8`, `utf-16le`, `utf-16be` or `windows-1252` (detected). */
            encoding: string | null;
            /** @description CSV: `,` `;` tab or `|` (detected). */
            delimiter: string | null;
            /** @description XLSX: the sheet that is read (default: the first visible one). */
            sheet: string | null;
            /** @description XLSX: the visible sheets. */
            sheets: string[] | null;
            /** @description Row (XLSX) or line (CSV) number of the header row. */
            header_line: number | null;
        };
        ImportColumnProfile: {
            index: number;
            header: string;
            non_blank: number;
            blank: number;
            distinct: number;
            /** @description More than 10,000 distinct values: `distinct` is a lower bound. */
            distinct_capped: boolean;
            /** @description Non-blank cells that repeat an earlier value. */
            duplicates: number;
            /** @enum {string} */
            type: "empty" | "integer" | "number" | "date" | "boolean" | "email" | "text";
            /**
             * @description Date columns: the order the data allows; `ambiguous` needs an explicit date format.
             * @enum {string|null}
             */
            date_order: "iso" | "dmy" | "mdy" | "ambiguous" | "mixed" | null;
            max_length: number;
            /** @description Up to five distinct values. */
            samples: string[];
        };
        RowIssue: {
            /** @description The target field the problem belongs to (`serial`, `cf:os_version`), or null for the row as a whole. */
            field: string | null;
            message: string;
            /** @description Stable code: `required`, `not-found`, `ambiguous-date`, `number`, `exists`, `duplicate-in-file`, `changed-since-dry-run`, `will-create`, `validated-at-commit`, `unchanged`... */
            code: string;
        };
        ImportJob: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            entity_type: "asset" | "person" | "location" | "department";
            /** @enum {string} */
            source: "csv" | "xlsx" | "google_admin_csv";
            /** @description The built-in preset the import was created from (`GET /v1/imports/presets`). */
            preset_key: string | null;
            /**
             * @description draft (no file yet) -> uploaded -> analyzing -> analyzed -> mapped -> dry_running -> dry_run_done -> committing -> completed; `failed` and `cancelled` end it. Editing the mapping or options returns `dry_run_done` to `mapped`.
             * @enum {string}
             */
            state: "draft" | "uploaded" | "analyzing" | "analyzed" | "mapped" | "dry_running" | "dry_run_done" | "committing" | "completed" | "failed" | "cancelled";
            filename: string | null;
            /**
             * Format: uuid
             * @description The uploaded file: an attachment of kind `import_file` owned by this import.
             */
            file_attachment_id: string | null;
            parse: components["schemas"]["ImportParse"];
            /** @description Header names of the file, after analysis. */
            headers: string[] | null;
            mapping: components["schemas"]["ImportMapping"];
            options: components["schemas"]["ImportOptions"];
            /** @description Data rows of the file. */
            rows_total: number;
            counts: {
                dry_run: {
                    create: number;
                    update: number;
                    skip: number;
                    error: number;
                };
                commit: {
                    created: number;
                    updated: number;
                    skipped: number;
                    error: number;
                };
            };
            progress: {
                /** @enum {string|null} */
                phase: "analyze" | "dry_run" | "commit" | null;
                processed: number;
                total: number;
                percent: number;
            };
            /** @description Digest of the reviewed dry run (file, parse settings, mapping, options, value map and every row's outcome). Quote it in the commit request. */
            dry_run_digest: string | null;
            /** Format: date-time */
            dry_run_at: string | null;
            /** Format: date-time */
            committed_at: string | null;
            /** Format: date-time */
            started_at: string | null;
            /** Format: date-time */
            finished_at: string | null;
            /**
             * Format: date-time
             * @description When the retention job removed the rows of the file, the profile, the sample rows, the value map and the uploaded file of this finished import (ED-25); null while they are kept. The counts, summary, mapping and options stay.
             */
            data_purged_at: string | null;
            cancel_requested: boolean;
            /** @description Why a failed import failed (a sentence; for a bad file it names the line). */
            error: string | null;
            /** @description After a dry run: `counts`, `errors_by_code`, `will_create` (references the commit would create, with counts) and `validated_at_commit` (rows whose last checks wait for the commit: a location below a parent the same import creates, ED-29). On a preset import: `setup` (what creating the import created). */
            summary: {
                [key: string]: unknown;
            } | null;
            /** Format: uuid */
            requested_by: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** @description Per-column statistics (only on a single import, not in lists). Without `import:run` the `samples` of each column are empty. */
            profile?: components["schemas"]["ImportColumnProfile"][] | null;
            /** @description The first 50 data rows (only on a single import; null without `import:run`: they are cells of the file). */
            samples?: string[][] | null;
            /** @description How sure the suggested mapping is per column index (1 = exact header match). */
            confidence?: {
                [key: string]: number;
            } | null;
            /** @description Empty without `import:run` (its keys are values of the file). */
            value_map?: components["schemas"]["ImportValueMap"];
        };
        ImportList: {
            data: components["schemas"]["ImportJob"][];
            page: components["schemas"]["PageInfo"];
        };
        ImportCreate: {
            /** @enum {string} */
            entity_type: "asset" | "person" | "location" | "department";
            /** @description A built-in preset of the same entity type. `google_admin_chromeos` creates the Chromebook category and its custom fields when they do not exist (needs `catalog:manage` then); it maps the org unit path to the department (one value-map entry per unit, created when missing: `department:manage`) and Disabled / Deprovisioned devices to the archived (Retired) status (ED-29). */
            preset_key?: string;
            options?: components["schemas"]["ImportOptions"];
        };
        /** @description Any change returns a `dry_run_done` import to `mapped` and invalidates the digest. Allowed in `draft`, `uploaded`, `analyzed`, `mapped` and `dry_run_done`. */
        ImportUpdate: {
            mapping?: components["schemas"]["ImportMapping"];
            /** @description Only the options to change; `references` and `defaults` are merged by key. */
            options?: components["schemas"]["ImportOptions"];
            /** @description Replaces the entries of each reference kind given (send `{}` for a kind to clear it). */
            value_map?: components["schemas"]["ImportValueMap"];
        };
        ImportAnalyze: {
            /**
             * Format: uuid
             * @description Attachment of kind `import_file` owned by this import, uploaded and completed. Omit to analyse the file again.
             */
            file_attachment_id?: string;
            /** @description Overrides of what the analysis detects. */
            parse?: {
                /** @enum {string} */
                encoding?: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
                /** @enum {string} */
                delimiter?: "," | ";" | "\t" | "|";
                sheet?: string;
                header_line?: number;
            };
        };
        ImportCommit: {
            /** @description The `dry_run_digest` of the dry run the user reviewed. */
            dry_run_digest: string;
        };
        ImportRow: {
            /** @description Position among the data rows. */
            row_no: number;
            /** @description Line (CSV) or row (XLSX) of the file; shown in error messages. */
            line_no: number;
            /** @enum {string} */
            phase: "dry_run" | "commit";
            /** @description Dry run: `create` / `update` / `skip` / `error`. Commit: `created` / `updated` / `skipped` / `error`. */
            outcome: string | null;
            /** @enum {string|null} */
            plan: "create" | "update" | "skip" | "error" | null;
            /** @enum {string|null} */
            result: "created" | "updated" | "skipped" | "error" | null;
            /**
             * Format: uuid
             * @description The existing record an update changes.
             */
            entity_id: string | null;
            /**
             * Format: uuid
             * @description The record the commit created.
             */
            created_id: string | null;
            /** @description Row number of the first row of the file with the same key. */
            duplicate_of: number | null;
            errors: components["schemas"]["RowIssue"][];
            warnings: components["schemas"]["RowIssue"][];
            /** @description The non-empty cells of the row by header. */
            source: {
                [key: string]: string;
            };
            /** @description The typed record the mapping produced (`f` fields, `r` references, `c` custom fields). */
            mapped: {
                [key: string]: unknown;
            } | null;
            /** @description Commit of an update: the values it replaced (kept for import undo, v1.1). */
            before_image: {
                [key: string]: unknown;
            } | null;
        };
        ImportRowList: {
            data: components["schemas"]["ImportRow"][];
            page: components["schemas"]["PageInfo"];
        };
        ImportValue: {
            /** @description A distinct value of the column (trimmed). */
            value: string;
            count: number;
            /** @description The existing record the value resolves to by name, by the rules of the dry run (a model inside the category of its rows; a bare location name counting the locations this import creates). Null when nothing matches (the import creates it or reports the rows, by the kind's policy) and when `issue` is set. */
            suggestion: {
                /** Format: uuid */
                id: string;
                name: string;
            } | null;
            /** @description [ED-37] Why the rows of this value will fail the dry run although a record of that name exists: they need a decision (map the value, or the category, or write the full path). Null otherwise. */
            issue: {
                /** @description `ambiguous` (a bare location name that several locations have, counting those the import creates) or `invalid` (a model that exists only in another category than its rows'). */
                code: string;
                message: string;
            } | null;
            /** @description What the value map says now. */
            entry: components["schemas"]["ImportValueEntry"] | null;
        };
        ImportValues: {
            /** @enum {string} */
            field: "category" | "manufacturer" | "model" | "status" | "location" | "department" | "vendor" | "person";
            column: string | null;
            /** @description Distinct values in the column (`data` is capped by `limit`). */
            distinct: number;
            data: components["schemas"]["ImportValue"][];
        };
        ImportPresetColumn: {
            column: string;
            target: string;
            description: string;
            required: string;
            example: string;
        };
        ImportPreset: {
            key: string;
            label: string;
            description: string;
            /** @enum {string} */
            entity_type: "asset" | "person" | "location" | "department";
            /** @enum {string} */
            source: "csv" | "google_admin_csv";
            notes: string[];
            /** @description Reference data creating an import from this preset creates when it is missing. */
            sets_up: {
                category: string;
                custom_fields: string[];
            } | null;
            /** @description The columns of the template with their data dictionary. */
            columns: components["schemas"]["ImportPresetColumn"][];
        };
        ImportPresetList: {
            data: components["schemas"]["ImportPreset"][];
        };
        ImportTemplateColumn: {
            header: string;
            target: string | null;
            /** @enum {string} */
            date_format?: "auto" | "iso" | "dmy" | "mdy";
        };
        ImportTemplate: {
            /** Format: uuid */
            id: string;
            name: string;
            description: string | null;
            /** @enum {string} */
            entity_type: "asset" | "person" | "location" | "department";
            columns: components["schemas"]["ImportTemplateColumn"][];
            options: components["schemas"]["ImportOptions"];
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            created_by: string | null;
        };
        ImportTemplateList: {
            data: components["schemas"]["ImportTemplate"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Either `from_import_id`, or `entity_type` and `columns`. */
        ImportTemplateCreate: {
            name: string;
            description?: string | null;
            /** @enum {string} */
            entity_type?: "asset" | "person" | "location" | "department";
            columns?: components["schemas"]["ImportTemplateColumn"][];
            options?: components["schemas"]["ImportOptions"];
            /**
             * Format: uuid
             * @description Copy the mapping (by header) and the options of this import instead of `entity_type` and `columns`.
             */
            from_import_id?: string;
        };
        ImportTemplateUpdate: {
            name?: string;
            description?: string | null;
            columns?: components["schemas"]["ImportTemplateColumn"][];
            options?: components["schemas"]["ImportOptions"];
        };
        ImportTemplateApply: {
            /** Format: uuid */
            template_id: string;
        };
        ScopeLocation: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @description The names from the top of the tree down to this location, joined with " / ". */
            path: string;
        };
    };
    responses: {
        /** @description Malformed request (bad JSON, bad query parameter, invalid cursor). Codes: `bad-request`, `idempotency-key-required`, `idempotency-key-invalid`. */
        BadRequest: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://api.assettracker.test/problems/bad-request",
                 *       "title": "Bad request",
                 *       "status": 400,
                 *       "code": "bad-request",
                 *       "detail": "Query parameter \"limit\" must be between 1 and 200.",
                 *       "request_id": "01JABCDEF0123456789"
                 *     }
                 */
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Missing, invalid or expired credentials. Codes: `unauthorized`, `session-expired`. */
        Unauthorized: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                /** @description Authentication scheme. */
                "WWW-Authenticate"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Authenticated, but the principal lacks the required permission (or MFA enrolment is required). Codes: `forbidden`, `csrf-invalid`, `mfa-enrolment-required`. */
        Forbidden: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The resource does not exist **or belongs to another tenant or is outside the caller's scope**. Codes: `not-found`. */
        NotFound: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description State conflict: uniqueness violation, asset already checked out, insufficient stock, or an Idempotency-Key request still in flight. Codes: `conflict`, `idempotency-key-in-flight`. */
        Conflict: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description `If-Match` does not match the current version; re-read and retry. Codes: `precondition-failed`. */
        PreconditionFailed: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description `If-Match` header is required for this operation. Codes: `precondition-required`. */
        PreconditionRequired: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Validation failed (see `errors[]`), or an Idempotency-Key was reused with a different body. Codes: `validation`, `idempotency-key-reuse`. */
        Unprocessable: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://api.assettracker.test/problems/validation",
                 *       "title": "Validation failed",
                 *       "status": 422,
                 *       "code": "validation",
                 *       "errors": [
                 *         {
                 *           "pointer": "/asset_tag",
                 *           "message": "must not contain whitespace",
                 *           "code": "pattern"
                 *         }
                 *       ],
                 *       "request_id": "01JABCDEF0123456789"
                 *     }
                 */
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Rate limit exceeded. Codes: `too-many-requests`. */
        TooManyRequests: {
            headers: {
                "X-Request-Id": components["headers"]["RequestId"];
                "Retry-After": components["headers"]["RetryAfter"];
                "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                "RateLimit-Reset": components["headers"]["RateLimitReset"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        /** @description Resource id (UUIDv7). */
        Id: string;
        /** @description Asset id. */
        AssetIdPath: string;
        /** @description Opaque cursor from `page.next_cursor` of the previous page. */
        Cursor: string;
        /** @description Page size. */
        Limit: number;
        /** @description Also return `page.total` (an extra count query; avoid on large lists). */
        IncludeTotal: boolean;
        /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
        Archived: "exclude" | "include" | "only";
        /** @description Free-text search (trigram / prefix match). */
        Q: string;
        /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
        IdempotencyKey: string;
        /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
        IdempotencyKeyRequired: string;
        /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
        IfMatch: string;
        /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
        IfMatchOptional: string;
        /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
        CsrfToken: string;
    };
    requestBodies: never;
    headers: {
        /** @description Weak entity tag of the resource version, `W/"<version>"`. Send it back in `If-Match`. */
        ETag: string;
        /** @description URL of the created or queued resource. */
        Location: string;
        /** @description Server-generated request id; quote it in support requests. */
        RequestId: string;
        /** @description Requests allowed in the current window. */
        RateLimitLimit: number;
        /** @description Requests left in the current window. */
        RateLimitRemaining: number;
        /** @description Seconds until the window resets. */
        RateLimitReset: number;
        /** @description Seconds to wait before retrying. */
        RetryAfter: number;
        /** @description `true` when the response is a replay of an earlier request with the same Idempotency-Key. */
        IdempotentReplayed: boolean;
        /** @description Session cookie `__Host-at_session`. */
        SetCookie: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listAccessories: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Filter by category. */
                category_id?: string;
                /** @description Filter by location. */
                location_id?: string;
                /** @description true = only accessories with `min_qty > 0` and `qty_available <= min_qty`; false = all the others. */
                low_stock?: boolean;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, qty_total, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "qty_total" | "-qty_total" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessoryList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createAccessory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccessoryCreate"];
            };
        };
        responses: {
            /** @description Accessory created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Accessory"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getAccessory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The accessory. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Accessory"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveAccessory: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Units are still checked out (`usage.open_assignments`); return them first. Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateAccessory: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccessoryUpdate"];
            };
        };
        responses: {
            /** @description Updated accessory. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Accessory"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The new `qty_total` is below the units that are checked out (`insufficient-stock`), or another uniqueness conflict. Codes: `insufficient-stock`, `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/insufficient-stock",
                     *       "title": "insufficient stock",
                     *       "status": 409,
                     *       "code": "insufficient-stock",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listAccessoryAssignments: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Defaults to `open`. */
                state?: "open" | "closed" | "all";
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of assignments. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssignmentList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    checkinAccessory: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccessoryCheckinRequest"];
            };
        };
        responses: {
            /** @description The assignment after the return: still open with a higher `quantity_returned` after a partial return, closed (`checked_in_at` set) after the last units come back. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Assignment"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The assignment is already fully returned, or a request with the same Idempotency-Key is still running. Codes: `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    checkoutAccessory: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "person_id": "0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91",
                 *       "quantity": 2,
                 *       "note": "Two chargers for the new starter"
                 *     }
                 */
                "application/json": components["schemas"]["AccessoryCheckoutRequest"];
            };
        };
        responses: {
            /** @description Checked out. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Assignment"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Not enough units available (`insufficient-stock`), the accessory is archived, or a request with the same Idempotency-Key is still running. Codes: `insufficient-stock`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/insufficient-stock",
                     *       "title": "insufficient stock",
                     *       "status": 409,
                     *       "code": "insufficient-stock",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listApiKeys: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of API keys (secrets are never returned). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createApiKey: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiKeyCreate"];
            };
        };
        responses: {
            /** @description Key created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyCreated"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    revokeApiKey: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listAssets: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Exact asset tag (case-insensitive) - the barcode scan path. */
                tag?: string;
                /** @description Exact serial number. */
                serial?: string;
                /** @description Any of these status labels. */
                status_id?: string[];
                /** @description Any of these state types. */
                state_type?: ("deployable" | "deployed" | "pending" | "undeployable" | "archived" | "lost")[];
                /** @description Any of these categories. */
                category_id?: string[];
                /** @description Any of these models. */
                model_id?: string[];
                /** @description Via the model. */
                manufacturer_id?: string;
                /** @description Assets at this location. */
                location_id?: string;
                /** @description [ED-17] Assets of this department. */
                department_id?: string;
                /** @description With `location_id`: include the whole subtree. */
                include_sublocations?: boolean;
                /** @description Filter by company. */
                company_id?: string;
                /** @description Filter by vendor. */
                vendor_id?: string;
                /** @description Children of this asset. */
                parent_asset_id?: string;
                /** @description Currently checked out to this person. */
                assigned_person_id?: string;
                /** @description true = checked out, false = in stock. */
                assigned?: boolean;
                /** @description [M2-W1] true = checked out with an `expected_return` before today (UTC); false = every other asset. */
                overdue?: boolean;
                /** @description [LOAN] Members of this loaner pool (ED-20). */
                loaner_pool_id?: string;
                /** @description [LOAN] true = member of any loaner pool, false = in none. */
                in_loaner_pool?: boolean;
                /** @description [ED-38] The assets this import created (its rows with result `created`). Matches nothing once the import's rows are purged (ED-25). */
                import_job_id?: string;
                /** @description Warranty ends on or before. */
                warranty_end_before?: string;
                /** @description Warranty ends on or after. */
                warranty_end_after?: string;
                /** @description Purchased on or after. */
                purchase_date_from?: string;
                /** @description Purchased on or before. */
                purchase_date_to?: string;
                /** @description Changed at or after (incremental sync). */
                updated_since?: string;
                /** @description Custom field filters, e.g. `cf[warranty_tier]=gold`. Exact match on the JSONB value. */
                cf?: {
                    [key: string]: string;
                };
                /** @description Embed related objects under `expanded`. */
                expand?: ("model" | "category" | "location" | "vendor" | "department")[];
                /** @description Sparse fieldset: return only these top-level properties (`id` is always included). */
                fields?: string[];
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: created_at, updated_at, asset_tag, name, purchase_date, warranty_end, location, assignee, due. A unique tiebreaker (`id`) is always appended. */
                sort?: ("created_at" | "-created_at" | "updated_at" | "-updated_at" | "asset_tag" | "-asset_tag" | "name" | "-name" | "purchase_date" | "-purchase_date" | "warranty_end" | "-warranty_end" | "location" | "-location" | "assignee" | "-assignee" | "due" | "-due")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of assets. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createAsset: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "asset_tag": "LAP-00042",
                 *       "name": "Dana's laptop",
                 *       "serial": "C02XK1ABCD",
                 *       "category_id": "0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d90",
                 *       "model_id": null,
                 *       "custom_data": {
                 *         "warranty_tier": "gold"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["AssetCreate"];
            };
        };
        responses: {
            /** @description Asset created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getAsset: {
        parameters: {
            query?: {
                /** @description Embed related objects under `expanded`. */
                expand?: ("model" | "category" | "location" | "vendor" | "department")[];
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveAsset: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateAsset: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetUpdate"];
            };
        };
        responses: {
            /** @description Updated asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listAssetAssignments: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of assignments. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssignmentList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    checkinAsset: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CheckinRequest"];
            };
        };
        responses: {
            /** @description Checked in. Returns the updated asset and the closed assignment; `ETag` is the new version of the asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustodyResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The asset has no open check-out, or a request with the same Idempotency-Key is still running. Codes: `asset-not-checked-out`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/asset-not-checked-out",
                     *       "title": "asset not checked out",
                     *       "status": 409,
                     *       "code": "asset-not-checked-out",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    checkoutAsset: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "person_id": "0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91",
                 *       "expected_return": "2026-12-15",
                 *       "note": "Loan for the exam week"
                 *     }
                 */
                "application/json": components["schemas"]["CheckoutRequest"];
            };
        };
        responses: {
            /** @description Checked out. Returns the updated asset and the new assignment; `ETag` is the new version of the asset and `Location` points at the assignment. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustodyResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Already checked out, not in a deployable state (lost, archived, in repair, pending), or a request with the same Idempotency-Key is still running. Codes: `asset-already-checked-out`, `asset-not-deployable`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/asset-already-checked-out",
                     *       "title": "asset already checked out",
                     *       "status": 409,
                     *       "code": "asset-already-checked-out",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    cloneAsset: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AssetCloneRequest"];
            };
        };
        responses: {
            /** @description The copies. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetCloneResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    disposeAsset: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "reason": "recycled",
                 *       "note": "Certificate R-2210"
                 *     }
                 */
                "application/json": components["schemas"]["DisposeRequest"];
            };
        };
        responses: {
            /** @description The disposed asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The asset is archived, or its state does not allow this action (see the description). Codes: `conflict`, `asset-already-checked-out`, `asset-not-deployable`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listAssetHistory: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by event type. */
                event_type?: ("created" | "updated" | "status_changed" | "location_changed" | "checked_out" | "checked_in" | "transferred" | "repair_opened" | "repair_completed" | "archived" | "restored" | "label_printed" | "imported" | "custody_undone")[];
                /** @description Events at or after. */
                from?: string;
                /** @description Events before. */
                to?: string;
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of events. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HistoryEventList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    markAssetFound: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["MarkFoundRequest"];
            };
        };
        responses: {
            /** @description The recovered asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The asset is not in a lost state. Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    markAssetLost: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["MarkLostRequest"];
            };
        };
        responses: {
            /** @description The asset in its lost state. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The asset is archived, or its state does not allow this action (see the description). Codes: `conflict`, `asset-already-checked-out`, `asset-not-deployable`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    moveAsset: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "location_id": "0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d92",
                 *       "note": "Moved to the exam room"
                 *     }
                 */
                "application/json": components["schemas"]["MoveRequest"];
            };
        };
        responses: {
            /** @description The moved asset; `ETag` is its new version. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The asset is archived. Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getAssetRepairSummary: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The totals. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepairSummary"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    restoreAsset: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Restored asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Asset"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    transferAsset: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransferRequest"];
            };
        };
        responses: {
            /** @description Transferred. Returns the updated asset, the transfer record and the new assignment; `ETag` is the new version of the asset. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransferResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The asset cannot be handed out in its current state, or a request with the same Idempotency-Key is still running. Codes: `asset-not-deployable`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/asset-not-deployable",
                     *       "title": "asset not deployable",
                     *       "status": 409,
                     *       "code": "asset-not-deployable",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    undoAssetCustody: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "assignment_id": "0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d93"
                 *     }
                 */
                "application/json": components["schemas"]["UndoCustodyRequest"];
            };
        };
        responses: {
            /** @description Undone. Returns the updated asset and the assignment now in effect; `ETag` is the new version of the asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UndoResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Too late, the asset changed meanwhile, already undone, or the previous holder / status is gone. Codes: `undo-expired`, `undo-asset-changed`, `undo-not-possible`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/undo-expired",
                     *       "title": "undo expired",
                     *       "status": 409,
                     *       "code": "undo-expired",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    bulkArchiveAssets: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAssetIds"];
            };
        };
        responses: {
            /** @description Per-item results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkAssetResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    bulkMoveAssets: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAssetMove"];
            };
        };
        responses: {
            /** @description Per-item results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkAssetResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    bulkRestoreAssets: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAssetIds"];
            };
        };
        responses: {
            /** @description Per-item results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkAssetResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    bulkUpdateAssets: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkAssetUpdate"];
            };
        };
        responses: {
            /** @description Per-item results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkAssetResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listAttachments: {
        parameters: {
            query: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                entity_type: "asset" | "asset_model" | "accessory" | "consumable" | "location" | "person" | "maintenance_record" | "assignment" | "import_job";
                entity_id: string;
                /** @description Filter by kind. */
                kind?: "photo" | "document" | "signature" | "import_file" | "other";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of attachments. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createAttachment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttachmentCreate"];
            };
        };
        responses: {
            /** @description Upload prepared. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttachmentUpload"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            /** @description The file is larger than the organisation's upload cap. Codes: `payload-too-large`. */
            413: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/payload-too-large",
                     *       "title": "payload too large",
                     *       "status": 413,
                     *       "code": "payload-too-large",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The file type is not allowed, or does not match the file name extension. Codes: `unsupported-media-type`. */
            415: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/unsupported-media-type",
                     *       "title": "unsupported media type",
                     *       "status": 415,
                     *       "code": "unsupported-media-type",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getAttachment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The attachment. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Attachment"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveAttachment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    completeAttachment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Upload confirmed; scan queued. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Attachment"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description No object was uploaded yet. Codes: `upload-missing`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/upload-missing",
                     *       "title": "upload missing",
                     *       "status": 409,
                     *       "code": "upload-missing",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The uploaded object is larger than declared or allowed. Codes: `payload-too-large`. */
            413: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/payload-too-large",
                     *       "title": "payload too large",
                     *       "status": 413,
                     *       "code": "payload-too-large",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The content does not match the declared type. Codes: `unsupported-media-type`. */
            415: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/unsupported-media-type",
                     *       "title": "unsupported media type",
                     *       "status": 415,
                     *       "code": "unsupported-media-type",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The uploaded size differs from the declared size. Codes: `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    listAuditLog: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by entity type. */
                entity_type?: string;
                /** @description Filter by entity id. */
                entity_id?: string;
                /** @description Filter by acting user. */
                actor_user_id?: string;
                /** @description Exact action, e.g. `asset.checkout`. */
                action?: string;
                /** @description Everything done by one request. */
                request_id?: string;
                /** @description At or after. */
                from?: string;
                /** @description Before. */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of audit entries. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEntryList"];
                    "text/csv": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Invitation token from the email link. */
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The invitation. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationInfo"];
                };
            };
            /** @description Unknown token, or the invitation was already accepted or revoked. Codes: `invitation-not-found`. */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/invitation-not-found",
                     *       "title": "invitation not found",
                     *       "status": 404,
                     *       "code": "invitation-not-found",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The invitation expired; an administrator can resend it. Codes: `invitation-expired`. */
            410: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/invitation-expired",
                     *       "title": "invitation expired",
                     *       "status": 410,
                     *       "code": "invitation-expired",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    acceptInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptInvitationRequest"];
            };
        };
        responses: {
            /** @description Account activated and signed in. */
            200: {
                headers: {
                    "Set-Cookie": components["headers"]["SetCookie"];
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Malformed request. Codes: `bad-request`. */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/bad-request",
                     *       "title": "bad request",
                     *       "status": 400,
                     *       "code": "bad-request",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Unknown token, or the invitation was already accepted or revoked. Codes: `invitation-not-found`. */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/invitation-not-found",
                     *       "title": "invitation not found",
                     *       "status": 404,
                     *       "code": "invitation-not-found",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The invitation expired; an administrator can resend it. Codes: `invitation-expired`. */
            410: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/invitation-expired",
                     *       "title": "invitation expired",
                     *       "status": 410,
                     *       "code": "invitation-expired",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Password rejected: `errors[]` pointer `/password`, code `too-short`, `too-long` or `breached`. Codes: `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "email": "alice@example.org",
                 *       "password": "correct horse battery staple"
                 *     }
                 */
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Authenticated, or a next step is required. */
            200: {
                headers: {
                    "Set-Cookie": components["headers"]["SetCookie"];
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            /** @description Wrong email or password (same answer for an unknown account). Codes: `invalid-credentials`. */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    /** @description Authentication scheme. */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/invalid-credentials",
                     *       "title": "invalid credentials",
                     *       "status": 401,
                     *       "code": "invalid-credentials",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The principal. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description No session, or it expired or was revoked. Codes: `unauthorized`, `session-expired`. */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    /** @description Authentication scheme. */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/unauthorized",
                     *       "title": "unauthorized",
                     *       "status": 401,
                     *       "code": "unauthorized",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    disableMfa: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReauthRequest"];
            };
        };
        responses: {
            /** @description MFA disabled. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Tenant policy enforces MFA for this user, the re-authentication value is wrong, or the request is not a valid browser-session mutation. Codes: `mfa-required-by-policy`, `reauth-failed`, `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/mfa-required-by-policy",
                     *       "title": "mfa required by policy",
                     *       "status": 403,
                     *       "code": "mfa-required-by-policy",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description MFA is not enabled for this user. Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Neither `password` nor `totp_code` was sent. Codes: `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    startMfaEnrolment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pending factor. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaEnrolment"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session (not an API key) with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A TOTP factor is already active; disable it first. Codes: `mfa-already-enrolled`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/mfa-already-enrolled",
                     *       "title": "mfa already enrolled",
                     *       "status": 409,
                     *       "code": "mfa-already-enrolled",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    confirmMfaEnrolment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MfaConfirmRequest"];
            };
        };
        responses: {
            /** @description Factor active; recovery codes and the new CSRF token. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaEnrolmentConfirmed"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session (not an API key) with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No enrolment is pending (call enrol first) or a factor is already active. Codes: `conflict`, `mfa-already-enrolled`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The code does not match. `errors[]` pointer `/code`. Codes: `mfa-invalid-code`, `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/mfa-invalid-code",
                     *       "title": "mfa invalid code",
                     *       "status": 422,
                     *       "code": "mfa-invalid-code",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    regenerateRecoveryCodes: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReauthRequest"];
            };
        };
        responses: {
            /** @description New recovery codes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaRecoveryCodes"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Not a browser session, bad CSRF token, or the re-authentication value is wrong. Codes: `forbidden`, `csrf-invalid`, `reauth-failed`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description MFA is not enabled for this user. Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Neither `password` nor `totp_code` was sent. Codes: `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    verifyMfa: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MfaVerifyRequest"];
            };
        };
        responses: {
            /** @description Session created. */
            200: {
                headers: {
                    "Set-Cookie": components["headers"]["SetCookie"];
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            /** @description The code is wrong (also: a TOTP code replayed inside its window) or the challenge is gone. Codes: `mfa-invalid-code`, `mfa-challenge-expired`. */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    /** @description Authentication scheme. */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/mfa-invalid-code",
                     *       "title": "mfa invalid code",
                     *       "status": 401,
                     *       "code": "mfa-invalid-code",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getPasswordPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The policy. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordPolicy"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    forgotPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "email": "alice@example.org"
                 *     }
                 */
                "application/json": components["schemas"]["ForgotPasswordRequest"];
            };
        };
        responses: {
            /** @description Accepted. If the account exists an email is on its way. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Malformed request. Codes: `bad-request`. */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/bad-request",
                     *       "title": "bad request",
                     *       "status": 400,
                     *       "code": "bad-request",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Validation failed. Codes: `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resetPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetPasswordRequest"];
            };
        };
        responses: {
            /** @description Password changed; all sessions revoked. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Malformed request. Codes: `bad-request`. */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/bad-request",
                     *       "title": "bad request",
                     *       "status": 400,
                     *       "code": "bad-request",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The reset token is unknown or was already used. Codes: `token-invalid`. */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/token-invalid",
                     *       "title": "token invalid",
                     *       "status": 404,
                     *       "code": "token-invalid",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The reset token has expired; request a new link. Codes: `token-expired`. */
            410: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/token-expired",
                     *       "title": "token expired",
                     *       "status": 410,
                     *       "code": "token-expired",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Password rejected: `errors[]` pointer `/password`, code `too-short`, `too-long` or `breached`. Codes: `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`. Codes: `account-locked`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/account-locked",
                     *       "title": "account locked",
                     *       "status": 429,
                     *       "code": "account-locked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listMySessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Active sessions. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionInfoList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session, not an API key. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    revokeOtherSessions: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Other sessions revoked. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session (not an API key) with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    revokeMySession: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session (not an API key) with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Not found. Codes: `not-found`. */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/not-found",
                     *       "title": "not found",
                     *       "status": 404,
                     *       "code": "not-found",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description That is the current session; use sign out. Codes: `cannot-revoke-current`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/cannot-revoke-current",
                     *       "title": "cannot revoke current",
                     *       "status": 409,
                     *       "code": "cannot-revoke-current",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    listCategories: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Filter by kind. */
                kind?: "asset" | "accessory" | "consumable" | "component" | "license";
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CategoryList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createCategory: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryCreate"];
            };
        };
        responses: {
            /** @description Category created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The category. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveCategory: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateCategory: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CategoryUpdate"];
            };
        };
        responses: {
            /** @description Updated category. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Category"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listCompanies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All companies of the tenant. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompanyList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listConsumables: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Filter by category. */
                category_id?: string;
                /** @description Filter by location. */
                location_id?: string;
                /** @description true = only consumables with `min_qty > 0` and `qty_on_hand <= min_qty`; false = all the others. */
                low_stock?: boolean;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, qty_on_hand, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "qty_on_hand" | "-qty_on_hand" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsumableList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createConsumable: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsumableCreate"];
            };
        };
        responses: {
            /** @description Consumable created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Consumable"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getConsumable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The consumable. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Consumable"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveConsumable: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Reserved for a uniqueness conflict; a consumable with stock can be archived (its ledger stays). Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateConsumable: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsumableUpdate"];
            };
        };
        responses: {
            /** @description Updated consumable. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Consumable"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listStockMovements: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by reason. */
                reason?: ("receive" | "issue" | "return" | "adjust" | "correction")[];
                /** @description Only movements issued to / returned by this person. */
                person_id?: string;
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of movements, newest first. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StockMovementList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createStockMovement: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "qty_delta": -2,
                 *       "reason": "issue",
                 *       "person_id": "0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91",
                 *       "note": "Printer on floor 2"
                 *     }
                 */
                "application/json": components["schemas"]["StockMovementCreate"];
            };
        };
        responses: {
            /** @description Movement recorded. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StockMovement"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The movement would make stock negative (`insufficient-stock`), the consumable is archived, or a request with the same Idempotency-Key is still running. Codes: `insufficient-stock`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/insufficient-stock",
                     *       "title": "insufficient stock",
                     *       "status": 409,
                     *       "code": "insufficient-stock",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listCustomFields: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Fields applying to this category (including fields that apply to all categories). */
                category_id?: string;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: position, key, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("position" | "-position" | "key" | "-key" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomFieldDefList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createCustomFieldDef: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CustomFieldDefCreate"];
            };
        };
        responses: {
            /** @description CustomFieldDef created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomFieldDef"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getCustomFieldDef: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The custom field definition. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomFieldDef"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveCustomFieldDef: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateCustomFieldDef: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CustomFieldDefUpdate"];
            };
        };
        responses: {
            /** @description Updated custom field definition. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomFieldDef"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listDepartments: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, code, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "code" | "-code" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DepartmentList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createDepartment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DepartmentCreate"];
            };
        };
        responses: {
            /** @description Department created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Department"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getDepartment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The department. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Department"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveDepartment: {
        parameters: {
            query?: {
                /** @description Move the people and assets of this department to that department before archiving (merge). Must be another live department (422 on `query:reassign_to` otherwise). */
                reassign_to?: string;
            };
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateDepartment: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DepartmentUpdate"];
            };
        };
        responses: {
            /** @description Updated department. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Department"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listExports: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by status. */
                status?: ("queued" | "running" | "succeeded" | "failed" | "expired")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of exports. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createExport: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportCreate"];
            };
        };
        responses: {
            /** @description Export queued. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    Location: components["headers"]["Location"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Export"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Missing `export:run` or the read permission of the list. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getExport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The export. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Export"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    downloadLocalFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Signed, short-lived download token from the presigned URL. */
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The file bytes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    /** @description inline for raster images, attachment otherwise. */
                    "Content-Disposition"?: string;
                    /** @description nosniff */
                    "X-Content-Type-Options"?: string;
                    /** @description default-src 'none'; sandbox */
                    "Content-Security-Policy"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description The token is malformed, forged or not a download token, the file is gone, or this deployment does not use local storage. Codes: `token-invalid`, `not-found`. */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/token-invalid",
                     *       "title": "token invalid",
                     *       "status": 404,
                     *       "code": "token-invalid",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The download URL expired; fetch the attachment again for a new one. Codes: `token-expired`. */
            410: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/token-expired",
                     *       "title": "token expired",
                     *       "status": 410,
                     *       "code": "token-expired",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    uploadLocalFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Signed, short-lived upload token from the presigned URL. */
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Stored. Now call `POST /v1/attachments/{id}/complete`. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The body has fewer bytes than the URL was issued for. Codes: `bad-request`. */
            400: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/bad-request",
                     *       "title": "bad request",
                     *       "status": 400,
                     *       "code": "bad-request",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description The token is malformed, forged or not an upload token, or this deployment does not use local storage. Codes: `token-invalid`, `not-found`. */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/token-invalid",
                     *       "title": "token invalid",
                     *       "status": 404,
                     *       "code": "token-invalid",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description This upload URL was already used. Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The upload URL expired. Codes: `token-expired`. */
            410: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/token-expired",
                     *       "title": "token expired",
                     *       "status": 410,
                     *       "code": "token-expired",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description More bytes than the URL was issued for. Codes: `payload-too-large`. */
            413: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/payload-too-large",
                     *       "title": "payload too large",
                     *       "status": 413,
                     *       "code": "payload-too-large",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The Content-Type differs from the one the URL was issued for. Codes: `unsupported-media-type`. */
            415: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/unsupported-media-type",
                     *       "title": "unsupported media type",
                     *       "status": 415,
                     *       "code": "unsupported-media-type",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Healthy. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            429: components["responses"]["TooManyRequests"];
            /** @description Degraded: the database check failed (same body). */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    listImportTemplates: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by entity type. */
                entity_type?: "asset" | "person" | "location" | "department";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of templates, by name. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportTemplateList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createImportTemplate: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportTemplateCreate"];
            };
        };
        responses: {
            /** @description The template. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportTemplate"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getImportTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportTemplate"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    deleteImportTemplate: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateImportTemplate: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportTemplateUpdate"];
            };
        };
        responses: {
            /** @description The template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportTemplate"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listImports: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by state. */
                state?: ("draft" | "uploaded" | "analyzing" | "analyzed" | "mapped" | "dry_running" | "dry_run_done" | "committing" | "completed" | "failed" | "cancelled")[];
                /** @description Filter by entity type. */
                entity_type?: "asset" | "person" | "location" | "department";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of imports. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createImport: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportCreate"];
            };
        };
        responses: {
            /** @description The import. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The import, with column profile, sample rows, mapping and value map. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateImport: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportUpdate"];
            };
        };
        responses: {
            /** @description The import. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The import is not in a state that allows this (`import-wrong-state`, with `state` and `allowed`), or the digest is not the reviewed dry run (`import-stale-dry-run`). Codes: `import-wrong-state`, `import-stale-dry-run`, `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-wrong-state",
                     *       "title": "import wrong state",
                     *       "status": 409,
                     *       "code": "import-wrong-state",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    analyzeImport: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ImportAnalyze"];
            };
        };
        responses: {
            /** @description Analysis queued. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    Location: components["headers"]["Location"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The import is not in a state that allows this (`import-wrong-state`, with `state` and `allowed`), or the digest is not the reviewed dry run (`import-stale-dry-run`). Codes: `import-wrong-state`, `import-stale-dry-run`, `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-wrong-state",
                     *       "title": "import wrong state",
                     *       "status": 409,
                     *       "code": "import-wrong-state",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            /** @description Too many imports are running at once (`import-quota-exceeded`, see `Retry-After`) or the general rate limit. Codes: `import-quota-exceeded`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-quota-exceeded",
                     *       "title": "import quota exceeded",
                     *       "status": 429,
                     *       "code": "import-quota-exceeded",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    applyImportTemplate: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportTemplateApply"];
            };
        };
        responses: {
            /** @description The import. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The import is not in a state that allows this (`import-wrong-state`, with `state` and `allowed`), or the digest is not the reviewed dry run (`import-stale-dry-run`). Codes: `import-wrong-state`, `import-stale-dry-run`, `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-wrong-state",
                     *       "title": "import wrong state",
                     *       "status": 409,
                     *       "code": "import-wrong-state",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    cancelImport: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The import. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The import is not in a state that allows this (`import-wrong-state`, with `state` and `allowed`), or the digest is not the reviewed dry run (`import-stale-dry-run`). Codes: `import-wrong-state`, `import-stale-dry-run`, `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-wrong-state",
                     *       "title": "import wrong state",
                     *       "status": 409,
                     *       "code": "import-wrong-state",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    commitImport: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportCommit"];
            };
        };
        responses: {
            /** @description Commit queued. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    Location: components["headers"]["Location"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description The import needs permissions the caller does not hold. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description The import is not in a state that allows this (`import-wrong-state`, with `state` and `allowed`), or the digest is not the reviewed dry run (`import-stale-dry-run`). Codes: `import-wrong-state`, `import-stale-dry-run`, `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-wrong-state",
                     *       "title": "import wrong state",
                     *       "status": 409,
                     *       "code": "import-wrong-state",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            /** @description Too many imports are running at once (`import-quota-exceeded`, see `Retry-After`) or the general rate limit. Codes: `import-quota-exceeded`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-quota-exceeded",
                     *       "title": "import quota exceeded",
                     *       "status": 429,
                     *       "code": "import-quota-exceeded",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    startImportDryRun: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dry run queued. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    Location: components["headers"]["Location"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description The import needs permissions the caller does not hold. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description The import is not in a state that allows this (`import-wrong-state`, with `state` and `allowed`), or the digest is not the reviewed dry run (`import-stale-dry-run`). Codes: `import-wrong-state`, `import-stale-dry-run`, `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-wrong-state",
                     *       "title": "import wrong state",
                     *       "status": 409,
                     *       "code": "import-wrong-state",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            /** @description Too many imports are running at once (`import-quota-exceeded`, see `Retry-After`) or the general rate limit. Codes: `import-quota-exceeded`, `too-many-requests`. */
            429: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/import-quota-exceeded",
                     *       "title": "import quota exceeded",
                     *       "status": 429,
                     *       "code": "import-quota-exceeded",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    downloadImportErrors: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The report. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    /** @description attachment */
                    "Content-Disposition"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listImportRows: {
        parameters: {
            query?: {
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Defaults to the latest phase. */
                phase?: "dry_run" | "commit";
                /** @description Filter by outcome (dry run: create/update/skip/error; commit: created/updated/skipped/error). */
                outcome?: ("create" | "update" | "skip" | "error" | "created" | "updated" | "skipped")[];
                /** @description Only rows with (or without) warnings. */
                has_warnings?: boolean;
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of rows. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportRowList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listImportValues: {
        parameters: {
            query: {
                /** @description The reference kind (the column mapped to it, or the preset constant). */
                field: "category" | "manufacturer" | "model" | "status" | "location" | "department" | "vendor" | "person";
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The values. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportValues"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listImportPresets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The presets. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportPresetList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    downloadImportTemplate: {
        parameters: {
            query?: {
                /** @description File format. */
                format?: "csv" | "xlsx";
            };
            header?: never;
            path: {
                /** @description Preset key. */
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The template file. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    /** @description attachment */
                    "Content-Disposition"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listLabelBatches: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Filter by status. */
                status?: ("queued" | "ready" | "failed" | "expired")[];
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of batches. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelBatchList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createLabelBatch: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabelBatchCreate"];
            };
        };
        responses: {
            /** @description Accepted: the batch is queued. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelBatch"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            /** @description Validation failed: unknown template or asset, `start_position` beyond the template's slots, neither or both of `asset_ids` and `filter`, a filter that matches nothing or more than 2000 assets, more than 2000 labels, a tag that cannot be a readable Code128 (`barcode-unprintable`), or a logo that is not a clean PNG/JPEG. Codes: `validation`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    getLabelBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The batch. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelBatch"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listLabelTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All templates. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelTemplateList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getLabelTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelTemplate"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateLabelTemplate: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LabelTemplateUpdate"];
            };
        };
        responses: {
            /** @description The calibrated template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabelTemplate"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listLoanerPools: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Only active / inactive pools. */
                is_active?: boolean;
                /** @description Pools whose home is this location. */
                home_location_id?: string;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPoolList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createLoanerPool: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanerPoolCreate"];
            };
        };
        responses: {
            /** @description LoanerPool created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPool"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getLoanerPool: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The loaner pool. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPool"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveLoanerPool: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateLoanerPool: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanerPoolUpdate"];
            };
        };
        responses: {
            /** @description Updated loaner pool. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPool"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    checkoutLoaner: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanerCheckoutRequest"];
            };
        };
        responses: {
            /** @description Loan opened. Returns the updated asset and the new assignment; `ETag` is the new version of the asset. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustodyResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The pool has nothing to lend, is switched off, or the borrower is at the limit; or (with `asset_id`) the device is out or not deployable. Codes: `no-loaner-available`, `loaner-pool-inactive`, `loan-limit-reached`, `asset-already-checked-out`, `asset-not-deployable`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/no-loaner-available",
                     *       "title": "no loaner available",
                     *       "status": 409,
                     *       "code": "no-loaner-available",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listLoanerPoolMembers: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description true = can be lent right now (not archived, `deployable`, not checked out); false = every other member. */
                available?: boolean;
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of pool members. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPoolMemberList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    addLoanerPoolMember: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    asset_id: string;
                };
            };
        };
        responses: {
            /** @description Already a member of this pool. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPoolMember"];
                };
            };
            /** @description Added. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPoolMember"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The asset is a member of another pool. Codes: `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    removeLoanerPoolMember: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
                /** @description Asset id. */
                asset_id: components["parameters"]["AssetIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    bulkAddLoanerPoolMembers: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanerPoolMembersBulk"];
            };
        };
        responses: {
            /** @description Per-item results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPoolMemberBulkResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    bulkRemoveLoanerPoolMembers: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanerPoolMembersBulk"];
            };
        };
        responses: {
            /** @description Per-item results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerPoolMemberBulkResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    quickCheckoutLoaners: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QuickLoanRequest"];
            };
        };
        responses: {
            /** @description Per-device results (HTTP 200 whenever the request itself was valid). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuickLoanResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            /** @description No such pool. Codes: `not-found`. */
            404: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/not-found",
                     *       "title": "not found",
                     *       "status": 404,
                     *       "code": "not-found",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The pool is switched off, the borrower text matches two people, or a request with the same Idempotency-Key is still running. Codes: `loaner-pool-inactive`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/loaner-pool-inactive",
                     *       "title": "loaner pool inactive",
                     *       "status": 409,
                     *       "code": "loaner-pool-inactive",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Bad body, unknown / inactive / ineligible borrower, or due date past the pool's maximum. Codes: `validation`, `idempotency-key-reuse`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    getLoanerDashboard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The dashboard. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanerDashboard"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listLoans: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Only this pool. */
                loaner_pool_id?: string;
                /** @description Only this borrower. */
                person_id?: string;
                /** @description Only this device. */
                asset_id?: string;
                /** @description Only these states. Default: `on_loan,due_today,overdue`. */
                state?: ("on_loan" | "due_today" | "overdue" | "returned")[];
                /** @description Open loans due on or before today + N days (0 = due today or earlier). */
                due_within_days?: number;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: expected_return, checked_out_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("expected_return" | "-expected_return" | "checked_out_at" | "-checked_out_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of loans. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getLoan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The loan. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Loan"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    extendLoan: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanExtendRequest"];
            };
        };
        responses: {
            /** @description The loan with its new due date. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Loan"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listOverdueCheckouts: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Only this pool. */
                loaner_pool_id?: string;
                /** @description Only this borrower. */
                person_id?: string;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: expected_return, days_overdue. A unique tiebreaker (`id`) is always appended. */
                sort?: ("expected_return" | "-expected_return" | "days_overdue" | "-days_overdue")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of overdue check-outs. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OverdueCheckoutList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    returnLoans: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required. */
                "Idempotency-Key": components["parameters"]["IdempotencyKeyRequired"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanReturnRequest"];
            };
        };
        responses: {
            /** @description Per-device results (HTTP 200 whenever the request itself was valid). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoanReturnResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            /** @description A request with the same Idempotency-Key is still running. Codes: `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/idempotency-key-in-flight",
                     *       "title": "idempotency key in flight",
                     *       "status": 409,
                     *       "code": "idempotency-key-in-flight",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Bad body, unknown location or status. Codes: `validation`, `idempotency-key-reuse`. */
            422: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/validation",
                     *       "title": "validation",
                     *       "status": 422,
                     *       "code": "validation",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    listLocations: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Direct children of this location. */
                parent_id?: string;
                /** @description Only root locations. */
                root?: boolean;
                /** @description All locations in the subtree below this location. */
                descendants_of?: string;
                /** @description Filter by kind. */
                kind?: ("site" | "building" | "floor" | "room" | "storage" | "vehicle" | "other")[];
                /** @description Filter by company. */
                company_id?: string;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, depth, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "depth" | "-depth" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createLocation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocationCreate"];
            };
        };
        responses: {
            /** @description Location created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Location"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getLocation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The location. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Location"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveLocation: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateLocation: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocationUpdate"];
            };
        };
        responses: {
            /** @description Updated location. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Location"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listManufacturers: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManufacturerList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createManufacturer: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManufacturerCreate"];
            };
        };
        responses: {
            /** @description Manufacturer created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Manufacturer"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getManufacturer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The manufacturer. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Manufacturer"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveManufacturer: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateManufacturer: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManufacturerUpdate"];
            };
        };
        responses: {
            /** @description Updated manufacturer. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Manufacturer"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listModels: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Filter by category. */
                category_id?: string;
                /** @description Filter by manufacturer. */
                manufacturer_id?: string;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetModelList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createAssetModel: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetModelCreate"];
            };
        };
        responses: {
            /** @description AssetModel created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetModel"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getAssetModel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The asset model. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetModel"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveAssetModel: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateAssetModel: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetModelUpdate"];
            };
        };
        responses: {
            /** @description Updated asset model. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetModel"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listNotificationDeliveries: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Recipient. */
                user_id?: string;
                /** @description Notification type. */
                type?: string;
                /** @description Channel. */
                channel?: "in_app" | "email";
                /** @description Status. */
                status?: ("delivered" | "queued" | "deferred" | "skipped" | "failed")[];
                /** @description At or after. */
                from?: string;
                /** @description Before. */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of deliveries. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationDeliveryList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listNotificationPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Preferences. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPreferenceList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session, not an API key. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateNotificationPreference: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Notification type, e.g. `attachment.infected` (see `GET /v1/notification-preferences`). */
                type: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationPreferenceUpdate"];
            };
        };
        responses: {
            /** @description The preference. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPreference"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: components["responses"]["NotFound"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listNotificationRules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Rules. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationRuleList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateNotificationRule: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Notification type, e.g. `attachment.infected` (see `GET /v1/notification-preferences`). */
                type: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationRuleUpdate"];
            };
        };
        responses: {
            /** @description The rule. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationRule"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description true = only unread ones. */
                unread?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of notifications. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session, not an API key. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    markNotificationRead: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The notification. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Notification"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    markAllNotificationsRead: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description How many were updated. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationReadAllResult"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    getNotificationUnreadCount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The count (for the bell badge). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationUnreadCount"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session, not an API key. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    listPeople: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Filter by kind. */
                kind?: ("employee" | "student" | "contractor" | "external")[];
                /** @description Filter by status. */
                status?: "active" | "inactive";
                /** @description [ED-17] People of this department. */
                department_id?: string;
                /** @description Home location. */
                location_id?: string;
                /** @description Exact employee / student number. */
                employee_ref?: string;
                /** @description Only people with (true) or without (false) a login account. */
                has_login?: boolean;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: display_name, created_at, employee_ref. A unique tiebreaker (`id`) is always appended. */
                sort?: ("display_name" | "-display_name" | "created_at" | "-created_at" | "employee_ref" | "-employee_ref")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createPerson: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersonCreate"];
            };
        };
        responses: {
            /** @description Person created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Person"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getPerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The person. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Person"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archivePerson: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updatePerson: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersonUpdate"];
            };
        };
        responses: {
            /** @description Updated person. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Person"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listPersonAssignments: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Defaults to `open`. */
                state?: "open" | "closed" | "all";
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of assignments. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssignmentList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listPersonHistory: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of events. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HistoryEventList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    linkPersonToUser: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "user_id": "0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d92"
                 *     }
                 */
                "application/json": components["schemas"]["PersonLinkUserRequest"];
            };
        };
        responses: {
            /** @description Linked. The person (`user_id` set); `ETag` is its new version. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Person"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The person already has a login, the login already has a chosen person, or the login's own placeholder person still holds assets. Codes: `person-already-linked`, `login-already-linked`, `login-person-in-use`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/person-already-linked",
                     *       "title": "person already linked",
                     *       "status": 409,
                     *       "code": "person-already-linked",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    unlinkPersonFromUser: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh. */
                "If-Match"?: components["parameters"]["IfMatchOptional"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unlinked. The person (`user_id` null); `ETag` is its new version. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Person"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The person has no login account to unlink, or is the login's own automatic record. Codes: `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            412: components["responses"]["PreconditionFailed"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listPersonStockMovements: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by reason. */
                reason?: ("receive" | "issue" | "return" | "adjust" | "correction")[];
            };
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of movements, newest first. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StockMovementList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listRepairs: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Repairs of this asset. */
                asset_id?: string;
                /** @description Filter by status. */
                status?: ("open" | "in_progress" | "completed" | "cancelled")[];
                /** @description Filter by kind. */
                kind?: ("repair" | "maintenance" | "inspection" | "upgrade")[];
                /** @description Filter by vendor. */
                vendor_id?: string;
                /** @description Reported at or after. */
                reported_from?: string;
                /** @description Reported before. */
                reported_to?: string;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: reported_at, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("reported_at" | "-reported_at" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RepairList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createRepair: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RepairCreate"];
            };
        };
        responses: {
            /** @description Repair created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Repair"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            /** @description The asset is checked out (check it in or use `force_checkin`), is lost, retired or archived, or another open repair already moved its status. Codes: `asset-already-checked-out`, `conflict`, `idempotency-key-in-flight`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/asset-already-checked-out",
                     *       "title": "asset already checked out",
                     *       "status": 409,
                     *       "code": "asset-already-checked-out",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getRepair: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The repair record. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Repair"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveRepair: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateRepair: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RepairUpdate"];
            };
        };
        responses: {
            /** @description Updated repair record. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Repair"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    completeRepair: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RepairCompleteRequest"];
            };
        };
        responses: {
            /** @description The completed repair. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Repair"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listRoles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All roles of the tenant. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listSavedViews: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description The list (default `assets`). */
                resource?: "assets";
                /** @description `mine` = created by the caller, `shared` = shared by anybody, `all` (default) = both. */
                scope?: "all" | "mine" | "shared";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of views. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedViewList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session, not an API key. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    createSavedView: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedViewCreate"];
            };
        };
        responses: {
            /** @description View saved. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedView"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getSavedView: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The view. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedView"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session, not an API key. Codes: `forbidden`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    deleteSavedView: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: components["responses"]["NotFound"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateSavedView: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedViewUpdate"];
            };
        };
        responses: {
            /** @description The view. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedView"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Needs a browser session with a valid `X-CSRF-Token`. Codes: `forbidden`, `csrf-invalid`. */
            403: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/forbidden",
                     *       "title": "forbidden",
                     *       "status": 403,
                     *       "code": "forbidden",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    shareSavedView: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavedViewShare"];
            };
        };
        responses: {
            /** @description The view. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedView"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    resolveScan: {
        parameters: {
            query: {
                /** @description Scanned value. */
                code: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The matching asset, accessory or consumable. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanResolveResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The serial number belongs to several assets; use the label or the asset tag. Codes: `conflict`. */
            409: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "type": "https://api.assettracker.test/problems/conflict",
                     *       "title": "conflict",
                     *       "status": 409,
                     *       "code": "conflict",
                     *       "request_id": "01JABCDEF0123456789"
                     *     }
                     */
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    search: {
        parameters: {
            query: {
                /** @description Search text (1-200 characters). */
                q: string;
                /** @description Comma-separated entity types to search. Default: every type available in this release. */
                types?: ("asset" | "model" | "category" | "person" | "location")[];
                /** @description Maximum results **per type**. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Grouped results (empty array when nothing matches). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResultList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getAssetTagTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetTagTemplate"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    putAssetTagTemplate: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssetTagTemplate"];
            };
        };
        responses: {
            /** @description The new template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetTagTemplate"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getCustodySettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The settings. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustodySettings"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    putCustodySettings: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CustodySettingsUpdate"];
            };
        };
        responses: {
            /** @description The new settings. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustodySettings"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getFilesSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The settings. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FilesSettings"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    putFilesSettings: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FilesSettingsUpdate"];
            };
        };
        responses: {
            /** @description The new settings. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FilesSettings"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listStatusLabels: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Filter by state type. */
                state_type?: ("deployable" | "deployed" | "pending" | "undeployable" | "archived" | "lost")[];
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: position, name. A unique tiebreaker (`id`) is always appended. */
                sort?: ("position" | "-position" | "name" | "-name")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusLabelList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createStatusLabel: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StatusLabelCreate"];
            };
        };
        responses: {
            /** @description StatusLabel created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusLabel"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getStatusLabel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The status label. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusLabel"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveStatusLabel: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateStatusLabel: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StatusLabelUpdate"];
            };
        };
        responses: {
            /** @description Updated status label. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusLabel"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listUsers: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Filter by status. */
                status?: "invited" | "active" | "disabled";
                /** @description Users holding this role. */
                role_id?: string;
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: display_name, email, created_at, last_login_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("display_name" | "-display_name" | "email" | "-email" | "created_at" | "-created_at" | "last_login_at" | "-last_login_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of users. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createUser: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserCreate"];
            };
        };
        responses: {
            /** @description User created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The user. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveUser: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateUser: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserUpdate"];
            };
        };
        responses: {
            /** @description Updated user. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    revokeUserInvitation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Invitation revoked. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    resendUserInvitation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description New invitation sent. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    resetUserMfa: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description MFA reset. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    addUserRoleAssignment: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleAssignment"];
            };
        };
        responses: {
            /** @description The user with the new assignment. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    removeUserRoleAssignment: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
                /** @description Id of a role assignment of this user (`User.role_assignments[].id`). */
                assignment_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The user without the assignment. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listUserSessions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Active sessions. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionInfoList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    revokeUserSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
                /** @description Session id. */
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listVendors: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Also return `page.total` (an extra count query; avoid on large lists). */
                include_total?: components["parameters"]["IncludeTotal"];
                /** @description Free-text search (trigram / prefix match). */
                q?: components["parameters"]["Q"];
                /** @description Archived (soft-deleted) records: `exclude` (default), `include` or `only`. */
                archived?: components["parameters"]["Archived"];
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: name, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("name" | "-name" | "created_at" | "-created_at")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of results. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VendorList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createVendor: {
        parameters: {
            query?: never;
            header?: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VendorCreate"];
            };
        };
        responses: {
            /** @description Vendor created. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    Location: components["headers"]["Location"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Vendor"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getVendor: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The vendor. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Vendor"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    archiveVendor: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    updateVendor: {
        parameters: {
            query?: never;
            header: {
                /** @description Required for mutating requests authenticated with the session cookie; ignored for API keys. */
                "X-CSRF-Token"?: components["parameters"]["CsrfToken"];
                /** @description Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
                /** @description ETag of the version being modified. `428` if absent, `412` if stale. */
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                /** @description Resource id (UUIDv7). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VendorUpdate"];
            };
        };
        responses: {
            /** @description Updated vendor. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    ETag: components["headers"]["ETag"];
                    "Idempotent-Replayed": components["headers"]["IdempotentReplayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Vendor"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getVersion: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The build. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionResponse"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
}
