import mongoose, { Schema } from "mongoose";

export interface IHoliday extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  name: string;
  date: Date;
  year: number;
  isGovernmentHoliday: boolean;
  status: "ACTIVE" | "INACTIVE";
  description?: string | null;
  createdBy?: mongoose.Types.ObjectId | string | null;
  createdAt: Date;
  updatedAt: Date;
}

const HolidaySchema = new Schema<IHoliday>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true, index: true },
    year: { type: Number, required: true, index: true },
    isGovernmentHoliday: { type: Boolean, default: true, index: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
    description: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

HolidaySchema.index({ organizationId: 1, date: 1 }, { unique: true });
HolidaySchema.index({ organizationId: 1, year: 1, status: 1 });

export const Holiday =
  (mongoose.models.Holiday as mongoose.Model<IHoliday>) ||
  mongoose.model<IHoliday>("Holiday", HolidaySchema);

export default Holiday;

