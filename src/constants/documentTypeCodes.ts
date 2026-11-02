/**
 * Official NexisparkX Document Type Registry & Constants
 *
 * Rules:
 * 1. Exactly 3 numeric digits.
 * 2. Digits 1-9 ONLY (ZERO '0' IS STRICTLY PROHIBITED in every position).
 * 3. Every code must be globally unique across all categories and types.
 * 4. Non-sequential, non-predictable patterns.
 * 5. Immutable once assigned.
 */

export const OFFICIAL_SYSTEM_PREFIX = "N";
export const OFFICIAL_COMPANY_CIN = "U62099MP2026PTC084748";

export interface DocumentTypeEntry {
  key: string;
  name: string;
  code: string;
  category: "EMPLOYMENT_HR" | "BUSINESS_CLIENT" | "LEGAL_CORPORATE" | "FINANCE_OPERATIONS" | "PROJECT" | "OTHER";
  categoryCode: string;
  description: string;
  hasFinancials?: boolean;
  isActive: boolean;
}

export const DOCUMENT_TYPE_REGISTRY: DocumentTypeEntry[] = [
  // ==========================================
  // 1. EMPLOYMENT / HR
  // ==========================================
  {
    key: "EMPLOYEE_OFFER_LETTER",
    name: "Employee Offer Letter",
    code: "731",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Official job offer letter for permanent/full-time candidate employment",
    isActive: true,
  },
  {
    key: "APPOINTMENT_LETTER",
    name: "Appointment Letter",
    code: "624",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Formal employee appointment and joining terms letter",
    isActive: true,
  },
  {
    key: "INTERNSHIP_OFFER_LETTER",
    name: "Internship Offer Letter",
    code: "493",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Internship program offer and terms letter",
    isActive: true,
  },
  {
    key: "INTERNSHIP_EXTENSION_LETTER",
    name: "Internship Extension Letter",
    code: "827",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Formal extension of internship duration",
    isActive: true,
  },
  {
    key: "EMPLOYMENT_AGREEMENT",
    name: "Employment Agreement",
    code: "749",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Binding employment contract between company and employee",
    isActive: true,
  },
  {
    key: "TERMINATION_LETTER",
    name: "Termination Letter",
    code: "362",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Formal employment separation or termination notice",
    isActive: true,
  },
  {
    key: "WARNING_LETTER",
    name: "Warning Letter",
    code: "914",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Official disciplinary or performance caution notice",
    isActive: true,
  },
  {
    key: "EXPERIENCE_LETTER",
    name: "Experience Letter",
    code: "286",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Certificate of past service and experience",
    isActive: true,
  },
  {
    key: "RELIEVING_LETTER",
    name: "Relieving Letter",
    code: "913",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Formal relieving and clearance certificate upon exit",
    isActive: true,
  },
  {
    key: "PROMOTION_LETTER",
    name: "Promotion Letter",
    code: "468",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Employee role promotion, elevation, and title change",
    isActive: true,
  },
  {
    key: "SALARY_REVISION_LETTER",
    name: "Salary Revision Letter",
    code: "751",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Compensation increment and salary structure revision",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "POLICY_DOCUMENT",
    name: "Policy Document",
    code: "319",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Organizational policy, employee handbook, or guidelines",
    isActive: true,
  },
  {
    key: "JOB_OFFER",
    name: "Job Offer",
    code: "512",
    category: "EMPLOYMENT_HR",
    categoryCode: "HR_EMP",
    description: "Direct employment offer letter (compatibility code)",
    isActive: true,
  },

  // ==========================================
  // 2. BUSINESS / CLIENT
  // ==========================================
  {
    key: "PROPOSAL",
    name: "Proposal",
    code: "592",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Commercial or technical client proposal",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "QUOTATION",
    name: "Quotation",
    code: "437",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Formal commercial price quote for client services",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "ESTIMATE",
    name: "Estimate",
    code: "681",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Project scope and financial cost estimation",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "CONTRACT",
    name: "Contract",
    code: "847",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Binding commercial master services agreement or client contract",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "SERVICE_AGREEMENT",
    name: "Service Agreement",
    code: "384",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Client service delivery and maintenance contract",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "NON_DISCLOSURE_AGREEMENT",
    name: "Non-Disclosure Agreement",
    code: "492",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Mutual or unilateral business confidentiality agreement",
    isActive: true,
  },
  {
    key: "MEMORANDUM_OF_UNDERSTANDING",
    name: "Memorandum of Understanding",
    code: "763",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Formal partnership or strategic cooperation MOU",
    isActive: true,
  },
  {
    key: "STATEMENT_OF_WORK",
    name: "Statement of Work",
    code: "627",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Detailed project deliverables, timeline, and scope document",
    isActive: true,
  },
  {
    key: "PURCHASE_ORDER",
    name: "Purchase Order",
    code: "752",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Official client purchase order confirmation",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "WORK_ORDER",
    name: "Work Order",
    code: "938",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Client authorization to initiate contracted work",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "INVOICE_REFERENCE",
    name: "Invoice Reference",
    code: "391",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "Tax invoice reference and commercial billing record",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "CLIENT_ONBOARDING_DOCUMENT",
    name: "Client Onboarding Document",
    code: "816",
    category: "BUSINESS_CLIENT",
    categoryCode: "BUS_SALES",
    description: "KYC and administrative client registration record",
    isActive: true,
  },

  // ==========================================
  // 3. LEGAL / CORPORATE
  // ==========================================
  {
    key: "LEGAL_AGREEMENT",
    name: "Legal Agreement",
    code: "529",
    category: "LEGAL_CORPORATE",
    categoryCode: "LEGAL_COMP",
    description: "General corporate legal agreement or deed",
    isActive: true,
  },
  {
    key: "BOARD_RESOLUTION",
    name: "Board/Corporate Resolution",
    code: "174",
    category: "LEGAL_CORPORATE",
    categoryCode: "LEGAL_COMP",
    description: "Minutes and resolutions of the board of directors",
    isActive: true,
  },
  {
    key: "COMPLIANCE_DOCUMENT",
    name: "Compliance Document",
    code: "481",
    category: "LEGAL_CORPORATE",
    categoryCode: "LEGAL_COMP",
    description: "Statutory filings, ROC documents, and regulatory filings",
    isActive: true,
  },
  {
    key: "REGISTRATION_DOCUMENT",
    name: "Registration Document",
    code: "635",
    category: "LEGAL_CORPORATE",
    categoryCode: "LEGAL_COMP",
    description: "Incorporation certificate, GSTIN, PAN, or MSME registration",
    isActive: true,
  },
  {
    key: "OFFICIAL_NOTICE",
    name: "Official Notice",
    code: "942",
    category: "LEGAL_CORPORATE",
    categoryCode: "LEGAL_COMP",
    description: "Formal legal or administrative corporate notice",
    isActive: true,
  },

  // ==========================================
  // 4. FINANCE / OPERATIONS
  // ==========================================
  {
    key: "PAYMENT_AGREEMENT",
    name: "Payment Agreement",
    code: "864",
    category: "FINANCE_OPERATIONS",
    categoryCode: "FIN_ACCTS",
    description: "Milestone schedule or deferred payment terms agreement",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "EXPENSE_APPROVAL",
    name: "Expense Approval",
    code: "372",
    category: "FINANCE_OPERATIONS",
    categoryCode: "FIN_ACCTS",
    description: "Internal capital or operational expenditure authorization",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "BUDGET_DOCUMENT",
    name: "Budget Document",
    code: "618",
    category: "FINANCE_OPERATIONS",
    categoryCode: "FIN_ACCTS",
    description: "Annual or project-level budget allocation document",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "FINANCIAL_AUTHORIZATION",
    name: "Financial Authorization",
    code: "795",
    category: "FINANCE_OPERATIONS",
    categoryCode: "FIN_ACCTS",
    description: "Executive disbursement or signing authority delegation",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "VENDOR_AGREEMENT",
    name: "Vendor Agreement",
    code: "483",
    category: "FINANCE_OPERATIONS",
    categoryCode: "VENDOR_MGMT",
    description: "Procurement and third-party vendor service contract",
    hasFinancials: true,
    isActive: true,
  },

  // ==========================================
  // 5. PROJECT
  // ==========================================
  {
    key: "PROJECT_PROPOSAL",
    name: "Project Proposal",
    code: "541",
    category: "PROJECT",
    categoryCode: "PROJ_DEV",
    description: "Internal technical project proposal and feasibility",
    isActive: true,
  },
  {
    key: "PROJECT_AGREEMENT",
    name: "Project Agreement",
    code: "873",
    category: "PROJECT",
    categoryCode: "PROJ_DEV",
    description: "Dedicated project delivery and milestones contract",
    hasFinancials: true,
    isActive: true,
  },
  {
    key: "PROJECT_SCOPE_DOCUMENT",
    name: "Project Scope Document",
    code: "429",
    category: "PROJECT",
    categoryCode: "PROJ_DEV",
    description: "Architecture boundaries and functional project scope",
    isActive: true,
  },
  {
    key: "TECHNICAL_SPECIFICATION",
    name: "Technical Specification",
    code: "956",
    category: "PROJECT",
    categoryCode: "PROJ_DEV",
    description: "System architecture, API schemas, and technical specifications",
    isActive: true,
  },
  {
    key: "PROJECT_HANDOVER_DOCUMENT",
    name: "Project Handover Document",
    code: "716",
    category: "PROJECT",
    categoryCode: "PROJ_DEV",
    description: "Final client sign-off, UAT acceptance, and system handover",
    isActive: true,
  },
];

// Verify integrity at initialization time
const seenCodes = new Set<string>();
const seenKeys = new Set<string>();
for (const entry of DOCUMENT_TYPE_REGISTRY) {
  if (!/^[1-9]{3}$/.test(entry.code)) {
    throw new Error(
      `FATAL: Invalid document type code '${entry.code}' for '${entry.key}'. Must be exactly 3 digits (1-9) with no zero.`
    );
  }
  if (seenCodes.has(entry.code)) {
    throw new Error(`FATAL: Duplicate document type code '${entry.code}' found in registry.`);
  }
  seenCodes.add(entry.code);

  if (seenKeys.has(entry.key)) {
    throw new Error(`FATAL: Duplicate document type key '${entry.key}' found in registry.`);
  }
  seenKeys.add(entry.key);
}

/**
 * Legacy and alternative alias mapping to canonical type codes
 */
const CANONICAL_ALIASES: Record<string, string> = {
  OFFER_LETTER: "731",
  "OFFER LETTER": "731",
  EMPLOYEE_OFFER: "731",
  "EMPLOYEE OFFER": "731",
  INTERNSHIP_OFFER: "493",
  "INTERNSHIP OFFER": "493",
  JOB_OFFER: "512",
  "JOB OFFER": "512",
  WARNING_LETTER: "914",
  "WARNING LETTER": "914",
};

/**
 * Retrieve document type entry by key, code, or human-readable name.
 */
export function getDocumentTypeEntry(identifier: string): DocumentTypeEntry | undefined {
  if (!identifier || typeof identifier !== "string") return undefined;
  const target = identifier.trim().toUpperCase();

  // Check direct alias resolution
  if (CANONICAL_ALIASES[target]) {
    const aliasCode = CANONICAL_ALIASES[target];
    const found = DOCUMENT_TYPE_REGISTRY.find((e) => e.code === aliasCode);
    if (found) return found;
  }

  return DOCUMENT_TYPE_REGISTRY.find(
    (e) =>
      e.key.toUpperCase() === target ||
      e.code === target ||
      e.name.toUpperCase() === target ||
      e.key.replace(/_/g, " ").toUpperCase() === target
  );
}

/**
 * Check if a code is valid (3 digits, 1-9, no zero).
 */
export function isValidDocumentTypeCode(code: string): boolean {
  return /^[1-9]{3}$/.test(code);
}

/**
 * Retrieve all registered document types.
 */
export function getAllDocumentTypes(): DocumentTypeEntry[] {
  return [...DOCUMENT_TYPE_REGISTRY];
}

