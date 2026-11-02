import mongoose, { Schema } from "mongoose";

export interface ICallLog extends mongoose.Document {
  leadId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  startedAt: Date;
  endedAt?: Date | null;
  duration?: number | null; // in seconds
  outcome:
    | "CONNECTED"
    | "NO_ANSWER"
    | "BUSY"
    | "SWITCHED_OFF"
    | "WRONG_NUMBER"
    | "CALLBACK_REQUESTED"
    | "INTERESTED"
    | "NOT_INTERESTED"
    | "CONVERTED";
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const CallLogSchema = new Schema<ICallLog>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startedAt: { type: Date, required: true, default: () => new Date() },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: null }, // in seconds
    outcome: {
      type: String,
      enum: [
        "CONNECTED",
        "NO_ANSWER",
        "BUSY",
        "SWITCHED_OFF",
        "WRONG_NUMBER",
        "CALLBACK_REQUESTED",
        "INTERESTED",
        "NOT_INTERESTED",
        "CONVERTED",
      ],
      required: true,
    },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

// Performance indexes
CallLogSchema.index({ leadId: 1, createdAt: -1 });
CallLogSchema.index({ userId: 1, createdAt: -1 });
CallLogSchema.index({ leadId: 1, outcome: 1 });

export const CallLog =
  (mongoose.models.CallLog as mongoose.Model<ICallLog>) ||
  mongoose.model<ICallLog>("CallLog", CallLogSchema);

export default CallLog;
