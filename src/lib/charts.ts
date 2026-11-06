/**
 * Two charts of accounts. Each account that the app needs to find on its own (the bank, receivables,
 * VAT, retained earnings...) carries a role, so the same books can be kept in either chart and the
 * reports read both the same way.
 */

export type ChartId = "intl" | "tdhp";
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

/** Where an account goes in the statements. */
export type Section =
  | "cash"
  | "receivables"
  | "tax-assets"
  | "other-current-assets"
  | "fixed-assets"
  | "current-liabilities"
  | "long-term-liabilities"
  | "equity"
  | "revenue"
  | "cost-of-sales"
  | "operating-expenses"
  | "other-income"
  | "other-expenses"
  | "income-tax";

export type Role =
  | "cash"
  | "bank-try"
  | "bank-eur"
  | "bank-usd"
  | "receivables"
  | "advances-paid"
  | "vat-input"
  | "vat-carried"
  | "prepaid"
  | "equipment"
  | "accumulated-depreciation"
  | "payables"
  | "salaries-payable"
  | "taxes-payable"
  | "social-security-payable"
  | "vat-output"
  | "income-tax-provision"
  | "deferred-revenue"
  | "loans"
  | "capital"
  | "retained-earnings"
  | "accumulated-losses"
  | "current-result"
  | "current-loss"
  | "sales-domestic"
  | "sales-export"
  | "sales-returns"
  | "cost-of-services"
  | "salaries"
  | "rent"
  | "software"
  | "depreciation"
  | "travel"
  | "marketing"
  | "professional-fees"
  | "office"
  | "interest-income"
  | "fx-gain"
  | "fx-loss"
  | "bank-fees"
  | "income-tax-expense"
  | "opening-balance";

export interface Account {
  code: string;
  name: { en: string; tr: string };
  type: AccountType;
  section: Section;
  /** A heading that groups sub-accounts; entries go to its children. */
  header?: boolean;
  /** Reduces the accounts around it: accumulated depreciation, sales returns. */
  contra?: boolean;
  role?: Role;
  /** Currency the account is kept in, for bank accounts in foreign currency. */
  currency?: string;
  /** Money and claims to money, revalued at month end when held in foreign currency. */
  monetary?: boolean;
  /** Added by the user rather than shipped with the chart. */
  custom?: boolean;
  archived?: boolean;
}

type Row = [code: string, en: string, tr: string, type: AccountType, section: Section, extra?: Partial<Account>];

const make = (rows: Row[]): Account[] =>
  rows.map(([code, en, tr, type, section, extra]) => ({ code, name: { en, tr }, type, section, ...extra }));

/** A small international chart, numbered the way most bookkeeping tools number theirs. */
export const INTL: Account[] = make([
  ["1000", "Cash on hand", "Kasa", "asset", "cash", { role: "cash", monetary: true }],
  ["1010", "Bank · TRY", "Banka · TRY", "asset", "cash", { role: "bank-try", monetary: true }],
  ["1020", "Bank · EUR", "Banka · EUR", "asset", "cash", { role: "bank-eur", currency: "EUR", monetary: true }],
  ["1030", "Bank · USD", "Banka · USD", "asset", "cash", { role: "bank-usd", currency: "USD", monetary: true }],
  ["1100", "Accounts receivable", "Ticari alacaklar", "asset", "receivables", { role: "receivables", monetary: true }],
  ["1150", "Advances to suppliers", "Verilen sipariş avansları", "asset", "other-current-assets", { role: "advances-paid" }],
  ["1200", "VAT receivable", "İndirilecek KDV", "asset", "tax-assets", { role: "vat-input" }],
  ["1210", "VAT carried forward", "Devreden KDV", "asset", "tax-assets", { role: "vat-carried" }],
  ["1300", "Prepaid expenses", "Peşin ödenmiş giderler", "asset", "other-current-assets", { role: "prepaid" }],
  ["1500", "Equipment", "Demirbaşlar", "asset", "fixed-assets", { role: "equipment" }],
  ["1510", "Accumulated depreciation", "Birikmiş amortisman", "asset", "fixed-assets", { role: "accumulated-depreciation", contra: true }],
  ["2000", "Accounts payable", "Ticari borçlar", "liability", "current-liabilities", { role: "payables", monetary: true }],
  ["2100", "VAT payable", "Hesaplanan KDV", "liability", "current-liabilities", { role: "vat-output" }],
  ["2200", "Salaries payable", "Personele borçlar", "liability", "current-liabilities", { role: "salaries-payable" }],
  ["2210", "Taxes payable", "Ödenecek vergiler", "liability", "current-liabilities", { role: "taxes-payable" }],
  ["2220", "Social security payable", "Ödenecek SGK primleri", "liability", "current-liabilities", { role: "social-security-payable" }],
  ["2300", "Deferred revenue", "Ertelenmiş gelirler", "liability", "current-liabilities", { role: "deferred-revenue" }],
  ["2400", "Income tax provision", "Vergi karşılığı", "liability", "current-liabilities", { role: "income-tax-provision" }],
  ["2500", "Bank loans", "Banka kredileri", "liability", "long-term-liabilities", { role: "loans", monetary: true }],
  ["3000", "Share capital", "Sermaye", "equity", "equity", { role: "capital" }],
  ["3100", "Retained earnings", "Geçmiş yıllar kârları", "equity", "equity", { role: "retained-earnings" }],
  ["3150", "Accumulated losses", "Geçmiş yıllar zararları", "equity", "equity", { role: "accumulated-losses" }],
  ["3200", "Current year earnings", "Dönem net kârı", "equity", "equity", { role: "current-result" }],
  ["3210", "Current year loss", "Dönem net zararı", "equity", "equity", { role: "current-loss" }],
  ["3900", "Opening balance equity", "Açılış bakiyeleri", "equity", "equity", { role: "opening-balance" }],
  ["4000", "Sales · domestic", "Yurt içi satışlar", "income", "revenue", { role: "sales-domestic" }],
  ["4010", "Sales · export", "Yurt dışı satışlar", "income", "revenue", { role: "sales-export" }],
  ["4090", "Sales returns and discounts", "Satıştan iadeler ve iskontolar", "income", "revenue", { role: "sales-returns", contra: true }],
  ["5000", "Cost of services", "Hizmet maliyeti", "expense", "cost-of-sales", { role: "cost-of-services" }],
  ["6000", "Salaries and wages", "Personel giderleri", "expense", "operating-expenses", { role: "salaries" }],
  ["6010", "Rent", "Kira giderleri", "expense", "operating-expenses", { role: "rent" }],
  ["6020", "Software subscriptions", "Yazılım abonelikleri", "expense", "operating-expenses", { role: "software" }],
  ["6030", "Depreciation", "Amortisman giderleri", "expense", "operating-expenses", { role: "depreciation" }],
  ["6040", "Travel", "Seyahat giderleri", "expense", "operating-expenses", { role: "travel" }],
  ["6050", "Marketing", "Pazarlama giderleri", "expense", "operating-expenses", { role: "marketing" }],
  ["6060", "Professional fees", "Danışmanlık ve müşavirlik", "expense", "operating-expenses", { role: "professional-fees" }],
  ["6070", "Office and utilities", "Ofis ve genel giderler", "expense", "operating-expenses", { role: "office" }],
  ["7000", "Interest income", "Faiz gelirleri", "income", "other-income", { role: "interest-income" }],
  ["7010", "Foreign exchange gains", "Kambiyo kârları", "income", "other-income", { role: "fx-gain" }],
  ["7500", "Foreign exchange losses", "Kambiyo zararları", "expense", "other-expenses", { role: "fx-loss" }],
  ["7510", "Bank fees", "Banka komisyonları", "expense", "other-expenses", { role: "bank-fees" }],
  ["8000", "Income tax expense", "Vergi gideri", "expense", "income-tax", { role: "income-tax-expense" }],
]);

/** The Turkish uniform chart of accounts (Tekdüzen Hesap Planı), the accounts a small service company uses. */
export const TDHP: Account[] = make([
  ["100", "Cash", "Kasa", "asset", "cash", { role: "cash", monetary: true }],
  ["102", "Banks", "Bankalar", "asset", "cash", { header: true }],
  ["102.01", "Banks · TRY", "Bankalar · TRY", "asset", "cash", { role: "bank-try", monetary: true }],
  ["102.02", "Banks · EUR", "Bankalar · EUR", "asset", "cash", { role: "bank-eur", currency: "EUR", monetary: true }],
  ["102.03", "Banks · USD", "Bankalar · USD", "asset", "cash", { role: "bank-usd", currency: "USD", monetary: true }],
  ["120", "Trade receivables", "Alıcılar", "asset", "receivables", { role: "receivables", monetary: true }],
  ["159", "Advances given for orders", "Verilen sipariş avansları", "asset", "other-current-assets", { role: "advances-paid" }],
  ["180", "Prepaid expenses", "Gelecek aylara ait giderler", "asset", "other-current-assets", { role: "prepaid" }],
  ["190", "VAT carried forward", "Devreden KDV", "asset", "tax-assets", { role: "vat-carried" }],
  ["191", "Deductible VAT", "İndirilecek KDV", "asset", "tax-assets", { role: "vat-input" }],
  ["255", "Fixtures and equipment", "Demirbaşlar", "asset", "fixed-assets", { role: "equipment" }],
  ["257", "Accumulated depreciation", "Birikmiş amortismanlar", "asset", "fixed-assets", { role: "accumulated-depreciation", contra: true }],
  ["320", "Trade payables", "Satıcılar", "liability", "current-liabilities", { role: "payables", monetary: true }],
  ["335", "Due to personnel", "Personele borçlar", "liability", "current-liabilities", { role: "salaries-payable" }],
  ["360", "Taxes payable", "Ödenecek vergi ve fonlar", "liability", "current-liabilities", { role: "taxes-payable" }],
  ["361", "Social security payable", "Ödenecek sosyal güvenlik kesintileri", "liability", "current-liabilities", { role: "social-security-payable" }],
  ["370", "Provision for income tax", "Dönem kârı vergi ve diğer yasal yükümlülük karşılıkları", "liability", "current-liabilities", { role: "income-tax-provision" }],
  ["380", "Deferred income", "Gelecek aylara ait gelirler", "liability", "current-liabilities", { role: "deferred-revenue" }],
  ["391", "Output VAT", "Hesaplanan KDV", "liability", "current-liabilities", { role: "vat-output" }],
  ["400", "Bank loans", "Banka kredileri", "liability", "long-term-liabilities", { role: "loans", monetary: true }],
  ["500", "Capital", "Sermaye", "equity", "equity", { role: "capital" }],
  ["570", "Retained earnings", "Geçmiş yıllar kârları", "equity", "equity", { role: "retained-earnings" }],
  ["580", "Accumulated losses", "Geçmiş yıllar zararları", "equity", "equity", { role: "accumulated-losses" }],
  ["590", "Net profit for the period", "Dönem net kârı", "equity", "equity", { role: "current-result" }],
  ["591", "Net loss for the period", "Dönem net zararı", "equity", "equity", { role: "current-loss" }],
  ["599", "Opening balances", "Açılış bilançosu farkları", "equity", "equity", { role: "opening-balance" }],
  ["600", "Domestic sales", "Yurt içi satışlar", "income", "revenue", { role: "sales-domestic" }],
  ["601", "Export sales", "Yurt dışı satışlar", "income", "revenue", { role: "sales-export" }],
  ["610", "Sales returns", "Satıştan iadeler", "income", "revenue", { role: "sales-returns", contra: true }],
  ["622", "Cost of services sold", "Satılan hizmet maliyeti", "expense", "cost-of-sales", { role: "cost-of-services" }],
  ["642", "Interest income", "Faiz gelirleri", "income", "other-income", { role: "interest-income" }],
  ["646", "Foreign exchange gains", "Kambiyo kârları", "income", "other-income", { role: "fx-gain" }],
  ["653", "Commission expenses", "Komisyon giderleri", "expense", "other-expenses", { role: "bank-fees" }],
  ["656", "Foreign exchange losses", "Kambiyo zararları", "expense", "other-expenses", { role: "fx-loss" }],
  ["691", "Income tax expense", "Dönem kârı vergi ve diğer yasal yükümlülük karşılıkları", "expense", "income-tax", { role: "income-tax-expense" }],
  ["760", "Marketing, sales and distribution expenses", "Pazarlama satış ve dağıtım giderleri", "expense", "operating-expenses", { role: "marketing" }],
  ["770", "General administrative expenses", "Genel yönetim giderleri", "expense", "operating-expenses", { header: true }],
  ["770.01", "Personnel expenses", "Personel giderleri", "expense", "operating-expenses", { role: "salaries" }],
  ["770.02", "Rent", "Kira giderleri", "expense", "operating-expenses", { role: "rent" }],
  ["770.03", "Software subscriptions", "Yazılım abonelikleri", "expense", "operating-expenses", { role: "software" }],
  ["770.04", "Depreciation", "Amortisman giderleri", "expense", "operating-expenses", { role: "depreciation" }],
  ["770.05", "Travel", "Seyahat giderleri", "expense", "operating-expenses", { role: "travel" }],
  ["770.06", "Professional fees", "Danışmanlık ve müşavirlik giderleri", "expense", "operating-expenses", { role: "professional-fees" }],
  ["770.07", "Office and utilities", "Ofis ve genel giderler", "expense", "operating-expenses", { role: "office" }],
]);

export const CHARTS: Record<ChartId, Account[]> = { intl: INTL, tdhp: TDHP };

/** Debit-normal accounts grow with debits: assets and expenses, except contra accounts. */
export const debitNormal = (a: Pick<Account, "type" | "contra">) => (a.type === "asset" || a.type === "expense") !== !!a.contra;

export const isBalanceSheet = (a: Pick<Account, "type">) => a.type === "asset" || a.type === "liability" || a.type === "equity";

export function roleCode(accounts: Account[], role: Role): string {
  const a = accounts.find((x) => x.role === role);
  if (!a) throw new Error(`No account with role ${role}`);
  return a.code;
}

/** The parent heading of a sub-account in the Turkish chart ("102.02" → "102"). */
export const parentCode = (code: string) => (code.includes(".") ? code.split(".")[0] : null);

/** Every role must exist exactly once in each chart, and codes must be unique; checked by the unit tests. */
export function checkChart(accounts: Account[]): string[] {
  const problems: string[] = [];
  const codes = new Set<string>();
  for (const a of accounts) {
    if (codes.has(a.code)) problems.push(`duplicate code ${a.code}`);
    codes.add(a.code);
  }
  const roles = new Map<string, number>();
  for (const a of accounts) if (a.role) roles.set(a.role, (roles.get(a.role) ?? 0) + 1);
  for (const [r, n] of roles) if (n > 1) problems.push(`role ${r} used ${n} times`);
  for (const a of accounts) {
    const p = parentCode(a.code);
    if (p && !accounts.find((x) => x.code === p && x.header)) problems.push(`${a.code} has no header ${p}`);
  }
  return problems;
}
