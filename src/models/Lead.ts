import mongoose, { Schema } from "mongoose";

export interface ILead extends mongoose.Document {
  leadId: string; // NX-LEAD-0001 format
  organizationId: mongoose.Types.ObjectId;
  departmentId?: string | null;
  teamId?: string | null;
  productId?: mongoose.Types.ObjectId | null;
  productName?: string | null;
  assignedTo?: mongoose.Types.ObjectId | null;
  assignedAt?: Date | null;
  createdBy: mongoose.Types.ObjectId;
  name: string;
  phone: string;
  email?: string | null;
  company?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string | null; // "IMPORT", "MANUAL", "WEBSITE", "WHATSAPP", "REFERRAL", "ADVERTISEMENT", etc.
  leadType?: string | null;
  priority?: "HOT" | "WARM" | "COLD" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status:
    | "NEW"
    | "CONTACTED"
    | "QUALIFIED"
    | "INTERESTED"
    | "FOLLOW_UP"
    | "NO_ANSWER"
    | "RESCHEDULED"
    | "REJECTED"
    | "NEGOTIATION"
    | "WON"
    | "CONVERTED"
    | "NOT_INTERESTED"
    | "LOST"
    | "INVALID";
  pipelineStage:
    | "NEW"
    | "CONTACTED"
    | "QUALIFIED"
    | "INTERESTED"
    | "FOLLOW_UP"
    | "NO_ANSWER"
    | "RESCHEDULED"
    | "REJECTED"
    | "NEGOTIATION"
    | "WON"
    | "CONVERTED"
    | "LOST";
  callOutcome?: "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED" | "NO_ANSWER" | "RESCHEDULED" | "REJECTED" | "CALL_NOT_PICKED" | null;
  rejectionReason?: string | null;
  nextAction?: string | null; // "Call", "WhatsApp", "Send Brochure", "Demo", "Follow-up", "Meeting", "Payment Follow-up", "Other"
  notes?: string | null;
  notesSummary?: string | null;
  callCount?: number;
  uncontacted?: boolean;
  lastContactedAt?: Date | null;
  nextFollowUpAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  convertedAt?: Date | null;
  lostAt?: Date | null;
}

const LeadSchema = new Schema<ILead>(
  {
    leadId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    departmentId: { type: String, default: null, index: true },
    teamId: { type: String, default: null, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null, index: true },
    productName: { type: String, default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    email: { type: String, default: null, index: true },
    company: { type: String, default: null },
    location: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    source: { type: String, default: "MANUAL" },
    leadType: { type: String, default: null },
    priority: {
      type: String,
      enum: ["HOT", "WARM", "COLD", "LOW", "MEDIUM", "HIGH", "URGENT"],
      default: "WARM",
    },
    status: {
      type: String,
      enum: ["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "FOLLOW_UP", "NO_ANSWER", "RESCHEDULED", "REJECTED", "NEGOTIATION", "WON", "CONVERTED", "NOT_INTERESTED", "LOST", "INVALID"],
      default: "NEW",
      index: true,
    },
    pipelineStage: {
      type: String,
      enum: ["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "FOLLOW_UP", "NO_ANSWER", "RESCHEDULED", "REJECTED", "NEGOTIATION", "WON", "CONVERTED", "LOST"],
      default: "NEW",
      index: true,
    },
    callOutcome: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    nextAction: { type: String, default: null },
    notes: { type: String, default: null },
    notesSummary: { type: String, default: null },
    callCount: { type: Number, default: 0 },
    uncontacted: { type: Boolean, default: true },
    lastContactedAt: { type: Date, default: null },
    nextFollowUpAt: { type: Date, default: null, index: true },
    convertedAt: { type: Date, default: null },
    lostAt: { type: Date, default: null },
  },
  { timestamps: true }
);

LeadSchema.index({ organizationId: 1, phone: 1 });
LeadSchema.index({ organizationId: 1, email: 1 });
LeadSchema.index({ organizationId: 1, status: 1, pipelineStage: 1 });
LeadSchema.index({ assignedTo: 1, status: 1 });
LeadSchema.index({ organizationId: 1, productId: 1 });
LeadSchema.index({ organizationId: 1, createdBy: 1 });
LeadSchema.index({ createdBy: 1 });

export const Lead =
  (mongoose.models.Lead as mongoose.Model<ILead>) || mongoose.model<ILead>("Lead", LeadSchema);

export default Lead;
