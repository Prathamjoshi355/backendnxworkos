import { getSocket } from "./socket";
import { IPointTransaction } from "../models/PointTransaction";
import { IPerformanceSnapshot } from "../models/PerformanceSnapshot";
import { ITarget } from "../models/Target";
import { ObjectId } from "mongoose";

/**
 * Emit point transaction event to user and organization
 */
export function emitPointsUpdated(
  userId: string | ObjectId,
  transaction: IPointTransaction,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      points: transaction.points,
      type: transaction.type,
      sourceType: transaction.sourceType,
      reason: transaction.reason,
      timestamp: transaction.createdAt,
      userId: String(userId),
    };
    io.to(`user:${userId}`).emit("points:updated", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("points:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting points:updated event:", error);
  }
}

/**
 * Emit performance update event to user and organization
 */
export function emitPerformanceUpdated(
  userId: string | ObjectId,
  snapshot: IPerformanceSnapshot,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      userId: String(userId),
      performanceScore: snapshot.performanceScore,
      taskCompletionScore: snapshot.taskCompletionScore,
      timelinessScore: snapshot.timelinessScore,
      attendanceScore: snapshot.attendanceScore,
      targetScore: snapshot.targetScore,
      consistencyScore: snapshot.consistencyScore,
      productivityScore: snapshot.productivityScore,
      periodType: snapshot.periodType,
      timestamp: snapshot.calculatedAt,
    };
    io.to(`user:${userId}`).emit("performance:updated", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("performance:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting performance:updated event:", error);
  }
}

/**
 * Emit target update event to user
 */
export function emitTargetUpdated(userId: string | ObjectId, target: ITarget) {
  try {
    const io = getSocket();
    const progress = (target.currentValue / target.targetValue) * 100;
    io.to(`user:${userId}`).emit("target:updated", {
      targetId: target._id,
      title: target.title,
      currentValue: target.currentValue,
      targetValue: target.targetValue,
      progress,
      status: target.status,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error emitting target:updated event:", error);
  }
}

/**
 * Emit target achieved event to user
 */
export function emitTargetAchieved(userId: string | ObjectId, target: ITarget) {
  try {
    const io = getSocket();
    io.to(`user:${userId}`).emit("target:achieved", {
      targetId: target._id,
      title: target.title,
      achievedAt: new Date(),
    });
  } catch (error) {
    console.error("Error emitting target:achieved event:", error);
  }
}

/**
 * Emit EOD / Daily Report submitted event to user, team, manager, and org
 */
export function emitEODSubmitted(
  userId: string | ObjectId,
  report: any,
  organizationId?: string | ObjectId,
  teamId?: string | ObjectId | null,
  managerId?: string | ObjectId | null,
  teamLeadId?: string | ObjectId | null
) {
  try {
    const io = getSocket();
    const payload = {
      reportId: report._id || report.id,
      userId: String(userId),
      reportDate: report.reportDate,
      status: report.status,
      tasksCompleted: report.tasksCompleted ?? report.completedTasks ?? 0,
      totalWorkedMinutes: report.totalWorkedMinutes ?? 0,
      performanceScore: report.performanceScore ?? 0,
      timestamp: new Date(),
    };

    io.to(`user:${userId}`).emit("eod:submitted", payload);
    io.to(`user:${userId}`).emit("daily-report:submitted", payload);

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("eod:submitted", payload);
      io.to(`org:${organizationId}`).emit("daily-report:submitted", payload);
    }
    if (teamId) {
      io.to(`team:${teamId}`).emit("eod:submitted", payload);
      io.to(`team:${teamId}`).emit("daily-report:submitted", payload);
    }
    if (managerId && String(managerId) !== String(userId)) {
      io.to(`user:${managerId}`).emit("eod:submitted", payload);
      io.to(`user:${managerId}`).emit("daily-report:submitted", payload);
    }
    if (teamLeadId && String(teamLeadId) !== String(userId)) {
      io.to(`user:${teamLeadId}`).emit("eod:submitted", payload);
      io.to(`user:${teamLeadId}`).emit("daily-report:submitted", payload);
    }
  } catch (error) {
    console.error("Error emitting eod:submitted event:", error);
  }
}

/**
 * Emit EOD / Daily Report reviewed / approved / rework event
 */
export function emitEODReviewed(
  userId: string | ObjectId,
  report: any,
  organizationId?: string | ObjectId,
  teamId?: string | ObjectId | null,
  reviewerId?: string | ObjectId | null
) {
  try {
    const io = getSocket();
    const payload = {
      reportId: report._id || report.id,
      userId: String(userId),
      reportDate: report.reportDate,
      status: report.status,
      reviewerId: reviewerId ? String(reviewerId) : null,
      reviewerRemarks: report.reviewerRemarks || report.reviewRemarks || report.reworkReason || null,
      finalScore: report.finalScore ?? report.performanceScore ?? null,
      timestamp: new Date(),
    };

    io.to(`user:${userId}`).emit("eod:reviewed", payload);
    io.to(`user:${userId}`).emit("daily-report:reviewed", payload);
    if (report.status === "APPROVED") {
      io.to(`user:${userId}`).emit("eod:approved", payload);
    } else if (report.status === "REWORK_REQUIRED" || report.status === "RETURNED") {
      io.to(`user:${userId}`).emit("eod:returned", payload);
    }

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("eod:reviewed", payload);
      io.to(`org:${organizationId}`).emit("daily-report:reviewed", payload);
    }
    if (teamId) {
      io.to(`team:${teamId}`).emit("eod:reviewed", payload);
      io.to(`team:${teamId}`).emit("daily-report:reviewed", payload);
    }
  } catch (error) {
    console.error("Error emitting eod:reviewed event:", error);
  }
}

/**
 * Emit EOD / Daily Report updated / draft event
 */
export function emitEODUpdated(
  userId: string | ObjectId,
  report: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      reportId: report._id || report.id,
      userId: String(userId),
      reportDate: report.reportDate,
      status: report.status,
      timestamp: new Date(),
    };

    io.to(`user:${userId}`).emit("eod:updated", payload);
    io.to(`user:${userId}`).emit("daily-report:updated", payload);

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("eod:updated", payload);
      io.to(`org:${organizationId}`).emit("daily-report:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting eod:updated event:", error);
  }
}

/**
 * Emit project creation event
 */
export function emitProjectCreated(
  project: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      projectId: project._id || project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      priority: project.priority,
      ownerId: project.ownerId ? String(project.ownerId._id || project.ownerId) : null,
      members: Array.isArray(project.members) ? project.members.map((m: any) => String(m._id || m)) : [],
      progress: project.progress || 0,
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("project:created", payload);
    }
    for (const memberId of payload.members) {
      io.to(`user:${memberId}`).emit("project:created", payload);
    }
  } catch (error) {
    console.error("Error emitting project:created event:", error);
  }
}

/**
 * Emit project update event
 */
export function emitProjectUpdated(
  project: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      projectId: project._id || project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      priority: project.priority,
      ownerId: project.ownerId ? String(project.ownerId._id || project.ownerId) : null,
      members: Array.isArray(project.members) ? project.members.map((m: any) => String(m._id || m)) : [],
      progress: project.progress || 0,
      totalTasks: project.totalTasks,
      completedTasks: project.completedTasks,
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("project:updated", payload);
      io.to(`org:${organizationId}`).emit("project:progress_updated", payload);
    }
    for (const memberId of payload.members) {
      io.to(`user:${memberId}`).emit("project:updated", payload);
      io.to(`user:${memberId}`).emit("project:progress_updated", payload);
    }
  } catch (error) {
    console.error("Error emitting project:updated event:", error);
  }
}

/**
 * Emit project member added event
 */
export function emitProjectMemberAdded(
  project: any,
  memberId: string | ObjectId,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      projectId: project._id || project.id,
      name: project.name,
      memberId: String(memberId),
      members: Array.isArray(project.members) ? project.members.map((m: any) => String(m._id || m)) : [],
      timestamp: new Date(),
    };

    io.to(`user:${memberId}`).emit("project:member_added", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("project:member_added", payload);
      io.to(`org:${organizationId}`).emit("project:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting project:member_added event:", error);
  }
}

/**
 * Emit project member removed event
 */
export function emitProjectMemberRemoved(
  project: any,
  memberId: string | ObjectId,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      projectId: project._id || project.id,
      name: project.name,
      memberId: String(memberId),
      members: Array.isArray(project.members) ? project.members.map((m: any) => String(m._id || m)) : [],
      timestamp: new Date(),
    };

    io.to(`user:${memberId}`).emit("project:member_removed", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("project:member_removed", payload);
      io.to(`org:${organizationId}`).emit("project:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting project:member_removed event:", error);
  }
}

/**
 * Emit project archived/cancelled event
 */
export function emitProjectArchived(
  project: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      projectId: project._id || project.id,
      name: project.name,
      status: project.status || "CANCELLED",
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("project:archived", payload);
      io.to(`org:${organizationId}`).emit("project:updated", payload);
    }
    const members = Array.isArray(project.members) ? project.members : [];
    for (const member of members) {
      const mid = String(member._id || member);
      io.to(`user:${mid}`).emit("project:archived", payload);
      io.to(`user:${mid}`).emit("project:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting project:archived event:", error);
  }
}

/**
 * Emit meeting creation event
 */
export function emitMeetingCreated(
  meeting: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const participants = Array.isArray(meeting.participants)
      ? meeting.participants.map((p: any) => String(p.userId?._id || p.userId || p))
      : [];
    const payload = {
      meetingId: meeting._id || meeting.id,
      code: meeting.meetingId,
      title: meeting.title,
      date: meeting.date,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      meetingType: meeting.meetingType,
      status: meeting.status,
      organizerId: meeting.organizerId ? String(meeting.organizerId._id || meeting.organizerId) : null,
      participants,
      location: meeting.location,
      meetingLink: meeting.meetingLink,
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("meeting:created", payload);
    }
    for (const pId of participants) {
      io.to(`user:${pId}`).emit("meeting:created", payload);
    }
  } catch (error) {
    console.error("Error emitting meeting:created event:", error);
  }
}

/**
 * Emit meeting updated event
 */
export function emitMeetingUpdated(
  meeting: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const participants = Array.isArray(meeting.participants)
      ? meeting.participants.map((p: any) => String(p.userId?._id || p.userId || p))
      : [];
    const payload = {
      meetingId: meeting._id || meeting.id,
      code: meeting.meetingId,
      title: meeting.title,
      date: meeting.date,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      meetingType: meeting.meetingType,
      status: meeting.status,
      organizerId: meeting.organizerId ? String(meeting.organizerId._id || meeting.organizerId) : null,
      participants,
      location: meeting.location,
      meetingLink: meeting.meetingLink,
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("meeting:updated", payload);
    }
    for (const pId of participants) {
      io.to(`user:${pId}`).emit("meeting:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting meeting:updated event:", error);
  }
}

/**
 * Emit meeting cancelled event
 */
export function emitMeetingCancelled(
  meeting: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const participants = Array.isArray(meeting.participants)
      ? meeting.participants.map((p: any) => String(p.userId?._id || p.userId || p))
      : [];
    const payload = {
      meetingId: meeting._id || meeting.id,
      title: meeting.title,
      status: "CANCELLED",
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("meeting:cancelled", payload);
      io.to(`org:${organizationId}`).emit("meeting:updated", payload);
    }
    for (const pId of participants) {
      io.to(`user:${pId}`).emit("meeting:cancelled", payload);
      io.to(`user:${pId}`).emit("meeting:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting meeting:cancelled event:", error);
  }
}

/**
 * Emit meeting participant added event
 */
export function emitMeetingParticipantAdded(
  meeting: any,
  participantId: string | ObjectId,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      meetingId: meeting._id || meeting.id,
      title: meeting.title,
      participantId: String(participantId),
      timestamp: new Date(),
    };

    io.to(`user:${participantId}`).emit("meeting:participant_added", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("meeting:participant_added", payload);
      io.to(`org:${organizationId}`).emit("meeting:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting meeting:participant_added event:", error);
  }
}

/**
 * Emit meeting participant removed event
 */
export function emitMeetingParticipantRemoved(
  meeting: any,
  participantId: string | ObjectId,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      meetingId: meeting._id || meeting.id,
      title: meeting.title,
      participantId: String(participantId),
      timestamp: new Date(),
    };

    io.to(`user:${participantId}`).emit("meeting:participant_removed", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("meeting:participant_removed", payload);
      io.to(`org:${organizationId}`).emit("meeting:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting meeting:participant_removed event:", error);
  }
}

/**
 * Emit meeting RSVP updated event
 */
export function emitMeetingRsvpUpdated(
  meeting: any,
  userId: string | ObjectId,
  responseStatus: string,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      meetingId: meeting._id || meeting.id,
      userId: String(userId),
      responseStatus,
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("meeting:rsvp_updated", payload);
      io.to(`org:${organizationId}`).emit("meeting:updated", payload);
    }
    if (meeting.organizerId) {
      const orgId = String(meeting.organizerId._id || meeting.organizerId);
      io.to(`user:${orgId}`).emit("meeting:rsvp_updated", payload);
    }
  } catch (error) {
    console.error("Error emitting meeting:rsvp_updated event:", error);
  }
}

/**
 * Emit message created event
 */
export function emitMessageCreated(
  message: any,
  conversation: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      message: message.toObject ? message.toObject() : message,
      conversationId: String(conversation._id || conversation.id || conversation),
      timestamp: new Date(),
    };

    const cId = String(conversation._id || conversation.id || conversation);
    io.to(`conversation:${cId}`).emit("message:created", payload);

    if (conversation && conversation.participants && Array.isArray(conversation.participants)) {
      for (const p of conversation.participants) {
        const pId = String(p._id || p.userId || p);
        io.to(`user:${pId}`).emit("message:created", payload);
      }
    }
  } catch (error) {
    console.error("Error emitting message:created event:", error);
  }
}

/**
 * Emit message updated event
 */
export function emitMessageUpdated(
  message: any,
  conversationId: string | ObjectId,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      message: message.toObject ? message.toObject() : message,
      conversationId: String(conversationId),
      timestamp: new Date(),
    };

    io.to(`conversation:${String(conversationId)}`).emit("message:updated", payload);
  } catch (error) {
    console.error("Error emitting message:updated event:", error);
  }
}

/**
 * Emit message deleted event
 */
export function emitMessageDeleted(
  messageId: string | ObjectId,
  conversationId: string | ObjectId,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      messageId: String(messageId),
      conversationId: String(conversationId),
      timestamp: new Date(),
    };

    io.to(`conversation:${String(conversationId)}`).emit("message:deleted", payload);
  } catch (error) {
    console.error("Error emitting message:deleted event:", error);
  }
}

/**
 * Emit message read event
 */
export function emitMessageRead(
  conversationId: string | ObjectId,
  userId: string | ObjectId,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      conversationId: String(conversationId),
      userId: String(userId),
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("message:read", payload);
    }
  } catch (error) {
    console.error("Error emitting message:read event:", error);
  }
}

/**
 * Emit conversation created event
 */
export function emitConversationCreated(
  conversation: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      conversation: conversation.toObject ? conversation.toObject() : conversation,
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("conversation:created", payload);
    }

    if (conversation && conversation.participants && Array.isArray(conversation.participants)) {
      for (const p of conversation.participants) {
        const pId = String(p._id || p.userId || p);
        io.to(`user:${pId}`).emit("conversation:created", payload);
      }
    }
  } catch (error) {
    console.error("Error emitting conversation:created event:", error);
  }
}

/**
 * Emit conversation updated event
 */
export function emitConversationUpdated(
  conversation: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      conversation: conversation.toObject ? conversation.toObject() : conversation,
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("conversation:updated", payload);
    }

    if (conversation && conversation.participants && Array.isArray(conversation.participants)) {
      for (const p of conversation.participants) {
        const pId = String(p._id || p.userId || p);
        io.to(`user:${pId}`).emit("conversation:updated", payload);
      }
    }
  } catch (error) {
    console.error("Error emitting conversation:updated event:", error);
  }
}

/**
 * Emit employee created event (organization directory update)
 */
export function emitEmployeeCreated(
  employee: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      employee: {
        id: String(employee._id || employee.id),
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        email: employee.email,
        role: employee.role,
        designation: employee.designation,
        departmentId: employee.departmentId,
        teamId: employee.teamId,
        status: employee.status,
      },
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("employee:created", payload);
    }
  } catch (error) {
    console.error("Error emitting employee:created event:", error);
  }
}

/**
 * Emit employee updated event
 */
export function emitEmployeeUpdated(
  employee: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      employee: {
        id: String(employee._id || employee.id),
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        email: employee.email,
        role: employee.role,
        designation: employee.designation,
        departmentId: employee.departmentId,
        teamId: employee.teamId,
        status: employee.status,
        employmentStatus: employee.employmentStatus,
      },
      timestamp: new Date(),
    };

    if (organizationId) {
      io.to(`org:${organizationId}`).emit("employee:updated", payload);
    }
    const empId = String(employee._id || employee.id);
    io.to(`user:${empId}`).emit("employee:updated", payload);
  } catch (error) {
    console.error("Error emitting employee:updated event:", error);
  }
}

/**
 * Emit employee status / lifecycle updated event
 */
export function emitEmployeeStatusUpdated(
  userId: string | ObjectId,
  statusPayload: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      userId: String(userId),
      ...statusPayload,
      timestamp: new Date(),
    };

    io.to(`user:${userId}`).emit("employee:status_updated", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("employee:status_updated", payload);
    }
  } catch (error) {
    console.error("Error emitting employee:status_updated event:", error);
  }
}

/**
 * Emit onboarding updated event
 */
export function emitOnboardingUpdated(
  userId: string | ObjectId,
  onboardingPayload: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      userId: String(userId),
      ...onboardingPayload,
      timestamp: new Date(),
    };

    io.to(`user:${userId}`).emit("onboarding:updated", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("onboarding:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting onboarding:updated event:", error);
  }
}

/**
 * Emit offboarding updated event
 */
export function emitOffboardingUpdated(
  userId: string | ObjectId,
  offboardingPayload: any,
  organizationId?: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      userId: String(userId),
      ...offboardingPayload,
      timestamp: new Date(),
    };

    io.to(`user:${userId}`).emit("offboarding:updated", payload);
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("offboarding:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting offboarding:updated event:", error);
  }
}

/**
 * Emit file created event
 */
export function emitFileCreated(
  organizationId: string | ObjectId,
  filePayload: any,
  options?: { userId?: string | ObjectId; projectId?: string }
) {
  try {
    const io = getSocket();
    const payload = { ...filePayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("file:created", payload);
    }
    if (options?.userId) {
      io.to(`user:${options.userId}`).emit("file:created", payload);
    }
    if (options?.projectId) {
      io.to(`project:${options.projectId}`).emit("file:created", payload);
    }
  } catch (error) {
    console.error("Error emitting file:created event:", error);
  }
}

/**
 * Emit file updated event
 */
export function emitFileUpdated(
  organizationId: string | ObjectId,
  filePayload: any
) {
  try {
    const io = getSocket();
    const payload = { ...filePayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("file:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting file:updated event:", error);
  }
}

/**
 * Emit file deleted event
 */
export function emitFileDeleted(
  organizationId: string | ObjectId,
  filePayload: any
) {
  try {
    const io = getSocket();
    const payload = { ...filePayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("file:deleted", payload);
    }
  } catch (error) {
    console.error("Error emitting file:deleted event:", error);
  }
}

/**
 * Emit file restored event
 */
export function emitFileRestored(
  organizationId: string | ObjectId,
  filePayload: any
) {
  try {
    const io = getSocket();
    const payload = { ...filePayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("file:restored", payload);
    }
  } catch (error) {
    console.error("Error emitting file:restored event:", error);
  }
}

/**
 * Emit file version created event
 */
export function emitFileVersionCreated(
  organizationId: string | ObjectId,
  filePayload: any
) {
  try {
    const io = getSocket();
    const payload = { ...filePayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("file:version_created", payload);
    }
  } catch (error) {
    console.error("Error emitting file:version_created event:", error);
  }
}

/**
 * Emit folder created event
 */
export function emitFolderCreated(
  organizationId: string | ObjectId,
  folderPayload: any
) {
  try {
    const io = getSocket();
    const payload = { ...folderPayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("folder:created", payload);
    }
  } catch (error) {
    console.error("Error emitting folder:created event:", error);
  }
}

/**
 * Emit folder updated event
 */
export function emitFolderUpdated(
  organizationId: string | ObjectId,
  folderPayload: any
) {
  try {
    const io = getSocket();
    const payload = { ...folderPayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("folder:updated", payload);
    }
  } catch (error) {
    console.error("Error emitting folder:updated event:", error);
  }
}

/**
 * Emit folder deleted event
 */
export function emitFolderDeleted(
  organizationId: string | ObjectId,
  folderPayload: any
) {
  try {
    const io = getSocket();
    const payload = { ...folderPayload, timestamp: new Date() };
    if (organizationId) {
      io.to(`org:${organizationId}`).emit("folder:deleted", payload);
    }
  } catch (error) {
    console.error("Error emitting folder:deleted event:", error);
  }
}

/**
 * Emit message delivered event
 */
export function emitMessageDelivered(
  messageId: string | ObjectId,
  conversationId: string | ObjectId,
  recipientId: string | ObjectId
) {
  try {
    const io = getSocket();
    const payload = {
      messageId: String(messageId),
      conversationId: String(conversationId),
      recipientId: String(recipientId),
      timestamp: new Date(),
    };
    io.to(`conversation:${String(conversationId)}`).emit("message:delivered", payload);
  } catch (error) {
    console.error("Error emitting message:delivered event:", error);
  }
}
