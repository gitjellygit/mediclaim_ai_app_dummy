export const MANAGER_ROLES = new Set(["ADMIN", "CLAIMS_MANAGER"]);

export function isManagerRole(role) {
  return MANAGER_ROLES.has(String(role || "").toUpperCase());
}

export function validatePriorityOverride({ role, managerPriority, managerPriorityReason }) {
  if (!managerPriority) return null;
  if (!isManagerRole(role)) {
    return { status: 403, error: "Only a claims manager or admin can override priority" };
  }
  if (
    managerPriority !== "NORMAL" &&
    !String(managerPriorityReason || "").trim()
  ) {
    return { status: 400, error: "A reason is required for High or Urgent manager priority" };
  }
  return null;
}

export function wouldRemoveActiveAdmin(target, patch = {}) {
  if (!target || target.role !== "ADMIN" || target.status !== "ACTIVE") return false;
  const suspending = patch.status === "SUSPENDED";
  const demoting = patch.role != null && patch.role !== "ADMIN";
  return suspending || demoting;
}

export function validateUserAdministrationMutation({
  actorId,
  target,
  patch = {},
  activeAdminCount = null
}) {
  if (patch.status === "SUSPENDED" && target?.id === actorId) {
    return { status: 409, error: "You cannot suspend your own account" };
  }

  if (
    wouldRemoveActiveAdmin(target, patch) &&
    Number(activeAdminCount) <= 1
  ) {
    return {
      status: 409,
      error: "At least one active administrator must remain in the organization"
    };
  }

  return null;
}

export function isAssignableUser(user) {
  return Boolean(user && user.status === "ACTIVE");
}

export function mentionsAreValid(requestedIds = [], activeUserIds = []) {
  const requested = new Set(requestedIds);
  const active = new Set(activeUserIds);
  if (requested.size !== requestedIds.length) return false;
  for (const id of requested) {
    if (!active.has(id)) return false;
  }
  return true;
}

export function canRespondToClinicalRequest({
  actorId,
  actorRole,
  assignedToUserId
}) {
  if (!assignedToUserId) return true;
  if (assignedToUserId === actorId) return true;
  return isManagerRole(actorRole);
}

export function shouldNotifyUser(actorId, targetUserId) {
  return Boolean(targetUserId && targetUserId !== actorId);
}

export function savedQueueVisibilityWhere({ organizationId, userId, teamId }) {
  const sharedTeamClause = teamId
    ? {
        AND: [
          { sharedWithTeam: true },
          { ownerUser: { is: { teamId } } }
        ]
      }
    : null;

  return {
    organizationId,
    OR: [
      { ownerUserId: userId },
      ...(sharedTeamClause ? [sharedTeamClause] : [])
    ]
  };
}
