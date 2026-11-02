import { Target, ITarget, TargetStatus, TargetPeriodType, TargetType } from "../models/Target";
import { Task } from "../models/Task";
import { createNotification } from "./notificationService";
import { emitTargetUpdated, emitTargetAchieved } from "../lib/socketEmitters";
import { ObjectId } from "mongoose";

export class TargetService {
  /**
   * Create a new target
   */
  static async createTarget(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    data: {
      departmentId?: string | ObjectId | null;
      teamId?: string | ObjectId | null;
      type: TargetType;
      title: string;
      targetValue: number;
      periodType: TargetPeriodType;
      startDate: Date;
      endDate: Date;
      createdBy: string | ObjectId;
    }
  ): Promise<ITarget> {
    const target = new Target({
      userId,
      organizationId,
      departmentId: data.departmentId || null,
      teamId: data.teamId || null,
      type: data.type,
      title: data.title,
      targetValue: data.targetValue,
      currentValue: 0,
      periodType: data.periodType,
      startDate: data.startDate,
      endDate: data.endDate,
      status: "ACTIVE",
      createdBy: data.createdBy,
    });

    return target.save();
  }

  /**
   * Update target
   */
  static async updateTarget(
    targetId: string | ObjectId,
    updates: Partial<ITarget>
  ): Promise<ITarget | null> {
    const updatedTarget = await Target.findByIdAndUpdate(targetId, updates, { new: true });
    return updatedTarget;
  }

  /**
   * Update target status
   */
  static async updateTargetStatus(
    targetId: string | ObjectId,
    status: TargetStatus
  ): Promise<ITarget | null> {
    return this.updateTarget(targetId, { status });
  }

  /**
   * Increment target progress (for TASK target when a task is completed)
   */
  static async incrementTargetProgress(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    targetType: TargetType,
    increment: number = 1
  ): Promise<ITarget[]> {
    const now = new Date();
    const targets = await Target.find({
      userId,
      organizationId,
      type: targetType,
      status: "ACTIVE",
      startDate: { $lte: now },
      endDate: { $gte: now },
    });

    const updatedTargets: ITarget[] = [];

    for (const target of targets) {
      // Prevent currentValue from exceeding targetValue (unless overachievement is allowed)
      const newValue = Math.min(target.currentValue + increment, target.targetValue);
      const status: TargetStatus = newValue >= target.targetValue ? "ACHIEVED" : "ACTIVE";

      const updated = await this.updateTarget(target._id, {
        currentValue: newValue,
        status,
      });

      if (updated) {
        updatedTargets.push(updated);

        // Emit update event
        emitTargetUpdated(userId, updated);

        // If target just achieved, create notification and emit event
        if (status === "ACHIEVED" && target.status !== "ACHIEVED") {
          await this.notifyTargetAchieved(updated);
          emitTargetAchieved(userId, updated);
        }
      }
    }

    return updatedTargets;
  }

  /**
   * Notify when target is achieved
   */
  private static async notifyTargetAchieved(target: ITarget): Promise<void> {
    try {
      await createNotification({
        recipientId: target.userId.toString(),
        organizationId: target.organizationId.toString(),
        type: "TARGET_ACHIEVED",
        title: "Target Achieved! 🎉",
        message: `You have achieved your target: ${target.title}`,
        entityType: "TARGET",
        entityId: target._id.toString(),
        priority: "HIGH",
      });
    } catch (error) {
      console.error("Error notifying target achievement:", error);
    }
  }

  /**
   * Get target progress percentage
   */
  static getProgressPercentage(target: ITarget): number {
    if (target.targetValue === 0) return 0;
    return Math.min(100, (target.currentValue / target.targetValue) * 100);
  }

  /**
   * Check and update active targets for completed task
   */
  static async updateTargetsForCompletedTask(
    userId: string | ObjectId,
    organizationId: string | ObjectId
  ): Promise<void> {
    try {
      await this.incrementTargetProgress(userId, organizationId, "TASKS", 1);
    } catch (error) {
      console.error("Error updating targets for completed task:", error);
    }
  }

  /**
   * Get user targets
   */
  static async getUserTargets(
    userId: string | ObjectId,
    organizationId: string | ObjectId,
    status?: TargetStatus
  ): Promise<ITarget[]> {
    const query: any = { userId, organizationId };
    if (status) {
      query.status = status;
    }
    return Target.find(query).sort({ createdAt: -1 });
  }

  /**
   * Get active targets for user
   */
  static async getActiveTargets(
    userId: string | ObjectId,
    organizationId: string | ObjectId
  ): Promise<ITarget[]> {
    const now = new Date();
    return Target.find({
      userId,
      organizationId,
      status: "ACTIVE",
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).sort({ endDate: 1 });
  }
}
