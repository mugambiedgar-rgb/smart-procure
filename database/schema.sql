-- =====================================================================
-- SmartProcure - Wholesale Procurement & Inventory Management System
-- Database schema for MySQL Server 8.0 (compatible with MySQL Workbench)
--
-- Run this file first, then seed.sql.
--   Workbench: File > Open SQL Script > schema.sql > Execute (lightning icon)
--   CLI      : npm run db:setup      (or npm run db:reset to start over)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS wholesale_procurement_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wholesale_procurement_db;

-- ---------------------------------------------------------------------
-- 1. Security: roles, permissions, users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(50)  NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(60)  NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name         VARCHAR(120) NOT NULL,
  email             VARCHAR(150) NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role_id           INT UNSIGNED NOT NULL,
  phone             VARCHAR(30)  NULL,
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  token_version     INT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at     DATETIME     NULL,
  reset_token_hash  CHAR(64)     NULL,
  reset_expires_at  DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role_id),
  KEY idx_users_reset (reset_token_hash),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. Catalogue: categories, products, serial numbers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_category_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sku             VARCHAR(40)   NOT NULL,
  name            VARCHAR(160)  NOT NULL,
  category_id     INT UNSIGNED  NOT NULL,
  brand           VARCHAR(80)   NULL,
  description     TEXT          NULL,
  unit_cost       DECIMAL(12,2) NOT NULL DEFAULT 0,
  selling_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_stock_level INT UNSIGNED  NOT NULL DEFAULT 5,
  lead_time_days  SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  track_serial    TINYINT(1)    NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category (category_id),
  KEY idx_products_name (name),
  KEY idx_products_active (is_active),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES product_categories (id),
  CONSTRAINT chk_products_cost  CHECK (unit_cost >= 0),
  CONSTRAINT chk_products_price CHECK (selling_price >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_serials (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    INT UNSIGNED NOT NULL,
  serial_number VARCHAR(80)  NOT NULL,
  status        ENUM('In Stock','Sold','Damaged','Returned') NOT NULL DEFAULT 'In Stock',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_serial (serial_number),
  KEY idx_serial_product (product_id, status),
  CONSTRAINT fk_serial_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. Suppliers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(20)  NOT NULL,
  name           VARCHAR(150) NOT NULL,
  contact_person VARCHAR(120) NULL,
  email          VARCHAR(150) NULL,
  phone          VARCHAR(30)  NULL,
  address        VARCHAR(255) NULL,
  city           VARCHAR(80)  NULL,
  country        VARCHAR(80)  NULL,
  payment_terms  VARCHAR(60)  NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_code (code),
  KEY idx_suppliers_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS supplier_products (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  supplier_id    INT UNSIGNED  NOT NULL,
  product_id     INT UNSIGNED  NOT NULL,
  supplier_sku   VARCHAR(60)   NULL,
  unit_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
  lead_time_days SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_product (supplier_id, product_id),
  KEY idx_sp_product (product_id),
  CONSTRAINT fk_sp_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_product  FOREIGN KEY (product_id)  REFERENCES products (id),
  CONSTRAINT chk_sp_price CHECK (unit_price >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. Procurement: requisitions and purchase orders
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  req_number    VARCHAR(30)  NOT NULL,
  requested_by  INT UNSIGNED NOT NULL,
  status        ENUM('Pending','Approved','Rejected','Converted') NOT NULL DEFAULT 'Pending',
  priority      ENUM('Low','Normal','High','Urgent') NOT NULL DEFAULT 'Normal',
  justification TEXT         NULL,
  reviewed_by   INT UNSIGNED NULL,
  reviewed_at   DATETIME     NULL,
  review_note   VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_req_number (req_number),
  KEY idx_req_status (status),
  CONSTRAINT fk_req_user     FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_req_reviewer FOREIGN KEY (reviewed_by)  REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  requisition_id  INT UNSIGNED  NOT NULL,
  product_id      INT UNSIGNED  NOT NULL,
  quantity        INT UNSIGNED  NOT NULL,
  estimated_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_req_item (requisition_id, product_id),
  CONSTRAINT fk_ri_req     FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions (id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_product FOREIGN KEY (product_id)     REFERENCES products (id),
  CONSTRAINT chk_ri_qty CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  po_number         VARCHAR(30)   NOT NULL,
  supplier_id       INT UNSIGNED  NOT NULL,
  requisition_id    INT UNSIGNED  NULL,
  status            ENUM('Draft','Pending Approval','Approved','Sent to Supplier','Partially Received','Fully Received','Cancelled')
                    NOT NULL DEFAULT 'Draft',
  order_date        DATE          NOT NULL,
  expected_date     DATE          NULL,
  total_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes             TEXT          NULL,
  rejection_reason  VARCHAR(255)  NULL,
  cancel_reason     VARCHAR(255)  NULL,
  idempotency_key   VARCHAR(64)   NULL,
  created_by        INT UNSIGNED  NOT NULL,
  approved_by       INT UNSIGNED  NULL,
  approved_at       DATETIME      NULL,
  sent_at           DATETIME      NULL,
  fully_received_at DATETIME      NULL,
  cancelled_at      DATETIME      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_number (po_number),
  UNIQUE KEY uq_po_idempotency (idempotency_key),
  KEY idx_po_status (status),
  KEY idx_po_supplier_status (supplier_id, status),
  KEY idx_po_expected (expected_date),
  KEY idx_po_order_date (order_date),
  CONSTRAINT fk_po_supplier    FOREIGN KEY (supplier_id)    REFERENCES suppliers (id),
  CONSTRAINT fk_po_requisition FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions (id),
  CONSTRAINT fk_po_creator     FOREIGN KEY (created_by)     REFERENCES users (id),
  CONSTRAINT fk_po_approver    FOREIGN KEY (approved_by)    REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  po_id             INT UNSIGNED  NOT NULL,
  product_id        INT UNSIGNED  NOT NULL,
  quantity_ordered  INT UNSIGNED  NOT NULL,
  quantity_received INT UNSIGNED  NOT NULL DEFAULT 0,
  unit_price        DECIMAL(12,2) NOT NULL,
  line_total        DECIMAL(14,2) GENERATED ALWAYS AS (quantity_ordered * unit_price) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_item (po_id, product_id),
  KEY idx_poi_product (product_id),
  CONSTRAINT fk_poi_po      FOREIGN KEY (po_id)      REFERENCES purchase_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_poi_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_poi_qty      CHECK (quantity_ordered > 0),
  CONSTRAINT chk_poi_received CHECK (quantity_received <= quantity_ordered)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. Goods received notes (stock only increases when a GRN is VERIFIED)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_received_notes (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  grn_number        VARCHAR(30)  NOT NULL,
  po_id             INT UNSIGNED NOT NULL,
  status            ENUM('Draft','Verified','Cancelled') NOT NULL DEFAULT 'Draft',
  received_date     DATE         NOT NULL,
  delivery_note_ref VARCHAR(80)  NULL,
  delivered_by_name VARCHAR(120) NULL,
  received_by       INT UNSIGNED NOT NULL,
  verified_by       INT UNSIGNED NULL,
  verified_at       DATETIME     NULL,
  notes             TEXT         NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grn_number (grn_number),
  KEY idx_grn_po (po_id),
  KEY idx_grn_status (status),
  KEY idx_grn_received_date (received_date),
  CONSTRAINT fk_grn_po       FOREIGN KEY (po_id)       REFERENCES purchase_orders (id),
  CONSTRAINT fk_grn_receiver FOREIGN KEY (received_by) REFERENCES users (id),
  CONSTRAINT fk_grn_verifier FOREIGN KEY (verified_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS goods_received_items (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  grn_id             INT UNSIGNED NOT NULL,
  po_item_id         INT UNSIGNED NOT NULL,
  product_id         INT UNSIGNED NOT NULL,
  quantity_delivered INT UNSIGNED NOT NULL DEFAULT 0,
  quantity_damaged   INT UNSIGNED NOT NULL DEFAULT 0,
  quantity_accepted  INT UNSIGNED NOT NULL DEFAULT 0,
  quantity_missing   INT UNSIGNED NOT NULL DEFAULT 0,
  remarks            VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grn_item (grn_id, po_item_id),
  KEY idx_gri_product (product_id),
  CONSTRAINT fk_gri_grn     FOREIGN KEY (grn_id)     REFERENCES goods_received_notes (id) ON DELETE CASCADE,
  CONSTRAINT fk_gri_poitem  FOREIGN KEY (po_item_id) REFERENCES purchase_order_items (id),
  CONSTRAINT fk_gri_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_gri_damaged CHECK (quantity_damaged <= quantity_delivered)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. Inventory (one row per product) and the movement ledger
--    available_qty = physical_qty - reserved_qty   (always derived by MySQL)
--    incoming stock is NOT stored here: it is derived from open purchase
--    orders so it can never be mistaken for available stock.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
  product_id   INT UNSIGNED NOT NULL,
  physical_qty INT          NOT NULL DEFAULT 0,
  reserved_qty INT          NOT NULL DEFAULT 0,
  available_qty INT GENERATED ALWAYS AS (physical_qty - reserved_qty) STORED,
  version      INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id),
  KEY idx_inventory_available (available_qty),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_inventory_physical CHECK (physical_qty >= 0),
  CONSTRAINT chk_inventory_reserved CHECK (reserved_qty >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id      INT UNSIGNED NOT NULL,
  txn_type        ENUM('INITIAL','GRN_RECEIPT','RESERVE','RELEASE','SALE_DISPATCH','DELIVERY_RETURN','ADJUSTMENT') NOT NULL,
  physical_change INT NOT NULL DEFAULT 0,
  reserved_change INT NOT NULL DEFAULT 0,
  physical_before INT NOT NULL,
  physical_after  INT NOT NULL,
  reserved_before INT NOT NULL,
  reserved_after  INT NOT NULL,
  reference_type  VARCHAR(30)  NULL,
  reference_id    INT UNSIGNED NULL,
  reference_no    VARCHAR(40)  NULL,
  notes           VARCHAR(255) NULL,
  performed_by    INT UNSIGNED NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_itx_product_date (product_id, created_at),
  KEY idx_itx_created (created_at),
  KEY idx_itx_reference (reference_type, reference_id),
  CONSTRAINT fk_itx_product FOREIGN KEY (product_id)   REFERENCES products (id),
  CONSTRAINT fk_itx_user    FOREIGN KEY (performed_by) REFERENCES users (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. Customers, sales orders, reservations, deliveries
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_code  VARCHAR(20)  NOT NULL,
  name           VARCHAR(150) NOT NULL,
  contact_person VARCHAR(120) NULL,
  email          VARCHAR(150) NULL,
  phone          VARCHAR(30)  NULL,
  address        VARCHAR(255) NULL,
  city           VARCHAR(80)  NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_code (customer_code),
  KEY idx_customer_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_orders (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  order_no        VARCHAR(30)   NOT NULL,
  customer_id     INT UNSIGNED  NOT NULL,
  status          ENUM('Confirmed','Completed','Cancelled') NOT NULL DEFAULT 'Confirmed',
  order_date      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  required_date   DATE          NULL,
  total_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes           VARCHAR(255)  NULL,
  cancel_reason   VARCHAR(255)  NULL,
  idempotency_key VARCHAR(64)   NULL,
  created_by      INT UNSIGNED  NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_no (order_no),
  UNIQUE KEY uq_order_idempotency (idempotency_key),
  KEY idx_order_customer (customer_id),
  KEY idx_order_status (status),
  KEY idx_order_date (order_date),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_order_creator  FOREIGN KEY (created_by)  REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_order_items (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  order_id   INT UNSIGNED  NOT NULL,
  product_id INT UNSIGNED  NOT NULL,
  quantity   INT UNSIGNED  NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_item (order_id, product_id),
  KEY idx_oi_product (product_id),
  CONSTRAINT fk_oi_order   FOREIGN KEY (order_id)   REFERENCES customer_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_oi_qty CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_reservations (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      INT UNSIGNED NOT NULL,
  order_item_id INT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED NOT NULL,
  status        ENUM('Active','Fulfilled','Released') NOT NULL DEFAULT 'Active',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_res_product_status (product_id, status),
  KEY idx_res_order (order_id),
  CONSTRAINT fk_res_order   FOREIGN KEY (order_id)      REFERENCES customer_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_res_item    FOREIGN KEY (order_item_id) REFERENCES customer_order_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_res_product FOREIGN KEY (product_id)    REFERENCES products (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deliveries (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  delivery_no    VARCHAR(30)  NOT NULL,
  order_id       INT UNSIGNED NOT NULL,
  status         ENUM('Pending','Processing','Ready for Dispatch','Dispatched','Delivered','Failed Delivery') NOT NULL DEFAULT 'Pending',
  driver_name    VARCHAR(120) NULL,
  vehicle_no     VARCHAR(40)  NULL,
  scheduled_date DATE         NULL,
  dispatched_at  DATETIME     NULL,
  delivered_at   DATETIME     NULL,
  failure_reason VARCHAR(255) NULL,
  updated_by     INT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_no (delivery_no),
  UNIQUE KEY uq_delivery_order (order_id),
  KEY idx_delivery_status (status),
  CONSTRAINT fk_delivery_order FOREIGN KEY (order_id)   REFERENCES customer_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_user  FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. Stock reconciliation and adjustments
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_reconciliations (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_no   VARCHAR(30)  NOT NULL,
  title        VARCHAR(150) NOT NULL,
  category_id  INT UNSIGNED NULL,
  status       ENUM('Open','Submitted','Completed','Cancelled') NOT NULL DEFAULT 'Open',
  notes        VARCHAR(255) NULL,
  created_by   INT UNSIGNED NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_no (session_no),
  KEY idx_recon_status (status),
  CONSTRAINT fk_recon_category FOREIGN KEY (category_id) REFERENCES product_categories (id),
  CONSTRAINT fk_recon_user     FOREIGN KEY (created_by)  REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_reconciliation_items (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reconciliation_id INT UNSIGNED NOT NULL,
  product_id        INT UNSIGNED NOT NULL,
  system_qty        INT          NOT NULL,
  counted_qty       INT          NULL,
  difference        INT GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
  reason            VARCHAR(255) NULL,
  status            ENUM('Pending Count','Matched','Variance','Approved','Rejected') NOT NULL DEFAULT 'Pending Count',
  resolved_by       INT UNSIGNED NULL,
  resolved_at       DATETIME     NULL,
  resolution_note   VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recon_item (reconciliation_id, product_id),
  KEY idx_rci_product (product_id),
  CONSTRAINT fk_rci_recon    FOREIGN KEY (reconciliation_id) REFERENCES stock_reconciliations (id) ON DELETE CASCADE,
  CONSTRAINT fk_rci_product  FOREIGN KEY (product_id)  REFERENCES products (id),
  CONSTRAINT fk_rci_resolver FOREIGN KEY (resolved_by) REFERENCES users (id),
  CONSTRAINT chk_rci_counted CHECK (counted_qty IS NULL OR counted_qty >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id             INT UNSIGNED NOT NULL,
  reconciliation_id      INT UNSIGNED NULL,
  reconciliation_item_id INT UNSIGNED NULL,
  system_qty             INT NOT NULL,
  physical_qty           INT NOT NULL,
  quantity_change        INT NOT NULL,
  reason                 VARCHAR(255) NULL,
  approved_by            INT UNSIGNED NOT NULL,
  approved_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adj_product (product_id),
  KEY idx_adj_recon (reconciliation_id),
  CONSTRAINT fk_adj_product  FOREIGN KEY (product_id)        REFERENCES products (id),
  CONSTRAINT fk_adj_recon    FOREIGN KEY (reconciliation_id) REFERENCES stock_reconciliations (id),
  CONSTRAINT fk_adj_approver FOREIGN KEY (approved_by)       REFERENCES users (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. Notifications, audit trail, helpers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  type        VARCHAR(40)  NOT NULL,
  severity    ENUM('info','success','warning','error') NOT NULL DEFAULT 'info',
  title       VARCHAR(160) NOT NULL,
  message     VARCHAR(500) NULL,
  link        VARCHAR(200) NULL,
  dedupe_key  VARCHAR(100) NULL,
  is_read     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at     DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id, is_read, created_at),
  KEY idx_notif_dedupe (user_id, dedupe_key, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NULL,
  action      VARCHAR(60)  NOT NULL,
  entity_type VARCHAR(40)  NULL,
  entity_id   VARCHAR(40)  NULL,
  details     JSON         NULL,
  ip_address  VARCHAR(64)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_user (user_id),
  KEY idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Atomic document-number counters (PO-2026-00001, GRN-..., SO-..., etc.)
CREATE TABLE IF NOT EXISTS doc_sequences (
  seq_key    VARCHAR(30)  NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (seq_key)
) ENGINE=InnoDB;

-- Configurable forecasting / alert parameters
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(60)  NOT NULL,
  setting_value VARCHAR(100) NOT NULL,
  description   VARCHAR(255) NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;
