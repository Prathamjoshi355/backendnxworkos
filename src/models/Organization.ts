import mongoose, { Schema } from "mongoose";

export interface IOrganization extends mongoose.Document {
  name: string;
  legalName?: string | null;
  cin?: string | null;
  companyPrefix?: string | null;
  gstNumber?: string | null;
  panNumber?: string | null;
  logo?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  timezone?: string | null;
  workingHours?: {
    workStartTime?: string;
    workEndTime?: string;
    gracePeriodMinutes?: number;
    workingDays?: string[];
  };
  settings?: {
    dailyReportRequiredBeforeLogout?: boolean;
  };
  status: string;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, index: true },
    legalName: { type: String, default: null },
    cin: { type: String, default: null, uppercase: true, trim: true },
    companyPrefix: { type: String, default: "N", uppercase: true, trim: true },
    gstNumber: { type: String, default: null, uppercase: true, trim: true },
    panNumber: { type: String, default: null, uppercase: true, trim: true },
    logo: { type: String, default: null },
    email: { type: String, default: null },
    phone: { type: String, default: null },
    website: { type: String, default: null },
    address: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    country: { type: String, default: null },
    timezone: { type: String, default: null },
    workingHours: {
      type: {
        workStartTime: { type: String, default: "09:30" },
        workEndTime: { type: String, default: "18:30" },
        gracePeriodMinutes: { type: Number, default: 10 },
        workingDays: { type: [String], default: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
      },
      default: null,
    },
    settings: {
      type: {
        dailyReportRequiredBeforeLogout: { type: Boolean, default: true },
      },
      default: { dailyReportRequiredBeforeLogout: true },
    },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  },
  { timestamps: true }
);

export const Organization = (mongoose.models.Organization as mongoose.Model<IOrganization>) || mongoose.model<IOrganization>("Organization", OrganizationSchema);
export default Organization;
