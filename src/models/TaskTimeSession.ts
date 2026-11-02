import mongoose, { Schema } from "mongoose";

export type TaskTimeStatus = "ACTIVE" | "PAUSED" | "COMPLETED";

export interface ITaskTimeSession extends mongoose.Document {
  taskId: mongoose.Types.ObjectId | string;
  userId: mongoose.Types.ObjectId | string;
  startedAt: Date;
  pausedAt?: Date | null;
  resumedAt?: Date | null;
  endedAt?: Date | null;
  activeSeconds: number;
  status: TaskTimeStatus;
  createdAt: Date;
  updatedAt: Date;
}

const TaskTimeSessionSchema = new Schema<ITaskTimeSession>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startedAt: { type: Date, required: true },
    pausedAt: { type: Date, default: null },
    resumedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    activeSeconds: { type: Number, default: 0 },
    status: { type: String, enum: ["ACTIVE", "PAUSED", "COMPLETED"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

TaskTimeSessionSchema.index({ taskId: 1, userId: 1, createdAt: 1 });

export const TaskTimeSession = (mongoose.models.TaskTimeSession as mongoose.Model<ITaskTimeSession>) || mongoose.model<ITaskTimeSession>("TaskTimeSession", TaskTimeSessionSchema);
export default TaskTimeSession;
