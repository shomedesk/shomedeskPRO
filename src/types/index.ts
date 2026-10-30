export interface Business {
  id: string;
  name: string;
  ownerId: string;
  currency: string;
  mobileNumber: string;
  createdAt: any;
}

export interface Branch {
  id: string;
  businessId: string;
  ownerId: string;
  name: string;
  branchCode: string; // Unique human-readable ID
  location: string;
  managerName: string;
  managerId: string; // Username for manager login
  managerPin: string; // For manager login
  mobileNumber: string;
  currency?: string; // Branch-specific currency (defaults to OMR)
  createdAt: any;
}

export type ServiceType = 'subscription' | 'commission' | 'ad_revenue' | 'software_sale' | 'other';

export interface Service {
  id: string;
  businessId: string;
  ownerId: string;
  name: string;
  type: ServiceType;
  description?: string;
  createdAt: any;
}

export interface BankAccount {
  id: string;
  businessId: string;
  ownerId: string;
  branchId?: string;
  serviceId?: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  balance: number;
  currency?: string;
  createdAt: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'admin' | 'manager' | 'branch_manager' | 'accountant';
  businessId: string;
  branchId?: string;
  ownedBusinessIds?: string[];
  isPlaceholder?: boolean;
}

export type TransactionType = 'income' | 'expense' | 'transfer' | 'withdraw' | 'deposit';
export type AccountType = 'cash' | 'bank';

export interface Transaction {
  id?: string;
  businessId: string;
  ownerId: string;
  branchId: string;
  serviceId?: string; // For digital services
  userId: string;
  type: TransactionType;
  fromAccount?: AccountType;
  toAccount?: AccountType;
  fromBankId?: string;
  toBankId?: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  createdAt: any;
  isFromReport?: boolean;
  reportId?: string; // Link to DailyReport document ID
}

export interface Supplier {
  id?: string;
  businessId: string;
  ownerId: string;
  branchId?: string; // Optional for global suppliers, but branch managers create branch-specific ones
  name: string;
  contactPerson?: string;
  category?: string;
  phone: string;
  email?: string;
  address?: string;
  country?: string;
  totalDue: number;
}

export interface SupplierProduct {
  id?: string;
  supplierId: string;
  supplierName?: string;
  businessId: string;
  productId?: string;
  productCode?: string;
  productName: string;
  barcode?: string;
  category: string;
  subCategory?: string;
  unit?: string;
  lastCost: number;
  salesPrice?: number;
  lastPurchaseDate?: string;
  totalPurchasedQty?: number;
  timesPurchased?: number;
  createdAt?: any;
  updatedAt?: any;
  // Pack / Carton settings
  orderMode?: 'pcs' | 'pack';
  piecesPerPack?: number;
  lastPackPrice?: number;
}

export interface ProductPackConfig {
  id?: string;
  businessId: string;
  productId?: string;
  productCode?: string;
  barcode?: string;
  productName: string;
  piecesPerPack: number;
  orderMode: 'pcs' | 'pack';
  packPrice?: number;
  unitPrice?: number;
  updatedAt?: any;
}

export interface ExpenseItem {
  id: string;
  category: string;
  amount: number;
  paymentType: 'cash' | 'bank';
  bankId?: string;
  bankName?: string;
  note?: string;
  isPurchaseBill?: boolean;
  purchaseInvoice?: string;
}

export interface TransferRow {
  id: string;
  amount: number;
  bankId: string;
}

export interface BankToBankRow {
  id: string;
  amount: number;
  fromBankId: string;
  toBankId: string;
}

export interface DailyReport {
  id?: string;
  businessId: string;
  ownerId: string;
  branchId: string;
  serviceId?: string;
  managerId: string;
  date: string;
  openingCash: number;
  openingBank: number;
  cashSale: number;
  bankSale: number;
  cardSale?: number;
  onlineSale?: number;
  totalSale?: number;
  cogs?: number; // Cost of Goods Sold (Cost of products sold)
  grossProfit?: number;
  cashExpense: number;
  bankExpense: number;
  cardExpense?: number;
  totalExpense?: number;
  netProfit?: number;
  bankToCash: number;
  cashToBank: number;
  bankToBank?: number;
  closingCash: number;
  closingBank: number;
  bankToCashRows?: TransferRow[];
  cashToBankRows?: TransferRow[];
  bankToBankRows?: BankToBankRow[];
  selectedBankId?: string;
  cardBankId?: string;
  expenseItems?: ExpenseItem[];
  note?: string;
  createdAt: any;
}

export interface SaleItem {
  id: string;
  productId?: string;
  productCode?: string;
  name: string;
  barcode?: string;
  category?: string;
  unit?: string;
  quantity: number;
  unitPrice: number; // Selling price
  unitCost: number; // Cost of goods
  totalPrice: number;
  totalCost: number;
}

export interface SaleInvoice {
  id?: string;
  businessId: string;
  ownerId: string;
  branchId: string;
  invoiceNumber: string;
  receiptNumber?: string;
  customerName?: string;
  customerPhone?: string;
  items: SaleItem[];
  subtotal: number;
  discount?: number;
  tax?: number;
  totalAmount: number;
  totalCost: number; // COGS
  grossProfit: number;
  grossProfitMargin?: number;
  paymentMode: 'Cash' | 'Card' | 'Online' | 'Split' | string;
  cashAmount?: number;
  cardAmount?: number;
  onlineAmount?: number;
  bankId?: string;
  bankName?: string;
  source?: 'salesplay_pos' | 'manual_pos' | 'online_order' | string;
  salesPlayOrderId?: string;
  transaction_id?: string;
  bill_id?: string;
  date: string;
  createdAt: any;
  notes?: string;
}

export interface PurchaseOrderItem {
  id: string; // Product ID or unique row ID
  productId?: string;
  productCode?: string;
  name: string;
  barcode?: string;
  category?: string;
  unit?: 'kg' | 'pcs' | string;
  quantity: number;
  unitPrice: number; // Purchase Cost snapshot
  salesPrice?: number; // Sales Price separate snapshot
  totalPrice: number;
  currentStock?: number;
  measurement?: string;
  imageUrl?: string;
  // Pack / Carton Purchase Support
  orderMode?: 'pcs' | 'pack'; // 'pcs' or 'pack'
  packCount?: number; // e.g. 5 packs
  piecesPerPack?: number; // e.g. 24 pcs/pack
  packPrice?: number; // e.g. cost per pack
}

export interface PurchaseOrder {
  id?: string;
  businessId: string;
  ownerId: string;
  branchId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierPhone?: string;
  supplierAddress?: string;
  items: PurchaseOrderItem[];
  totalAmount: number;
  status: 'draft' | 'pending' | 'fulfilled' | 'cancelled';
  expectedDate?: string;
  notes?: string;
  createdAt: any;
  fulfilledAt?: any;
  associatedBillId?: string;
  salesPlayShopId?: string;
}

export interface PurchaseLog {
  id?: string;
  businessId: string;
  ownerId: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  openingDue: number;
  billAmount: number;
  paidAmount: number;
  netDue: number;
  date: string;
  createdAt: any;
  items?: PurchaseOrderItem[];
  purchaseOrderId?: string;
  salesPlayShopId?: string;
  syncedToSalesPlay?: boolean;
  notes?: string;
  paymentType?: string;
  paymentMode?: 'Cash' | 'Bank' | 'Card' | 'Online' | 'Due' | string;
  bankId?: string;
  bankAccountId?: string;
  bankName?: string;
}

export interface SalesPlayProduct {
  id: string;
  product_code: string;
  product_name: string;
  category: string;
  sub_category?: string;
  barcode: string;
  cost: number; // purchase cost
  price?: number; // sales price
  last_purchase_cost?: number; // previous purchase cost
  measurement?: string;
  is_weight_item?: boolean;
  image_url?: string;
  in_stock?: number;
  stock_control?: boolean;
}

export interface PaymentRoutingSettings {
  defaultCardBankId: string;
  defaultOnlineBankId: string;
  updatedAt?: any;
}

export interface SalesPlayCategory {
  id: string;
  category_name: string;
  item_classification_code?: string;
  created_at?: string;
  updated_date?: string;
}

export interface SalesPlayShop {
  id: string;
  shop_name: string;
  address?: string;
  phone_number?: string;
  terminal_list?: { pos_name: string; pos_key: string }[];
}

export interface SalesPlaySettings {
  businessId: string;
  ownerId?: string;
  accountEmail: string;
  apiToken: string;
  appId?: string;
  appSecret?: string;
  authCode?: string;
  selectedShopId: string;
  branchShopMap?: { [branchId: string]: string }; // branchId -> salesPlayShopId
  defaultCardBankId?: string;
  defaultOnlineBankId?: string;
  lastSyncedAt?: string;
}

export interface Task {
  id?: string;
  businessId: string;
  ownerId: string;
  branchId: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  deadline: string;
  status: 'pending' | 'completed';
  createdAt: any;
}

export interface Employee {
  id: string;
  name: string;
  position: string;
  baseSalary: number;
  joinDate: string;
  status: 'active' | 'inactive';
  branchId: string;
  businessId: string;
  // Advanced details
  phone: string;
  email?: string;
  address?: string;
  bloodGroup?: string;
  emergencyContact?: string;
  nidPassport?: string;
  documentUrl?: string; // Base64 or URL
  documentName?: string;
  // Bank Details
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  ifscCode?: string;
  createdAt?: any;
}

export interface SalaryRequest {
  id: string;
  employeeId: string;
  employeeName?: string;
  month: string;
  year: number;
  baseSalary: number;
  allowances: number;
  overtime: number;
  bonuses: number;
  deductions: number;
  netSalary: number;
  adjustmentNote: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  paymentMethod?: string;
  paymentType?: 'cash' | 'bank' | 'split';
  cashAmount?: number;
  bankAmount?: number;
  sourceAccountId?: string; // Bank account ID if paymentType is 'bank' or 'split'
  destinationType?: 'cash' | 'bank';
  paymentDate?: string;
  businessId: string;
  branchId: string;
  createdAt: any;
  processedBy?: string;
}

export interface Denomination {
  id: string;
  value: number;
  label: string;
  type: 'note' | 'coin';
}

export interface CurrencyConfig {
  id: string;
  code: string;
  name: string;
  symbol: string;
  denominations: Denomination[];
  businessId: string;
  ownerId: string;
  createdAt: any;
}

export interface CashCountRecord {
  id?: string;
  businessId: string;
  branchId: string;
  ownerId: string;
  userId: string;
  currencyId: string;
  date: string;
  counts: { [denominationId: string]: number };
  totalAmount: number;
  note?: string;
  createdAt: any;
}
