import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "../../../../services/authService";
import User from "../../../../models/User";
import Lead from "../../../../models/Lead";
import Product from "../../../../models/Product";
import LeadImport from "../../../../models/LeadImport";
import LeadAssignment from "../../../../models/LeadAssignment";
import mongoose from "mongoose";

function resolveImportFilename(value?: unknown, format?: unknown): string {
  const provided = typeof value === "string" ? value.trim() : "";
  if (provided) {
    return provided.replace(/[\\/]+/g, "_");
  }

  const extension =
    typeof format === "string" && ["csv", "xlsx", "xls"].includes(format.toLowerCase())
      ? format.toLowerCase()
      : "xlsx";

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `leads-import-${timestamp}.${extension}`;
}

async function generateImportId(): Promise<string> {
  const lastImport = await LeadImport.findOne().sort({ _id: -1 }).lean();

  let nextNumber = 1;
  if (lastImport && lastImport.importId) {
    const match = lastImport.importId.match(/IMP-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `IMP-${String(nextNumber).padStart(6, "0")}`;
}

async function checkLeadDuplicate(
  organizationId: mongoose.Types.ObjectId,
  phone: string,
  email?: string
): Promise<boolean> {
  const existing = await Lead.findOne({
    organizationId,
    $or: [{ phone }, ...(email ? [{ email }] : [])],
  }).lean();

  return !!existing;
}

async function generateLeadId(organizationId: string): Promise<string> {
  const lastLead = await Lead.findOne({ organizationId }).sort({ _id: -1 }).lean();

  let nextNumber = 1;
  if (lastLead && lastLead.leadId) {
    const match = lastLead.leadId.match(/NX-LEAD-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `NX-LEAD-${String(nextNumber).padStart(4, "0")}`;
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Missing token" } },
        { status: 401 }
      );
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Invalid token" } },
        { status: 401 }
      );
    }

    const user = await User.findById(payload.sub).lean();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } },
        { status: 404 }
      );
    }

    const body = await request.json();

    if (!body || !Array.isArray(body.leads)) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "leads array is required" } },
        { status: 422 }
      );
    }

    const {
      leads = [],
      departmentId,
      teamId,
      defaultProductId,
      assignmentMode = "EXCEL",
      assignedTo,
      employeeIds = [],
    } = body;
    const filename = resolveImportFilename(body.filename ?? body.fileName ?? body.file?.name, body.format);

    if (leads.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "At least one lead is required" } },
        { status: 422 }
      );
    }

    const importId = await generateImportId();
    let successfulRows = 0;
    let failedRows = 0;
    let duplicateRows = 0;
    let assignedRows = 0;
    let unassignedRows = 0;

    const errors: Array<{ rowNumber: number; error: string; data?: any }> = [];
    const createdLeads = [];
    const orgIdStr = String(user.organizationId || "");

    const productsFoundSet = new Set<string>();

    // Load active quota rules if assignmentMode === "PRODUCT_QUOTA"
    const LeadQuotaModel = (await import("../../../../models/LeadQuota")).default;
    const activeQuotaRules = assignmentMode === "PRODUCT_QUOTA"
      ? await LeadQuotaModel.find({ organizationId: orgIdStr, status: "ACTIVE" }).lean()
      : [];

    // Eligible employees for EQUAL_DISTRIBUTION / ROUND_ROBIN
    let distributionEmployees: any[] = [];
    if ((assignmentMode === "EQUAL_DISTRIBUTION" || assignmentMode === "ROUND_ROBIN") && Array.isArray(employeeIds) && employeeIds.length > 0) {
      distributionEmployees = await User.find({ _id: { $in: employeeIds }, organizationId: orgIdStr, status: "ACTIVE" }).lean();
    }

    for (let i = 0; i < leads.length; i++) {
      const rawLeadData = leads[i] || {};
      const rowNumber = i + 2;

      // Normalize row keys
      const normalizedData = {
        name: rawLeadData.name ?? rawLeadData.Name ?? rawLeadData["Lead Name"] ?? "",
        phone: rawLeadData.phone ?? rawLeadData.Phone ?? rawLeadData.Contact ?? rawLeadData.Mobile ?? "",
        email: rawLeadData.email ?? rawLeadData.Email ?? undefined,
        company: rawLeadData.company ?? rawLeadData.Company ?? rawLeadData.Organization ?? undefined,
        location: rawLeadData.location ?? rawLeadData.Location ?? undefined,
        city: rawLeadData.city ?? rawLeadData.City ?? undefined,
        state: rawLeadData.state ?? rawLeadData.State ?? undefined,
        source: rawLeadData.source ?? rawLeadData.Source ?? "EXCEL_IMPORT",
        productId: rawLeadData.productId ?? rawLeadData.productCode ?? undefined,
        productName: rawLeadData.productName ?? rawLeadData.product ?? rawLeadData.Product ?? undefined,
        employeeId: rawLeadData.employeeId ?? rawLeadData.EmployeeId ?? rawLeadData["Employee ID"] ?? undefined,
        employeeEmail: rawLeadData.employeeEmail ?? rawLeadData.EmployeeEmail ?? rawLeadData.Employee ?? undefined,
        priority: rawLeadData.priority ?? rawLeadData.Priority ?? "WARM",
        notes: rawLeadData.notes ?? rawLeadData.Notes ?? rawLeadData.Remark ?? undefined,
      };

      // Phone coercion (handles numbers from Excel)
      let phoneStr = String(normalizedData.phone || "").replace(/\.0$/, "").trim();
      if (!phoneStr || phoneStr.length < 7) {
        failedRows++;
        errors.push({
          rowNumber,
          error: "Phone number is required and must be valid",
          data: rawLeadData,
        });
        continue;
      }

      // Email coercion
      let emailStr: string | undefined = typeof normalizedData.email === "string" ? normalizedData.email.trim() : undefined;
      if (emailStr && (!emailStr.includes("@") || emailStr.length < 5)) {
        emailStr = undefined;
      }

      const nameStr = String(normalizedData.name || "").trim();
      if (!nameStr || nameStr.length < 2) {
        failedRows++;
        errors.push({
          rowNumber,
          error: "Name is required (at least 2 characters)",
          data: rawLeadData,
        });
        continue;
      }

      try {
        // Check for duplicates
        const isDuplicate = await checkLeadDuplicate(
          new mongoose.Types.ObjectId(orgIdStr),
          phoneStr,
          emailStr
        );

        if (isDuplicate) {
          duplicateRows++;
          errors.push({
            rowNumber,
            error: "Lead already exists with same phone/email",
            data: rawLeadData,
          });
          continue;
        }

        // Resolve Product
        let resolvedProductId: string | null = defaultProductId || (normalizedData.productId ? String(normalizedData.productId) : null);
        let resolvedProductName: string | null = normalizedData.productName ? String(normalizedData.productName) : null;

        if (resolvedProductName && !resolvedProductId) {
          const matchedProd = await Product.findOne({
            organizationId: orgIdStr,
            $or: [{ name: new RegExp(resolvedProductName, "i") }, { code: new RegExp(resolvedProductName, "i") }],
          }).lean();
          if (matchedProd) {
            resolvedProductId = String(matchedProd._id);
            resolvedProductName = matchedProd.name;
          }
        }

        if (resolvedProductName) productsFoundSet.add(resolvedProductName);

        // Resolve Employee Assignment
        let assignedToId: mongoose.Types.ObjectId | null = null;
        let modeLabel = assignmentMode;

        const isUserAdmin = user.role === "SUPER_ADMIN" || user.role === "ADMIN";
        if (!isUserAdmin) {
          // For non-admin employees, all imported leads MUST be assigned to the creator
          assignedToId = user._id as any;
          modeLabel = "EMPLOYEE_IMPORT";
        } else if (assignmentMode === "EXCEL" && (normalizedData.employeeId || normalizedData.employeeEmail)) {
          const empQuery: any = { organizationId: orgIdStr, status: "ACTIVE" };
          if (normalizedData.employeeEmail) empQuery.email = String(normalizedData.employeeEmail).toLowerCase();
          else if (normalizedData.employeeId) empQuery.$or = [{ employeeId: normalizedData.employeeId }, { _id: normalizedData.employeeId }];

          const matchedEmp = await User.findOne(empQuery).lean();
          if (matchedEmp) assignedToId = matchedEmp._id as any;
        } else if (assignmentMode === "MANUAL" && assignedTo) {
          assignedToId = new mongoose.Types.ObjectId(assignedTo);
        } else if ((assignmentMode === "EQUAL_DISTRIBUTION" || assignmentMode === "ROUND_ROBIN") && distributionEmployees.length > 0) {
          const emp = distributionEmployees[i % distributionEmployees.length];
          assignedToId = emp._id as any;
        } else if (assignmentMode === "PRODUCT_QUOTA" && resolvedProductId) {
          const matchingQuotas = activeQuotaRules.filter((q: any) => String(q.productId) === resolvedProductId);
          for (const qRule of matchingQuotas) {
            const currentCount = await Lead.countDocuments({ organizationId: orgIdStr, productId: qRule.productId, assignedTo: qRule.employeeId });
            if (currentCount < qRule.maxLeads) {
              assignedToId = qRule.employeeId as any;
              break;
            }
          }
        }

        const leadId = await generateLeadId(orgIdStr);

        const created = await Lead.create({
          leadId,
          organizationId: new mongoose.Types.ObjectId(orgIdStr),
          departmentId: departmentId || null,
          teamId: teamId || null,
          productId: resolvedProductId ? new mongoose.Types.ObjectId(resolvedProductId) : null,
          productName: resolvedProductName,
          assignedTo: assignedToId,
          assignedAt: assignedToId ? new Date() : null,
          createdBy: new mongoose.Types.ObjectId(String(user._id)),
          name: nameStr,
          phone: phoneStr,
          email: emailStr || null,
          company: normalizedData.company || null,
          location: normalizedData.location || null,
          city: normalizedData.city || null,
          state: normalizedData.state || null,
          source: normalizedData.source || "EXCEL_IMPORT",
          priority: ["HOT", "WARM", "COLD", "LOW", "MEDIUM", "HIGH", "URGENT"].includes(normalizedData.priority) ? normalizedData.priority : "WARM",
          status: "NEW",
          pipelineStage: "NEW",
          notes: normalizedData.notes || null,
          callCount: 0,
          uncontacted: true,
        });

        if (assignedToId) {
          assignedRows++;
          await LeadAssignment.create({
            organizationId: orgIdStr,
            leadId: created._id,
            employeeId: assignedToId,
            productId: resolvedProductId ? new mongoose.Types.ObjectId(resolvedProductId) : null,
            assignedBy: String(user._id),
            assignmentMode: modeLabel,
            assignedAt: new Date(),
            reason: `Assigned via ${modeLabel} Import`,
          });
        } else {
          unassignedRows++;
        }

        createdLeads.push(created.toObject());
        successfulRows++;
      } catch (error: any) {
        failedRows++;
        errors.push({
          rowNumber,
          error: error?.message || "Failed to create lead",
          data: rawLeadData,
        });
      }
    }

    const importRecord = await LeadImport.create({
      importId,
      organizationId: new mongoose.Types.ObjectId(orgIdStr),
      uploadedBy: new mongoose.Types.ObjectId(String(user._id)),
      filename,
      totalRows: leads.length,
      successfulRows,
      failedRows,
      duplicateRows,
      importErrors: errors,
      status: "COMPLETED",
      createdAt: new Date(),
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          importId,
          total: leads.length,
          successful: successfulRows,
          failed: failedRows,
          duplicates: duplicateRows,
          assigned: assignedRows,
          unassigned: unassignedRows,
          productsFound: Array.from(productsFoundSet),
          errors,
          createdLeads: createdLeads.map((lead) => ({
            _id: lead._id,
            leadId: lead.leadId,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
          })),
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/leads/import error]", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error?.message || "Failed to import leads" } },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Missing token" } },
        { status: 401 }
      );
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Invalid token" } },
        { status: 401 }
      );
    }

    const user = await User.findById(payload.sub).lean();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } },
        { status: 404 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const skip = (page - 1) * limit;

    const query: any = { organizationId: new mongoose.Types.ObjectId(String(user.organizationId)) };

    const [imports, total] = await Promise.all([
      LeadImport.find(query)
        .populate("uploadedBy", "fullName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LeadImport.countDocuments(query),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        imports,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("GET /api/leads/import error:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 }
    );
  }
}
