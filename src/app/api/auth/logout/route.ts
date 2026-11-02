import { success } from "../../../../utils/response";

export async function POST() {
  // Placeholder: frontend should delete client token; server-side invalidation can be implemented later.
  return success({ message: "Logged out" });
}
