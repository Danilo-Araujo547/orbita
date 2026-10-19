# Local users and explicit access

Users are accounts of this Orbita instance. Users > New user / Edit manages name, password, active state and grants. Team uses the same directory. Select local and remote units individually; removing a unit removes its grant. No local membership is automatically retained. Grantable units are limited to the administrator scope. Each section is hidden, read-only or write. Operator and viewer roles cannot grant administrative editing. Administrative is a unit role and does not create a Django superuser.

Unspecified sections on user creation or grant updates are denied. Existing grants are not rewritten by this deployment. Sidebar, initial route and API loading respect effective permissions. The API independently checks grants on every request; frontend session refreshes on focus and every 30 seconds. Withdrawal takes effect immediately on the backend. Self-account/global superuser changes remain protected. Updates preserve grants outside the acting administrator scope and reject stale versions with 409.

Units support audited versioned editing of name, timezone, response deadline, paused state and authorized test numbers. Empty authorized list disables test recipients; null retains existing environment fallback. No recipients were added or removed by this deployment.

Report recipients support editing owner, phone, report selection and active state; changing phone/owner clears verification. Schedules, Oracle sources, reminder rules, follow-up rules, report labels/keywords and response deadlines use edit modals. Preparations and import layouts create new versions to preserve historical content. Unsupported external reports remain blocked. Secrets remain protected by the existing Oracle/Meta credential flows.

Campaign UI is named Importa CROSS at /importa-cross. The old /campanhas URL and backend campaign APIs remain compatible.

Validation: backend suite (221 passing plus corrected route test and all 5 access tests passing), 33 frontend tests, TypeScript/Vite production build, migration checks and OpenAPI validation. Backups are under /opt/backups/orbita. No messages were dispatched as part of this change.

Browser verification: admin user directory and new-user modal checked; explicit frontend session with only appointments/write and groups/read rendered only those two sidebar tabs, no group mutation buttons and no requests for hidden sections. Backend denial/revocation verified separately in PostgreSQL tests. Dialog checked at 1024 and 1920 pixels with visible footer and no page horizontal overflow. Existing database counts unchanged after deployment.
