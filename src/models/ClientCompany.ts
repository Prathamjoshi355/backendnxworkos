import mongoose, { Schema, Document, Types } from "mongoose";

export interface IClientCompany extends Document {
  organizationId: Types.ObjectId;
  companyName: string;
  contactPerson?: string;
  officialEmail?: string;
  phone?: string;
  registeredAddress?: string;
  website?: string;
  cin?: string;
  gstNumber?: string;
  panNumber?: string;
  status: "ACTIVE" | "INACTIVE";
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ClientCompanySchema = new Schema<IClientCompany>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    companyName: { type: String, required: true, trim: true },
    contactPerson: { type: String, default: null, trim: true },
    officialEmail: { type: String, default: null, trim: true, lowercase: true },
    phone: { type: String, default: null, trim: true },
    registeredAddress: { type: String, default: null, trim: true },
    website: { type: String, default: null, trim: true },
    cin: { type: String, default: null, trim: true, uppercase: true },
    gstNumber: { type: String, default: null, trim: true, uppercase: true },
    panNumber: { type: String, default: null, trim: true, uppercase: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
    notes: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

ClientCompanySchema.index({ organizationId: 1, companyName: 1 }, { unique: true });

export const ClientCompany =
  (mongoose.models.ClientCompany as mongoose.Model<IClientCompany>) ||
  mongoose.model<IClientCompany>("ClientCompany", ClientCompanySchema);

export default ClientCompany;

