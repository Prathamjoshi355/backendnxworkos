import { connectToDatabase } from "../../../../../config/database";
import { getUserFromRequest, requireRole } from "../../../../../middleware/auth";
import Team from "../../../../../models/Team";
import User from "../../../../../models/User";
import { PerformanceScoreService } from "../../../../../services/performanceScoreService";
import { getManagementScope } from "../../../../../utils/scopeHelper";
import { success, error } from "../../../../../utils/response";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const authUser = await getUserFromRequest(request);
    if (!authUser) return error("UNAUTHORIZED", "Not authenticated", 401);
    if (!requireRole(authUser, ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_LEADER"])) {
      return error("FORBIDDEN", "Forbidden", 403);
    }

    const { id: teamId } = await context.params;
    const team = await Team.findById(teamId).lean();
    if (!team) return error("TEAM_NOT_FOUND", "Team not found", 404);

    if (authUser.role === "SUPER_ADMIN") {
      // Allowed
    } else if (authUser.role === "ADMIN") {
      if (String(team.organizationId) !== String(authUser.organizationId)) {
        return error("FORBIDDEN", "Forbidden", 403);
      }
    } else if (authUser.role === "MANAGER" || authUser.role === "TEAM_LEADER") {
      const scope = await getManagementScope(authUser);
      if (!scope.managedTeamIds.includes(String(teamId))) {
        return error("FORBIDDEN", "Forbidden - team outside management scope", 403);
      }
    }

    const members = await User.find({
      teamId: String(team._id),
      status: "ACTIVE",
    })
      .select("_id fullName email employeeId designation role")
      .lean();

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const memberScores = await Promise.all(
      members.map(async (m) => {
        try {
          const score = await PerformanceScoreService.calculateDailyPerformanceScore(
            String(m._id),
            String(team.organizationId || ""),
            start,
            end
          );
          return {
            user: m,
            performanceScore: score.performanceScore,
            metrics: score.metrics,
            scoreBreakdown: score.scoreBreakdown,
          };
        } catch (_) {
          return {
            user: m,
            performanceScore: 80,
            metrics: null,
            scoreBreakdown: null,
          };
        }
      })
    );

    const totalScores = memberScores.reduce((sum, item) => sum + item.performanceScore, 0);
    const averageScore = memberScores.length > 0 ? Math.round(totalScores / memberScores.length) : 0;

    return success({
      team: {
        id: String(team._id),
        name: team.name,
        code: team.code,
        departmentId: team.departmentId,
        managerId: team.managerId,
        teamLeadId: team.teamLeadId,
      },
      memberCount: members.length,
      averagePerformanceScore: averageScore,
      members: memberScores,
    });
  } catch (err: any) {
    return error("GET_TEAM_PERFORMANCE_FAILED", err.message || "Failed to get team performance", 500);
  }
}
