import mongoose, { Schema } from "mongoose";

export interface ISchedulerLock extends mongoose.Document {
  jobName: string;
  scopeDate: string; // YYYY-MM-DD
  organizationId: string; // "GLOBAL" or ObjectId string
  status: "LOCKED" | "COMPLETED" | "FAILED";
  lockedAt: Date;
  lockedUntil: Date;
  completedAt?: Date | null;
  hostInstanceId?: string;
  resultSummary?: Record<string, any>;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SchedulerLockSchema = new Schema<ISchedulerLock>(
  {
    jobName: { type: String, required: true, index: true },
    scopeDate: { type: String, required: true, index: true },
    organizationId: { type: String, required: true, default: "GLOBAL", index: true },
    status: {
      type: String,
      enum: ["LOCKED", "COMPLETED", "FAILED"],
      default: "LOCKED",
      index: true,
    },
    lockedAt: { type: Date, required: true, default: Date.now },
    lockedUntil: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    hostInstanceId: { type: String, default: null },
    resultSummary: { type: Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

// Compound unique index ensuring only one active run per job per scopeDate per organization
SchedulerLockSchema.index({ jobName: 1, scopeDate: 1, organizationId: 1 }, { unique: true });

export const SchedulerLock =
  (mongoose.models.SchedulerLock as mongoose.Model<ISchedulerLock>) ||
  mongoose.model<ISchedulerLock>("SchedulerLock", SchedulerLockSchema);

export default SchedulerLock;

