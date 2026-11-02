import mongoose, { Schema } from "mongoose";

export type PointTransactionType = "EARNED" | "DEDUCTED" | "ADJUSTED";
export type PointSourceType = "TASK" | "TARGET" | "MANUAL" | "BONUS" | "PENALTY";

export interface IPointTransaction extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId: mongoose.Types.ObjectId | string;
  type: PointTransactionType;
  points: number;
  sourceType: PointSourceType;
  sourceId?: mongoose.Types.ObjectId | string | null;
  reason: string;
  createdBy?: mongoose.Types.ObjectId | string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PointTransactionSchema = new Schema<IPointTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    type: { type: String, enum: ["EARNED", "DEDUCTED", "ADJUSTED"], required: true },
    points: { type: Number, required: true },
    sourceType: { type: String, enum: ["TASK", "TARGET", "MANUAL", "BONUS", "PENALTY"], required: true },
    sourceId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Indexes for efficient querying
PointTransactionSchema.index({ userId: 1, createdAt: -1 });
PointTransactionSchema.index({ organizationId: 1, createdAt: -1 });
PointTransactionSchema.index({ sourceType: 1, sourceId: 1 });
PointTransactionSchema.index({ userId: 1, organizationId: 1, createdAt: -1 });

export const PointTransaction =
  (mongoose.models.PointTransaction as mongoose.Model<IPointTransaction>) ||
  mongoose.model<IPointTransaction>("PointTransaction", PointTransactionSchema);
export default PointTransaction;
