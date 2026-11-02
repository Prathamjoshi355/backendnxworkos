import mongoose, { Schema } from "mongoose";

export interface IFollowUp extends mongoose.Document {
  leadId: mongoose.Types.ObjectId;
  assignedTo: mongoose.Types.ObjectId;
  scheduledAt: Date;
  reason?: string | null;
  status: "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED";
  createdBy: mongoose.Types.ObjectId;
  completedAt?: Date | null;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const FollowUpSchema = new Schema<IFollowUp>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    reason: { type: String, default: null },
    status: {
      type: String,
      enum: ["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"],
      default: "SCHEDULED",
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    completedAt: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

// Performance indexes
FollowUpSchema.index({ leadId: 1, scheduledAt: -1 });
FollowUpSchema.index({ assignedTo: 1, scheduledAt: 1, status: 1 });
FollowUpSchema.index({ scheduledAt: 1, status: 1 }); // For getting overdue/today follow-ups

export const FollowUp =
  (mongoose.models.FollowUp as mongoose.Model<IFollowUp>) ||
  mongoose.model<IFollowUp>("FollowUp", FollowUpSchema);

export default FollowUp;
