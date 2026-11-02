import mongoose, { Schema } from "mongoose";

export interface IAppVersion extends mongoose.Document {
  latestVersion: string;
  minimumSupportedVersion: string;
  releaseNotes?: string | null;
  windowsDownloadUrl?: string | null;
  androidDownloadUrl?: string | null;
  publishedAt: Date;
  isEnabled: boolean;
  updatedBy?: mongoose.Types.ObjectId | string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AppVersionSchema = new Schema<IAppVersion>(
  {
    latestVersion: { type: String, required: true, default: "1.0.0" },
    minimumSupportedVersion: { type: String, required: true, default: "1.0.0" },
    releaseNotes: { type: String, default: "Bug fixes and performance improvements" },
    windowsDownloadUrl: { type: String, default: "http://localhost:3000/downloads/windows" },
    androidDownloadUrl: { type: String, default: "http://localhost:3000/downloads/android" },
    publishedAt: { type: Date, default: Date.now },
    isEnabled: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const AppVersion =
  (mongoose.models.AppVersion as mongoose.Model<IAppVersion>) ||
  mongoose.model<IAppVersion>("AppVersion", AppVersionSchema);

export default AppVersion;
