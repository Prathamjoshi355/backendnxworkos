import mongoose, { Schema } from "mongoose";

export interface ISystemSetting extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId | string;
  key: string;
  value: any;
  valueType: "STRING" | "NUMBER" | "BOOLEAN" | "JSON";
  category: "ORGANIZATION" | "ATTENDANCE" | "EOD" | "POINTS" | "PERFORMANCE" | "NOTIFICATIONS" | "LEAVE" | "PROJECTS" | "MEETINGS" | "SECURITY";
  updatedBy: mongoose.Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}

const SystemSettingSchema = new Schema<ISystemSetting>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    valueType: { type: String, enum: ["STRING", "NUMBER", "BOOLEAN", "JSON"], default: "STRING" },
    category: {
      type: String,
      enum: ["ORGANIZATION", "ATTENDANCE", "EOD", "POINTS", "PERFORMANCE", "NOTIFICATIONS", "LEAVE", "PROJECTS", "MEETINGS", "SECURITY"],
      default: "ORGANIZATION",
      index: true,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

SystemSettingSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const SystemSetting =
  (mongoose.models.SystemSetting as mongoose.Model<ISystemSetting>) ||
  mongoose.model<ISystemSetting>("SystemSetting", SystemSettingSchema);

export default SystemSetting;
