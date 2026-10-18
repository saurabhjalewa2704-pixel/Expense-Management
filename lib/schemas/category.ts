import { z } from "zod";

export const CATEGORY_COLORS = ["stone", "sage", "moss", "sky", "slate", "clay", "sand", "plum", "rose", "ochre"] as const;

export const CategoryInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Give the category a name.").max(32, "Keep the name under 32 characters."),
  kind: z.enum(["expense", "income"]),
  /** Only parents are allowed here, which is what keeps the taxonomy at two levels. */
  parent_id: z.uuid().nullish(),
  icon: z.string().min(1).max(40),
  color: z.enum(CATEGORY_COLORS),
});
export type CategoryInput = z.input<typeof CategoryInput>;
