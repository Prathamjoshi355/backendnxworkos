import mongoose, { Schema } from "mongoose";

export type PointRuleKey =
  | "TASK_APPROVED"
  | "TASK_EARLY_COMPLETION"
  | "TARGET_ACHIEVED"
  | "DAILY_REPORT_SUBMITTED"
  | "BONUS"
  | "PENALTY";

export interface IPointRule extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId | string;
  key: PointRuleKey;
  points: number;
  description?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PointRuleSchema = new Schema<IPointRule>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    key: { type: String, enum: ["TASK_APPROVED", "TASK_EARLY_COMPLETION", "TARGET_ACHIEVED", "DAILY_REPORT_SUBMITTED", "BONUS", "PENALTY"], required: true },
    points: { type: Number, required: true, default: 0 },
    description: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Unique rule per organization
PointRuleSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const PointRule =
  (mongoose.models.PointRule as mongoose.Model<IPointRule>) ||
  mongoose.model<IPointRule>("PointRule", PointRuleSchema);
