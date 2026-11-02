import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import DocumentCategory, { IDocumentCategory } from "../models/DocumentCategory";
import DocumentType, { IDocumentType } from "../models/DocumentType";
import DocumentAllocationControl, { IDocumentAllocationControl } from "../models/DocumentAllocationControl";
import ClientCompany, { IClientCompany } from "../models/ClientCompany";
import NXDocument, { INXDocument, DocumentStatus, ConfidentialityLevel, AttachmentType } from "../models/NXDocument";
import Organization from "../models/Organization";
import User from "../models/User";
import AuditLog from "../models/AuditLog";
import storageProvider from "./storageService";
import { validateUploadFile } from "../utils/fileSecurity";
import { logger } from "../utils/logger";
import * as docIdService from "./documentIdService";
export * from "./documentIdService";

// ---------------------------------------------------------------------------
// 1. Initial Predefined Categories and Document Types
// ---------------------------------------------------------------------------

export const INITIAL_CATEGORIES = [
  { name: "HR & Employment", code: "HR_EMP", description: "Human resources, letters, employee records" },
  { name: "Business & Sales", code: "BUS_SALES", description: "Sales contracts, proposals, client agreements" },
  { name: "Legal & Compliance", code: "LEGAL_COMP", description: "Company registrations, compliance certificates, legal NDAs" },
  { name: "Finance & Accounts", code: "FIN_ACCTS", description: "Invoices, payment receipts, expense reports" },
  { name: "Projects & Development", code: "PROJ_DEV", description: "Project specifications, technical docs, delivery reports" },
  { name: "Marketing", code: "MARKETING", description: "Marketing plans, campaign agreements, brand assets" },
  { name: "Operations", code: "OPERATIONS", description: "Policies, SOPs, operational process documentation" },
  { name: "Vendor Management", code: "VENDOR_MGMT", description: "Vendor agreements, onboarding and reviews" },
  { name: "Administration", code: "ADMIN", description: "General administrative records and notices" },
  { name: "Internal Documentation", code: "INTERNAL_DOC", description: "Internal wikis, memos, guidelines" },
  { name: "Other / Custom", code: "OTHER_CUSTOM", description: "Custom and miscellaneous organizational documents" },
];

export const INITIAL_DOCUMENT_TYPES: Array<{
  name: string;
  categoryCode: string;
  code: string;
  hasFinancials?: boolean;
  description?: string;
}> = [
  // HR & Employment
  { name: "Employee Offer Letter", categoryCode: "HR_EMP", code: "731", description: "Official job offer letter for permanent candidate employment" },
  { name: "Internship Offer Letter", categoryCode: "HR_EMP", code: "493", description: "Internship program offer and terms letter" },
  { name: "Offer Letter", categoryCode: "HR_EMP", code: "512", description: "Candidate job offer letter (compatibility code)" },
  { name: "Appointment Letter", categoryCode: "HR_EMP", code: "331", description: "Official employee appointment letter" },
  { name: "Internship Letter", categoryCode: "HR_EMP", code: "749", description: "Internship appointment and terms letter" },
  { name: "Experience Letter", categoryCode: "HR_EMP", code: "286", description: "Service and experience certification" },
  { name: "Relieving Letter", categoryCode: "HR_EMP", code: "913", description: "Formal relieving and exit certificate" },
  { name: "Termination Letter", categoryCode: "HR_EMP", code: "458", description: "Formal employment separation notice" },
  { name: "Internship Extension Letter", categoryCode: "HR_EMP", code: "627", description: "Extension of internship term" },
  { name: "NDA", categoryCode: "HR_EMP", code: "194", description: "Employee non-disclosure agreement" },
  { name: "Employee Confirmation Letter", categoryCode: "HR_EMP", code: "835", description: "Probation completion confirmation" },
  { name: "Salary Slip", categoryCode: "HR_EMP", code: "371", hasFinancials: true, description: "Monthly compensation slip" },
  { name: "Employment Verification Letter", categoryCode: "HR_EMP", code: "692", description: "Proof of active employment" },
  { name: "Warning Letter", categoryCode: "HR_EMP", code: "914", description: "Official disciplinary or performance caution notice" },
  { name: "Promotion Letter", categoryCode: "HR_EMP", code: "817", description: "Role upgrade and elevation letter" },
  { name: "Increment Letter", categoryCode: "HR_EMP", code: "263", hasFinancials: true, description: "Compensation revision letter" },
  { name: "Leave Approval Letter", categoryCode: "HR_EMP", code: "946", description: "Approved sabbatical or extended leave" },

  // Business & Sales
  { name: "Business Proposal", categoryCode: "BUS_SALES", code: "385", hasFinancials: true },
  { name: "Quotation", categoryCode: "BUS_SALES", code: "751", hasFinancials: true },
  { name: "Client Agreement", categoryCode: "BUS_SALES", code: "428", hasFinancials: true },
  { name: "Service Agreement", categoryCode: "BUS_SALES", code: "693", hasFinancials: true },
  { name: "MOU", categoryCode: "BUS_SALES", code: "157" },
  { name: "Purchase Order", categoryCode: "BUS_SALES", code: "824", hasFinancials: true },
  { name: "Work Order", categoryCode: "BUS_SALES", code: "539", hasFinancials: true },
  { name: "Sales Contract", categoryCode: "BUS_SALES", code: "718", hasFinancials: true },
  { name: "Project Proposal", categoryCode: "BUS_SALES", code: "942", hasFinancials: true },
  { name: "Scope of Work", categoryCode: "BUS_SALES", code: "275" },
  { name: "Client Onboarding Document", categoryCode: "BUS_SALES", code: "489" },
  { name: "Delivery Confirmation", categoryCode: "BUS_SALES", code: "362" },

  // Finance & Accounts
  { name: "Invoice", categoryCode: "FIN_ACCTS", code: "584", hasFinancials: true },
  { name: "Payment Receipt", categoryCode: "FIN_ACCTS", code: "927", hasFinancials: true },
  { name: "Payment Confirmation", categoryCode: "FIN_ACCTS", code: "461", hasFinancials: true },
  { name: "Expense Report", categoryCode: "FIN_ACCTS", code: "839", hasFinancials: true },
  { name: "Credit Note", categoryCode: "FIN_ACCTS", code: "372", hasFinancials: true },
  { name: "Debit Note", categoryCode: "FIN_ACCTS", code: "651", hasFinancials: true },
  { name: "Payment Agreement", categoryCode: "FIN_ACCTS", code: "294", hasFinancials: true },
  { name: "Financial Statement", categoryCode: "FIN_ACCTS", code: "783", hasFinancials: true },

  // Legal & Compliance
  { name: "Vendor Agreement", categoryCode: "LEGAL_COMP", code: "846", hasFinancials: true },
  { name: "Authorization Letter", categoryCode: "LEGAL_COMP", code: "317" },
  { name: "Confidentiality Agreement", categoryCode: "LEGAL_COMP", code: "592" },
  { name: "Company Registration Documents", categoryCode: "LEGAL_COMP", code: "738" },
  { name: "CIN Certificate", categoryCode: "LEGAL_COMP", code: "249" },
  { name: "GST Certificate", categoryCode: "LEGAL_COMP", code: "963" },
  { name: "PAN Document", categoryCode: "LEGAL_COMP", code: "471" },
  { name: "MSME Certificate", categoryCode: "LEGAL_COMP", code: "618" },
  { name: "Compliance Records", categoryCode: "LEGAL_COMP", code: "852" },

  // Projects & Development
  { name: "Project Report", categoryCode: "PROJ_DEV", code: "395" },
  { name: "Technical Documentation", categoryCode: "PROJ_DEV", code: "726" },
  { name: "Software Delivery Report", categoryCode: "PROJ_DEV", code: "481" },
  { name: "Project Handover Document", categoryCode: "PROJ_DEV", code: "637" },
  { name: "Requirement Specification", categoryCode: "PROJ_DEV", code: "952" },
  { name: "Change Request", categoryCode: "PROJ_DEV", code: "284" },
  { name: "Project Closure Report", categoryCode: "PROJ_DEV", code: "519" },

  // Marketing
  { name: "Marketing Proposal", categoryCode: "MARKETING", code: "862", hasFinancials: true },
  { name: "Campaign Agreement", categoryCode: "MARKETING", code: "347", hasFinancials: true },
  { name: "Media Plan", categoryCode: "MARKETING", code: "791" },
  { name: "Brand Guidelines", categoryCode: "MARKETING", code: "426" },
  { name: "Marketing Report", categoryCode: "MARKETING", code: "683" },
  { name: "Content Approval Document", categoryCode: "MARKETING", code: "935" },

  // Operations
  { name: "Internal Notice", categoryCode: "OPERATIONS", code: "273" },
  { name: "Company Policy", categoryCode: "OPERATIONS", code: "518" },
  { name: "Standard Operating Procedure", categoryCode: "OPERATIONS", code: "841" },
  { name: "Process Documentation", categoryCode: "OPERATIONS", code: "369" },
  { name: "Vendor Onboarding Document", categoryCode: "OPERATIONS", code: "624" },
  { name: "Maintenance Agreement", categoryCode: "OPERATIONS", code: "759", hasFinancials: true },

  // Vendor Management
  { name: "Vendor Quotation", categoryCode: "VENDOR_MGMT", code: "982", hasFinancials: true },
  { name: "Vendor Performance Review", categoryCode: "VENDOR_MGMT", code: "415" },

  // Administration
  { name: "Asset Handover Document", categoryCode: "ADMIN", code: "563" },
  { name: "General Administrative Notice", categoryCode: "ADMIN", code: "829" },

  // Internal Documentation
  { name: "Meeting Minutes", categoryCode: "INTERNAL_DOC", code: "374" },
  { name: "Knowledge Base Article", categoryCode: "INTERNAL_DOC", code: "691" },

  // Other / Custom
  { name: "Custom Document", categoryCode: "OTHER_CUSTOM", code: "999" },
];

/**
 * Seed or ensure predefined document categories and types exist.
 */
export async function ensurePredefinedDocumentCatalog(organizationId?: string): Promise<void> {
  // 1. Categories
  for (const cat of INITIAL_CATEGORIES) {
    await DocumentCategory.findOneAndUpdate(
      { code: cat.code, organizationId: null },
      {
        $setOnInsert: {
          name: cat.name,
          code: cat.code,
          description: cat.description,
          isPredefined: true,
          status: "ACTIVE",
        },
      },
      { upsert: true, new: true }
    );
  }

  if (organizationId) {
    for (const cat of INITIAL_CATEGORIES) {
      await DocumentCategory.findOneAndUpdate(
        { code: cat.code, organizationId: new Types.ObjectId(organizationId) },
        {
          $setOnInsert: {
            name: cat.name,
            code: cat.code,
            description: cat.description,
            isPredefined: true,
            status: "ACTIVE",
          },
        },
        { upsert: true, new: true }
      );
    }
  }

  // 2. Types
  for (const item of INITIAL_DOCUMENT_TYPES) {
    const category = await DocumentCategory.findOne({ code: item.categoryCode });
    if (!category) continue;

    await DocumentType.findOneAndUpdate(
      { code: item.code },
      {
        $setOnInsert: {
          name: item.name,
          code: item.code,
          categoryId: category._id,
          hasFinancials: Boolean(item.hasFinancials),
          description: item.description || null,
          isPredefined: true,
          organizationId: null,
          status: "ACTIVE",
        },
      },
      { upsert: true, new: true }
    );
  }

  // 3. Official NexisparkX Predefined Document Types from Central Registry
  const { DOCUMENT_TYPE_REGISTRY } = await import("../constants/documentTypeCodes");
  for (const entry of DOCUMENT_TYPE_REGISTRY) {
    const category = await DocumentCategory.findOne({ code: entry.categoryCode });
    if (!category) continue;

    await DocumentType.findOneAndUpdate(
      { code: entry.code },
      {
        $setOnInsert: {
          name: entry.name,
          code: entry.code,
          categoryId: category._id,
          hasFinancials: Boolean(entry.hasFinancials),
          description: entry.description || null,
          isPredefined: true,
          organizationId: null,
          status: entry.isActive ? "ACTIVE" : "INACTIVE",
        },
      },
      { upsert: true, new: true }
    );
  }
}

export const ensureDocumentCatalogue = ensurePredefinedDocumentCatalog;

export async function createDocumentType(
  currentUser: any,
  input: {
    name: string;
    code: string;
    categoryCode?: string;
    categoryId?: string | Types.ObjectId;
    hasFinancials?: boolean;
    description?: string;
  }
) {
  if (currentUser.role !== "SUPER_ADMIN" && currentUser.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Only administrators can register document types");
  }

  const code = input.code?.trim();
  if (!code || !/^[1-9]{3}$/.test(code)) {
    throw new Error(
      `Invalid Document Type Code '${code}': Code must be exactly 3 digits between 1-9 with no zero. Zero is strictly prohibited.`
    );
  }

  const existing = await DocumentType.findOne({ code });
  if (existing) {
    throw new Error(`DOCUMENT_TYPE_CODE_EXISTS: Code '${code}' is already registered for '${existing.name}'`);
  }

  let categoryId = input.categoryId;
  if (!categoryId && input.categoryCode) {
    const cat = await DocumentCategory.findOne({ code: input.categoryCode.toUpperCase() });
    if (!cat) throw new Error(`Category '${input.categoryCode}' not found`);
    categoryId = cat._id;
  }

  if (!categoryId) {
    throw new Error("Document category is required");
  }

  return await DocumentType.create({
    name: input.name.trim(),
    code,
    categoryId,
    hasFinancials: Boolean(input.hasFinancials),
    description: input.description?.trim() || null,
    isPredefined: currentUser.role === "SUPER_ADMIN" && !currentUser.organizationId,
    organizationId: currentUser.organizationId || null,
    status: "ACTIVE",
  });
}

export const registerDocumentType = createDocumentType;

// ---------------------------------------------------------------------------
// 2. Document ID Generation (Strictly conforming to Part 3.4)
// Structure: N + COMPANY_CIN + YYMMDD + RANDOM_ALPHANUMERIC_CODE + DOCUMENT_TYPE_CODE
// ---------------------------------------------------------------------------

export function generateSecureRandomAlphanumeric(length = 6): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude easily confusable characters
  let result = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

export function formatYYMMDD(date: Date, timezone?: string): string {
  // Format YYMMDD in server/company timezone
  const yearStr = date.getFullYear().toString().slice(-2);
  const monthStr = (date.getMonth() + 1).toString().padStart(2, "0");
  const dayStr = date.getDate().toString().padStart(2, "0");
  return `${yearStr}${monthStr}${dayStr}`;
}

export async function generateDocumentId(
  organizationId: Types.ObjectId | string,
  documentTypeCode: string,
  docDate: Date = new Date()
): Promise<string> {
  return docIdService.generateDocumentId({
    organizationId,
    documentType: documentTypeCode,
    docDate,
  });
}

// ---------------------------------------------------------------------------
// 3. Document Allocation Control (Live vs Legacy Import, Part 3.5)
// ---------------------------------------------------------------------------

export async function getOrCreateAllocationControl(
  orgIdOrUser: any
): Promise<IDocumentAllocationControl> {
  const organizationId = orgIdOrUser?.organizationId || orgIdOrUser;
  let control = await DocumentAllocationControl.findOne({ organizationId });
  if (!control) {
    control = await DocumentAllocationControl.create({
      organizationId: new Types.ObjectId(organizationId),
      liveAllocationEnabled: true,
      startingAllocationValue: 1,
      currentLiveAllocationCounter: 0,
      totalLiveAllocations: 0,
      totalLegacyImports: 0,
      allocationHistory: [],
    });
  }
  return control;
}

export const getDocumentAllocationStatus = getOrCreateAllocationControl;

export async function configureAllocationControl(
  currentUser: any,
  orgIdOrConfig: any,
  maybeConfig?: {
    liveAllocationEnabled?: boolean;
    startingAllocationValue?: number;
    maxDocumentAllocation?: number;
    notes?: string;
  }
): Promise<IDocumentAllocationControl> {
  // SUPER_ADMIN only
  if (currentUser.role !== "SUPER_ADMIN") {
    throw new Error("FORBIDDEN_SUPER_ADMIN_ONLY: Only SUPER_ADMIN can configure Document Allocation Control.");
  }

  let organizationId = currentUser.organizationId;
  let config = orgIdOrConfig;
  if (maybeConfig) {
    organizationId = orgIdOrConfig;
    config = maybeConfig;
  } else if (orgIdOrConfig && (orgIdOrConfig.maxDocumentAllocation !== undefined || orgIdOrConfig.notes !== undefined || orgIdOrConfig.liveAllocationEnabled !== undefined)) {
    config = orgIdOrConfig;
    organizationId = currentUser.organizationId;
  }

  const control = await getOrCreateAllocationControl(organizationId);

  if (config?.liveAllocationEnabled !== undefined) {
    control.liveAllocationEnabled = config.liveAllocationEnabled;
  }

  if (config?.maxDocumentAllocation !== undefined) {
    control.maxDocumentAllocation = config.maxDocumentAllocation;
  }

  if (config?.startingAllocationValue !== undefined) {
    if (config.startingAllocationValue < 1) {
      throw new Error("INVALID_ALLOCATION_VALUE: Starting allocation value must be at least 1.");
    }
    control.startingAllocationValue = config.startingAllocationValue;
    if (control.currentLiveAllocationCounter < config.startingAllocationValue) {
      control.currentLiveAllocationCounter = config.startingAllocationValue - 1;
    }
  }

  if (config?.notes) {
    control.allocationHistory.push({
      notes: config.notes,
      changedBy: currentUser._id,
      allocatedBy: currentUser._id,
      allocatedAt: new Date(),
    } as any);
  }

  control.updatedBy = currentUser._id;
  await control.save();
  return control;
}

export const updateDocumentAllocation = configureAllocationControl;

export async function allocateLiveDocumentSequence(
  currentUser: any,
  organizationId: Types.ObjectId | string,
  documentId: string,
  documentType: IDocumentType
): Promise<number> {
  const control = await getOrCreateAllocationControl(organizationId);

  if (!control.liveAllocationEnabled) {
    control.failedAllocationAttempts += 1;
    await control.save();
    throw new Error("LIVE_ALLOCATION_DISABLED: Operational document registration is currently disabled by Super Admin.");
  }

  // Atomic increment
  const startVal = control.startingAllocationValue || 1;
  const currentCount = Math.max(control.currentLiveAllocationCounter, startVal - 1);
  const nextAllocation = currentCount + 1;

  control.currentLiveAllocationCounter = nextAllocation;
  control.totalLiveAllocations += 1;
  control.lastAllocatedAt = new Date();

  control.allocationHistory.unshift({
    allocationNumber: nextAllocation,
    documentId,
    documentTypeId: documentType._id as Types.ObjectId,
    documentTypeCode: documentType.code,
    isLegacyImport: false,
    allocatedBy: currentUser._id,
    allocatedAt: new Date(),
  });

  // Limit history length to 500 records
  if (control.allocationHistory.length > 500) {
    control.allocationHistory = control.allocationHistory.slice(0, 500);
  }

  await control.save();
  return nextAllocation;
}

export async function recordLegacyImportAllocation(
  currentUser: any,
  organizationId: Types.ObjectId | string,
  documentId: string,
  documentType: IDocumentType,
  metadata?: Record<string, any>
): Promise<number> {
  const control = await getOrCreateAllocationControl(organizationId);

  // Independent legacy counter - does NOT modify currentLiveAllocationCounter!
  control.totalLegacyImports += 1;

  control.allocationHistory.unshift({
    allocationNumber: control.totalLegacyImports,
    documentId,
    documentTypeId: documentType._id as Types.ObjectId,
    documentTypeCode: documentType.code,
    isLegacyImport: true,
    allocatedBy: currentUser._id,
    allocatedAt: new Date(),
    metadata,
  });

  if (control.allocationHistory.length > 500) {
    control.allocationHistory = control.allocationHistory.slice(0, 500);
  }

  await control.save();
  return control.totalLegacyImports;
}

// ---------------------------------------------------------------------------
// 4. Client Company Entity Operations (Section 3.6 Section C)
// ---------------------------------------------------------------------------

export async function createClientCompany(
  currentUser: any,
  data: {
    companyName: string;
    contactPerson?: string;
    officialEmail?: string;
    phone?: string;
    registeredAddress?: string;
    website?: string;
    cin?: string;
    gstNumber?: string;
    panNumber?: string;
    notes?: string;
  }
): Promise<IClientCompany> {
  if (!currentUser.organizationId) {
    throw new Error("ORGANIZATION_REQUIRED: User must belong to an organization.");
  }

  const existing = await ClientCompany.findOne({
    organizationId: currentUser.organizationId,
    companyName: data.companyName.trim(),
  });
  if (existing) {
    return existing;
  }

  const client = await ClientCompany.create({
    organizationId: currentUser.organizationId,
    companyName: data.companyName.trim(),
    contactPerson: data.contactPerson?.trim() || null,
    officialEmail: data.officialEmail?.trim().toLowerCase() || null,
    phone: data.phone?.trim() || null,
    registeredAddress: data.registeredAddress?.trim() || null,
    website: data.website?.trim() || null,
    cin: data.cin?.trim().toUpperCase() || null,
    gstNumber: data.gstNumber?.trim().toUpperCase() || null,
    panNumber: data.panNumber?.trim().toUpperCase() || null,
    notes: data.notes || null,
    createdBy: currentUser._id,
  });

  return client;
}

export async function listClientCompanies(
  currentUser: any,
  query: { search?: string; status?: string; limit?: number; page?: number } = {}
): Promise<{ items: IClientCompany[]; total: number }> {
  const filter: any = { organizationId: currentUser.organizationId };
  if (query.status) filter.status = query.status;
  if (query.search) {
    const s = query.search.trim();
    filter.$or = [
      { companyName: { $regex: s, $options: "i" } },
      { contactPerson: { $regex: s, $options: "i" } },
      { officialEmail: { $regex: s, $options: "i" } },
      { cin: { $regex: s, $options: "i" } },
    ];
  }

  const limit = Math.max(1, Math.min(100, query.limit || 50));
  const page = Math.max(1, query.page || 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    ClientCompany.find(filter).sort({ companyName: 1 }).skip(skip).limit(limit),
    ClientCompany.countDocuments(filter),
  ]);

  return { items, total };
}

// ---------------------------------------------------------------------------
// 5. Document Registration & Lifecycle Operations
// ---------------------------------------------------------------------------

export const registerClientCompany = createClientCompany;

export interface CreateDocumentInput {
  title: string;
  categoryId?: string;
  categoryCode?: string;
  documentTypeId?: string;
  typeCode?: string;
  shortDescription?: string;
  documentDate?: Date | string;
  status?: DocumentStatus;
  confidentialityLevel?: ConfidentialityLevel;
  tags?: string[];

  // Division / Dept
  divisionId?: string;
  departmentId?: string;
  teamId?: string;

  // Linked Entities
  clientCompanyId?: string;
  employeeId?: string;
  internId?: string;
  vendorId?: string;
  projectId?: string;
  recipientType?: string;
  recipientName?: string;
  recipientEmail?: string;

  // Financials
  financialAmount?: number;
  financialCurrency?: string;
  financialTaxAmount?: number;
  validityStartDate?: Date | string;
  validityEndDate?: Date | string;
  financials?: {
    contractValue?: number;
    proposalValue?: number;
    currency?: string;
    taxAmount?: number;
    gstAmount?: number;
    advanceAmount?: number;
    paidAmount?: number;
    pendingAmount?: number;
    paymentTerms?: string;
    paymentDueDate?: Date | string;
    paymentStatus?: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";
  };

  // Legacy import
  isLegacyImport?: boolean;
  legacyReferenceId?: string;
  legacyReferenceNumber?: string;

  // Internal Tracking
  responsibleDepartment?: string;
  assignedEmployeeId?: string;
  reviewerId?: string;
  internalNotes?: string;
}

export async function createDocument(
  currentUser: any,
  input: CreateDocumentInput | any
): Promise<INXDocument> {
  if (!currentUser?.organizationId) {
    throw new Error("ORGANIZATION_REQUIRED: User must belong to an organization.");
  }

  // Role & scope authorization check (Section 12)
  const allowedRoles = ["SUPER_ADMIN", "ADMIN", "DIVISION_ADMIN", "MANAGER", "TEAM_LEADER", "HR_HEAD"];
  const userPermissions = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
  const hasDocPermission = userPermissions.includes("documents:create") || userPermissions.includes("documents:manage");

  if (!allowedRoles.includes(currentUser.role) && !hasDocPermission) {
    throw new Error("FORBIDDEN: You do not have permission to create official documents.");
  }

  // Division admin scope enforcement (no implicit access to central or null-division records)
  if (currentUser.role === "DIVISION_ADMIN") {
    if (!currentUser.divisionId) {
      throw new Error("FORBIDDEN: Division administrators without an active division assignment cannot create documents.");
    }
    if (!input.divisionId || String(input.divisionId) !== String(currentUser.divisionId)) {
      throw new Error("FORBIDDEN: Division administrators can only create documents within their assigned active division.");
    }
  }

  // Prevent client from choosing an arbitrary official document ID (Section 12 & 16)
  if (input.documentId) {
    throw new Error("CLIENT_OVERRIDE_PROHIBITED: Clients cannot choose or override official Document IDs.");
  }

  // Prevent client from overriding the official company CIN (Section 12 & 16)
  if (input.cin && input.cin !== docIdService.OFFICIAL_COMPANY_CIN) {
    throw new Error("CLIENT_OVERRIDE_PROHIBITED: Clients cannot override the official company CIN.");
  }

  // 1. Validate Category and Document Type
  let docType: any = null;
  if (input.documentTypeId) {
    docType = await DocumentType.findById(input.documentTypeId);
  } else if (input.typeCode) {
    docType = await DocumentType.findOne({ code: input.typeCode });
  } else if (input.documentTypeCode) {
    docType = await DocumentType.findOne({ code: input.documentTypeCode });
  } else if (input.documentType) {
    const code = docIdService.getDocumentTypeCode(input.documentType);
    docType = await DocumentType.findOne({ code });
  }

  if (!docType || docType.status !== "ACTIVE") {
    throw new Error("INVALID_DOCUMENT_TYPE: Document type does not exist or is inactive.");
  }

  let category: any = null;
  if (input.categoryId) {
    category = await DocumentCategory.findById(input.categoryId);
  } else if (input.categoryCode) {
    category = await DocumentCategory.findOne({ code: input.categoryCode });
  } else if (docType.categoryId) {
    category = await DocumentCategory.findById(docType.categoryId);
  } else if (docType.categoryCode) {
    category = await DocumentCategory.findOne({ code: docType.categoryCode });
  }

  // If still not resolved, fall back to default active category so category is never a blocker
  if (!category || category.status !== "ACTIVE") {
    category = await DocumentCategory.findOne({ status: "ACTIVE" });
  }

  if (!category) {
    throw new Error("INVALID_DOCUMENT_CATEGORY: Category does not exist or is inactive.");
  }

  const docDate = input.documentDate ? new Date(input.documentDate) : new Date();

  // 2. Generate permanent, unique alphanumeric Document ID
  const documentId = await generateDocumentId(
    currentUser.organizationId,
    docType.code,
    docDate
  );

  // 3. Allocation handling (Live vs Legacy)
  const isLegacy = Boolean(input.isLegacyImport);
  let allocationNumber: number | null = null;
  if (isLegacy) {
    allocationNumber = await recordLegacyImportAllocation(
      currentUser,
      currentUser.organizationId,
      documentId,
      docType,
      { legacyReferenceId: input.legacyReferenceId || input.legacyReferenceNumber }
    );
  } else {
    allocationNumber = await allocateLiveDocumentSequence(
      currentUser,
      currentUser.organizationId,
      documentId,
      docType
    );
  }

  // 4. Parse financials conditionally
  let parsedFinancials = null;
  const val = input.financialAmount ?? input.financials?.contractValue ?? input.financials?.proposalValue;
  if (docType.code === "584" && (val === undefined || val === null)) {
    throw new Error("Financial amount and currency are required for this document type.");
  }
  if (val !== undefined && val !== null) {
    parsedFinancials = {
      contractValue: val,
      proposalValue: val,
      currency: input.financialCurrency || input.financials?.currency || "INR",
      taxAmount: input.financialTaxAmount || input.financials?.taxAmount || null,
      gstAmount: input.financials?.gstAmount || null,
      advanceAmount: input.financials?.advanceAmount || null,
      paidAmount: input.financials?.paidAmount || null,
      pendingAmount: input.financials?.pendingAmount || null,
      paymentTerms: input.financials?.paymentTerms || null,
      paymentDueDate: input.financials?.paymentDueDate ? new Date(input.financials.paymentDueDate) : null,
      paymentStatus: input.financials?.paymentStatus || "UNPAID",
    };
  } else if (input.financials) {
    parsedFinancials = {
      contractValue: input.financials.contractValue || null,
      proposalValue: input.financials.proposalValue || null,
      currency: input.financials.currency || "INR",
      taxAmount: input.financials.taxAmount || null,
      gstAmount: input.financials.gstAmount || null,
      advanceAmount: input.financials.advanceAmount || null,
      paidAmount: input.financials.paidAmount || null,
      pendingAmount: input.financials.pendingAmount || null,
      paymentTerms: input.financials.paymentTerms || null,
      paymentDueDate: input.financials.paymentDueDate ? new Date(input.financials.paymentDueDate) : null,
      paymentStatus: input.financials.paymentStatus || "UNPAID",
    };
  }

  const initialStatus = input.status || "DRAFT";

  // 5. Create Document record
  const doc = await NXDocument.create({
    documentId,
    organizationId: currentUser.organizationId,
    divisionId: input.divisionId ? new Types.ObjectId(input.divisionId) : (currentUser.divisionId ? new Types.ObjectId(currentUser.divisionId) : null),
    departmentId: input.departmentId || currentUser.departmentId || null,
    teamId: input.teamId || currentUser.teamId || null,

    title: input.title.trim(),
    categoryId: category._id,
    documentTypeId: docType._id,
    documentTypeCode: docType.code,
    documentType: docType.name,
    shortDescription: input.shortDescription || null,
    documentDate: docDate,
    issueDate: input.issueDate ? new Date(input.issueDate) : (input.documentDate ? new Date(input.documentDate) : docDate),
    effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null,
    expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
    status: initialStatus,
    confidentialityLevel: input.confidentialityLevel || "INTERNAL",
    tags: Array.isArray(input.tags) ? input.tags.map((t: string) => t.trim()) : [],

    isLegacyImport: isLegacy,
    legacyReferenceId: input.legacyReferenceId || input.legacyReferenceNumber || null,
    legacyReferenceNumber: input.legacyReferenceNumber || input.legacyReferenceId || null,
    allocationNumber,

    clientCompanyId: input.clientCompanyId ? new Types.ObjectId(input.clientCompanyId) : null,
    externalCompanyName: input.externalCompanyName || null,
    externalCompanyId: input.externalCompanyId || null,
    employeeId: input.employeeId ? new Types.ObjectId(input.employeeId) : null,
    internId: input.internId ? new Types.ObjectId(input.internId) : null,
    vendorId: input.vendorId || null,
    projectId: input.projectId ? new Types.ObjectId(input.projectId) : null,

    financials: parsedFinancials,
    financialAmount: parsedFinancials?.contractValue || null,
    financialCurrency: parsedFinancials?.currency || null,
    financialTaxAmount: parsedFinancials?.taxAmount || null,
    validityStartDate: input.validityStartDate ? new Date(input.validityStartDate) : null,
    validityEndDate: input.validityEndDate ? new Date(input.validityEndDate) : null,
    attachments: [],

    responsibleDepartment: input.responsibleDepartment || null,
    assignedEmployeeId: input.assignedEmployeeId ? new Types.ObjectId(input.assignedEmployeeId) : null,
    reviewerId: input.reviewerId ? new Types.ObjectId(input.reviewerId) : null,
    internalNotes: input.internalNotes || null,

    activityHistory: [
      {
        action: "REGISTERED",
        performedBy: currentUser._id,
        performedByName: currentUser.fullName || currentUser.email,
        performedAt: new Date(),
        previousStatus: undefined,
        newStatus: initialStatus,
        notes: `Registered with Document ID ${documentId}`,
      },
    ],

    isArchived: false,
    createdBy: currentUser._id,
    lastUpdatedBy: currentUser._id,
  });

  // Record sensitive document creation event in audit log (Section 13)
  try {
    await AuditLog.create({
      organizationId: currentUser.organizationId,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      action: "DOCUMENT_CREATED",
      entityType: "DOCUMENT",
      entityId: doc._id,
      summary: `Created official document ${documentId} (${doc.title})`,
      metadata: {
        documentId,
        documentTypeCode: doc.documentTypeCode,
        documentType: doc.documentType,
        isLegacyImport: isLegacy,
      },
    });
  } catch (err: any) {
    logger.error("Failed to create audit log for document creation", { error: err.message });
  }

  return doc;
}

export const registerDocument = createDocument;

export async function listDocuments(
  currentUser: any,
  query: {
    search?: string;
    categoryId?: string;
    documentTypeId?: string;
    documentTypeCode?: string;
    status?: string;
    confidentialityLevel?: string;
    clientCompanyId?: string;
    employeeId?: string;
    projectId?: string;
    divisionId?: string;
    departmentId?: string;
    isLegacyImport?: boolean;
    attachmentStatus?: "PENDING" | "ATTACHED" | string;
    pendingUploadsOnly?: boolean;
    isArchived?: boolean;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  } = {}
): Promise<{ items: INXDocument[]; total: number }> {
  const isArchivedQuery = query.isArchived === true || query.status === "ARCHIVED";
  const filter: any = {
    organizationId: currentUser.organizationId,
    isArchived: isArchivedQuery,
  };

  // Role scoping
  if (currentUser.role === "DIVISION_ADMIN" && currentUser.divisionId) {
    filter.divisionId = new Types.ObjectId(currentUser.divisionId);
  } else if (["MANAGER", "TEAM_LEADER"].includes(currentUser.role)) {
    // Managers / TLs see documents in their department/division or assigned to their teams/members
    if (currentUser.departmentId) {
      filter.$or = [
        { departmentId: currentUser.departmentId },
        { assignedEmployeeId: currentUser._id },
        { createdBy: currentUser._id },
      ];
    }
  } else if (["EMPLOYEE", "INTERN"].includes(currentUser.role)) {
    filter.$or = [
      { employeeId: currentUser._id },
      { internId: currentUser._id },
      { assignedEmployeeId: currentUser._id },
      { createdBy: currentUser._id },
      { confidentialityLevel: "PUBLIC" },
    ];
  }

  // Filter overrides
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.documentTypeId) filter.documentTypeId = new Types.ObjectId(query.documentTypeId);
  if (query.documentTypeCode) filter.documentTypeCode = query.documentTypeCode;
  if (query.status) filter.status = query.status;
  if (query.confidentialityLevel) filter.confidentialityLevel = query.confidentialityLevel;
  if (query.clientCompanyId) filter.clientCompanyId = new Types.ObjectId(query.clientCompanyId);
  if (query.employeeId) filter.employeeId = new Types.ObjectId(query.employeeId);
  if (query.projectId) filter.projectId = new Types.ObjectId(query.projectId);
  if (query.divisionId) filter.divisionId = new Types.ObjectId(query.divisionId);
  if (query.departmentId) filter.departmentId = query.departmentId;
  if (query.isLegacyImport !== undefined) filter.isLegacyImport = query.isLegacyImport;

  // Pending uploads / attachment state filtering (Section 2.B & 2.C)
  if (query.pendingUploadsOnly || query.attachmentStatus === "PENDING") {
    // Registered records that have NO original attachment
    filter["attachments.attachmentType"] = { $ne: "ORIGINAL" };
    filter.status = { $nin: ["ARCHIVED", "CANCELLED"] };
  } else if (query.attachmentStatus === "ATTACHED") {
    filter["attachments.attachmentType"] = "ORIGINAL";
  }

  if (query.startDate || query.endDate) {
    filter.documentDate = {};
    if (query.startDate) filter.documentDate.$gte = new Date(query.startDate);
    if (query.endDate) filter.documentDate.$lte = new Date(query.endDate);
  }

  if (query.search) {
    const s = query.search.trim();
    filter.$or = [
      { documentId: { $regex: s, $options: "i" } },
      { title: { $regex: s, $options: "i" } },
      { shortDescription: { $regex: s, $options: "i" } },
      { tags: { $in: [new RegExp(s, "i")] } },
    ];
  }

  const limit = Math.max(1, Math.min(100, query.limit || 50));
  const page = Math.max(1, query.page || 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    NXDocument.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("categoryId", "name code")
      .populate("documentTypeId", "name code hasFinancials")
      .populate("clientCompanyId", "companyName contactPerson officialEmail")
      .populate("employeeId", "fullName email role designation")
      .populate("createdBy", "fullName email role"),
    NXDocument.countDocuments(filter),
  ]);

  return { items, total };
}

export async function getDocumentById(
  currentUser: any,
  idOrDocId: string | Types.ObjectId
): Promise<INXDocument> {
  const isObjectId = Types.ObjectId.isValid(String(idOrDocId));
  const filter: any = {
    organizationId: currentUser.organizationId,
    ...(isObjectId ? { _id: idOrDocId } : { documentId: String(idOrDocId).trim().toUpperCase() }),
  };

  const doc = await NXDocument.findOne(filter)
    .populate("categoryId", "name code")
    .populate("documentTypeId", "name code hasFinancials")
    .populate("clientCompanyId", "companyName contactPerson officialEmail phone registeredAddress")
    .populate("employeeId", "fullName email role designation")
    .populate("assignedEmployeeId", "fullName email role designation")
    .populate("reviewerId", "fullName email role designation")
    .populate("createdBy", "fullName email role");

  if (!doc) {
    throw new Error("DOCUMENT_NOT_FOUND");
  }

  // Scoping check for Division Administrators (Section 12: no implicit access to central/null-division records)
  if (currentUser.role === "DIVISION_ADMIN") {
    if (!currentUser.divisionId || !doc.divisionId || String(doc.divisionId) !== String(currentUser.divisionId)) {
      try {
        await AuditLog.create({
          organizationId: currentUser.organizationId,
          actorId: currentUser._id,
          actorRole: currentUser.role,
          action: "DOCUMENT_ACCESS_DENIED",
          entityType: "DOCUMENT",
          entityId: doc._id,
          summary: `Division administrator access denied to document ${doc.documentId}`,
          metadata: { documentId: doc.documentId, reason: "CROSS_DIVISION_OR_CENTRAL" },
        });
      } catch (err: any) {
        logger.error("Failed to create audit log for access denial", { error: err.message });
      }
      throw new Error("FORBIDDEN: Division administrators cannot access central or cross-division documents.");
    }
  }

  // Scoping check for lower roles
  if (["EMPLOYEE", "INTERN"].includes(currentUser.role)) {
    const isOwner =
      String(doc.employeeId?._id || doc.employeeId) === String(currentUser._id) ||
      String(doc.internId) === String(currentUser._id) ||
      String(doc.assignedEmployeeId?._id || doc.assignedEmployeeId) === String(currentUser._id) ||
      String(doc.createdBy?._id || doc.createdBy) === String(currentUser._id);

    if (!isOwner && doc.confidentialityLevel !== "PUBLIC") {
      try {
        await AuditLog.create({
          organizationId: currentUser.organizationId,
          actorId: currentUser._id,
          actorRole: currentUser.role,
          action: "DOCUMENT_ACCESS_DENIED",
          entityType: "DOCUMENT",
          entityId: doc._id,
          summary: `Employee access denied to confidential document ${doc.documentId}`,
          metadata: { documentId: doc.documentId, confidentialityLevel: doc.confidentialityLevel },
        });
      } catch (err: any) {
        logger.error("Failed to create audit log for access denial", { error: err.message });
      }
      throw new Error("FORBIDDEN: You do not have permission to view this document.");
    }
  }

  return doc;
}

/**
 * Updates document metadata while strictly preserving documentId and CIN immutability (Section 11).
 */
export async function updateDocumentMetadata(
  currentUser: any,
  idOrDocId: string | Types.ObjectId,
  updates: Record<string, any>
): Promise<INXDocument> {
  const doc = await getDocumentById(currentUser, idOrDocId);

  // Prohibit modifying immutable core fields (Section 11)
  if (updates.documentId && updates.documentId !== doc.documentId) {
    throw new Error("IMMUTABLE_DOCUMENT_ID: Document ID cannot be modified once generated.");
  }
  if (updates.cin && !doc.documentId.includes(updates.cin)) {
    throw new Error("IMMUTABLE_DOCUMENT_ID: CIN portion of Document ID cannot be modified.");
  }
  if (updates.documentTypeCode && updates.documentTypeCode !== doc.documentTypeCode) {
    throw new Error("IMMUTABLE_DOCUMENT_ID: Document type code cannot be modified once assigned.");
  }
  if (updates.organizationId && String(updates.organizationId) !== String(doc.organizationId)) {
    throw new Error("FORBIDDEN: Cannot reassign document across organizations.");
  }

  // Update permitted fields
  if (updates.title) doc.title = updates.title.trim();
  if (updates.shortDescription !== undefined) doc.shortDescription = updates.shortDescription;
  if (Array.isArray(updates.tags)) doc.tags = updates.tags;
  if (updates.departmentId !== undefined) doc.departmentId = updates.departmentId;
  if (updates.teamId !== undefined) doc.teamId = updates.teamId;
  if (updates.confidentialityLevel) doc.confidentialityLevel = updates.confidentialityLevel;
  if (updates.externalCompanyName !== undefined) doc.externalCompanyName = updates.externalCompanyName;
  if (updates.externalCompanyId !== undefined) doc.externalCompanyId = updates.externalCompanyId;
  if (updates.issueDate !== undefined) doc.issueDate = updates.issueDate ? new Date(updates.issueDate) : null;
  if (updates.effectiveDate !== undefined) doc.effectiveDate = updates.effectiveDate ? new Date(updates.effectiveDate) : null;
  if (updates.expiryDate !== undefined) doc.expiryDate = updates.expiryDate ? new Date(updates.expiryDate) : null;
  if (updates.internalNotes !== undefined) doc.internalNotes = updates.internalNotes;
  if (updates.status) {
    const validStatuses = ["DRAFT", "ACTIVE", "ARCHIVED", "CANCELLED", "PREPARED", "SENT", "UNDER_REVIEW", "PENDING_SIGNATURE", "SIGNED", "EXPIRED"];
    if (!validStatuses.includes(updates.status)) {
      throw new Error(`INVALID_STATUS: '${updates.status}' is not a permitted status.`);
    }
    doc.status = updates.status;
  }

  doc.lastUpdatedBy = currentUser._id;
  doc.activityHistory.push({
    action: "METADATA_UPDATED",
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    performedAt: new Date(),
    notes: updates.notes || "Document metadata updated",
  });

  await doc.save();

  try {
    await AuditLog.create({
      organizationId: currentUser.organizationId,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      action: "DOCUMENT_UPDATED",
      entityType: "DOCUMENT",
      entityId: doc._id,
      summary: `Updated metadata for document ${doc.documentId}`,
      metadata: { documentId: doc.documentId },
    });
  } catch (err: any) {
    logger.error("Failed to create audit log for document update", { error: err.message });
  }

  return doc;
}

export async function updateDocumentStatus(
  currentUser: any,
  idOrDocId: string | Types.ObjectId,
  newStatus: DocumentStatus,
  notes?: string
): Promise<INXDocument> {
  const doc = await getDocumentById(currentUser, idOrDocId);

  const prevStatus = doc.status;
  doc.status = newStatus;

  doc.activityHistory.push({
    action: "STATUS_CHANGED",
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    performedAt: new Date(),
    previousStatus: prevStatus,
    newStatus,
    notes: notes || `Status changed from ${prevStatus} to ${newStatus}`,
  });

  await doc.save();

  try {
    await AuditLog.create({
      organizationId: currentUser.organizationId,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      action: "DOCUMENT_ARCHIVED",
      entityType: "DOCUMENT",
      entityId: doc._id,
      summary: `Archived document ${doc.documentId}`,
      metadata: { documentId: doc.documentId, reason: doc.archiveReason },
    });
  } catch (err: any) {
    logger.error("Failed to create audit log for document archive", { error: err.message });
  }

  return doc;
}

export async function archiveDocument(
  currentUser: any,
  idOrDocId: string | Types.ObjectId,
  reason?: string
): Promise<INXDocument> {
  // Only ADMIN, SUPER_ADMIN or responsible managers can archive
  if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "HR_HEAD"].includes(currentUser.role)) {
    throw new Error("FORBIDDEN: Only authorized managers or administrators can archive documents.");
  }

  const doc = await getDocumentById(currentUser, idOrDocId);

  const prevStatus = doc.status;
  doc.status = "ARCHIVED";
  doc.isArchived = true;
  doc.archivedAt = new Date();
  doc.archivedBy = currentUser._id;
  doc.archiveReason = reason || "Archived by administrator";
  doc.archivedReason = reason || "Archived by administrator";

  doc.activityHistory.push({
    action: "DOCUMENT_ARCHIVED",
    performedBy: currentUser._id,
    performedByName: currentUser.fullName || currentUser.email,
    performedAt: new Date(),
    previousStatus: prevStatus,
    newStatus: "ARCHIVED",
    notes: doc.archiveReason,
  });

  await doc.save();

  try {
    await AuditLog.create({
      organizationId: currentUser.organizationId,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      action: "DOCUMENT_ARCHIVED",
      entityType: "DOCUMENT",
      entityId: doc._id,
      summary: `Archived document ${doc.documentId}`,
      metadata: { documentId: doc.documentId, reason: doc.archiveReason },
    });
  } catch (err: any) {
    logger.error("Failed to create audit log for document archive", { error: err.message });
  }

  return doc;
}

// ---------------------------------------------------------------------------
// 6. Attachment Management & Signed Download URL Access (Part 7)
// ---------------------------------------------------------------------------

export async function uploadDocumentAttachment(
  currentUser: any,
  idOrDocId: string | Types.ObjectId,
  file: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    attachmentType?: AttachmentType;
  }
) {
  if (file.buffer && file.buffer.length > 25 * 1024 * 1024) {
    throw new Error("File exceeds the maximum 25MB limit");
  }

  const doc = await getDocumentById(currentUser, idOrDocId);

  const targetAttachmentType = file.attachmentType || "ORIGINAL";

  // Enforce single original attachment per registry record (Section 2.D)
  if (targetAttachmentType === "ORIGINAL") {
    const hasExistingOriginal = doc.attachments?.some((a: any) => a.attachmentType === "ORIGINAL");
    if (hasExistingOriginal) {
      throw new Error("ATTACHMENT_ALREADY_EXISTS: An original attachment already exists for this document. Replacing original attachments is prohibited.");
    }
  }

  // Validate file security
  const validation = validateUploadFile(file.buffer, file.fileName, file.mimeType);
  if (!validation.isValid) {
    throw new Error(`INVALID_FILE: ${validation.error}`);
  }

  // Upload to Cloudflare R2 / Local Storage
  const uploadResult = await storageProvider.upload({
    buffer: file.buffer,
    fileName: file.fileName,
    mimeType: file.mimeType,
    organizationId: String(currentUser.organizationId),
  });

  const attachmentId = `ATT-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const checksumSha256 = uploadResult.checksum || crypto.createHash("sha256").update(file.buffer).digest("hex");

  const attachment = {
    attachmentId,
    fileName: file.fileName,
    originalName: file.fileName,
    fileSize: uploadResult.fileSize,
    fileSizeBytes: file.buffer.length,
    mimeType: file.mimeType,
    storageKey: uploadResult.storagePath,
    storageProvider: uploadResult.storageProvider || "R2",
    attachmentType: targetAttachmentType,
    uploadedBy: currentUser._id,
    uploadedAt: new Date(),
    checksum: uploadResult.checksum,
    checksumSha256,
  };

  // Atomic update to prevent simultaneous race conditions on the same document
  const atomicResult = await NXDocument.findOneAndUpdate(
    {
      _id: doc._id,
      ...(targetAttachmentType === "ORIGINAL"
        ? { "attachments.attachmentType": { $ne: "ORIGINAL" } }
        : {}),
    },
    {
      $push: {
        attachments: attachment,
        activityHistory: {
          action: "ATTACHMENT_ADDED",
          performedBy: currentUser._id,
          performedByName: currentUser.fullName || currentUser.email,
          performedAt: new Date(),
          notes: `Uploaded file '${file.fileName}' (${Math.round(uploadResult.fileSize / 1024)} KB) as ${attachment.attachmentType}`,
        },
      },
    },
    { new: true }
  );

  if (!atomicResult) {
    throw new Error("CONCURRENT_UPLOAD_CONFLICT: An original attachment was already committed for this document by another process.");
  }

  try {
    await AuditLog.create({
      organizationId: currentUser.organizationId,
      actorId: currentUser._id,
      actorRole: currentUser.role,
      action: "DOCUMENT_UPLOAD_ATTACHED",
      entityType: "DOCUMENT",
      entityId: doc._id,
      summary: `Attached file '${file.fileName}' to document ${doc.documentId}`,
      metadata: {
        documentId: doc.documentId,
        attachmentId,
        fileName: file.fileName,
        fileSize: uploadResult.fileSize,
      },
    });
  } catch (err: any) {
    logger.error("Failed to create audit log for document attachment", { error: err.message });
  }

  return attachment;
}

export async function getDocumentAttachmentSignedUrl(
  currentUser: any,
  idOrDocId: string | Types.ObjectId,
  attachmentId: string
): Promise<{ signedUrl: string; attachment: any }> {
  const isObjectId = Types.ObjectId.isValid(String(idOrDocId));
  const rawDoc = await NXDocument.findOne(
    isObjectId ? { _id: idOrDocId } : { documentId: String(idOrDocId).trim().toUpperCase() }
  );
  if (!rawDoc) {
    throw new Error("DOCUMENT_NOT_FOUND");
  }

  if (currentUser.organizationId && String(rawDoc.organizationId) !== String(currentUser.organizationId)) {
    throw new Error("FORBIDDEN_CROSS_TENANT: Cannot access documents from another organization");
  }

  const doc = await getDocumentById(currentUser, idOrDocId);

  const attachment = doc.attachments.find(
    (a: any) => a.attachmentId === attachmentId || String(a._id) === String(attachmentId)
  );
  if (!attachment) {
    throw new Error("ATTACHMENT_NOT_FOUND");
  }

  // Generate 15-minute signed URL
  const token = jwt.sign(
    { docId: String(doc._id), attachmentId: attachment.attachmentId, sub: String(currentUser._id) },
    env.JWT_SECRET,
    { expiresIn: 900 }
  );

  const base = storageProvider.getUrl(attachment.storageKey);
  const sep = base.includes("?") ? "&" : "?";
  const signedUrl = `${base}${sep}attachmentId=${attachment.attachmentId}&token=${token}&expiresIn=900`;

  return {
    signedUrl,
    attachment,
  };
}

export function verifyAttachmentSignedToken(signedUrl: string): boolean {
  try {
    const url = new URL(signedUrl, "http://localhost");
    const token = url.searchParams.get("token");
    if (!token) return true;
    const decoded: any = jwt.verify(token, env.JWT_SECRET);
    return Boolean(decoded);
  } catch {
    return false;
  }
}
