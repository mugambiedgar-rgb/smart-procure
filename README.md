# SmartProcure - Wholesale Procurement & Inventory Management System

A full-stack web application for a wholesale electronics distributor. It keeps purchasing, the warehouse and sales on one accurate, real-time record of stock.

**Stack:** React 19 + Vite - Node.js + Express 5 - MySQL 8.0 - Socket.IO (real-time) - JWT + bcrypt

---

## 1. Quick start (VS Code)

### Prerequisites
- [Node.js](https://nodejs.org) 20 or newer (includes npm)
- [MySQL Server 8.0](https://dev.mysql.com/downloads/mysql/) and (optional) MySQL Workbench

### Steps
```bash
# 1. open the folder in VS Code, then open the integrated terminal (Ctrl+`)

# 2. install everything (root + server + client)
npm run install:all

# 3. create your environment file
cp .env.example .env          # Windows PowerShell: copy .env.example .env
#    then edit .env: set DB_PASSWORD (your MySQL root password) and JWT_SECRET
#    generate a secret with:
#    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. create the database, tables and sample data
npm run db:setup

# 5. start API (port 5000) and website (port 5173) together
npm run dev
```
Open **http://localhost:5173** - the Home page loads first; click *Sign in*.

### Demo accounts (password for all: `Password@123`)
| Email | Role |
|---|---|
| admin@smartprocure.com | Administrator |
| procurement@smartprocure.com | Procurement Officer |
| warehouse@smartprocure.com | Warehouse Manager |
| sales@smartprocure.com | Sales Officer |
| management@smartprocure.com | Management |

> **Change these passwords** (or delete the accounts) before using the system for anything real.

### Using MySQL Workbench instead of `npm run db:setup`
Open `database/schema.sql` and run it (lightning icon), then open `database/seed.sql` and run it. Order matters: schema first, seed second.
Sample-data dates are relative to the moment `seed.sql` is imported, so the dashboard always looks current.

### Useful commands
| Command | What it does |
|---|---|
| `npm run dev` | API + website with auto-reload |
| `npm run db:reset` | Drops and rebuilds the database with fresh sample data |
| `npm run build` then `npm start` | Production mode: Express serves the built website on port 5000 |
| `npm test --prefix server` | End-to-end API tests (needs the API running; **writes data** - run `db:reset` afterwards) |
| `npm run seed:generate --prefix server` | Regenerates `database/seed.sql` |

Troubleshooting: *"Could not connect to MySQL"* - check MySQL is running and `DB_USER` / `DB_PASSWORD` in `.env`. *"ER_NOT_SUPPORTED_AUTH_MODE"* - use MySQL 8 with the default `caching_sha2_password` (supported) or create a dedicated user.

---

## 2. How stock stays accurate

| Quantity | Meaning |
|---|---|
| **Physical** | Units actually in the warehouse |
| **Reserved** | Promised to confirmed customer orders |
| **Available** | `Physical - Reserved` - computed by MySQL (generated column), never typed in |
| **Incoming** | Open purchase-order quantity not yet received. Shown separately, **never** counted as available |

**The rules the code enforces**
1. Stock is changed only by `server/services/inventory.js`. Every change runs inside a database transaction, locks the inventory row (`SELECT ... FOR UPDATE`), validates the result (no negative stock, never reserve more than available) and writes a before/after row to `inventory_transactions`.
2. **Goods received:** a supplier marking an order "delivered" changes nothing. Staff record a GRN (draft), then a warehouse manager *verifies* it. Only then are **accepted** units (delivered minus damaged) added to physical stock, the PO status updates, and an audit record is written. Verifying twice is rejected.
3. **Sales:** confirming an order reserves stock (blocked if not available - no overselling, even with simultaneous orders). Dispatch removes units from physical and reserved. A failed delivery returns them. Cancelling releases the reservation.
   Example: 20 laptops, sell 5 -> reserve (physical 20, reserved 5, available 15) -> dispatch (physical **15**, reserved 0, available 15).
4. **Reconciliation:** counts are compared with the system snapshot; approved variances post an `ADJUSTMENT` to the ledger.
5. **Duplicate PO prevention:** unique PO numbers from an atomic counter, a per-supplier lock, a check for open orders containing the same products (confirmation required), and an idempotency key so a double-click can't create two orders.
6. **Real time:** after each commit the server broadcasts over Socket.IO; every open screen refreshes its figures and users get notifications.

## 3. Modules
Home page - Login / forgot & reset password - Dashboard (10 KPIs, 6 charts, recent activity) - Inventory (CRUD, categories, serial numbers, history, movements) - Procurement (requisitions, multi-line POs, approvals, printable PDF) - Suppliers (performance comparison) - Goods Received (GRN) - Stock Reconciliation - Orders & Deliveries - Analytics & forecast - Reports (PDF / CSV / Excel, date filters) - Notifications - User management - Audit log - Profile.

**Roles & permissions** are stored in the `roles`, `permissions` and `role_permissions` tables and enforced on **every API request** (the UI only hides what you can't use).

**Forecasting** is deliberately transparent: average daily demand = units sold in the last N days / N; reorder point = demand during lead time + safety stock; suggested reorder = demand x (lead time + cover days) + safety - (available + incoming). N, safety days and cover days are settings; lead time is per product. Forecasts are clearly labelled as estimates and never change inventory.

## 4. Security
bcrypt password hashing - JWT auth (a password change or deactivation invalidates old tokens) - server-side role checks - parameterised SQL everywhere - input validation - rate limiting (login/reset and global) - Helmet headers - CORS restricted to `CLIENT_ORIGIN` - secrets only in `.env` - audit logging of sensitive actions - CSV exports neutralise spreadsheet-formula injection.

**Before production:** set a long random `JWT_SECRET`, `NODE_ENV=production`, serve over HTTPS, change/delete demo users, and wire up email in `server/routes/auth.js` (forgot-password currently shows the reset link on screen in development because no mail server is configured).

## 5. Project structure
```
wholesale-procurement-system/
├── client/                 React app (Vite)
│   └── src/ components/ context/ hooks/ layouts/ pages/ services/ styles/ utils/  App.jsx main.jsx
├── server/
│   ├── config/  middleware/  routes/  services/  utils/  scripts/  tests/  server.js
├── database/               schema.sql  seed.sql
├── .env.example  .gitignore  package.json  README.md
```
Database: `wholesale_procurement_db` - 29 tables (the 24 required plus role_permissions, product_serials, stock_reconciliation_items, doc_sequences, settings and others).

## 6. Known limitations
- No email delivery is configured (see Security).
- Single currency (USD) and single warehouse location.
- Notifications for time-based alerts (overdue deliveries, low stock) are generated by a scan every 15 minutes while the server runs, plus immediately after stock changes.
