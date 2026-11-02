import mongoose, { Schema } from "mongoose";

export interface ITeam extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId | string;
  departmentId: mongoose.Types.ObjectId | string;
  divisionId?: mongoose.Types.ObjectId | string | null;
  name: string;
  code?: string | null;
  description?: string | null;
  managerId?: mongoose.Types.ObjectId | string | null;
  teamLeadId?: mongoose.Types.ObjectId | string | null;
  status: string;
}

const TeamSchema = new Schema<ITeam>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true, index: true },
    divisionId: { type: Schema.Types.ObjectId, ref: "Division", default: null, index: true },
    name: { type: String, required: true },
    code: { type: String, default: null },
    description: { type: String, default: null },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    teamLeadId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
  },
  { timestamps: true }
);

TeamSchema.index({ organizationId: 1, departmentId: 1, name: 1 }, { unique: true, partialFilterExpression: { name: { $exists: true } } });
TeamSchema.index({ organizationId: 1, managerId: 1 });
TeamSchema.index({ organizationId: 1, teamLeadId: 1 });
TeamSchema.index({ organizationId: 1, divisionId: 1 });

export const Team = (mongoose.models.Team as mongoose.Model<ITeam>) || mongoose.model<ITeam>("Team", TeamSchema);
export default Team;
