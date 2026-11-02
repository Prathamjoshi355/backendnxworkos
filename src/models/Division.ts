import mongoose, { Schema } from "mongoose";
import {
  DIVISION_CODE_REGEX,
  isReservedDivisionIdentity,
} from "../constants/division";

export type DivisionStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface IDivision extends mongoose.Document {
  organizationId: mongoose.Types.ObjectId;
  name: string;
  code: string;
  description?: string | null;
  divisionHeadId?: mongoose.Types.ObjectId | null;
  budgetCode?: string | null;
  status: DivisionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const DivisionSchema = new Schema<IDivision>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
      immutable: true, // Organization relationship cannot be altered after creation
    },
    name: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (val: string) => !isReservedDivisionIdentity(val),
        message:
          "RESERVED_DIVISION_NAME_PROHIBITED: The entity 'NX Media' is a reserved corporate entity and cannot be created as an internal division.",
      },
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: [
        DIVISION_CODE_REGEX,
        "Division code must contain 2-6 uppercase alphanumeric characters (^[A-Z0-9]{2,6}$)",
      ],
      immutable: true, // Division code is immutable after creation
    },
    description: { type: String, default: null },
    divisionHeadId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    budgetCode: { type: String, default: null },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "ARCHIVED"],
      default: "ACTIVE",
      index: true,
    },
  },
  { timestamps: true }
);

// Compound Unique Indexes within Parent Organization
DivisionSchema.index({ organizationId: 1, name: 1 }, { unique: true });
DivisionSchema.index({ organizationId: 1, code: 1 }, { unique: true });

// Pre-save hook: Enforces reserved name restriction
DivisionSchema.pre("save", function (next) {
  if (isReservedDivisionIdentity(this.name)) {
    return next(
      new Error(
        "RESERVED_DIVISION_NAME_PROHIBITED: The entity 'NX Media' is a reserved corporate entity and cannot be created as a division."
      )
    );
  }
  next();
});

// Pre-findOneAndUpdate hook: Enforces reserved name restriction and immutability
DivisionSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() as any;
  if (update) {
    const name = update.name || update.$set?.name;
    if (name && isReservedDivisionIdentity(name)) {
      return next(
        new Error(
          "RESERVED_DIVISION_NAME_PROHIBITED: The entity 'NX Media' is a reserved corporate entity and cannot be used as a division name."
        )
      );
    }

    // Guard against attempting to mutate immutable organizationId
    if (update.organizationId || update.$set?.organizationId) {
      return next(
        new Error("ORGANIZATION_IMMUTABLE: Division organization cannot be modified after creation.")
      );
    }

    // Guard against attempting to mutate immutable code
    if (update.code || update.$set?.code) {
      return next(
        new Error("DIVISION_CODE_IMMUTABLE: Division code cannot be modified after creation.")
      );
    }
  }
  next();
});

// Pre-updateOne and pre-updateMany hooks
DivisionSchema.pre(["updateOne", "updateMany"], function (next) {
  const update = this.getUpdate() as any;
  if (update) {
    const name = update.name || update.$set?.name;
    if (name && isReservedDivisionIdentity(name)) {
      return next(
        new Error(
          "RESERVED_DIVISION_NAME_PROHIBITED: The entity 'NX Media' is a reserved corporate entity and cannot be used as a division name."
        )
      );
    }
    if (update.organizationId || update.$set?.organizationId) {
      return next(
        new Error("ORGANIZATION_IMMUTABLE: Division organization cannot be modified after creation.")
      );
    }
    if (update.code || update.$set?.code) {
      return next(
        new Error("DIVISION_CODE_IMMUTABLE: Division code cannot be modified after creation.")
      );
    }
  }
  next();
});

export const Division =
  (mongoose.models.Division as mongoose.Model<IDivision>) ||
  mongoose.model<IDivision>("Division", DivisionSchema);

export default Division;
