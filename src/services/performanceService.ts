export interface IPerformanceWeights {
  taskCompletionWeight: number; // 40%
  onTimeDeliveryWeight: number; // 20%
  timeEfficiencyWeight: number; // 15%
  qualityWeight: number; // 15%
  reviewerAssessmentWeight: number; // 10%
}

export const DEFAULT_PERFORMANCE_WEIGHTS: IPerformanceWeights = {
  taskCompletionWeight: 0.40,
  onTimeDeliveryWeight: 0.20,
  timeEfficiencyWeight: 0.15,
  qualityWeight: 0.15,
  reviewerAssessmentWeight: 0.10,
};

export interface IPerformanceInput {
  totalTasksAssigned: number;
  totalTasksCompleted: number;
  totalTasksPending?: number;
  totalTasksRejected?: number;
  totalTasksReworked?: number;
  tasksOverdue?: number;
  totalEstimatedMinutes?: number;
  totalActualMinutes?: number;
  productiveMinutes?: number;
  reviewerScore?: number | null;
  isLeaveDay?: boolean;
  isPartialDay?: boolean;
}

export interface IPerformanceOutput {
  performanceScore: number;
  completionRate: number;
  onTimeRate: number;
  timeEfficiency: number;
  reworkRate: number;
  breakdown: {
    completionScore: number;
    onTimeScore: number;
    timeEfficiencyScore: number;
    qualityScore: number;
    reviewerScore: number;
  };
  notes?: string;
}

export class PerformanceService {
  static calculateScore(input: IPerformanceInput, weights: IPerformanceWeights = DEFAULT_PERFORMANCE_WEIGHTS): IPerformanceOutput {
    // 1. Leave Day Handling
    if (input.isLeaveDay && input.totalTasksAssigned === 0) {
      return {
        performanceScore: 100,
        completionRate: 100,
        onTimeRate: 100,
        timeEfficiency: 100,
        reworkRate: 0,
        breakdown: {
          completionScore: 40,
          onTimeScore: 20,
          timeEfficiencyScore: 15,
          qualityScore: 15,
          reviewerScore: 10,
        },
        notes: "Approved leave / non-working day (standard baseline)",
      };
    }

    // 2. Task Completion Rate
    let completionRate = 100;
    if (input.totalTasksAssigned > 0) {
      completionRate = Math.min(100, Math.round((input.totalTasksCompleted / input.totalTasksAssigned) * 100));
    }

    // 3. On-Time Delivery Rate
    let onTimeRate = 100;
    if (input.totalTasksAssigned > 0) {
      const overdue = input.tasksOverdue || 0;
      onTimeRate = Math.max(0, Math.round(((input.totalTasksAssigned - overdue) / input.totalTasksAssigned) * 100));
    }

    // 4. Time Efficiency (Actual vs Estimated or Productive work vs 8h standard)
    let timeEfficiency = 100;
    const actual = input.totalActualMinutes || input.productiveMinutes || 0;
    const estimated = input.totalEstimatedMinutes || 0;

    if (estimated > 0 && actual > 0) {
      // If actual is within estimated time (<= 1.2x estimated)
      const ratio = estimated / actual;
      timeEfficiency = Math.min(100, Math.max(20, Math.round(ratio * 100)));
    } else if (actual > 0) {
      const targetMins = input.isPartialDay ? 240 : 480;
      timeEfficiency = Math.min(100, Math.round((actual / targetMins) * 100));
    } else if (input.totalTasksAssigned === 0) {
      timeEfficiency = 80;
    }

    // 5. Quality / Rework Rate
    let reworkRate = 0;
    const reworks = (input.totalTasksRejected || 0) + (input.totalTasksReworked || 0);
    if (input.totalTasksAssigned > 0) {
      reworkRate = Math.min(100, Math.round((reworks / input.totalTasksAssigned) * 100));
    }
    const qualityRate = Math.max(0, 100 - reworkRate);

    // 6. Reviewer Assessment
    const reviewerScoreVal = typeof input.reviewerScore === "number" ? Math.min(100, Math.max(0, input.reviewerScore)) : 80;

    // Component weighted scores
    const completionScore = (completionRate / 100) * (weights.taskCompletionWeight * 100);
    const onTimeScore = (onTimeRate / 100) * (weights.onTimeDeliveryWeight * 100);
    const timeEfficiencyScore = (timeEfficiency / 100) * (weights.timeEfficiencyWeight * 100);
    const qualityScore = (qualityRate / 100) * (weights.qualityWeight * 100);
    const reviewerScore = (reviewerScoreVal / 100) * (weights.reviewerAssessmentWeight * 100);

    const totalRaw = completionScore + onTimeScore + timeEfficiencyScore + qualityScore + reviewerScore;
    const finalScore = Math.min(100, Math.max(0, Math.round(totalRaw)));

    return {
      performanceScore: finalScore,
      completionRate,
      onTimeRate,
      timeEfficiency,
      reworkRate,
      breakdown: {
        completionScore: Math.round(completionScore * 10) / 10,
        onTimeScore: Math.round(onTimeScore * 10) / 10,
        timeEfficiencyScore: Math.round(timeEfficiencyScore * 10) / 10,
        qualityScore: Math.round(qualityScore * 10) / 10,
        reviewerScore: Math.round(reviewerScore * 10) / 10,
      },
    };
  }

  static async calculatePerformanceScore(userId: string, organizationId: string, startDate: Date, endDate: Date) {
    const { PerformanceScoreService } = await import("./performanceScoreService");
    return PerformanceScoreService.calculateDailyPerformanceScore(userId, organizationId, startDate, endDate);
  }

  static async createPerformanceSnapshot(userId: string, organizationId: string, periodType: string = "DAILY", startDate?: Date, endDate?: Date) {
    const { PerformanceScoreService } = await import("./performanceScoreService");
    return PerformanceScoreService.createDailyPerformanceSnapshot(userId, organizationId, startDate || new Date(), true);
  }

  static async getCurrentPerformance(userId: string, organizationId: string, periodType: string = "DAILY") {
    const { PerformanceScoreService } = await import("./performanceScoreService");
    return PerformanceScoreService.calculateDailyPerformanceScore(userId, organizationId, new Date(), new Date());
  }
}

export default PerformanceService;
