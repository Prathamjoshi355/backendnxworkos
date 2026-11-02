import mongoose, { Schema } from "mongoose";

export type PerformancePeriodType = "DAILY" | "WEEKLY" | "MONTHLY";

export interface IPerformanceSnapshot extends mongoose.Document {
  userId: mongoose.Types.ObjectId | string;
  organizationId: mongoose.Types.ObjectId | string;
  periodType: PerformancePeriodType;
  periodStart: Date;
  periodEnd: Date;
  performanceScore: number;
  taskCompletionScore: number;
  timelinessScore: number;
  attendanceScore: number;
  targetScore: number;
  consistencyScore: number;
  productivityScore: number;
  calculationVersion: number;
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PerformanceSnapshotSchema = new Schema<IPerformanceSnapshot>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    periodType: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY"], required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    performanceScore: { type: Number, required: true, min: 0, max: 100 },
    taskCompletionScore: { type: Number, required: true, min: 0, max: 100 },
    timelinessScore: { type: Number, required: true, min: 0, max: 100 },
    attendanceScore: { type: Number, required: true, min: 0, max: 100 },
    targetScore: { type: Number, required: true, min: 0, max: 100 },
    consistencyScore: { type: Number, required: true, min: 0, max: 100 },
    productivityScore: { type: Number, required: true, min: 0, max: 100 },
    calculationVersion: { type: Number, default: 1 },
    calculatedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Indexes for efficient querying
PerformanceSnapshotSchema.index({ userId: 1, periodStart: -1 });
PerformanceSnapshotSchema.index({ organizationId: 1, periodStart: -1 });
PerformanceSnapshotSchema.index({ userId: 1, periodType: 1, periodStart: -1 });

export const PerformanceSnapshot =
  (mongoose.models.PerformanceSnapshot as mongoose.Model<IPerformanceSnapshot>) ||
  mongoose.model<IPerformanceSnapshot>("PerformanceSnapshot", PerformanceSnapshotSchema);
