import mongoose, { Schema } from "mongoose";
import { Role, EmploymentType } from "../types/roles";

export interface IUser extends mongoose.Document {
  employeeId?: string;
  fullName: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email: string;
  phone?: string | null;
  personalEmail?: string | null;
  officialEmail?: string | null;
  primaryPhone?: string | null;
  alternatePhone?: string | null;
  dateOfBirth?: Date | null;
  gender?: "MALE" | "FEMALE" | "OTHER" | string | null;
  maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "OTHER" | string | null;
  currentAddress?: string | null;
  permanentAddress?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelation?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactAlternatePhone?: string | null;
  passwordHash: string;
  role: typeof Role[keyof typeof Role];
  employmentType: typeof EmploymentType[keyof typeof EmploymentType];
  employmentClassification?: "FULL_TIME_EMPLOYEE" | "PART_TIME_EMPLOYEE" | "FULL_TIME_INTERN" | "PART_TIME_INTERN" | string;
  employmentStatus?: "INVITED" | "ACTIVE" | "PROBATION" | "CONFIRMED" | "ON_LEAVE" | "NOTICE_PERIOD" | "SUSPENDED" | "INACTIVE" | "TERMINATED" | "RESIGNED" | "EXITED" | "COMPLETED" | string;
  organizationId?: string | null;
  divisionId?: mongoose.Types.ObjectId | string | null;
  primaryDivisionId?: mongoose.Types.ObjectId | string | null;
  departmentId?: string | null;
  primaryDepartmentId?: string | null;
  teamId?: string | null;
  primaryTeamId?: string | null;
  teamMemberships?: Array<{
    teamId: mongoose.Types.ObjectId | string;
    role?: string;
    isPrimary?: boolean;
    joinedAt?: Date;
  }>;
  reportingManagerId?: string | null;
  designation?: string | null;
  departmentProfileId?: mongoose.Types.ObjectId | string | null;
  designationProfileId?: mongoose.Types.ObjectId | string | null;
  joiningDate?: Date | null;
  probationEndDate?: Date | null;
  confirmationDate?: Date | null;
  internshipStartDate?: Date | null;
  internshipEndDate?: Date | null;
  evaluationPeriodMonths?: number | null;
  provisionStipend?: number | null;
  confirmedStipend?: number | null;
  confirmedStipendEffectiveDate?: Date | null;
  onboardingStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | string;
  onboardingChecklist?: Array<{
    key: string;
    title: string;
    completed: boolean;
    completedAt?: Date | null;
    completedBy?: string | null;
  }>;
  exitDate?: Date | null;
  exitNoticeDate?: Date | null;
  exitReason?: string | null;
  exitClearanceStatus?: {
    it: boolean;
    finance: boolean;
    admin: boolean;
    hr: boolean;
  };
  hrNotes?: Array<{
    id: string;
    authorId: mongoose.Types.ObjectId;
    authorName: string;
    note: string;
    createdAt: Date;
  }>;
  workLocation?: string | null;
  workMode?: "REMOTE" | "HYBRID" | "OFFICE" | string | null;
  status?: string;
  profilePhoto?: string | null;
  lastLoginAt?: Date | null;
  mustChangePassword?: boolean;
  passwordChangedAt?: Date | null;
  passwordMetadata?: {
    temporaryPasswordAssignedAt?: Date | null;
    defaultAssigned?: boolean;
    assignedBy?: string | null;
    lastChangedAt?: Date | null;
    changedBy?: string | null;
  } | null;
  permissions?: string[];
  grantedPermissions?: string[];
  deniedPermissions?: string[];
  accessScope?: string;
}

const UserSchema = new Schema<IUser>(
  {
    employeeId: { type: String, index: true, unique: true, sparse: true },
    fullName: { type: String, required: true },
    firstName: { type: String, default: null },
    middleName: { type: String, default: null },
    lastName: { type: String, default: null },
    displayName: { type: String, default: null },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, default: null },
    personalEmail: { type: String, default: null },
    officialEmail: { type: String, default: null },
    primaryPhone: { type: String, default: null },
    alternatePhone: { type: String, default: null },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: ["MALE", "FEMALE", "OTHER"], required: false },
    maritalStatus: { type: String, enum: ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "OTHER"], required: false },
    currentAddress: { type: String, default: null },
    permanentAddress: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    country: { type: String, default: "India" },
    postalCode: { type: String, default: null },
    emergencyContactName: { type: String, default: null },
    emergencyContactRelation: { type: String, default: null },
    emergencyContactPhone: { type: String, default: null },
    emergencyContactAlternatePhone: { type: String, default: null },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: Object.values(Role), default: Role.EMPLOYEE, index: true },
    employmentType: { type: String, required: true, enum: Object.values(EmploymentType), default: EmploymentType.EMPLOYEE, index: true },
    employmentClassification: {
      type: String,
      enum: ["FULL_TIME_EMPLOYEE", "PART_TIME_EMPLOYEE", "FULL_TIME_INTERN", "PART_TIME_INTERN"],
      default: "FULL_TIME_EMPLOYEE",
      index: true,
    },
    employmentStatus: {
      type: String,
      enum: ["INVITED", "ACTIVE", "PROBATION", "CONFIRMED", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED", "INACTIVE", "TERMINATED", "RESIGNED", "EXITED", "COMPLETED"],
      default: "ACTIVE",
      index: true,
    },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    primaryDivisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    departmentId: { type: String, default: null, index: true },
    primaryDepartmentId: { type: String, default: null, index: true },
    teamId: { type: String, default: null, index: true },
    primaryTeamId: { type: String, default: null, index: true },
    teamMemberships: [
      {
        teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true },
        role: { type: String, enum: ["MEMBER", "LEAD", "CONTRIBUTOR"], default: "MEMBER" },
        isPrimary: { type: Boolean, default: false },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    reportingManagerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    designation: { type: String, default: null },
    departmentProfileId: { type: Schema.Types.ObjectId, ref: "PermissionProfile", default: null },
    designationProfileId: { type: Schema.Types.ObjectId, ref: "PermissionProfile", default: null },
    joiningDate: { type: Date, default: null },
    probationEndDate: { type: Date, default: null },
    confirmationDate: { type: Date, default: null },
    internshipStartDate: { type: Date, default: null },
    internshipEndDate: { type: Date, default: null },
    evaluationPeriodMonths: { type: Number, default: null },
    provisionStipend: { type: Number, default: null },
    confirmedStipend: { type: Number, default: null },
    confirmedStipendEffectiveDate: { type: Date, default: null },
    onboardingStatus: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED"],
      default: "COMPLETED",
      index: true,
    },
    onboardingChecklist: [
      {
        key: { type: String, required: true },
        title: { type: String, required: true },
        completed: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        completedBy: { type: String, default: null },
      },
    ],
    exitDate: { type: Date, default: null },
    exitNoticeDate: { type: Date, default: null },
    exitReason: { type: String, default: null },
    exitClearanceStatus: {
      it: { type: Boolean, default: false },
      finance: { type: Boolean, default: false },
      admin: { type: Boolean, default: false },
      hr: { type: Boolean, default: false },
    },
    hrNotes: [
      {
        id: { type: String, required: true },
        authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        authorName: { type: String, required: true },
        note: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    workLocation: { type: String, default: null },
    workMode: { type: String, enum: ["REMOTE", "HYBRID", "OFFICE"], default: "OFFICE" },
    status: {
      type: String,
      enum: ["INVITED", "ACTIVE", "PROBATION", "CONFIRMED", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED", "INACTIVE", "TERMINATED", "RESIGNED", "EXITED", "COMPLETED"],
      default: "ACTIVE",
      index: true,
    },
    profilePhoto: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false, index: true },
    passwordChangedAt: { type: Date, default: null },
    passwordMetadata: { type: Schema.Types.Mixed, default: null },
    permissions: { type: [String], default: [] },
    grantedPermissions: { type: [String], default: [] },
    deniedPermissions: { type: [String], default: [] },
    accessScope: { type: String, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ organizationId: 1, role: 1 });
UserSchema.index({ organizationId: 1, teamId: 1 });
UserSchema.index({ organizationId: 1, departmentId: 1 });
UserSchema.index({ organizationId: 1, employmentStatus: 1 });
UserSchema.index({ organizationId: 1, employmentClassification: 1 });
UserSchema.index({ organizationId: 1, divisionId: 1 });
UserSchema.index({ organizationId: 1, "teamMemberships.teamId": 1 });

// Ensure model is not overwritten during hot reloads
export const User = (mongoose.models.User as mongoose.Model<IUser>) || mongoose.model<IUser>("User", UserSchema);

export default User;
