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
         * @description Requires permission `accessory:read`.
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
         * @description Fails with 409 `insufficient-stock` if the quantity exceeds what is available (`qty_total` minus the units still outstanding on open assignments).
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
         * @description Atomically closes the current assignment (if any) and opens a new one, and records a `Transfer`.
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
         * @description Applies the same `changes` (status, category, model, vendor, `custom_data` merge) to every listed asset.
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
         * @description Requires permission `consumable:manage`.
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
         * @description Requires permission `consumable:read`.
         */
        get: operations["listStockMovements"];
        put?: never;
        /**
         * Receive, issue or adjust stock
         * @description Appends to the ledger and updates `qty_on_hand` atomically. The ledger is append-only: fix mistakes with a `correction` movement.
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
    "/v1/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List import jobs
         * @description Requires permission `import:read`.
         */
        get: operations["listImports"];
        put?: never;
        /**
         * Create an import job
         * @description Creates a `draft` job. Upload the file first (`POST /v1/attachments` with kind `import_file`), then reference it here. Nothing is written to the registry until a dry run has completed and the job is committed.
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
         * Get an import job
         * @description Requires permission `import:read`.
         */
        get: operations["getImport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edit mapping and options
         * @description Requires permission `import:run`.
         */
        patch: operations["updateImport"];
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
         * Cancel an import job
         * @description Allowed before commit starts; a running commit finishes its current batch and stops (rows already written stay).
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
         * @description Only valid in state `dry_run_complete`, and only with the `dry_run_digest` the caller reviewed (409 `import-stale-dry-run` otherwise). Writes through the normal registry services, so validation, history and audit are not bypassed. Rollback of a committed import is v1.1.
         *
         *     Requires permission `import:run`.
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
         * @description Queues a dry run that validates every row, matches existing records and reports per-row outcomes (`create` / `update` / `skip` / `error`) without touching the registry. Poll `GET /v1/imports/{id}` until `state=dry_run_complete`.
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
    "/v1/imports/{id}/rows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Per-row results
         * @description Requires permission `import:read`.
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
    "/v1/labels/render": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Render a PDF label sheet
         * @description Renders QR / Code128 labels for up to 500 assets into a PDF (synchronously). Each QR encodes `https://<host>/s/<label_code>`. Writes a `label_printed` history event per asset.
         *
         *     Requires permission `asset:label`.
         */
        post: operations["renderLabels"];
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
         * @description Standard sheet templates (US Letter 30-up, A4 21-up, 10-up, single 50x25 mm). Read-only in the MVP; a template editor arrives in v1.1.
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
    "/v1/loaner-pools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List loaner pools
         * @description Cursor-paginated list.
         *
         *     Requires permission `loaner:read`.
         */
        get: operations["listLoanerPools"];
        put?: never;
        /**
         * Create loaner pool
         * @description Requires permission `loaner:manage`.
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
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `loaner:manage`.
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
         * @description Checks out a specific pool member, or the next available one, to a person with a due date. Return it with `POST /v1/assets/{id}/checkin`. 409 `no-loaner-available` when the pool is empty. Like a normal check-out it returns the updated asset (the client may not have known which pool member was chosen) and the assignment.
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
         * @description Requires permission `loaner:read`.
         */
        get: operations["listLoanerPoolMembers"];
        put?: never;
        /**
         * Add an asset to the pool
         * @description An asset belongs to at most one pool (409 if it is in another).
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
         * @description Rejected with 409 while the asset is on loan.
         *
         *     Requires permission `loaner:manage`.
         */
        delete: operations["removeLoanerPoolMember"];
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
         * @description Open asset check-outs past `expected_return`, loaner or not (the data behind overdue alerts).
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
         * @description Requires permission `location:manage`.
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
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `location:manage`.
         */
        delete: operations["archiveLocation"];
        options?: never;
        head?: never;
        /**
         * Update location
         * @description Requires permission `location:manage`.
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
         * @description Requires permission `person:manage`.
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
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `person:manage`.
         */
        delete: operations["archivePerson"];
        options?: never;
        head?: never;
        /**
         * Update person
         * @description Requires permission `person:manage`.
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
         * @description Requires permission `repair:manage`.
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
         * @description Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.
         *
         *     Requires permission `repair:manage`.
         */
        delete: operations["archiveRepair"];
        options?: never;
        head?: never;
        /**
         * Update repair record
         * @description Requires permission `repair:manage`.
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
         * @description Sets `completed_at` and status `completed`, records cost and resolution, and restores the asset status (`restore_status_id`).
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
    "/v1/scan/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resolve a scanned code
         * @description Accepts the opaque QR `label_code`, the whole label URL (`<PUBLIC_URL>/s/<label_code>` or `/s/<label_code>`: its last path segment is used) or a Code128 `asset_tag`, and returns the asset with the actions allowed right now. `entity_type` says what the code identifies (only `asset` today). `404` when nothing matches in the caller's tenant and scope: unknown, foreign and out-of-scope codes are indistinguishable. Enumeration resistance: a signed-in caller whose lookups keep missing (60 per throttle window by default) is answered `429` with `Retry-After` for every code until the window ends (hits never count towards the limit). The web route `/s/<label_code>` sends signed-out users to sign-in first and reveals nothing about the code; this endpoint answers `401` without a credential whatever the code. Responses are `Cache-Control: private, no-store`.
         *
         *     Requires permission `asset:read`.
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
         *     **Availability:** M1 returns `asset`, `model` and `category` results only. `person` and `location` are accepted values for `types` (so clients can send them today) but yield no results until M2 search lands. Matching is a case-insensitive prefix / trigram match on tag, serial, name and code. Archived records are excluded.
         *
         *     Requires permission `search:read`.
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
         *     Requires permission `user:manage`.
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
            copy_fields?: ("name" | "model_id" | "status_id" | "vendor_id" | "location_id" | "parent_asset_id" | "purchase_date" | "purchase_cost" | "order_number" | "warranty_end" | "notes" | "custom_data")[];
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
            /** @description ISO 3166-1 alpha-2. */
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
            readonly depth?: number;
            /** @description Root..self. */
            readonly ancestor_ids?: string[];
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
            department?: string | null;
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
            department?: string | null;
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
            department?: string | null;
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
        PersonList: {
            data: components["schemas"]["Person"][];
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
            readonly qty_checked_out?: number;
            readonly qty_available?: number;
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
            /** @description Changed only through stock movements. */
            readonly qty_on_hand?: number;
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
        LoanerPool: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: date-time */
            readonly archived_at?: string | null;
            name: string;
            description?: string | null;
            /** Format: uuid */
            home_location_id?: string | null;
            /** @default 7 */
            default_loan_days?: number;
            /** @description Must be >= default_loan_days. */
            max_loan_days?: number | null;
            /** @default true */
            is_active?: boolean;
            readonly member_count?: number;
            readonly checked_out_count?: number;
            readonly overdue_count?: number;
        };
        LoanerPoolCreate: {
            name: string;
            description?: string | null;
            /** Format: uuid */
            home_location_id?: string | null;
            /** @default 7 */
            default_loan_days?: number;
            /** @description Must be >= default_loan_days. */
            max_loan_days?: number | null;
            /** @default true */
            is_active?: boolean;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        LoanerPoolUpdate: {
            name?: string;
            description?: string | null;
            /** Format: uuid */
            home_location_id?: string | null;
            /** @default 7 */
            default_loan_days?: number;
            /** @description Must be >= default_loan_days. */
            max_loan_days?: number | null;
            /** @default true */
            is_active?: boolean;
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
             * @description Completion happens through `POST /v1/repairs/{id}/complete`.
             * @default open
             * @enum {string}
             */
            status?: "open" | "in_progress" | "cancelled";
            /**
             * Format: uuid
             * @description Status label to put the asset in while the repair is open (typically an undeployable label such as "In repair").
             */
            set_status_id?: string;
        };
        /** @description Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field. */
        RepairUpdate: {
            /** Format: uuid */
            asset_id?: string;
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
             * @description Completion happens through `POST /v1/repairs/{id}/complete`.
             * @default open
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
            /** Format: uuid */
            loaner_pool_id?: string | null;
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
            readonly status?: {
                /** Format: uuid */
                id: string;
                name: string;
                state_type: string;
            };
            /** @description Related objects requested through `expand` (model, category, location, vendor). */
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
            /** @enum {string} */
            match_type: "label_code" | "asset_tag";
            asset: components["schemas"]["Asset"];
            /** @description Actions valid for the asset in its current state and for the caller. */
            allowed_actions: ("checkout" | "checkin" | "transfer" | "update" | "open_repair")[];
            /**
             * @description Kind of record the code identifies. Only `asset` today; accessories get their own value (and result member) when they ship, so branch on this field.
             * @enum {string}
             */
            entity_type: "asset";
        };
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
            /** @description Previously uploaded photos/signatures to link to the assignment. */
            attachment_ids?: string[];
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
            note?: string;
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
            event_type: "created" | "updated" | "status_changed" | "location_changed" | "checked_out" | "checked_in" | "transferred" | "repair_opened" | "repair_completed" | "archived" | "restored" | "label_printed" | "imported";
            /** @enum {string} */
            actor_type: "user" | "api_key" | "integration" | "system";
            /** Format: uuid */
            actor_id?: string | null;
            /** @description Who did it, resolved for display; null for system events or when the user no longer exists. */
            actor?: {
                /** Format: uuid */
                id: string;
                display_name: string;
            } | null;
            /** Format: uuid */
            assignment_id?: string | null;
            /** Format: uuid */
            transfer_id?: string | null;
            summary?: string | null;
            /** @description Event details, e.g. `{"from":"...","to":"..."}`. */
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
            balance_after: number;
            /** Format: uuid */
            by_user_id?: string | null;
            /** Format: date-time */
            at: string;
        };
        StockMovementCreate: {
            /** @description Non-zero. Rejected with 409 if it would make stock negative. */
            qty_delta: number;
            /** @enum {string} */
            reason: "receive" | "issue" | "return" | "adjust" | "correction";
            /**
             * Format: uuid
             * @description Who it was issued to / returned by.
             */
            person_id?: string | null;
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
            /** @description Not currently checked out. */
            available: boolean;
            asset?: components["schemas"]["Asset"];
        };
        LoanerPoolMemberList: {
            data: components["schemas"]["LoanerPoolMember"][];
            page: components["schemas"]["PageInfo"];
        };
        LoanerCheckoutRequest: {
            /** Format: uuid */
            person_id: string;
            /**
             * Format: uuid
             * @description A specific pool member. If omitted, the next available member is chosen.
             */
            asset_id?: string;
            /**
             * Format: date
             * @description Defaults to today + pool.default_loan_days; must not exceed pool.max_loan_days.
             */
            expected_return?: string;
            note?: string;
        };
        OverdueCheckout: {
            /** Format: uuid */
            assignment_id: string;
            /** Format: uuid */
            asset_id: string;
            /** Format: uuid */
            person_id?: string | null;
            /** Format: uuid */
            location_id?: string | null;
            /** Format: uuid */
            target_asset_id?: string | null;
            /** Format: uuid */
            loaner_pool_id?: string | null;
            /** Format: date */
            expected_return: string;
            days_overdue: number;
        };
        OverdueCheckoutList: {
            data: components["schemas"]["OverdueCheckout"][];
            page: components["schemas"]["PageInfo"];
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
        };
        LabelTemplate: {
            /** Format: uuid */
            id: string;
            key: string;
            name: string;
            /** @enum {string} */
            page_size: "letter" | "a4" | "custom";
            page_width_mm?: number;
            page_height_mm?: number;
            label_width_mm?: number;
            label_height_mm?: number;
            cols: number;
            rows: number;
            /** @enum {string} */
            code_type: "qr" | "code128" | "qr_and_code128";
            fields?: string[];
            /** @description System templates are read-only in the MVP; the editor arrives in v1.1. */
            is_system?: boolean;
        };
        LabelTemplateList: {
            data: components["schemas"]["LabelTemplate"][];
        };
        LabelRenderRequest: {
            /** @description Key from `GET /v1/labels/templates`. */
            template_key: string;
            asset_ids: string[];
            /**
             * @description First label slot to use on the first sheet (re-use a partly used sheet).
             * @default 1
             */
            start_position?: number;
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
             * @description Short-lived signed URL; only on `GET /v1/attachments/{id}` and only when `scan_status=clean`. Images are served inline, everything else as an attachment download.
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
        ImportJob: {
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            source: "csv" | "xlsx" | "snipe_it" | "google_admin_csv";
            /** @enum {string} */
            entity_type: "asset" | "accessory" | "consumable" | "location" | "person" | "manufacturer" | "asset_model" | "category";
            /** @enum {string} */
            readonly state: "draft" | "dry_run_queued" | "dry_run_running" | "dry_run_complete" | "commit_queued" | "committing" | "committed" | "failed" | "cancelled";
            /**
             * Format: uuid
             * @description Uploaded file (kind `import_file`).
             */
            file_attachment_id?: string | null;
            original_filename?: string | null;
            /** @description Source column -> target field key (use `custom_data.<key>` for custom fields). */
            mapping: {
                [key: string]: string;
            };
            options: {
                /**
                 * @default asset_tag
                 * @enum {string}
                 */
                match_on?: "asset_tag" | "serial" | "external_id";
                /**
                 * @default skip
                 * @enum {string}
                 */
                on_duplicate?: "skip" | "update" | "error";
                /**
                 * @description Create missing categories, manufacturers, models, locations referenced by name.
                 * @default true
                 */
                create_missing_references?: boolean;
                /** @default , */
                delimiter?: string;
                /** @default YYYY-MM-DD */
                date_format?: string;
            } & {
                [key: string]: unknown;
            };
            readonly rows_total?: number;
            readonly rows_create?: number;
            readonly rows_update?: number;
            readonly rows_skip?: number;
            readonly rows_error?: number;
            /** @description Hash of file + mapping + options at dry-run time; quote it in the commit request. */
            readonly dry_run_digest?: string | null;
            /** Format: date-time */
            readonly dry_run_completed_at?: string | null;
            /** Format: date-time */
            readonly committed_at?: string | null;
            readonly error?: string | null;
            /** Format: date-time */
            readonly created_at?: string;
            /** Format: date-time */
            readonly updated_at?: string;
            /** Format: uuid */
            readonly created_by?: string | null;
        };
        ImportJobCreate: {
            /** @enum {string} */
            source: "csv" | "xlsx" | "snipe_it" | "google_admin_csv";
            /** @enum {string} */
            entity_type: "asset" | "accessory" | "consumable" | "location" | "person" | "manufacturer" | "asset_model" | "category";
            /**
             * Format: uuid
             * @description Required for file sources; omit for `snipe_it` (credentials are passed in `options.snipe_it`).
             */
            file_attachment_id?: string;
            mapping?: {
                [key: string]: string;
            };
            options?: {
                [key: string]: unknown;
            };
        };
        /** @description Editing mapping/options is allowed in `draft` and `dry_run_complete` (the latter returns the job to `draft` and invalidates the digest). */
        ImportJobUpdate: {
            mapping?: {
                [key: string]: string;
            };
            options?: {
                [key: string]: unknown;
            };
        };
        ImportJobList: {
            data: components["schemas"]["ImportJob"][];
            page: components["schemas"]["PageInfo"];
        };
        ImportCommitRequest: {
            /** @description Digest of the reviewed dry run; if the file, mapping or options changed since, commit fails with 409. */
            dry_run_digest: string;
        };
        ImportRow: {
            row_no: number;
            /** @enum {string} */
            phase: "dry_run" | "commit";
            /** @enum {string} */
            outcome: "create" | "update" | "skip" | "error";
            /** Format: uuid */
            entity_id?: string | null;
            errors: components["schemas"]["FieldError"][];
            warnings: components["schemas"]["FieldError"][];
            source_data?: {
                [key: string]: unknown;
            } | null;
        };
        ImportRowList: {
            data: components["schemas"]["ImportRow"][];
            page: components["schemas"]["PageInfo"];
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
             * @description Required when scope_type=location; the grant covers the location subtree.
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
            /** Format: uuid */
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
                /** @description Only accessories at or below `min_qty` available. */
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
            409: components["responses"]["Conflict"];
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
            409: components["responses"]["Conflict"];
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
            409: components["responses"]["Conflict"];
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
            409: components["responses"]["Conflict"];
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
                /** @description Members of this loaner pool. */
                loaner_pool_id?: string;
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
                expand?: ("model" | "category" | "location" | "vendor")[];
                /** @description Sparse fieldset: return only these top-level properties (`id` is always included). */
                fields?: string[];
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: created_at, updated_at, asset_tag, name, purchase_date, warranty_end. A unique tiebreaker (`id`) is always appended. */
                sort?: ("created_at" | "-created_at" | "updated_at" | "-updated_at" | "asset_tag" | "-asset_tag" | "name" | "-name" | "purchase_date" | "-purchase_date" | "warranty_end" | "-warranty_end")[];
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
                expand?: ("model" | "category" | "location" | "vendor")[];
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
            409: components["responses"]["Conflict"];
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
            409: components["responses"]["Conflict"];
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
    listAssetHistory: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by event type. */
                event_type?: ("created" | "updated" | "status_changed" | "location_changed" | "checked_out" | "checked_in" | "transferred" | "repair_opened" | "repair_completed" | "archived" | "restored" | "label_printed" | "imported")[];
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
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
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
                entity_type: "asset" | "accessory" | "consumable" | "location" | "person" | "maintenance_record" | "assignment" | "import_job";
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
                /** @description Only consumables at or below `min_qty`. */
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
            409: components["responses"]["Conflict"];
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
            409: components["responses"]["Conflict"];
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
    listImports: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Filter by state. */
                state?: ("draft" | "dry_run_queued" | "dry_run_running" | "dry_run_complete" | "commit_queued" | "committing" | "committed" | "failed" | "cancelled")[];
                /** @description Filter by entity type. */
                entity_type?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of import jobs, newest first. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJobList"];
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
                "application/json": components["schemas"]["ImportJobCreate"];
            };
        };
        responses: {
            /** @description Job created. */
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
            /** @description The job. */
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
                "application/json": components["schemas"]["ImportJobUpdate"];
            };
        };
        responses: {
            /** @description Updated job. */
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
            409: components["responses"]["Conflict"];
            412: components["responses"]["PreconditionFailed"];
            422: components["responses"]["Unprocessable"];
            428: components["responses"]["PreconditionRequired"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    cancelImport: {
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
            /** @description Cancelled job. */
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
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
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
                "application/json": components["schemas"]["ImportCommitRequest"];
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
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    startImportDryRun: {
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
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listImportRows: {
        parameters: {
            query?: {
                /** @description Opaque cursor from `page.next_cursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Defaults to the latest phase. */
                phase?: "dry_run" | "commit";
                /** @description Filter by outcome. */
                outcome?: ("create" | "update" | "skip" | "error")[];
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
    renderLabels: {
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
                "application/json": components["schemas"]["LabelRenderRequest"];
            };
        };
        responses: {
            /** @description The PDF. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    /** @description attachment filename. */
                    "Content-Disposition"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": string;
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
            409: components["responses"]["Conflict"];
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
                /** @description true = not currently checked out. */
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
            409: components["responses"]["Conflict"];
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
                /** @description Exact department. */
                department?: string;
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
                /** @description Comma-separated sort keys, `-` prefix = descending. Allowed: reported_at, completed_at, created_at. A unique tiebreaker (`id`) is always appended. */
                sort?: ("reported_at" | "-reported_at" | "completed_at" | "-completed_at" | "created_at" | "-created_at")[];
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
            409: components["responses"]["Conflict"];
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
            /** @description The matching asset. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["RequestId"];
                    "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanResolveResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
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
