import User from "../models/User";

export async function generateEmployeeId(employmentType: string) {
  const prefix = employmentType === "INTERN" ? "NX-INT-" : "NX-EMP-";
  const users = await User.find({ employeeId: { $regex: `^${prefix}` } }).select("employeeId").lean();
  let max = 0;
  for (const u of users) {
    if (u.employeeId) {
      const match = u.employeeId.match(/^NX-(?:EMP|INT)-(\d+)$/);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > max) {
          max = num;
        }
      }
    }
  }
  let candidateNum = max + 1;
  let candidateId = `${prefix}${String(candidateNum).padStart(4, "0")}`;
  while (await User.exists({ employeeId: candidateId })) {
    candidateNum++;
    candidateId = `${prefix}${String(candidateNum).padStart(4, "0")}`;
  }
  return candidateId;
}
