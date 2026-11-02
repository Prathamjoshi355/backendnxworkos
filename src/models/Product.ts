import mongoose, { Schema } from "mongoose";

export interface IProduct extends mongoose.Document {
  productId: string;
  organizationId: mongoose.Types.ObjectId;
  name: string;
  code: string;
  description?: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt?: Date;
  updatedAt?: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    productId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    description: { type: String, default: null },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

ProductSchema.index({ organizationId: 1, name: 1 });

export const Product =
  (mongoose.models.Product as mongoose.Model<IProduct>) ||
  mongoose.model<IProduct>("Product", ProductSchema);

export default Product;
