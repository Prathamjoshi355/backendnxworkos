import mongoose, { Schema } from "mongoose";

export interface IAuditLog extends mongoose.Document {
  organizationId?: mongoose.Types.ObjectId | string | null;
  actorId?: mongoose.Types.ObjectId | string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: mongoose.Types.ObjectId | string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorRole: { type: String, default: null },
    action: { type: String, required: true, index: true },
    entityType: { type: String, default: null, index: true },
    entityId: { type: Schema.Types.ObjectId, default: null, index: true },
    summary: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog =
  (mongoose.models.AuditLog as mongoose.Model<IAuditLog>) ||
  mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);

export default AuditLog;
