import { connectToDatabase } from "../../../../config/database";
import { getUserFromRequest } from "../../../../middleware/auth";
import { success, error } from "../../../../utils/response";
import Organization from "../../../../models/Organization";
import User from "../../../../models/User";

export async function GET(request: Request) {
  await connectToDatabase();
  const user = await getUserFromRequest(request);
  if (!user) return error("UNAUTHORIZED", "Not authenticated", 401);

  if (!user.organizationId) {
    let org = await Organization.findOne().lean();
    if (!org) {
      const created = await Organization.create({
        name: "NexisparkX Enterprise",
        code: "NX-MAIN",
        domain: "nexipark.com",
      });
      org = created.toObject();
    }
    await User.findByIdAndUpdate(user._id, { organizationId: org._id });
    user.organizationId = org._id;
  }

  return success({ user });
}
